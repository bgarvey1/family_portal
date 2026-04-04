const { Router } = require('express');
const { requireApiKey, requireOidc } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const syncService = require('../services/sync');
const firestoreService = require('../services/firestore');

// Sync triggers Drive download + AI classification — limit to 5 per minute
const syncLimiter = createRateLimiter({ windowMs: 60_000, max: 5, message: 'Too many sync requests. Please wait.' });

const router = Router();

let syncInProgress = false;
let lastSyncResult = null;

router.post('/sync/await', requireApiKey, syncLimiter, async (req, res) => {
  try {
    if (syncInProgress) {
      return res.status(409).json({ error: 'Sync already in progress' });
    }
    syncInProgress = true;
    const result = await syncService.runSync();
    lastSyncResult = result;
    syncInProgress = false;
    res.json({
      status: 'done',
      processed: result.processed,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (err) {
    syncInProgress = false;
    console.error('Sync/await error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync', requireOidc, async (req, res) => {
  if (syncInProgress) {
    return res.status(409).json({ error: 'Sync already in progress' });
  }

  res.json({ status: 'accepted' });

  syncInProgress = true;
  try {
    lastSyncResult = await syncService.runSync();
  } catch (err) {
    console.error('Background sync error:', err);
    lastSyncResult = { processed: 0, skipped: 0, errors: [{ error: err.message }] };
  } finally {
    syncInProgress = false;
  }
});

router.get('/sync/status', requireApiKey, async (req, res) => {
  try {
    const status = await firestoreService.getSyncStatus();
    res.json({
      syncInProgress,
      lastSyncResult,
      lastSyncAt: status.lastSyncAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
