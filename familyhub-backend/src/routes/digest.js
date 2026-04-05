const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireApiKey } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const firestoreService = require('../services/firestore');
const weatherService = require('../services/weather');
const config = require('../config');

// Digest is AI-powered — limit to 5 requests per minute per IP
const digestLimiter = createRateLimiter({ windowMs: 60_000, max: 5, message: 'Too many digest requests. Please wait a moment.' });

const router = express.Router();
const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

// GET /api/digest — generate a warm family update from recent photos + weather
router.get('/digest', requireApiKey, digestLimiter, async (req, res) => {
  try {
    // 1. Fetch manifests and sort by recency
    const manifests = await firestoreService.getAllManifests();
    const sorted = manifests.sort((a, b) => {
      const dateA = a.exif?.time || a.driveCreatedTime || a.createdAt || '';
      const dateB = b.exif?.time || b.driveCreatedTime || b.createdAt || '';
      return dateB.localeCompare(dateA);
    });
    const recent = sorted.slice(0, 10);

    if (recent.length === 0) {
      return res.json({
        text: "Welcome to Family Hub! It looks like your vault is empty. Try uploading some photos or syncing from Google Drive to get started.",
        sources: [],
      });
    }

    // 2. Fetch profiles + weather
    const profiles = await firestoreService.getAllProfiles();
    const weatherResults = [];
    for (const profile of profiles) {
      if (!profile.location?.city) continue;
      try {
        const weather = await weatherService.getWeatherForCity(
          profile.location.city,
          profile.location.state
        );
        if (weather) {
          weatherResults.push({ name: profile.name, location: profile.location, weather });
        }
      } catch {}
    }

    // 3. Build context strings
    let familyContext = '';
    if (profiles.length > 0) {
      const lines = profiles.map(p => {
        const parts = [p.name];
        if (p.birthday) {
          const d = new Date(p.birthday + 'T00:00:00');
          const now = new Date();
          let age = now.getFullYear() - d.getFullYear();
          const m = now.getMonth() - d.getMonth();
          if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
          if (age >= 0) parts.push(`age ${age}`);
        }
        if (p.school) parts.push(`goes to ${p.school}`);
        if (p.location?.city) {
          const loc = p.location.state ? `${p.location.city}, ${p.location.state}` : p.location.city;
          parts.push(`lives in ${loc}`);
        }
        if (p.activities?.length > 0) parts.push(`activities: ${p.activities.join(', ')}`);
        if (p.notes) parts.push(`notes: ${p.notes}`);
        return `- ${parts.join(' | ')}`;
      });
      familyContext = `\nFAMILY MEMBERS:\n${lines.join('\n')}\n`;
    }

    let weatherContext = '';
    if (weatherResults.length > 0) {
      const lines = weatherResults.map(w => {
        const loc = w.location.state ? `${w.location.city}, ${w.location.state}` : w.location.city;
        return `- ${w.name} in ${loc}: ${Math.round(w.weather.temperature)}°F, ${w.weather.description}`;
      });
      weatherContext = `\nCURRENT WEATHER:\n${lines.join('\n')}\n`;
    }

    const itemSummaries = recent.map((m, i) => {
      const c = m.classification || {};
      const cor = m.corrections || {};
      const lines = [`[${i + 1}] "${c.title || m.fileName}"`];
      if (c.description) lines.push(c.description);
      if (cor.context) lines.push(`Context: ${cor.context}`);
      const people = (cor.people || c.people || []).join(', ');
      if (people) lines.push(`People: ${people}`);
      const location = cor.location || c.location || '';
      if (location) lines.push(`Location: ${location}`);
      const tags = (cor.tags || c.tags || []).join(', ');
      if (tags) lines.push(`Tags: ${tags}`);
      if (m.exif?.time) {
        lines.push(`Taken: ${m.exif.time}`);
      } else if (c.date_estimate && c.date_estimate !== 'unknown') {
        lines.push(`Date: ${c.date_estimate}`);
      } else if (m.driveCreatedTime) {
        lines.push(`Added: ${new Date(m.driveCreatedTime).toLocaleDateString()}`);
      }
      return lines.join(' | ');
    }).join('\n');

    // 4. Ask Claude for a warm digest
    const systemPrompt = `You are a warm, loving family assistant helping grandparents stay connected with their family. You're generating a welcome digest — a quick, heartfelt update on what's been happening with the family based on recent photos and current conditions.

STRICT RULES:
- Write in a warm, conversational tone — like a kind family member catching them up over coffee.
- Start with a warm greeting, then naturally weave in what the family has been up to based on the recent photos.
- Mention the weather and locations of family members naturally (e.g., "It's a beautiful 81°F day where Mia is in Palo Alto...").
- Keep it to 2-3 short paragraphs. Not too long — just enough to feel connected.
- Reference specific photos warmly when relevant ("There's a lovely shot of...").
- NEVER show IDs, file names, technical details, or system terminology.
- NEVER say you "can't display" photos — they appear automatically below your message.
- If there are photos worth highlighting, end with something like "Here are some recent favorites..." so the photo sources appear naturally below.
- Make the grandparent feel like they just got a wonderful update on their grandkids.
${familyContext}${weatherContext}
RECENT FAMILY MEMORIES (${recent.length} most recent):
${itemSummaries}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Give me a quick update on the family.' }],
    });

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    // Return up to 5 most interesting recent items as sources
    const sources = recent.slice(0, 5).map(m => ({
      id: m.id,
      driveFileId: m.driveFileId,
      fileName: m.fileName,
      mimeType: m.mimeType,
      classification: m.classification,
      corrections: m.corrections,
      source: m.source,
      gcsBucket: m.gcsBucket,
      gcsPath: m.gcsPath,
    }));

    res.json({ text, sources });
  } catch (err) {
    console.error('Digest error:', err.message);
    res.status(502).json({ error: 'Failed to generate family digest' });
  }
});

module.exports = router;
