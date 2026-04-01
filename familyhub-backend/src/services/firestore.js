const admin = require('firebase-admin');
const config = require('../config');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: config.gcpProjectId });
}

const db = admin.firestore();

const MANIFESTS_COLLECTION = 'vault_manifests';
const META_COLLECTION = 'vault_meta';
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
  getSyncStatus,
};
