const { Router } = require('express');
const { requireApiKey } = require('../middleware/auth');
const firestoreService = require('../services/firestore');
const weatherService = require('../services/weather');

const router = Router();

// GET /api/profiles — list all family profiles
router.get('/profiles', requireApiKey, async (req, res) => {
  try {
    const profiles = await firestoreService.getAllProfiles();
    res.json({ profiles, count: profiles.length });
  } catch (err) {
    console.error('Error fetching profiles:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/profiles/weather — get current weather for all profiles with locations
// IMPORTANT: must be defined before /profiles/:id to avoid "weather" matching as :id
router.get('/profiles/weather', requireApiKey, async (req, res) => {
  try {
    const profiles = await firestoreService.getAllProfiles();
    const results = [];

    for (const profile of profiles) {
      if (!profile.location || !profile.location.city) continue;

      try {
        const weather = await weatherService.getWeatherForCity(
          profile.location.city,
          profile.location.state
        );
        if (weather) {
          results.push({
            profileId: profile.id,
            name: profile.name,
            location: profile.location,
            weather,
          });
        }
      } catch (err) {
        console.warn(`Weather fetch failed for ${profile.name} (${profile.location.city}): ${err.message}`);
      }
    }

    res.json({ weather: results, count: results.length });
  } catch (err) {
    console.error('Error fetching profile weather:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profiles — create a new family profile
// Body: { name, age, birthday, school, location: { city, state }, activities: [], notes }
router.post('/profiles', requireApiKey, async (req, res) => {
  try {
    const { name, birthday, school, location, activities, notes, links } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }

    const profile = await firestoreService.addProfile({
      name: name.trim(),
      birthday: birthday || null,
      school: school || null,
      location: location || null, // { city, state }
      activities: activities || [],
      notes: notes || null,
      links: links || [], // [{ label, url }]
    });

    res.json({ profile, message: 'Profile created' });
  } catch (err) {
    console.error('Error creating profile:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/profiles/:id — update a family profile
router.patch('/profiles/:id', requireApiKey, async (req, res) => {
  try {
    const { name, birthday, school, location, activities, notes, links } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (birthday !== undefined) updates.birthday = birthday;
    if (school !== undefined) updates.school = school;
    if (location !== undefined) updates.location = location;
    if (activities !== undefined) updates.activities = activities;
    if (notes !== undefined) updates.notes = notes;
    if (links !== undefined) updates.links = links;

    await firestoreService.updateProfile(req.params.id, updates);
    res.json({ message: 'Profile updated', id: req.params.id });
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: err.message });
  }
});

// In-memory cache for crawled site content: url → { text, timestamp }
const crawlCache = new Map();
const CRAWL_TTL = 60 * 60 * 1000; // 1 hour

function extractText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractInternalLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = [];
  const seen = new Set();
  // Match href attributes
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const resolved = new URL(m[1], baseUrl);
      // Same domain, not anchor, not file download
      if (resolved.hostname === base.hostname && !resolved.hash && !resolved.pathname.match(/\.(pdf|jpg|png|gif|zip|doc|mp4)$/i)) {
        const key = resolved.origin + resolved.pathname;
        if (!seen.has(key) && key !== base.origin + '/' && key !== baseUrl) {
          seen.add(key);
          links.push(resolved.href);
        }
      }
    } catch {}
  }
  return links;
}

async function fetchPage(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FamilyHub/1.0' },
    });
    clearTimeout(timeout);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// Prioritize pages likely to have useful content
function scoreLink(url) {
  const path = url.toLowerCase();
  const keywords = ['about', 'news', 'events', 'academics', 'calendar', 'athletics', 'student', 'campus', 'admission', 'program', 'schedule', 'life'];
  let score = 0;
  for (const kw of keywords) {
    if (path.includes(kw)) score += 10;
  }
  // Prefer shorter paths (closer to root)
  score -= (path.split('/').length - 3) * 2;
  return score;
}

// POST /api/profiles/fetch-link — crawl a website and return extracted content
router.post('/profiles/fetch-link', requireApiKey, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    // Check cache
    const cached = crawlCache.get(url);
    if (cached && Date.now() - cached.timestamp < CRAWL_TTL) {
      return res.json({ text: cached.text, url, pages: cached.pages, fromCache: true });
    }

    console.log(`Crawling ${url} for profile context...`);

    // Fetch homepage
    const homeHtml = await fetchPage(url);
    if (!homeHtml) return res.json({ text: '', error: 'Failed to fetch homepage' });

    // Extract internal links, prioritize useful pages
    const internalLinks = extractInternalLinks(homeHtml, url);
    const rankedLinks = internalLinks
      .map(l => ({ url: l, score: scoreLink(l) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5); // Top 5 pages

    // Fetch subpages in parallel
    const subPages = await Promise.all(
      rankedLinks.map(async (link) => {
        const html = await fetchPage(link.url);
        if (!html) return null;
        const text = extractText(html).slice(0, 2000);
        return text.length > 100 ? { url: link.url, text } : null;
      })
    );

    // Combine: homepage (abbreviated) + subpages
    const homeText = extractText(homeHtml).slice(0, 1500);
    const parts = [`Homepage: ${homeText}`];
    const validSubs = subPages.filter(Boolean);
    for (const sub of validSubs) {
      const pageName = new URL(sub.url).pathname.replace(/\//g, ' ').trim() || 'page';
      parts.push(`${pageName}: ${sub.text}`);
    }

    const combined = parts.join('\n\n').slice(0, 8000); // Cap total at 8k
    const pagesCrawled = 1 + validSubs.length;

    console.log(`Crawled ${pagesCrawled} pages from ${url} (${combined.length} chars)`);

    // Cache result
    crawlCache.set(url, { text: combined, pages: pagesCrawled, timestamp: Date.now() });

    res.json({ text: combined, url, pages: pagesCrawled });
  } catch (err) {
    console.error('Crawl error:', err);
    res.json({ text: '', error: err.message });
  }
});

// DELETE /api/profiles/:id — delete a family profile
router.delete('/profiles/:id', requireApiKey, async (req, res) => {
  try {
    await firestoreService.deleteProfile(req.params.id);
    res.json({ message: 'Profile deleted', id: req.params.id });
  } catch (err) {
    console.error('Error deleting profile:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
