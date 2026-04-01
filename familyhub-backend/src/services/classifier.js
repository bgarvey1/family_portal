const Anthropic = require('@anthropic-ai/sdk');
const ExifParser = require('exif-parser');
const sharp = require('sharp');
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

// Extract EXIF directly from image file bytes (works even when cloud APIs strip metadata)
function extractExifFromBytes(fileBuffer, mimeType) {
  // exif-parser only works with JPEG/TIFF
  if (!mimeType || (!mimeType.includes('jpeg') && !mimeType.includes('jpg') && !mimeType.includes('tiff'))) {
    return null;
  }

  try {
    const parser = ExifParser.create(fileBuffer);
    const result = parser.parse();
    const tags = result.tags || {};
    const exif = {};

    // Timestamp — DateTimeOriginal is when the photo was actually taken
    if (tags.DateTimeOriginal) {
      exif.time = new Date(tags.DateTimeOriginal * 1000).toISOString();
    } else if (tags.CreateDate) {
      exif.time = new Date(tags.CreateDate * 1000).toISOString();
    }

    // GPS
    if (tags.GPSLatitude != null && tags.GPSLongitude != null) {
      exif.location = {
        latitude: tags.GPSLatitude,
        longitude: tags.GPSLongitude,
        altitude: tags.GPSAltitude || null,
      };
    }

    // Camera
    if (tags.Make) exif.cameraMake = tags.Make;
    if (tags.Model) exif.cameraModel = tags.Model;

    // Image dimensions
    if (result.imageSize) {
      exif.width = result.imageSize.width;
      exif.height = result.imageSize.height;
    }

    // Exposure info
    if (tags.ExposureTime) exif.exposureTime = tags.ExposureTime;
    if (tags.FNumber) exif.aperture = tags.FNumber;
    if (tags.ISO) exif.isoSpeed = tags.ISO;
    if (tags.FocalLength) exif.focalLength = tags.FocalLength;

    return Object.keys(exif).length > 0 ? exif : null;
  } catch (err) {
    console.warn(`EXIF parse failed for ${mimeType}: ${err.message}`);
    return null;
  }
}

// Extract useful EXIF fields from Google Drive's imageMediaMetadata
function extractExifFromDrive(imageMediaMetadata) {
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

// Merge EXIF from multiple sources — file bytes take priority (most reliable),
// then Drive API metadata as fallback
function extractExif(imageMediaMetadata, fileBuffer, mimeType) {
  const fromBytes = fileBuffer ? extractExifFromBytes(fileBuffer, mimeType) : null;
  const fromDrive = extractExifFromDrive(imageMediaMetadata);

  if (!fromBytes && !fromDrive) return null;
  if (!fromBytes) return fromDrive;
  if (!fromDrive) return fromBytes;

  // Merge: bytes wins for each field, Drive fills gaps
  return { ...fromDrive, ...fromBytes };
}

// Resize image if over Claude's 5MB base64 limit (~3.75MB raw due to base64 overhead)
const MAX_IMAGE_BYTES = 3_500_000;

async function resizeIfNeeded(fileBuffer, mimeType) {
  if (!mimeType.startsWith('image/') || mimeType === 'image/gif') {
    return { buffer: fileBuffer, mimeType };
  }
  if (fileBuffer.length <= MAX_IMAGE_BYTES) {
    return { buffer: fileBuffer, mimeType };
  }

  console.log(`  Resizing ${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB image for classification...`);
  const resized = await sharp(fileBuffer)
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  console.log(`  Resized to ${(resized.length / 1024 / 1024).toFixed(1)}MB`);
  return { buffer: resized, mimeType: 'image/jpeg' };
}

async function classifyFile(fileBuffer, mimeType, fileName, { exif, knowledge } = {}) {
  // Resize large images to stay under Claude's limit
  const { buffer: classifyBuffer, mimeType: classifyMime } = await resizeIfNeeded(fileBuffer, mimeType);
  const base64Data = classifyBuffer.toString('base64');

  const contentBlock = classifyMime === 'application/pdf'
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
          media_type: classifyMime,
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
