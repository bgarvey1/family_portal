const { Router } = require('express');
const { requireApiKey } = require('../middleware/auth');
const driveService = require('../services/drive');
const firestoreService = require('../services/firestore');

const router = Router();

// Simple in-memory cache for thumbnails (avoids hammering Drive API)
const thumbCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

router.get('/files/:driveFileId/thumbnail', requireApiKey, async (req, res) => {
  const { driveFileId } = req.params;

  try {
    // Check cache first
    const cached = thumbCache.get(driveFileId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      res.set('Content-Type', cached.mimeType);
      res.set('Cache-Control', 'public, max-age=900');
      return res.send(cached.buffer);
    }

    // Look up the manifest to get the mimeType
    const manifests = await firestoreService.getAllManifests();
    const manifest = manifests.find(m => m.driveFileId === driveFileId);
    const mimeType = manifest?.mimeType || 'image/jpeg';

    // Download the file from Drive
    const { buffer, mimeType: actualMime } = await driveService.downloadFile(driveFileId, mimeType);

    // Cache it
    thumbCache.set(driveFileId, { buffer, mimeType: actualMime, ts: Date.now() });

    // Evict old cache entries if it gets too big
    if (thumbCache.size > 200) {
      const oldest = [...thumbCache.entries()]
        .sort((a, b) => a[1].ts - b[1].ts)
        .slice(0, 50);
      oldest.forEach(([key]) => thumbCache.delete(key));
    }

    res.set('Content-Type', actualMime);
    res.set('Cache-Control', 'public, max-age=900');
    res.send(buffer);
  } catch (err) {
    console.error(`Thumbnail error for ${driveFileId}:`, err.message);
    res.status(404).json({ error: 'File not found or not accessible' });
  }
});

module.exports = router;
