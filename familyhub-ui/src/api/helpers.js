import { BACKEND_URL, BACKEND_KEY } from "./config";

// Build a proxied thumbnail URL — works for both Drive files and uploaded files
export const thumbUrl = (item) => {
  if (!item) return null;
  // Uploaded files (stored in GCS)
  if (item.source === "upload") {
    return `${BACKEND_URL}/api/uploads/${item.id}/image?key=${BACKEND_KEY}`;
  }
  // Drive files
  if (item.driveFileId) {
    return `${BACKEND_URL}/api/files/${item.driveFileId}/thumbnail?key=${BACKEND_KEY}`;
  }
  return null;
};

// Legacy helper for code that only has a driveFileId
export const driveThumbUrl = (driveFileId) =>
  driveFileId
    ? `${BACKEND_URL}/api/files/${driveFileId}/thumbnail?key=${BACKEND_KEY}`
    : null;
