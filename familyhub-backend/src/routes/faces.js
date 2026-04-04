const { Router } = require('express');
const { Storage } = require('@google-cloud/storage');
const { requireApiKey } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const firestoreService = require('../services/firestore');
const facesService = require('../services/faces');
const driveService = require('../services/drive');
const config = require('../config');

// Face scan sends every photo to Gemini — limit to 3 per minute
const scanLimiter = createRateLimiter({ windowMs: 60_000, max: 3, message: 'Too many scan requests. Please wait.' });

const router = Router();
const storage = new Storage();

// POST /api/faces/label — click on a person in a photo, crop and label them
// Body: { manifestId, clickX, clickY, personName }
// clickX/clickY are 0-1 percentages of where the user clicked on the image
router.post('/faces/label', requireApiKey, async (req, res) => {
  try {
    const { manifestId, clickX, clickY, personName } = req.body;

    if (!manifestId || clickX == null || clickY == null || !personName) {
      return res.status(400).json({ error: 'manifestId, clickX, clickY, and personName are required' });
    }

    // Get the manifest
    const manifest = await firestoreService.getManifest(manifestId);
    if (!manifest) {
      return res.status(404).json({ error: 'Manifest not found' });
    }

    // Download the source image
    let buffer;
    if (manifest.source === 'upload' && manifest.gcsBucket && manifest.gcsPath) {
      [buffer] = await storage.bucket(manifest.gcsBucket).file(manifest.gcsPath).download();
    } else if (manifest.driveFileId) {
      const result = await driveService.downloadFile(manifest.driveFileId, manifest.mimeType);
      buffer = result.buffer;
    } else {
      return res.status(400).json({ error: 'Cannot download source image' });
    }

    // Crop the face region
    console.log(`Cropping face for "${personName}" at (${clickX}, ${clickY}) from ${manifest.fileName}`);
    const cropBuffer = await facesService.cropFace(buffer, clickX, clickY, manifest.mimeType);

    // Save the reference
    const faceRef = await facesService.saveFaceReference(manifestId, personName, cropBuffer);

    // Also add to knowledge base
    await firestoreService.addKnowledge({
      fact: `${personName} has a face reference photo cropped from "${manifest.classification?.title || manifest.fileName}"`,
      source: 'face_label',
      manifestId,
    });

    console.log(`  Saved face reference: ${faceRef.id}`);

    res.json({
      message: `Face reference saved for "${personName}"`,
      faceRef,
      cropUrl: `/api/faces/${faceRef.id}/image`,
    });
  } catch (err) {
    console.error('Error labeling face:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/faces — list all face references
router.get('/faces', requireApiKey, async (req, res) => {
  try {
    const refs = await firestoreService.getAllFaceReferences();
    // Group by person
    const byPerson = {};
    for (const ref of refs) {
      if (!byPerson[ref.personName]) byPerson[ref.personName] = [];
      byPerson[ref.personName].push(ref);
    }
    res.json({ faces: refs, byPerson, count: refs.length });
  } catch (err) {
    console.error('Error fetching faces:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/faces/:id/image — serve a face crop
router.get('/faces/:id/image', async (req, res) => {
  try {
    const key = req.query.key;
    if (!key || key !== config.apiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const refs = await firestoreService.getAllFaceReferences();
    const ref = refs.find(r => r.id === req.params.id);
    if (!ref) {
      return res.status(404).json({ error: 'Face reference not found' });
    }

    const [buffer] = await storage.bucket(ref.gcsBucket).file(ref.gcsPath).download();
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    console.error('Error serving face image:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/faces/:id — delete a face reference
router.delete('/faces/:id', requireApiKey, async (req, res) => {
  try {
    const refs = await firestoreService.getAllFaceReferences();
    const ref = refs.find(r => r.id === req.params.id);
    if (!ref) {
      return res.status(404).json({ error: 'Face reference not found' });
    }

    // Delete from GCS
    try {
      await storage.bucket(ref.gcsBucket).file(ref.gcsPath).delete();
    } catch (err) {
      console.warn(`GCS delete failed for face ${ref.id}: ${err.message}`);
    }

    await firestoreService.deleteFaceReference(ref.id);
    res.json({ message: 'Face reference deleted', id: ref.id });
  } catch (err) {
    console.error('Error deleting face:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/faces/identify — identify people in a specific photo
// Body: { manifestId }
router.post('/faces/identify', requireApiKey, async (req, res) => {
  try {
    const { manifestId } = req.body;
    if (!manifestId) {
      return res.status(400).json({ error: 'manifestId is required' });
    }

    const manifest = await firestoreService.getManifest(manifestId);
    if (!manifest) {
      return res.status(404).json({ error: 'Manifest not found' });
    }

    // Download image
    let buffer;
    if (manifest.source === 'upload' && manifest.gcsBucket && manifest.gcsPath) {
      [buffer] = await storage.bucket(manifest.gcsBucket).file(manifest.gcsPath).download();
    } else if (manifest.driveFileId) {
      const result = await driveService.downloadFile(manifest.driveFileId, manifest.mimeType);
      buffer = result.buffer;
    } else {
      return res.status(400).json({ error: 'Cannot download source image' });
    }

    // Load face library
    const library = await facesService.loadFaceLibrary();
    if (library.length === 0) {
      return res.json({ matches: [], message: 'No face references yet. Label some faces first!' });
    }

    console.log(`Identifying people in ${manifest.fileName} against ${library.length} face references`);
    const result = await facesService.identifyPeople(buffer, manifest.mimeType, library);
    console.log(`  Found ${result.matches.length} matches`);

    res.json(result);
  } catch (err) {
    console.error('Error identifying faces:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/faces/scan — scan entire vault for a specific person
// Body: { personName, apply: false } — set apply=true to auto-label matches
router.post('/faces/scan', requireApiKey, scanLimiter, async (req, res) => {
  try {
    const { personName, apply } = req.body;
    if (!personName) {
      return res.status(400).json({ error: 'personName is required' });
    }

    console.log(`Scanning vault for "${personName}"...`);

    const library = await facesService.loadFaceLibrary();
    const manifests = await firestoreService.getAllManifests();

    const result = await facesService.scanVaultForPerson(personName, library, manifests);
    console.log(`  Scanned ${result.scanned} photos, found ${result.matches.length} matches`);

    // If apply=true, auto-label the matches
    if (apply && result.matches.length > 0) {
      for (const match of result.matches) {
        const highConfidence = match.matches.filter(m => m.confidence === 'high' || m.confidence === 'medium');
        if (highConfidence.length === 0) continue;

        const manifest = await firestoreService.getManifest(match.manifestId);
        if (!manifest) continue;

        const existingPeople = manifest.corrections?.people || manifest.classification?.people || [];
        const newPeople = [...new Set([...existingPeople, personName])];

        await firestoreService.updateManifest(match.manifestId, {
          corrections: {
            ...(manifest.corrections || {}),
            people: newPeople,
            updatedAt: new Date().toISOString(),
            faceMatchSource: personName,
          },
        });

        match.applied = true;
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Error scanning vault:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/faces/reject — reject a face match (human decline = ground truth)
// Body: { manifestId, personName }
router.post('/faces/reject', requireApiKey, async (req, res) => {
  try {
    const { manifestId, personName } = req.body;
    if (!manifestId || !personName) {
      return res.status(400).json({ error: 'manifestId and personName are required' });
    }

    const manifest = await firestoreService.getManifest(manifestId);
    if (!manifest) {
      return res.status(404).json({ error: 'Manifest not found' });
    }

    const existing = manifest.corrections || {};
    const rejected = existing.faceMatchRejected || [];
    if (!rejected.some(r => r.toLowerCase() === personName.toLowerCase())) {
      rejected.push(personName);
    }

    // Also remove this person from people list if they were auto-labeled
    const updatedCorrections = { ...existing, faceMatchRejected: rejected, updatedAt: new Date().toISOString() };
    if (existing.people) {
      updatedCorrections.people = existing.people.filter(p => p.toLowerCase() !== personName.toLowerCase());
    }

    await firestoreService.updateManifest(manifestId, { corrections: updatedCorrections });

    console.log(`Rejected face match: "${personName}" is NOT in ${manifest.classification?.title || manifestId}`);
    res.json({ message: `Rejected: "${personName}" will not be suggested for this photo again` });
  } catch (err) {
    console.error('Error rejecting face match:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
