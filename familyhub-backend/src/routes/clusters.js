const { Router } = require('express');
const { requireApiKey } = require('../middleware/auth');
const firestoreService = require('../services/firestore');
const clusterService = require('../services/clusters');
const { createRateLimiter } = require('../middleware/rateLimit');

const router = Router();

// Rate limit cluster generation: 1 per minute
const generateLimiter = createRateLimiter({ windowMs: 60_000, max: 1 });

// GET /api/clusters — list all clusters
router.get('/clusters', requireApiKey, async (req, res) => {
  try {
    const clusters = await firestoreService.getAllClusters();
    res.json({ clusters, count: clusters.length });
  } catch (err) {
    console.error('Error fetching clusters:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clusters/:id — get single cluster with full manifest details
router.get('/clusters/:id', requireApiKey, async (req, res) => {
  try {
    const cluster = await firestoreService.getCluster(req.params.id);
    if (!cluster) {
      return res.status(404).json({ error: 'Cluster not found' });
    }

    // Fetch full manifests for this cluster
    const manifests = [];
    for (const manifestId of cluster.manifestIds) {
      const m = await firestoreService.getManifest(manifestId);
      if (m) manifests.push(m);
    }

    res.json({ cluster, manifests });
  } catch (err) {
    console.error('Error fetching cluster:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clusters/generate — trigger full cluster regeneration
router.post('/clusters/generate', requireApiKey, generateLimiter, async (req, res) => {
  try {
    const result = await clusterService.generateClusters();
    res.json({ message: `Generated ${result.count} clusters`, ...result });
  } catch (err) {
    console.error('Error generating clusters:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clusters/:id — delete a single cluster
router.delete('/clusters/:id', requireApiKey, async (req, res) => {
  try {
    await firestoreService.deleteCluster(req.params.id);
    res.json({ message: 'Cluster deleted', id: req.params.id });
  } catch (err) {
    console.error('Error deleting cluster:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
