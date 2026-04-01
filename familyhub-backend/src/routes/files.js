const { Router } = require('express');
const { Storage } = require('@google-cloud/storage');
const { requireApiKey } = require('../middleware/auth');
const driveService = require('../services/drive');
const firestoreService = require('../services/firestore');
const config = require('../config');

const router = Router();
const storage = new Storage({ projectId: config.gcpProjectId });

// Simple in-memory cache for thumbnails (avoids hammering Drive/GCS)
const thumbCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function evictOldCache() {
  if (thumbCache.size > 200) {
    const oldest = [...thumbCache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, 50);
    oldest.forEach(([key]) => thumbCache.delete(key));
  }
}

// GET /api/files/:driveFileId/thumbnail — serve image from Drive
router.get('/files/:driveFileId/thumbnail', requireApiKey, async (req, res) => {
  const { driveFileId } = req.params;

  try {
    const cached = thumbCache.get(`drive:${driveFileId}`);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      res.set('Content-Type', cached.mimeType);
      res.set('Cache-Control', 'public, max-age=900');
      return res.send(cached.buffer);
    }

    const manifests = await firestoreService.getAllManifests();
    const manifest = manifests.find(m => m.driveFileId === driveFileId);
    const mimeType = manifest?.mimeType || 'image/jpeg';

    const { buffer, mimeType: actualMime } = await driveService.downloadFile(driveFileId, mimeType);

    thumbCache.set(`drive:${driveFileId}`, { buffer, mimeType: actualMime, ts: Date.now() });
    evictOldCache();

    res.set('Content-Type', actualMime);
    res.set('Cache-Control', 'public, max-age=900');
    res.send(buffer);
  } catch (err) {
    console.error(`Thumbnail error for ${driveFileId}:`, err.message);
    res.status(404).json({ error: 'File not found or not accessible' });
  }
});

// GET /api/uploads/:id/image — serve image from GCS (for uploaded files)
router.get('/uploads/:id/image', requireApiKey, async (req, res) => {
  const { id } = req.params;

  try {
    const cached = thumbCache.get(`upload:${id}`);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      res.set('Content-Type', cached.mimeType);
      res.set('Cache-Control', 'public, max-age=900');
      return res.send(cached.buffer);
    }

    const manifest = await firestoreService.getManifest(id);
    if (!manifest || !manifest.gcsBucket || !manifest.gcsPath) {
      return res.status(404).json({ error: 'Uploaded file not found' });
    }

    const [buffer] = await storage.bucket(manifest.gcsBucket).file(manifest.gcsPath).download();

    thumbCache.set(`upload:${id}`, { buffer, mimeType: manifest.mimeType, ts: Date.now() });
    evictOldCache();

    res.set('Content-Type', manifest.mimeType);
    res.set('Cache-Control', 'public, max-age=900');
    res.send(buffer);
  } catch (err) {
    console.error(`Upload image error for ${id}:`, err.message);
    res.status(404).json({ error: 'File not found' });
  }
});

module.exports = router;
