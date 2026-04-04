// ── Configuration ────────────────────────────────────────────────────────────
// Backend (Cloud Run) — handles vault storage, Drive sync, classification
// In local dev (Vite proxy), leave BACKEND_URL empty so requests go to /api/*
// In production (Cloud Run), set the full URL.
export const CLOUD_BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://familyhub-backend-761807984124.us-east1.run.app";
export const BACKEND_KEY = import.meta.env.VITE_BACKEND_KEY || "";

// Auto-detect: if running on localhost with a local backend, use Vite proxy (empty base);
// otherwise use Cloud Run URL directly.
export const IS_LOCAL = typeof window !== "undefined" && window.location.hostname === "localhost";
export const BACKEND_URL = CLOUD_BACKEND_URL;
