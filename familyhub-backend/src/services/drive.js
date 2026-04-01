const { google } = require('googleapis');
const config = require('../config');

const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

const drive = google.drive({ version: 'v3', auth });

const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
];

async function listFiles(pageToken = null) {
  const params = {
    q: `'${config.driveFolderId}' in parents and trashed = false`,
    fields: 'nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, size, thumbnailLink, webViewLink)',
    pageSize: 100,
    orderBy: 'createdTime desc',
  };
  if (pageToken) {
    params.pageToken = pageToken;
  }

  const res = await drive.files.list(params);
  return {
    files: res.data.files || [],
    nextPageToken: res.data.nextPageToken || null,
  };
}

async function downloadFile(fileId, mimeType) {
  if (mimeType.startsWith('application/vnd.google-apps.')) {
    const res = await drive.files.export(
      { fileId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    );
    return { buffer: Buffer.from(res.data), mimeType: 'application/pdf' };
  }

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return { buffer: Buffer.from(res.data), mimeType };
}

function isSupportedType(mimeType) {
  if (SUPPORTED_MIME_TYPES.includes(mimeType)) return true;
  if (mimeType.startsWith('application/vnd.google-apps.')) return true;
  return false;
}

module.exports = { listFiles, downloadFile, isSupportedType };
