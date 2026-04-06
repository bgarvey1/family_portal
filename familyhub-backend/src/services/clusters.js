const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const firestoreService = require('./firestore');

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

// Build a compact text summary of a manifest for clustering
function summarizeManifest(manifest, index) {
  const c = manifest.classification || {};
  const mc = manifest.corrections || {};
  const exif = manifest.exif || {};

  const people = mc.people || c.people || [];
  const location = mc.location || c.location || 'unknown';
  const tags = mc.tags || c.tags || [];
  const date = exif.time || c.date_estimate || manifest.driveCreatedTime || 'unknown';
  const category = c.category || 'other';

  return `[${index}] title="${c.title || manifest.fileName}" people=[${people.join(', ')}] location="${location}" date="${date}" tags=[${tags.join(', ')}] category="${category}" sentiment="${c.sentiment || 'neutral'}"`;
}

const CLUSTER_PROMPT = `You are analyzing a family photo and document vault to create meaningful collections (clusters) that help a grandparent browse their family memories.

Here are all the items in the vault:

ITEMS:
{ITEMS}

Create collections that group related items together. Think about:
- Events: photos from the same day/trip/outing at the same location
- Activities: recurring activities like skiing, soccer, school events
- People: groups featuring specific family members together
- Temporal: seasonal collections, holidays, "this year" groupings
- Places: photos from the same location across different times

Rules:
- Each collection must have at least 3 items
- Items can belong to multiple collections
- Create 5-20 collections depending on vault size (aim for ~1 per 5-10 items)
- Titles should be warm and descriptive (e.g. "Skiing Adventures at Steamboat" not "Cluster 7")
- Description should be 1-2 sentences that a grandparent would enjoy reading
- For clusterType, use: "event", "activity", "people", "temporal", or "location"

Return a JSON array:
[
  {
    "title": "Warm descriptive title",
    "description": "A brief, warm description of this collection",
    "clusterType": "event|activity|people|temporal|location",
    "itemIndexes": [0, 3, 7],
    "metadata": {
      "people": ["names of primary people"],
      "dateRange": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } or null,
      "location": "primary location or null",
      "activity": "primary activity or null"
    }
  }
]

Return ONLY the JSON array, no other text.`;

async function generateClusters() {
  const manifests = await firestoreService.getAllManifests();

  if (manifests.length < 3) {
    console.log('Not enough manifests for clustering (need at least 3)');
    return { count: 0, clusters: [] };
  }

  // Build compact summaries
  const summaries = manifests.map((m, i) => summarizeManifest(m, i)).join('\n');
  const prompt = CLUSTER_PROMPT.replace('{ITEMS}', summaries);

  console.log(`Clustering ${manifests.length} manifests (${summaries.length} chars of context)...`);

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  let rawClusters = [];
  try {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      rawClusters = JSON.parse(jsonMatch[0]);
    }
  } catch (parseErr) {
    console.error('Failed to parse cluster response:', responseText.slice(0, 500));
    throw new Error('Cluster generation: AI response parse failed');
  }

  // Delete old clusters and write new ones
  await firestoreService.deleteAllClusters();

  const clusters = [];
  for (const raw of rawClusters) {
    // Map indexes back to manifest IDs
    const manifestIds = (raw.itemIndexes || [])
      .filter(i => i >= 0 && i < manifests.length)
      .map(i => manifests[i].id);

    if (manifestIds.length < 3) continue; // Skip tiny clusters

    // Pick cover: first photo-category manifest, or just the first one
    const coverManifestId = manifestIds.find(id => {
      const m = manifests.find(mm => mm.id === id);
      return m && (m.classification?.category === 'photo' || m.mimeType?.startsWith('image/'));
    }) || manifestIds[0];

    const cluster = {
      id: uuidv4(),
      title: raw.title || 'Untitled Collection',
      description: raw.description || '',
      coverManifestId,
      manifestIds,
      clusterType: raw.clusterType || 'event',
      metadata: {
        people: raw.metadata?.people || [],
        dateRange: raw.metadata?.dateRange || null,
        location: raw.metadata?.location || null,
        activity: raw.metadata?.activity || null,
      },
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await firestoreService.writeCluster(cluster);
    clusters.push(cluster);
  }

  console.log(`Created ${clusters.length} clusters from ${manifests.length} manifests`);
  return { count: clusters.length, clusters };
}

module.exports = { generateClusters };
