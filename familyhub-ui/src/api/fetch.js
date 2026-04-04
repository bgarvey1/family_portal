import { BACKEND_URL, BACKEND_KEY } from "./config";

// ── API helpers ──────────────────────────────────────────────────────────────
export const apiFetch = (path, opts = {}) =>
  fetch(`${BACKEND_URL}${path}`, {
    ...opts,
    headers: { "x-api-key": BACKEND_KEY, ...opts.headers },
  });
