const admin = require('firebase-admin');
const config = require('../config');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: config.gcpProjectId });
}

const db = admin.firestore();

const MANIFESTS_COLLECTION = 'vault_manifests';
const META_COLLECTION = 'vault_meta';
const KNOWLEDGE_COLLECTION = 'vault_knowledge';
const FACES_COLLECTION = 'vault_faces';
const DELETED_COLLECTION = 'vault_deleted';
const PROFILES_COLLECTION = 'vault_profiles';
const CLUSTERS_COLLECTION = 'vault_clusters';
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

async function getManifestsPaginated(limit = 50, startAfterId = null) {
  let query = db.collection(MANIFESTS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(limit);

  if (startAfterId) {
    const startDoc = await db.collection(MANIFESTS_COLLECTION).doc(startAfterId).get();
    if (startDoc.exists) {
      query = query.startAfter(startDoc);
    }
  }

  const snapshot = await query.get();
  const manifests = snapshot.docs.map(doc => doc.data());
  const lastDoc = snapshot.docs[snapshot.docs.length - 1];
  return {
    manifests,
    nextCursor: lastDoc ? lastDoc.id : null,
    hasMore: manifests.length === limit,
  };
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

// ── Face References ─────────────────────────────────────────────────────────
async function addFaceReference(entry) {
  await db.collection(FACES_COLLECTION).doc(entry.id).set(entry);
  return entry.id;
}

async function getAllFaceReferences() {
  const snapshot = await db.collection(FACES_COLLECTION)
    .orderBy('createdAt', 'desc')
    .get();
  return snapshot.docs.map(doc => doc.data());
}

async function getFaceReferencesByPerson(personName) {
  const snapshot = await db.collection(FACES_COLLECTION)
    .where('personName', '==', personName)
    .get();
  return snapshot.docs.map(doc => doc.data());
}

async function deleteFaceReference(id) {
  await db.collection(FACES_COLLECTION).doc(id).delete();
}

async function deleteManifest(id) {
  await db.collection(MANIFESTS_COLLECTION).doc(id).delete();
}

// Track deleted items so sync doesn't re-import them
async function markDeleted(driveFileId) {
  if (!driveFileId) return;
  await db.collection(DELETED_COLLECTION).doc(driveFileId).set({
    driveFileId,
    deletedAt: new Date().toISOString(),
  });
}

async function isDeleted(driveFileId) {
  if (!driveFileId) return false;
  const doc = await db.collection(DELETED_COLLECTION).doc(driveFileId).get();
  return doc.exists;
}

async function deleteKnowledge(id) {
  await db.collection(KNOWLEDGE_COLLECTION).doc(id).delete();
}

async function getKnowledgeByManifestId(manifestId) {
  const snapshot = await db.collection(KNOWLEDGE_COLLECTION)
    .where('manifestId', '==', manifestId)
    .get();
  return snapshot.docs.map(doc => doc.data());
}

// ── Family Profiles ────────────────────────────────────────────────────────
async function addProfile(profile) {
  const ref = db.collection(PROFILES_COLLECTION).doc();
  const entry = { ...profile, id: ref.id, createdAt: new Date().toISOString() };
  await ref.set(entry);
  return entry;
}

async function getAllProfiles() {
  const snapshot = await db.collection(PROFILES_COLLECTION)
    .orderBy('createdAt', 'desc')
    .get();
  return snapshot.docs.map(doc => doc.data());
}

async function updateProfile(id, updates) {
  await db.collection(PROFILES_COLLECTION).doc(id).set(
    { ...updates, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

async function deleteProfile(id) {
  await db.collection(PROFILES_COLLECTION).doc(id).delete();
}

// ── Clusters ──────────────────────────────────────────────────────────────
async function writeCluster(cluster) {
  await db.collection(CLUSTERS_COLLECTION).doc(cluster.id).set(cluster);
}

async function getAllClusters() {
  const snapshot = await db.collection(CLUSTERS_COLLECTION)
    .orderBy('updatedAt', 'desc')
    .get();
  return snapshot.docs.map(doc => doc.data());
}

async function getCluster(id) {
  const doc = await db.collection(CLUSTERS_COLLECTION).doc(id).get();
  return doc.exists ? doc.data() : null;
}

async function updateCluster(id, updates) {
  await db.collection(CLUSTERS_COLLECTION).doc(id).set(updates, { merge: true });
}

async function deleteCluster(id) {
  await db.collection(CLUSTERS_COLLECTION).doc(id).delete();
}

async function deleteAllClusters() {
  const snapshot = await db.collection(CLUSTERS_COLLECTION).get();
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  if (snapshot.docs.length > 0) {
    await batch.commit();
  }
}

// ── Review Status ─────────────────────────────────────────────────────────
async function getUnreviewedManifests() {
  const snapshot = await db.collection(MANIFESTS_COLLECTION)
    .where('reviewed', '==', false)
    .orderBy('createdAt', 'desc')
    .get();
  return snapshot.docs.map(doc => doc.data());
}

async function markManifestReviewed(id) {
  await db.collection(MANIFESTS_COLLECTION).doc(id).set(
    { reviewed: true },
    { merge: true }
  );
}

async function markAllReviewed() {
  const unreviewed = await getUnreviewedManifests();
  const batch = db.batch();
  for (const m of unreviewed) {
    batch.update(db.collection(MANIFESTS_COLLECTION).doc(m.id), { reviewed: true });
  }
  if (unreviewed.length > 0) {
    await batch.commit();
  }
  return unreviewed.length;
}

module.exports = {
  getSyncCursor,
  updateSyncCursor,
  manifestExists,
  writeManifest,
  getAllManifests,
  getManifestsPaginated,
  getManifest,
  updateManifest,
  addKnowledge,
  getAllKnowledge,
  deleteManifest,
  markDeleted,
  isDeleted,
  deleteKnowledge,
  getKnowledgeByManifestId,
  addFaceReference,
  getAllFaceReferences,
  getFaceReferencesByPerson,
  deleteFaceReference,
  getSyncStatus,
  addProfile,
  getAllProfiles,
  updateProfile,
  deleteProfile,
  writeCluster,
  getAllClusters,
  getCluster,
  updateCluster,
  deleteCluster,
  deleteAllClusters,
  getUnreviewedManifests,
  markManifestReviewed,
  markAllReviewed,
};
