// ── Configuration ────────────────────────────────────────────────────────────
// In local dev, Vite proxies /api/* to localhost:8080 (the local backend).
// The local backend reads the API key from its own .env — never exposed to the browser.
// BACKEND_URL is empty string so fetch("/api/...") goes through the Vite proxy.
export const BACKEND_URL = "";

// ── API helpers ──────────────────────────────────────────────────────────────
export const apiFetch = (path, opts = {}) =>
  fetch(`${BACKEND_URL}${path}`, {
    ...opts,
    headers: { ...opts.headers },
  });

// Build a proxied thumbnail URL (goes through Vite proxy, no key needed)
export const thumbUrl = (item) => {
  if (!item) return null;
  if (item.source === "upload") {
    return `${BACKEND_URL}/api/uploads/${item.id}/image`;
  }
  if (item.driveFileId) {
    return `${BACKEND_URL}/api/files/${item.driveFileId}/thumbnail`;
  }
  return null;
};

export const driveThumbUrl = (driveFileId) =>
  driveFileId
    ? `${BACKEND_URL}/api/files/${driveFileId}/thumbnail`
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
