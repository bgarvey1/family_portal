const { Router } = require('express');
const { requireApiKey } = require('../middleware/auth');
const firestoreService = require('../services/firestore');
const classifier = require('../services/classifier');
const driveService = require('../services/drive');

const router = Router();

// GET /api/manifests — list all manifests
router.get('/manifests', requireApiKey, async (req, res) => {
  try {
    const manifests = await firestoreService.getAllManifests();
    res.json({ manifests, count: manifests.length });
  } catch (err) {
    console.error('Error fetching manifests:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/manifests/:id — add corrections to a manifest
// Body: { people, location, context, tags }
// Corrections are stored alongside the AI classification so both are available.
// Automatically extracts knowledge facts from corrections.
router.patch('/manifests/:id', requireApiKey, async (req, res) => {
  try {
    const manifest = await firestoreService.getManifest(req.params.id);
    if (!manifest) {
      return res.status(404).json({ error: 'Manifest not found' });
    }

    const { people, location, context, tags } = req.body;
    const corrections = {
      ...(manifest.corrections || {}),
      ...(people && { people }),
      ...(location && { location }),
      ...(context && { context }),
      ...(tags && { tags }),
      updatedAt: new Date().toISOString(),
    };

    await firestoreService.updateManifest(req.params.id, { corrections });

    // Auto-extract knowledge facts from corrections
    const knowledgeEntries = [];

    if (people && Array.isArray(people)) {
      for (const person of people) {
        // e.g. "Ryan (blue jacket)" → learn that Ryan wears blue
        const match = person.match(/^(\w+)\s*\((.+)\)$/);
        if (match) {
          const fact = `${match[1]} is often seen wearing/described as: ${match[2]}`;
          const id = await firestoreService.addKnowledge({
            fact,
            source: 'correction',
            manifestId: req.params.id,
          });
          knowledgeEntries.push({ id, fact });
        }
      }
    }

    if (location) {
      // Learn about places the family visits
      const title = manifest.classification?.title || manifest.fileName;
      const fact = `"${title}" was taken at: ${location}`;
      const id = await firestoreService.addKnowledge({
        fact,
        source: 'correction',
        manifestId: req.params.id,
      });
      knowledgeEntries.push({ id, fact });
    }

    if (context) {
      const id = await firestoreService.addKnowledge({
        fact: context,
        source: 'correction',
        manifestId: req.params.id,
      });
      knowledgeEntries.push({ id, fact: context });
    }

    res.json({
      message: 'Corrections saved',
      corrections,
      knowledgeLearned: knowledgeEntries,
    });
  } catch (err) {
    console.error('Error updating manifest:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/manifests/:id/reclassify — re-run classification with knowledge base
// Optionally pass { includeCorrections: true } to bake corrections into the prompt
router.post('/manifests/:id/reclassify', requireApiKey, async (req, res) => {
  try {
    const manifest = await firestoreService.getManifest(req.params.id);
    if (!manifest) {
      return res.status(404).json({ error: 'Manifest not found' });
    }

    console.log(`Re-classifying: ${manifest.fileName}`);

    // Download the file again
    const { buffer, mimeType } = await driveService.downloadFile(
      manifest.driveFileId,
      manifest.mimeType
    );

    // Re-extract EXIF from file bytes (in case it wasn't captured before)
    const freshExif = await classifier.extractExif(null, buffer, mimeType);
    const exif = freshExif || manifest.exif || null;

    // Load current knowledge base
    const knowledge = await firestoreService.getAllKnowledge();

    // Re-classify with EXIF + knowledge
    const newClassification = await classifier.classifyFile(
      buffer,
      mimeType,
      manifest.fileName,
      { exif, knowledge }
    );

    // Store old classification for reference
    const previousClassification = manifest.classification;

    await firestoreService.updateManifest(req.params.id, {
      classification: newClassification,
      exif,
      previousClassification,
      reclassifiedAt: new Date().toISOString(),
    });

    res.json({
      message: 'Re-classification complete',
      previous: previousClassification,
      current: newClassification,
    });
  } catch (err) {
    console.error('Error re-classifying:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/knowledge — list all learned knowledge
router.get('/knowledge', requireApiKey, async (req, res) => {
  try {
    const knowledge = await firestoreService.getAllKnowledge();
    res.json({ knowledge, count: knowledge.length });
  } catch (err) {
    console.error('Error fetching knowledge:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/knowledge — manually add a family fact
// Body: { fact: "Ryan is 12 years old and loves skiing" }
router.post('/knowledge', requireApiKey, async (req, res) => {
  try {
    const { fact } = req.body;
    if (!fact || typeof fact !== 'string') {
      return res.status(400).json({ error: 'fact string is required' });
    }

    const id = await firestoreService.addKnowledge({
      fact,
      source: 'manual',
    });

    res.json({ id, fact, message: 'Knowledge added' });
  } catch (err) {
    console.error('Error adding knowledge:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
