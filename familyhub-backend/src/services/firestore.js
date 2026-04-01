const admin = require('firebase-admin');
const config = require('../config');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: config.gcpProjectId });
}

const db = admin.firestore();

const MANIFESTS_COLLECTION = 'vault_manifests';
const META_COLLECTION = 'vault_meta';
const KNOWLEDGE_COLLECTION = 'vault_knowledge';
const SYNC_CONFIG_DOC = 'sync_config';

async function getSyncCursor() {
  const doc = await db.collection(META_COLLECTION).doc(SYNC_CONFIG_DOC).get();
  return doc.exists ? doc.data() : null;
}

async function updateSyncCursor(data) {
  await db.collection(META_COLLECTION).doc(SYNC_CONFIG_DOC).set(
    { ...data, lastSyncAt: new Date().toISOString() },
    { merge: true }
  );
}

async function manifestExists(driveFileId) {
  const snapshot = await db.collection(MANIFESTS_COLLECTION)
    .where('driveFileId', '==', driveFileId)
    .limit(1)
    .get();
  return !snapshot.empty;
}

async function writeManifest(manifest) {
  await db.collection(MANIFESTS_COLLECTION).doc(manifest.id).set(manifest);
}

async function getAllManifests() {
  const snapshot = await db.collection(MANIFESTS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .get();
  return snapshot.docs.map(doc => doc.data());
}

async function getManifest(id) {
  const doc = await db.collection(MANIFESTS_COLLECTION).doc(id).get();
  return doc.exists ? doc.data() : null;
}

async function updateManifest(id, updates) {
  await db.collection(MANIFESTS_COLLECTION).doc(id).set(updates, { merge: true });
}

// ── Knowledge Base ──────────────────────────────────────────────────────────
// Stores accumulated family facts learned from user corrections.
// Each entry is a fact like "Ryan usually wears blue" or "The family goes cat skiing at Buffalo Pass."

async function addKnowledge(entry) {
  const ref = db.collection(KNOWLEDGE_COLLECTION).doc();
  await ref.set({ ...entry, id: ref.id, createdAt: new Date().toISOString() });
  return ref.id;
}

async function getAllKnowledge() {
  const snapshot = await db.collection(KNOWLEDGE_COLLECTION)
    .orderBy('createdAt', 'desc')
    .get();
  return snapshot.docs.map(doc => doc.data());
}

async function getSyncStatus() {
  const cursor = await getSyncCursor();
  return {
    lastSyncAt: cursor?.lastSyncAt || null,
    lastPageToken: cursor?.lastPageToken || null,
  };
}

module.exports = {
  getSyncCursor,
  updateSyncCursor,
  manifestExists,
  writeManifest,
  getAllManifests,
  getManifest,
  updateManifest,
  addKnowledge,
  getAllKnowledge,
  getSyncStatus,
};
