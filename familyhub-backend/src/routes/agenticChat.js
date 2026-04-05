const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireApiKey } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const firestoreService = require('../services/firestore');
const weatherService = require('../services/weather');
const config = require('../config');

// Agentic chat hits Claude API with tool use — limit to 15 requests per minute
const agenticLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 15,
  message: 'Too many chat requests. Please wait a moment and try again.',
});

const router = express.Router();
const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

// ── Tool Definitions ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'search_photos',
    description:
      'Search the family photo vault for photos and documents matching a query. ' +
      'Can filter by people, date range, category, or free-text search across titles, descriptions, tags, and locations. ' +
      'Returns up to 8 matching items with full metadata. Use this whenever the user asks about specific photos, events, people, or memories.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text search query to match against titles, descriptions, tags, locations, and context. Leave empty to match all.',
        },
        people: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to items featuring these people (e.g. ["Mia", "Ryan"]). Names are matched case-insensitively.',
        },
        category: {
          type: 'string',
          enum: ['photo', 'document', 'receipt', 'letter', 'certificate', 'medical', 'legal', 'financial', 'other'],
          description: 'Filter by item category.',
        },
        date_from: {
          type: 'string',
          description: 'Start date (inclusive) in YYYY-MM-DD format. Filters by EXIF time, classification date, or upload date.',
        },
        date_to: {
          type: 'string',
          description: 'End date (inclusive) in YYYY-MM-DD format.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return (default 8, max 15).',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_person_update',
    description:
      'Get a detailed update on a specific family member — their profile info, recent photos featuring them, current weather at their location, and any relevant knowledge base facts. ' +
      'Use this when the user asks "What\'s new with [name]?" or wants to know about a specific person.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The family member\'s name (e.g. "Mia", "Ryan").',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_weather',
    description:
      'Get the current weather and 7-day forecast for a family member\'s location. ' +
      'Use when the user asks about weather, or to add context about what conditions are like where a family member lives.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The family member\'s name to look up weather for.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_this_day_in_history',
    description:
      'Find photos and memories from the same date (month and day) in previous years. ' +
      'Great for "on this day" nostalgia or when the user wants to see what happened on a particular date in the past.',
    input_schema: {
      type: 'object',
      properties: {
        month: {
          type: 'integer',
          description: 'Month (1-12). Defaults to current month if not provided.',
        },
        day: {
          type: 'integer',
          description: 'Day of month (1-31). Defaults to current day if not provided.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_family_overview',
    description:
      'Get an overview of all family members — names, ages, schools, locations, activities, and current weather. ' +
      'Use this to understand who\'s in the family or when the user asks general family questions.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'browse_website',
    description:
      'Crawl a family member\'s linked website (school, organization, etc.) to get current information. ' +
      'Use when the user asks about a school, organization, or activity and you need up-to-date info from the website.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The family member whose linked website to browse.',
        },
        url: {
          type: 'string',
          description: 'Specific URL to browse. If not provided, will use the first link from the person\'s profile.',
        },
      },
      required: ['name'],
    },
  },
];

// ── Tool Implementations ────────────────────────────────────────────────────

async function execSearchPhotos({ query, people, category, date_from, date_to, limit }) {
  const maxResults = Math.min(limit || 8, 15);
  const manifests = await firestoreService.getAllManifests();

  const filtered = manifests.filter(m => {
    const c = m.classification || {};
    const cor = m.corrections || {};

    // Category filter
    if (category && c.category !== category) return false;

    // People filter (case-insensitive)
    if (people && people.length > 0) {
      const itemPeople = [...(cor.people || []), ...(c.people || [])].map(p => p.toLowerCase());
      const match = people.some(p => itemPeople.some(ip => ip.includes(p.toLowerCase())));
      if (!match) return false;
    }

    // Date filter
    const itemDate = m.exif?.time || c.date_estimate || m.driveCreatedTime || m.createdAt || '';
    const dateStr = itemDate.slice(0, 10); // YYYY-MM-DD
    if (date_from && dateStr < date_from) return false;
    if (date_to && dateStr > date_to) return false;

    // Text query filter
    if (query && query.trim()) {
      const q = query.toLowerCase();
      const searchable = [
        c.title, c.description, cor.context,
        ...(cor.people || []), ...(c.people || []),
        ...(cor.tags || []), ...(c.tags || []),
        cor.location, c.location,
        m.fileName,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }

    return true;
  });

  // Sort by date descending
  filtered.sort((a, b) => {
    const dateA = a.exif?.time || a.classification?.date_estimate || a.driveCreatedTime || a.createdAt || '';
    const dateB = b.exif?.time || b.classification?.date_estimate || b.driveCreatedTime || b.createdAt || '';
    return dateB.localeCompare(dateA);
  });

  const results = filtered.slice(0, maxResults);
  return {
    count: results.length,
    total_matching: filtered.length,
    items: results.map(formatManifest),
  };
}

async function execGetPersonUpdate({ name }) {
  const nameLower = name.toLowerCase();

  // Get profile
  const profiles = await firestoreService.getAllProfiles();
  const profile = profiles.find(p => p.name.toLowerCase().includes(nameLower));

  // Get recent photos featuring this person
  const manifests = await firestoreService.getAllManifests();
  const personPhotos = manifests
    .filter(m => {
      const people = [
        ...(m.corrections?.people || []),
        ...(m.classification?.people || []),
      ].map(p => p.toLowerCase());
      return people.some(p => p.includes(nameLower));
    })
    .sort((a, b) => {
      const dateA = a.exif?.time || a.driveCreatedTime || a.createdAt || '';
      const dateB = b.exif?.time || b.driveCreatedTime || b.createdAt || '';
      return dateB.localeCompare(dateA);
    })
    .slice(0, 8);

  // Get weather if profile has location
  let weather = null;
  if (profile?.location?.city) {
    try {
      weather = await weatherService.getWeatherForCity(
        profile.location.city,
        profile.location.state
      );
    } catch {}
  }

  // Get knowledge base entries about this person
  const knowledge = await firestoreService.getAllKnowledge();
  const personKnowledge = knowledge.filter(k =>
    (k.text || '').toLowerCase().includes(nameLower) ||
    (k.fact || '').toLowerCase().includes(nameLower)
  );

  return {
    profile: profile ? {
      name: profile.name,
      birthday: profile.birthday || null,
      age: profile.birthday ? calcAge(profile.birthday) : null,
      school: profile.school || null,
      location: profile.location || null,
      activities: profile.activities || [],
      notes: profile.notes || null,
      links: (profile.links || []).map(l => ({ label: l.label, url: l.url })),
    } : null,
    recent_photos: personPhotos.map(formatManifest),
    weather: weather ? {
      temperature: Math.round(weather.temperature),
      description: weather.description,
      city: weather.city,
      state: weather.state,
      forecast: (weather.forecast || []).slice(0, 5).map(d => ({
        date: d.date,
        high: d.high,
        low: d.low,
        description: d.description,
      })),
    } : null,
    knowledge_facts: personKnowledge.slice(0, 10).map(k => k.text || k.fact),
    photo_count: personPhotos.length,
  };
}

async function execGetWeather({ name }) {
  const nameLower = name.toLowerCase();
  const profiles = await firestoreService.getAllProfiles();
  const profile = profiles.find(p => p.name.toLowerCase().includes(nameLower));

  if (!profile?.location?.city) {
    return { error: `No location on file for ${name}. Try asking about a different family member.` };
  }

  try {
    const weather = await weatherService.getWeatherForCity(
      profile.location.city,
      profile.location.state
    );
    if (!weather) {
      return { error: `Could not fetch weather for ${profile.location.city}.` };
    }
    return {
      name: profile.name,
      city: weather.city,
      state: weather.state,
      temperature: Math.round(weather.temperature),
      description: weather.description,
      forecast: (weather.forecast || []).map(d => ({
        date: d.date,
        high: d.high,
        low: d.low,
        description: d.description,
      })),
    };
  } catch (err) {
    return { error: `Weather lookup failed: ${err.message}` };
  }
}

async function execGetThisDayInHistory({ month, day }) {
  const now = new Date();
  const targetMonth = month || (now.getMonth() + 1);
  const targetDay = day || now.getDate();
  const mm = String(targetMonth).padStart(2, '0');
  const dd = String(targetDay).padStart(2, '0');
  const currentYear = now.getFullYear();

  const manifests = await firestoreService.getAllManifests();
  const matches = manifests.filter(m => {
    const dateStr = m.exif?.time || m.classification?.date_estimate || m.driveCreatedTime || m.createdAt || '';
    const d = dateStr.slice(0, 10); // YYYY-MM-DD
    if (!d || d.length < 10) return false;
    // Match month and day, but exclude current year
    const itemMM = d.slice(5, 7);
    const itemDD = d.slice(8, 10);
    const itemYear = parseInt(d.slice(0, 4), 10);
    return itemMM === mm && itemDD === dd && itemYear < currentYear;
  });

  // Sort by year descending
  matches.sort((a, b) => {
    const dateA = a.exif?.time || a.classification?.date_estimate || a.driveCreatedTime || a.createdAt || '';
    const dateB = b.exif?.time || b.classification?.date_estimate || b.driveCreatedTime || b.createdAt || '';
    return dateB.localeCompare(dateA);
  });

  return {
    date: `${mm}-${dd}`,
    date_label: new Date(2000, targetMonth - 1, targetDay).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
    count: matches.length,
    items: matches.slice(0, 10).map(formatManifest),
  };
}

async function execGetFamilyOverview() {
  const profiles = await firestoreService.getAllProfiles();
  const members = [];

  for (const p of profiles) {
    const member = {
      name: p.name,
      age: p.birthday ? calcAge(p.birthday) : null,
      birthday: p.birthday || null,
      school: p.school || null,
      location: p.location || null,
      activities: p.activities || [],
      notes: p.notes || null,
    };

    if (p.location?.city) {
      try {
        const weather = await weatherService.getWeatherForCity(p.location.city, p.location.state);
        if (weather) {
          member.weather = {
            temperature: Math.round(weather.temperature),
            description: weather.description,
          };
        }
      } catch {}
    }

    members.push(member);
  }

  // Also get a quick count of total vault items
  const manifests = await firestoreService.getAllManifests();

  return {
    family_members: members,
    vault_item_count: manifests.length,
  };
}

// In-memory crawl cache (shared with profiles route pattern)
const crawlCache = new Map();
const CRAWL_TTL = 60 * 60 * 1000; // 1 hour

// SSRF protection: only allow http(s) to public hosts
function isAllowedUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    // Block internal/cloud metadata endpoints and private IPs
    if (host === 'localhost' || host === 'metadata.google.internal') return false;
    if (host.endsWith('.internal') || host.endsWith('.local')) return false;
    // Block private IP ranges
    const parts = host.split('.').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      if (parts[0] === 10) return false;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
      if (parts[0] === 192 && parts[1] === 168) return false;
      if (parts[0] === 127) return false;
      if (parts[0] === 169 && parts[1] === 254) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function execBrowseWebsite({ name, url }) {
  const nameLower = name.toLowerCase();
  const profiles = await firestoreService.getAllProfiles();
  const profile = profiles.find(p => p.name.toLowerCase().includes(nameLower));

  if (!profile) {
    return { error: `No profile found for ${name}.` };
  }

  // Determine URL to crawl
  let targetUrl = url;
  if (!targetUrl) {
    const link = (profile.links || [])[0];
    if (!link?.url) {
      return { error: `${profile.name} has no linked websites in their profile.` };
    }
    targetUrl = link.url;
  }

  // Validate URL to prevent SSRF
  if (!isAllowedUrl(targetUrl)) {
    return { error: `Cannot browse that URL — only public http/https websites are allowed.` };
  }

  // Check cache
  const cached = crawlCache.get(targetUrl);
  if (cached && Date.now() - cached.timestamp < CRAWL_TTL) {
    return { name: profile.name, url: targetUrl, content: cached.text, pages: cached.pages, from_cache: true };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FamilyHub/1.0' },
    });
    clearTimeout(timeout);

    if (!r.ok) {
      return { error: `Failed to fetch ${targetUrl}: HTTP ${r.status}` };
    }

    const html = await r.text();
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);

    crawlCache.set(targetUrl, { text, pages: 1, timestamp: Date.now() });

    return { name: profile.name, url: targetUrl, content: text, pages: 1 };
  } catch (err) {
    return { error: `Failed to browse ${targetUrl}: ${err.message}` };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function calcAge(birthday) {
  if (!birthday) return null;
  const d = new Date(birthday + 'T00:00:00');
  if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

function formatManifest(m) {
  const c = m.classification || {};
  const cor = m.corrections || {};
  return {
    id: m.id,
    driveFileId: m.driveFileId,
    fileName: m.fileName,
    mimeType: m.mimeType,
    source: m.source,
    gcsBucket: m.gcsBucket,
    gcsPath: m.gcsPath,
    title: c.title || m.fileName,
    description: c.description || '',
    category: c.category || 'other',
    people: cor.people || c.people || [],
    location: cor.location || c.location || '',
    tags: [...new Set([...(cor.tags || []), ...(c.tags || [])])],
    context: cor.context || '',
    date: m.exif?.time || c.date_estimate || m.driveCreatedTime || m.createdAt || '',
    sentiment: c.sentiment || '',
  };
}

// Map tool names to executor functions
const TOOL_EXECUTORS = {
  search_photos: execSearchPhotos,
  get_person_update: execGetPersonUpdate,
  get_weather: execGetWeather,
  get_this_day_in_history: execGetThisDayInHistory,
  get_family_overview: execGetFamilyOverview,
  browse_website: execBrowseWebsite,
};

// ── System Prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a warm, loving family storyteller helping grandparents stay connected with their family. You have access to a family photo vault, profiles, weather data, and knowledge base.

YOUR ROLE:
- You're like a kind family member sitting next to them, sharing updates and looking through photos together.
- Use your tools to actively explore the family's data based on what they ask about.
- Paint pictures with words — describe moments warmly, mention who's there and what they're doing.
- Weave in contextual details naturally (weather, locations, activities, school).

TOOL USAGE:
- Use search_photos to find relevant photos when the user mentions events, people, times, or memories.
- Use get_person_update when they ask about a specific family member — it gives you everything about them.
- Use get_weather to add weather context or when they ask about conditions where someone lives.
- Use get_this_day_in_history for "on this day" nostalgia or anniversary-type questions.
- Use get_family_overview to understand who's in the family when you need broad context.
- Use browse_website when they ask about schools, organizations, or activities linked in profiles.
- You can call multiple tools in one turn to gather comprehensive information.

STRICT RULES:
- ALWAYS respond in natural, conversational language. NEVER return JSON, arrays, code, or structured data.
- NEVER show IDs, file names, reference numbers, UUIDs, or any technical identifiers.
- NEVER say you "can't display" or "can't show" photos. Photos from your tool results will appear automatically below your message. Say things like "Here are some lovely photos..." or "Take a look at these..."
- Keep responses warm and concise — 2-3 paragraphs at most. No bullet points or numbered lists.
- If nothing matches, gently say so and suggest things they could ask about.
- Never mention "vault," "manifests," "tools," "database," or system terminology.
- Make every response feel like a personal family update, not a search result.`;

// ── Route Handler ───────────────────────────────────────────────────────────

// POST /api/chat/agentic — agentic chat with tool use
// Body: { message: string, history: [...] }
router.post('/chat/agentic', requireApiKey, agenticLimiter, async (req, res) => {
  const { message, history } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message string is required' });
  }

  try {
    // Build messages array from history + current message
    const messages = [];

    // Include recent conversation history (last 10 turns)
    const recentHistory = (history || []).slice(-10);
    for (const h of recentHistory) {
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: 'user', content: message });

    // Agentic loop: keep calling Claude until it produces a final text response
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    // Collect all source items from tool results for photo display
    const allSources = [];
    let loopCount = 0;
    const MAX_LOOPS = 5;

    while (response.stop_reason === 'tool_use' && loopCount < MAX_LOOPS) {
      loopCount++;

      // Extract tool use blocks
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      // Execute all tool calls
      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        const executor = TOOL_EXECUTORS[toolBlock.name];
        if (!executor) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: JSON.stringify({ error: `Unknown tool: ${toolBlock.name}` }),
          });
          continue;
        }

        console.log(`[agentic] Calling tool: ${toolBlock.name}`, JSON.stringify(toolBlock.input).slice(0, 200));

        try {
          const result = await executor(toolBlock.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: JSON.stringify(result),
          });

          // Collect photo sources from tool results
          if (result.items) {
            allSources.push(...result.items);
          }
          if (result.recent_photos) {
            allSources.push(...result.recent_photos);
          }
        } catch (err) {
          console.error(`[agentic] Tool ${toolBlock.name} error:`, err.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: JSON.stringify({ error: err.message }),
          });
        }
      }

      // Send tool results back to Claude
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });
    }

    // Extract final text response
    let text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    if (!text && allSources.length > 0) {
      text = "I found some wonderful family memories to share with you! Take a look at the photos below.";
    } else if (!text) {
      text = "I'm sorry, I had a little trouble putting that together. Could you try asking again?";
    }

    // Deduplicate sources by id, keep first occurrence
    const seenIds = new Set();
    const uniqueSources = [];
    for (const s of allSources) {
      if (!seenIds.has(s.id)) {
        seenIds.add(s.id);
        uniqueSources.push(s);
      }
    }

    // Return up to 8 source items for photo display
    const sources = uniqueSources.slice(0, 8).map(s => ({
      id: s.id,
      driveFileId: s.driveFileId,
      fileName: s.fileName,
      mimeType: s.mimeType,
      classification: { category: s.category, title: s.title },
      corrections: s.context ? { context: s.context } : undefined,
      source: s.source,
      gcsBucket: s.gcsBucket,
      gcsPath: s.gcsPath,
    }));

    res.json({ text, sources });
  } catch (err) {
    console.error('[agentic] Chat error:', err.message);
    res.status(502).json({ error: 'Failed to get response from Claude' });
  }
});

module.exports = router;
