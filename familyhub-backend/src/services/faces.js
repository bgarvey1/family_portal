const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Storage } = require('@google-cloud/storage');
const sharp = require('sharp');
const config = require('../config');
const firestoreService = require('./firestore');
const driveService = require('./drive');

const storage = new Storage();
const BUCKET_NAME = `${config.gcpProjectId}-familyhub-uploads`;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ── Face Crop Management ────────────────────────────────────────────────────

/**
 * Crop a face region from a photo given click coordinates (as percentages 0-1).
 * Returns a ~300x300 crop centered on the click point.
 */
async function cropFace(imageBuffer, clickX, clickY, mimeType) {
  // First, auto-rotate based on EXIF orientation so coordinates match what the browser displays.
  // iPhone photos are stored rotated with an EXIF tag — the browser auto-corrects for display,
  // but sharp operates on raw pixels. rotate() with no args applies the EXIF orientation.
  const rotatedBuffer = await sharp(imageBuffer).rotate().toBuffer();

  // Get dimensions AFTER rotation (these match what the user sees in the browser)
  const metadata = await sharp(rotatedBuffer).metadata();
  const { width, height } = metadata;

  // Convert percentage coords to pixels
  const px = Math.round(clickX * width);
  const py = Math.round(clickY * height);

  // Crop a square region — ~15% of smallest dimension captures face + shoulders nicely
  const cropSize = Math.round(Math.min(width, height) * 0.15);
  const half = Math.round(cropSize / 2);

  const left = Math.max(0, px - half);
  const top = Math.max(0, py - half);
  const cropW = Math.min(cropSize, width - left);
  const cropH = Math.min(cropSize, height - top);

  const cropped = await sharp(rotatedBuffer)
    .extract({ left, top, width: cropW, height: cropH })
    .resize(300, 300, { fit: 'cover' })
    .jpeg({ quality: 90 })
    .toBuffer();

  return cropped;
}

/**
 * Store a labeled face crop in GCS and register it in Firestore.
 */
async function saveFaceReference(manifestId, personName, cropBuffer) {
  const id = `face_${Date.now()}_${personName.toLowerCase().replace(/\s+/g, '_')}`;
  const gcsPath = `faces/${id}.jpg`;

  // Upload crop to GCS
  const file = storage.bucket(BUCKET_NAME).file(gcsPath);
  await file.save(cropBuffer, { contentType: 'image/jpeg' });

  // Store reference in Firestore
  const faceRef = {
    id,
    personName,
    manifestId,
    gcsBucket: BUCKET_NAME,
    gcsPath,
    createdAt: new Date().toISOString(),
  };

  await firestoreService.addFaceReference(faceRef);
  return faceRef;
}

/**
 * Get all face reference crops as buffers for building Gemini context.
 */
async function loadFaceLibrary() {
  const refs = await firestoreService.getAllFaceReferences();
  const library = [];

  for (const ref of refs) {
    try {
      const [buffer] = await storage.bucket(ref.gcsBucket).file(ref.gcsPath).download();
      library.push({
        ...ref,
        buffer,
      });
    } catch (err) {
      console.warn(`Failed to load face crop ${ref.id}: ${err.message}`);
    }
  }

  return library;
}

// ── Gemini Face Matching ────────────────────────────────────────────────────

/**
 * Identify people in a photo using the face reference library.
 * Sends reference crops + target photo to Gemini in a single multimodal request.
 */
async function identifyPeople(targetBuffer, targetMimeType, faceLibrary, existingLabels = null) {
  if (!faceLibrary || faceLibrary.length === 0) {
    return { matches: [], message: 'No face references in library yet' };
  }

  // Resize target if needed
  let processedBuffer = targetBuffer;
  let processedMime = targetMimeType;
  const metadata = await sharp(targetBuffer).metadata();
  if (targetBuffer.length > 3_000_000 || (targetMimeType && !['image/jpeg', 'image/png', 'image/webp'].includes(targetMimeType))) {
    processedBuffer = await sharp(targetBuffer)
      .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    processedMime = 'image/jpeg';
  }

  // Group references by person (may have multiple crops per person)
  const byPerson = {};
  for (const ref of faceLibrary) {
    if (!byPerson[ref.personName]) byPerson[ref.personName] = [];
    byPerson[ref.personName].push(ref);
  }

  // Build the multimodal content: reference images first, then target
  const parts = [];

  parts.push({
    text: `You are a family photo face matcher. I will show you reference photos of family members, then a target photo. Identify which family members appear in the target photo.

REFERENCE PHOTOS (labeled):`,
  });

  for (const [name, refs] of Object.entries(byPerson)) {
    parts.push({ text: `\n--- ${name} ---` });
    // Include up to 3 reference crops per person
    for (const ref of refs.slice(0, 3)) {
      parts.push({
        inlineData: {
          data: ref.buffer.toString('base64'),
          mimeType: 'image/jpeg',
        },
      });
    }
  }

  // Add existing label context if available
  let labelContext = '';
  if (existingLabels) {
    const labelParts = [];
    if (existingLabels.people?.length) labelParts.push(`Already identified people: ${existingLabels.people.join(', ')}`);
    if (existingLabels.title) labelParts.push(`Photo title: "${existingLabels.title}"`);
    if (existingLabels.description) labelParts.push(`Description: "${existingLabels.description}"`);
    if (labelParts.length) labelContext = `\n\nEXISTING LABELS for this photo (use as additional context):\n${labelParts.join('\n')}`;
  }

  parts.push({
    text: `\n\nTARGET PHOTO (identify who appears here):${labelContext}`,
  });

  parts.push({
    inlineData: {
      data: processedBuffer.toString('base64'),
      mimeType: processedMime,
    },
  });

  parts.push({
    text: `\nExamine the target photo carefully. For each person visible, determine if they match any of the reference photos above.

Return a JSON array of matches:
[
  {
    "personName": "the name from the references",
    "confidence": "high" | "medium" | "low",
    "description": "brief description of where they are in the photo (e.g. 'left side, wearing blue jacket')"
  }
]

Rules:
- Only include people you can confidently match to a reference
- "high" = very confident facial match
- "medium" = likely match based on face + build + context
- "low" = possible match, not certain
- If no one matches, return an empty array []
- Do NOT guess or hallucinate — only match if you see a real resemblance

Return ONLY the JSON array.`,
  });

  const result = await model.generateContent(parts);

  const responseText = result.response.text();

  try {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return { matches: JSON.parse(jsonMatch[0]) };
    }
    return { matches: [] };
  } catch (err) {
    console.error('Failed to parse Gemini face match response:', responseText);
    return { matches: [], error: 'Parse failed' };
  }
}

/**
 * Scan all vault photos against the face library and return proposed label updates.
 * This is the "Find [person] everywhere" bulk operation.
 */
async function scanVaultForPerson(personName, faceLibrary, manifests) {
  // Filter library to just this person's references
  const personRefs = faceLibrary.filter(f => f.personName.toLowerCase() === personName.toLowerCase());
  if (personRefs.length === 0) {
    return { matches: [], message: `No face references for "${personName}"` };
  }

  // Get manifest IDs that were used as face reference sources — skip those
  const sourceManifestIds = new Set(personRefs.map(r => r.manifestId));

  const candidates = manifests.filter(m => {
    if (!(m.mimeType || '').startsWith('image/')) return false;
    // Skip photos the face crops came from (already known)
    if (sourceManifestIds.has(m.id)) return false;
    // Skip if already labeled with this person
    const people = [...(m.corrections?.people || []), ...(m.classification?.people || [])];
    if (people.some(p => p.toLowerCase().includes(personName.toLowerCase()))) return false;
    // Skip ONLY if user explicitly rejected this person for this photo (human decline = ground truth)
    const rejected = m.corrections?.faceMatchRejected || [];
    if (rejected.some(r => r.toLowerCase() === personName.toLowerCase())) return false;
    // Everything else is fair game — even photos with other people labeled
    return true;
  });

  if (candidates.length === 0) {
    return { matches: [], message: 'All photos already labeled or no image candidates' };
  }

  // Process in batches of 5 to stay within limits
  const allMatches = [];
  const batchSize = 5;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);

    for (const manifest of batch) {
      try {
        // Download the image
        let buffer;
        if (manifest.source === 'upload' && manifest.gcsBucket && manifest.gcsPath) {
          [buffer] = await storage.bucket(manifest.gcsBucket).file(manifest.gcsPath).download();
        } else if (manifest.driveFileId) {
          const result = await driveService.downloadFile(manifest.driveFileId, manifest.mimeType);
          buffer = result.buffer;
        } else {
          continue;
        }

        const existingLabels = {
          people: [...(manifest.corrections?.people || []), ...(manifest.classification?.people || [])],
          title: manifest.classification?.title,
          description: manifest.classification?.description,
        };
        const result = await identifyPeople(buffer, manifest.mimeType, personRefs.map(r => ({ ...r, personName })), existingLabels);

        if (result.matches.length > 0) {
          allMatches.push({
            manifestId: manifest.id,
            title: manifest.classification?.title || manifest.fileName,
            matches: result.matches,
          });
        }
      } catch (err) {
        console.warn(`Face scan failed for ${manifest.id}: ${err.message}`);
      }
    }
  }

  return { matches: allMatches, scanned: candidates.length };
}

module.exports = {
  cropFace,
  saveFaceReference,
  loadFaceLibrary,
  identifyPeople,
  scanVaultForPerson,
};
