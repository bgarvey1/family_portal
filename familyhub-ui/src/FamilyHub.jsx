import { useState, useEffect, useCallback } from "react";
import { C } from "./constants/palette";
import { DEMO_MANIFESTS } from "./constants/demoData";
import { BACKEND_URL } from "./api/config";
import { apiFetch } from "./api/fetch";
import Lightbox from "./components/shared/Lightbox";
import Badge from "./components/shared/Badge";
import ChatView from "./components/chat/ChatView";
import VaultView from "./components/vault/VaultView";
import AdminView from "./components/admin/AdminView";

// ── Main Component ───────────────────────────────────────────────────────────
export default function FamilyHub() {
  const [tab, setTab] = useState("chat");
  const [online, setOnline] = useState(null);
  const [manifests, setManifests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [lightbox, setLightbox] = useState({ src: null, alt: null });

  const openPhoto = useCallback((src, alt) => setLightbox({ src, alt }), []);
  const closePhoto = useCallback(() => setLightbox({ src: null, alt: null }), []);

  // Close lightbox on Escape key
  useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") closePhoto(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [closePhoto]);

  const checkHealth = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(`${BACKEND_URL}/api/health`, { signal: controller.signal });
      clearTimeout(timeout);
      return r.ok;
    } catch {
      return false;
    }
  }, []);

  const loadManifests = useCallback(async () => {
    try {
      const r = await apiFetch("/api/manifests");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return data.manifests || [];
    } catch {
      return null; // null = failed
    }
  }, []);

  const loadSyncStatus = useCallback(async () => {
    try {
      const r = await apiFetch("/api/sync/status");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [isOnline, manifestData, syncData] = await Promise.all([
        checkHealth(),
        loadManifests(),
        loadSyncStatus(),
      ]);
      setOnline(isOnline);
      if (isOnline && manifestData) {
        setManifests(manifestData);
      } else {
        // Fallback to demo data so the app is usable
        setManifests(DEMO_MANIFESTS);
      }
      if (syncData) setSyncStatus(syncData);
      setLoading(false);
    })();
  }, [checkHealth, loadManifests, loadSyncStatus]);

  const triggerSync = async () => {
    if (!online) {
      setSyncResult({ error: "Backend is offline. Sync requires a live connection to your Cloud Run service. See Admin notes below." });
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await apiFetch("/api/sync/await", { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const data = await r.json();
      setSyncResult(data);
      const [manifestData, syncData] = await Promise.all([loadManifests(), loadSyncStatus()]);
      if (manifestData) setManifests(manifestData);
      if (syncData) setSyncStatus(syncData);
    } catch (e) {
      setSyncResult({ error: e.message });
    } finally {
      setSyncing(false);
    }
  };

  const tabs = [
    { id: "chat", label: "Chat" },
    { id: "vault", label: `Vault (${manifests.length})` },
    { id: "admin", label: "Admin" },
  ];

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: C.cream,
        color: C.text,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "12px 20px",
          background: C.brown,
          color: C.cream,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>Family Hub</span>
          {online === null ? (
            <Badge color={C.amberBorder} bg={C.amber + "30"}>Connecting...</Badge>
          ) : online ? (
            <Badge color="#4ade80" bg="#16a34a20">Live</Badge>
          ) : (
            <Badge color={C.amberBorder} bg={C.amber + "30"}>Demo Mode</Badge>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={async () => {
                setTab(t.id);
                // Refresh manifests when switching tabs so labels/corrections are up to date
                if (online) {
                  const data = await loadManifests();
                  if (data) setManifests(data);
                }
              }}
              style={{
                padding: "6px 16px",
                borderRadius: 8,
                border: "none",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                background: tab === t.id ? C.amber : "transparent",
                color: tab === t.id ? C.white : "rgba(253,248,240,0.65)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {/* Body */}
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {loading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 16 }}>
            Loading...
          </div>
        ) : tab === "chat" ? (
          <ChatView manifests={manifests} onPhotoClick={openPhoto} />
        ) : tab === "vault" ? (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <VaultView manifests={manifests} onPhotoClick={openPhoto} onRefresh={async () => {
              const data = await loadManifests();
              if (data) setManifests(data);
            }} />
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <AdminView
              syncStatus={syncStatus}
              onSync={triggerSync}
              syncing={syncing}
              syncResult={syncResult}
              manifests={manifests}
              online={online}
              onRefresh={async () => {
                const data = await loadManifests();
                if (data) setManifests(data);
              }}
            />
          </div>
        )}
      </main>

      {/* Full-screen photo viewer */}
      <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={closePhoto} />
    </div>
  );
}
