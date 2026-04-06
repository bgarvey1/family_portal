const { Router } = require('express');
const { Storage } = require('@google-cloud/storage');
const Anthropic = require('@anthropic-ai/sdk');
const { requireApiKey } = require('../middleware/auth');
const firestoreService = require('../services/firestore');
const classifier = require('../services/classifier');
const driveService = require('../services/drive');
const config = require('../config');

const router = Router();
const storage = new Storage();
const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

// GET /api/manifests/unreviewed — get unreviewed manifests (must be before /:id routes)
router.get('/manifests/unreviewed', requireApiKey, async (req, res) => {
  try {
    const manifests = await firestoreService.getUnreviewedManifests();
    res.json({ manifests, count: manifests.length });
  } catch (err) {
    console.error('Error fetching unreviewed manifests:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/manifests/review-all — mark all unreviewed as reviewed
router.post('/manifests/review-all', requireApiKey, async (req, res) => {
  try {
    const count = await firestoreService.markAllReviewed();
    res.json({ message: `Marked ${count} items as reviewed`, count });
  } catch (err) {
    console.error('Error marking all reviewed:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/manifests — list manifests (supports pagination)
// Query params: ?limit=50&cursor=<lastId> for paginated results
// Omit params to get all manifests (backwards compatible)
router.get('/manifests', requireApiKey, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
    const cursor = req.query.cursor || null;

    if (limit) {
      const result = await firestoreService.getManifestsPaginated(limit, cursor);
      res.json({ manifests: result.manifests, count: result.manifests.length, nextCursor: result.nextCursor, hasMore: result.hasMore });
    } else {
      const manifests = await firestoreService.getAllManifests();
      res.json({ manifests, count: manifests.length });
    }
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

// POST /api/manifests/:id/review — mark a single manifest as reviewed
router.post('/manifests/:id/review', requireApiKey, async (req, res) => {
  try {
    const manifest = await firestoreService.getManifest(req.params.id);
    if (!manifest) {
      return res.status(404).json({ error: 'Manifest not found' });
    }
    await firestoreService.markManifestReviewed(req.params.id);
    res.json({ message: 'Marked as reviewed', id: req.params.id });
  } catch (err) {
    console.error('Error marking reviewed:', err);
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

// DELETE /api/manifests/:id — delete a manifest and its storage/knowledge
router.delete('/manifests/:id', requireApiKey, async (req, res) => {
  try {
    const manifest = await firestoreService.getManifest(req.params.id);
    if (!manifest) {
      return res.status(404).json({ error: 'Manifest not found' });
    }

    // Delete file from GCS if it was uploaded (not Drive-sourced)
    if (manifest.source === 'upload' && manifest.gcsBucket && manifest.gcsPath) {
      try {
        await storage.bucket(manifest.gcsBucket).file(manifest.gcsPath).delete();
      } catch (err) {
        console.warn(`GCS delete failed for ${manifest.gcsPath}: ${err.message}`);
      }
    }

    // Mark Drive files as deleted so sync won't re-import
    if (manifest.driveFileId) {
      await firestoreService.markDeleted(manifest.driveFileId);
    }

    // Delete associated knowledge entries
    const knowledge = await firestoreService.getKnowledgeByManifestId(req.params.id);
    for (const k of knowledge) {
      await firestoreService.deleteKnowledge(k.id);
    }

    await firestoreService.deleteManifest(req.params.id);
    res.json({ message: 'Deleted', id: req.params.id });
  } catch (err) {
    console.error('Error deleting manifest:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/manifests/bulk-delete — delete multiple manifests
router.post('/manifests/bulk-delete', requireApiKey, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    if (ids.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 items per bulk delete' });
    }

    const deleted = [];
    const failed = [];

    for (const id of ids) {
      try {
        const manifest = await firestoreService.getManifest(id);
        if (!manifest) {
          failed.push({ id, error: 'Not found' });
          continue;
        }

        if (manifest.source === 'upload' && manifest.gcsBucket && manifest.gcsPath) {
          try {
            await storage.bucket(manifest.gcsBucket).file(manifest.gcsPath).delete();
          } catch (err) {
            console.warn(`GCS delete failed for ${manifest.gcsPath}: ${err.message}`);
          }
        }

        if (manifest.driveFileId) {
          await firestoreService.markDeleted(manifest.driveFileId);
        }

        const knowledge = await firestoreService.getKnowledgeByManifestId(id);
        for (const k of knowledge) {
          await firestoreService.deleteKnowledge(k.id);
        }

        await firestoreService.deleteManifest(id);
        deleted.push(id);
      } catch (err) {
        failed.push({ id, error: err.message });
      }
    }

    res.json({ deleted, failed, message: `Deleted ${deleted.length} of ${ids.length}` });
  } catch (err) {
    console.error('Error bulk deleting:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/manifests/:id/propagate — smart label propagation
// Uses AI to find similar items and apply labels from a corrected item
// Query: ?dryRun=true (default) to preview, ?dryRun=false to apply
router.post('/manifests/:id/propagate', requireApiKey, async (req, res) => {
  try {
    const source = await firestoreService.getManifest(req.params.id);
    if (!source) {
      return res.status(404).json({ error: 'Manifest not found' });
    }

    const corrections = source.corrections || {};
    const classification = source.classification || {};
    if (!corrections.people && !corrections.location && !corrections.context && !corrections.tags) {
      return res.status(400).json({ error: 'This item has no corrections to propagate' });
    }

    const dryRun = req.query.dryRun !== 'false';
    // Allow caller to limit which candidate IDs to apply (for selective apply after dry run)
    const onlyIds = req.body.ids || null;

    const allManifests = await firestoreService.getAllManifests();
    const candidates = allManifests.filter(m => {
      if (m.id === source.id) return false;
      if (onlyIds && !onlyIds.includes(m.id)) return false;
      return true;
    });

    // Build source label profile
    const sourceProfile = {
      title: classification.title,
      description: classification.description,
      category: classification.category,
      people: corrections.people || classification.people || [],
      location: corrections.location || classification.location || 'unknown',
      tags: corrections.tags || classification.tags || [],
      context: corrections.context || '',
      date_estimate: classification.date_estimate || 'unknown',
    };

    // Pre-filter: score candidates by metadata similarity
    const scored = candidates.map(m => {
      const c = m.classification || {};
      const mc = m.corrections || {};
      let score = 0;

      // Same category
      if (c.category === sourceProfile.category) score += 1;

      // Overlapping tags
      const mTags = [...(mc.tags || []), ...(c.tags || [])];
      const overlap = sourceProfile.tags.filter(t => mTags.some(mt => mt.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(mt.toLowerCase())));
      score += Math.min(overlap.length * 0.5, 3);

      // People name overlap
      const mPeople = [...(mc.people || []), ...(c.people || [])].map(p => p.toLowerCase());
      const sPeople = sourceProfile.people.map(p => p.toLowerCase().split('(')[0].trim());
      for (const sp of sPeople) {
        if (mPeople.some(mp => mp.includes(sp) || sp.includes(mp))) score += 3;
      }

      // Location similarity
      const mLoc = (mc.location || c.location || '').toLowerCase();
      const sLoc = sourceProfile.location.toLowerCase();
      if (mLoc && sLoc && sLoc !== 'unknown' && mLoc !== 'unknown') {
        if (mLoc.includes(sLoc) || sLoc.includes(mLoc)) score += 2;
      }

      return { manifest: m, score };
    });

    // Take top 20 by score (must have score > 0)
    const top = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    if (top.length === 0) {
      return res.json({
        source: { id: source.id, title: sourceProfile.title, labels: sourceProfile },
        candidates: 0,
        matches: [],
        dryRun,
        message: 'No similar items found in the vault',
      });
    }

    // Ask Claude to evaluate which candidates should get labels propagated
    const candidateSummaries = top.map((t, i) => {
      const c = t.manifest.classification || {};
      const mc = t.manifest.corrections || {};
      return `[${i}] id="${t.manifest.id}" title="${c.title}" people=[${(mc.people || c.people || []).join(', ')}] location="${mc.location || c.location || 'unknown'}" tags=[${(mc.tags || c.tags || []).join(', ')}] date="${c.date_estimate || 'unknown'}" description="${c.description || ''}"`;
    }).join('\n');

    const propagatePrompt = `You are helping manage a family photo vault. A user has manually labeled one item with corrections. Your job is to find which OTHER items in the vault likely share the same people, event, or context, and should receive the same labels.

SOURCE ITEM (manually labeled):
Title: "${sourceProfile.title}"
People: [${sourceProfile.people.join(', ')}]
Location: "${sourceProfile.location}"
Tags: [${sourceProfile.tags.join(', ')}]
Context: "${sourceProfile.context}"
Date: "${sourceProfile.date_estimate}"
Description: "${sourceProfile.description}"

CANDIDATE ITEMS (may or may not match):
${candidateSummaries}

For each candidate that should receive labels from the source, return a JSON array of objects:
[
  {
    "index": 0,
    "confidence": "high" | "medium" | "low",
    "reason": "brief explanation",
    "applyPeople": ["names to add"],
    "applyLocation": "location to set, or null",
    "applyTags": ["tags to add"]
  }
]

Rules:
- Only include candidates you are CONFIDENT about (high or medium). Skip uncertain ones.
- "high" = almost certainly the same event/people/place
- "medium" = likely related (same trip, same people in different shots)
- "low" = possibly related but not sure (include sparingly)
- Only propagate labels that make sense for that specific candidate
- If a candidate already has the correct labels, skip it
- Return an empty array [] if no candidates match

Return ONLY the JSON array, no other text.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [{ role: 'user', content: propagatePrompt }],
    });

    const responseText = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    let matches = [];
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        matches = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.error('Failed to parse propagation response:', responseText);
      return res.status(500).json({ error: 'AI response parse failed' });
    }

    // Map matches back to manifests
    const results = matches.map(m => {
      const candidate = top[m.index];
      if (!candidate) return null;
      return {
        id: candidate.manifest.id,
        title: (candidate.manifest.classification || {}).title,
        confidence: m.confidence,
        reason: m.reason,
        applyPeople: m.applyPeople || [],
        applyLocation: m.applyLocation || null,
        applyTags: m.applyTags || [],
        applied: false,
      };
    }).filter(Boolean);

    // If not dry run, apply the labels
    if (!dryRun) {
      for (const match of results) {
        const existing = await firestoreService.getManifest(match.id);
        if (!existing) continue;

        const existingCorrections = existing.corrections || {};
        const mergedPeople = [...new Set([...(existingCorrections.people || []), ...match.applyPeople])];
        const mergedTags = [...new Set([...(existingCorrections.tags || []), ...match.applyTags])];

        const newCorrections = {
          ...existingCorrections,
          ...(mergedPeople.length > 0 && { people: mergedPeople }),
          ...(match.applyLocation && { location: match.applyLocation }),
          ...(mergedTags.length > 0 && { tags: mergedTags }),
          propagatedFrom: source.id,
          updatedAt: new Date().toISOString(),
        };

        await firestoreService.updateManifest(match.id, { corrections: newCorrections });
        match.applied = true;
      }
    }

    res.json({
      source: { id: source.id, title: sourceProfile.title, labels: sourceProfile },
      candidates: top.length,
      matches: results,
      dryRun,
    });
  } catch (err) {
    console.error('Error propagating labels:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/knowledge/:id — delete a knowledge fact
router.delete('/knowledge/:id', requireApiKey, async (req, res) => {
  try {
    await firestoreService.deleteKnowledge(req.params.id);
    res.json({ message: 'Knowledge deleted', id: req.params.id });
  } catch (err) {
    console.error('Error deleting knowledge:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
