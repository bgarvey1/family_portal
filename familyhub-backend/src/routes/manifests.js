const { Router } = require('express');
const { requireApiKey } = require('../middleware/auth');
const firestoreService = require('../services/firestore');

const router = Router();

router.get('/manifests', requireApiKey, async (req, res) => {
  try {
    const manifests = await firestoreService.getAllManifests();
    res.json({ manifests, count: manifests.length });
  } catch (err) {
    console.error('Error fetching manifests:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
