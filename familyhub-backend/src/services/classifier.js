const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const CLASSIFICATION_PROMPT = `You are a family document and photo classifier. Analyze this file and return a JSON object with the following fields:

{
  "title": "A short descriptive title for this item",
  "description": "A 2-3 sentence description of what this file contains. Be specific about people, location, and activity.",
  "category": "One of: photo, document, receipt, letter, certificate, medical, legal, financial, other",
  "people": ["Array of people visible — use real names if you can identify them from the family knowledge below, otherwise describe them, e.g. 'man in blue jacket'"],
  "location": "Best estimate of where this was taken/created, using GPS and visual clues",
  "date_estimate": "Best estimate of when this was created/taken (ISO date or 'unknown')",
  "tags": ["Array of relevant keywords for search"],
  "sentiment": "One of: joyful, neutral, formal, somber"
}

Return ONLY the JSON object, no additional text.`;

// Build extra context from EXIF metadata and family knowledge
function buildContext(fileName, { exif, knowledge } = {}) {
  const lines = [`File name: "${fileName}"`];

  if (exif) {
    const parts = [];
    if (exif.time) parts.push(`Taken: ${exif.time}`);
    if (exif.location) {
      parts.push(`GPS: ${exif.location.latitude}, ${exif.location.longitude}`);
    }
    if (exif.cameraMake || exif.cameraModel) {
      parts.push(`Camera: ${[exif.cameraMake, exif.cameraModel].filter(Boolean).join(' ')}`);
    }
    if (exif.width && exif.height) {
      parts.push(`Resolution: ${exif.width}×${exif.height}`);
    }
    if (parts.length > 0) {
      lines.push(`\nPhoto metadata (EXIF): ${parts.join(' | ')}`);
    }
  }

  if (knowledge && knowledge.length > 0) {
    lines.push('\nFamily knowledge (use this to identify people and places):');
    for (const k of knowledge) {
      lines.push(`- ${k.fact}`);
    }
  }

  lines.push(`\n${CLASSIFICATION_PROMPT}`);
  return lines.join('\n');
}

// Extract useful EXIF fields from Google Drive's imageMediaMetadata
function extractExif(imageMediaMetadata) {
  if (!imageMediaMetadata) return null;
  const m = imageMediaMetadata;
  const exif = {};

  if (m.time) exif.time = m.time;
  if (m.location && (m.location.latitude != null || m.location.longitude != null)) {
    exif.location = {
      latitude: m.location.latitude,
      longitude: m.location.longitude,
      altitude: m.location.altitude || null,
    };
  }
  if (m.cameraMake) exif.cameraMake = m.cameraMake;
  if (m.cameraModel) exif.cameraModel = m.cameraModel;
  if (m.width) exif.width = m.width;
  if (m.height) exif.height = m.height;
  if (m.exposureTime) exif.exposureTime = m.exposureTime;
  if (m.aperture) exif.aperture = m.aperture;
  if (m.isoSpeed) exif.isoSpeed = m.isoSpeed;
  if (m.focalLength) exif.focalLength = m.focalLength;

  return Object.keys(exif).length > 0 ? exif : null;
}

async function classifyFile(fileBuffer, mimeType, fileName, { exif, knowledge } = {}) {
  const base64Data = fileBuffer.toString('base64');

  const contentBlock = mimeType === 'application/pdf'
    ? {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64Data,
        },
      }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: base64Data,
        },
      };

  const contextText = buildContext(fileName, { exif, knowledge });

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          contentBlock,
          {
            type: 'text',
            text: contextText,
          },
        ],
      },
    ],
  });

  const responseText = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in response');
    }
    return JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    console.error('Failed to parse classification response:', responseText);
    return {
      title: fileName,
      description: 'Classification failed - raw file',
      category: 'other',
      people: [],
      location: 'unknown',
      date_estimate: 'unknown',
      tags: [],
      sentiment: 'neutral',
    };
  }
}

module.exports = { classifyFile, extractExif };
