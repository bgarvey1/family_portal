const express = require('express');
const { Router } = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { Storage } = require('@google-cloud/storage');
const { requireApiKey } = require('../middleware/auth');
const classifier = require('../services/classifier');
const firestoreService = require('../services/firestore');
const config = require('../config');

const router = Router();

// Accept up to 25MB files in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// GCS bucket for uploaded files (auto-created if needed)
const BUCKET_NAME = `${config.gcpProjectId}-familyhub-uploads`;
const storage = new Storage({ projectId: config.gcpProjectId });

async function ensureBucket() {
  try {
    const [exists] = await storage.bucket(BUCKET_NAME).exists();
    if (!exists) {
      await storage.createBucket(BUCKET_NAME, { location: 'US-EAST1' });
      console.log(`Created GCS bucket: ${BUCKET_NAME}`);
    }
  } catch (err) {
    // Bucket might already exist from a previous run
    if (!err.message.includes('already exists') && !err.message.includes('409')) {
      throw err;
    }
  }
}

// POST /api/upload — receive a photo, extract EXIF, classify, store
// Accepts multipart/form-data with a "file" field
// Optional fields: "contributor" (who uploaded), "notes" (freeform context)
router.post('/upload', requireApiKey, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided. Send as multipart/form-data with field name "file".' });
  }

  const { originalname, mimetype, buffer, size } = req.file;
  const contributor = req.body.contributor || 'unknown';
  const notes = req.body.notes || '';

  console.log(`Upload received: ${originalname} (${mimetype}, ${(size / 1024).toFixed(0)}KB) from ${contributor}`);

  // Only accept images and PDFs
  const supported = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'application/pdf'];
  if (!supported.some(t => mimetype.startsWith(t.split('/')[0]) || mimetype === t)) {
    return res.status(400).json({ error: `Unsupported file type: ${mimetype}` });
  }

  try {
    // 1. Extract EXIF from the raw bytes (before anything strips it)
    const exif = classifier.extractExif(null, buffer, mimetype);
    if (exif) {
      console.log(`  EXIF extracted: time=${exif.time || 'none'}, GPS=${exif.location ? 'yes' : 'no'}, camera=${exif.cameraModel || 'none'}`);
    } else {
      console.log('  No EXIF data found in file bytes');
    }

    // 2. Upload to GCS for permanent storage
    await ensureBucket();
    const fileId = uuidv4();
    const gcsPath = `uploads/${fileId}/${originalname}`;
    const file = storage.bucket(BUCKET_NAME).file(gcsPath);
    await file.save(buffer, {
      contentType: mimetype,
      metadata: {
        contributor,
        originalName: originalname,
        uploadedAt: new Date().toISOString(),
      },
    });
    console.log(`  Stored in GCS: gs://${BUCKET_NAME}/${gcsPath}`);

    // 3. Classify with EXIF + knowledge base
    const knowledge = await firestoreService.getAllKnowledge();
    const classification = await classifier.classifyFile(buffer, mimetype, originalname, { exif, knowledge });

    // 4. Store manifest
    const manifest = {
      id: fileId,
      source: 'upload',
      contributor,
      fileName: originalname,
      mimeType: mimetype,
      fileSize: size,
      gcsBucket: BUCKET_NAME,
      gcsPath,
      exif: exif || null,
      classification,
      corrections: null,
      createdAt: new Date().toISOString(),
    };

    // Add notes as initial context if provided
    if (notes) {
      manifest.corrections = { context: notes, updatedAt: new Date().toISOString() };
      // Also learn from the notes
      await firestoreService.addKnowledge({
        fact: notes,
        source: 'upload_note',
        manifestId: fileId,
      });
    }

    await firestoreService.writeManifest(manifest);
    console.log(`  Classified and stored: ${originalname} -> ${classification.category}`);

    res.json({
      message: 'Photo uploaded and classified!',
      id: fileId,
      title: classification.title,
      people: classification.people,
      location: classification.location,
      exif: exif ? { time: exif.time, location: exif.location, camera: [exif.cameraMake, exif.cameraModel].filter(Boolean).join(' ') || null } : null,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/upload/simple — accepts raw image body (for Apple Shortcut)
// API key via query param: ?key=xxx&contributor=Brendan
// Content-Type from the request tells us the mime type
router.post('/upload/simple', express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
  // Auth via query param
  const key = req.query.key;
  if (!key || key !== config.apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const buffer = req.body;
  if (!buffer || buffer.length === 0) {
    return res.status(400).json({ error: 'No file data received' });
  }

  const contributor = req.query.contributor || 'unknown';
  const mimeType = req.headers['content-type'] || 'image/jpeg';
  const fileName = `upload_${Date.now()}.${mimeType.includes('png') ? 'png' : mimeType.includes('heic') ? 'heic' : 'jpg'}`;

  console.log(`Simple upload: ${fileName} (${mimeType}, ${(buffer.length / 1024).toFixed(0)}KB) from ${contributor}`);

  try {
    const exif = classifier.extractExif(null, buffer, mimeType);
    if (exif) {
      console.log(`  EXIF: time=${exif.time || 'none'}, GPS=${exif.location ? 'yes' : 'no'}`);
    }

    await ensureBucket();
    const fileId = uuidv4();
    const gcsPath = `uploads/${fileId}/${fileName}`;
    const file = storage.bucket(BUCKET_NAME).file(gcsPath);
    await file.save(buffer, { contentType: mimeType });

    const knowledge = await firestoreService.getAllKnowledge();
    const classification = await classifier.classifyFile(buffer, mimeType, fileName, { exif, knowledge });

    const manifest = {
      id: fileId,
      source: 'upload',
      contributor,
      fileName,
      mimeType,
      fileSize: buffer.length,
      gcsBucket: BUCKET_NAME,
      gcsPath,
      exif: exif || null,
      classification,
      corrections: null,
      createdAt: new Date().toISOString(),
    };

    await firestoreService.writeManifest(manifest);
    console.log(`  Classified: ${classification.title}`);

    res.json({
      message: 'Photo uploaded and classified!',
      id: fileId,
      title: classification.title,
    });
  } catch (err) {
    console.error('Simple upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
