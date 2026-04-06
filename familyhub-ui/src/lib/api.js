// ── Configuration ────────────────────────────────────────────────────────────
const CLOUD_BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://familyhub-backend-761807984124.us-east1.run.app";
export const BACKEND_KEY = import.meta.env.VITE_BACKEND_KEY || "";
export const BACKEND_URL = CLOUD_BACKEND_URL;

// ── API helpers ──────────────────────────────────────────────────────────────
export const apiFetch = (path, opts = {}) =>
  fetch(`${BACKEND_URL}${path}`, {
    ...opts,
    headers: { "x-api-key": BACKEND_KEY, ...opts.headers },
  });

// Build a proxied thumbnail URL
export const thumbUrl = (item) => {
  if (!item) return null;
  if (item.source === "upload") {
    return `${BACKEND_URL}/api/uploads/${item.id}/image?key=${BACKEND_KEY}`;
  }
  if (item.driveFileId) {
    return `${BACKEND_URL}/api/files/${item.driveFileId}/thumbnail?key=${BACKEND_KEY}`;
  }
  return null;
};

export const driveThumbUrl = (driveFileId) =>
  driveFileId
    ? `${BACKEND_URL}/api/files/${driveFileId}/thumbnail?key=${BACKEND_KEY}`
    : null;

// ── Agentic Chat ────────────────────────────────────────────────────────────
export const agenticChat = async (message, history) => {
  const r = await apiFetch("/api/chat/agentic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Chat API ${r.status}: ${err}`);
  }
  const data = await r.json();
  const sources = (data.sources || []).map((s) => ({
    ...s,
    thumbUrl: thumbUrl(s),
  }));
  return { text: data.text || "", sources };
};
