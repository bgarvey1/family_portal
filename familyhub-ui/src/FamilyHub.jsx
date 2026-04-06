import { useState, useEffect, useCallback } from "react";
import { C } from "./lib/palette";
import { apiFetch, BACKEND_URL } from "./lib/api";
import { Badge } from "./components/Badge";
import { Lightbox } from "./components/Lightbox";
import { ChatView } from "./components/ChatView";
import { ExploreView } from "./components/ExploreView";
import { SettingsView } from "./components/SettingsView";
import { ReviewQueue } from "./components/ReviewQueue";

// Demo data (used when backend is unreachable)
const DEMO_MANIFESTS = [
  {
    id: "demo-1", driveFileId: "demo-1", fileName: "family-picnic-2024.jpg", mimeType: "image/jpeg",
    classification: { title: "Summer Family Picnic", description: "The whole family gathered at Riverside Park.", category: "photo", people: ["Grandma", "Grandpa"], date_estimate: "2024-07-15", tags: ["summer", "picnic"], sentiment: "joyful" },
    createdAt: "2024-07-16T10:00:00Z",
  },
  {
    id: "demo-2", driveFileId: "demo-2", fileName: "birthday-card-emma.pdf", mimeType: "application/pdf",
    classification: { title: "Emma's Birthday Card", description: "A handmade birthday card from Emma.", category: "letter", people: ["Emma"], date_estimate: "2024-09-22", tags: ["birthday", "card"], sentiment: "joyful" },
    createdAt: "2024-09-23T08:00:00Z",
  },
  {
    id: "demo-3", driveFileId: "demo-3", fileName: "school-report-fall2024.pdf", mimeType: "application/pdf",
    classification: { title: "Fall 2024 School Report", description: "Excellent progress report.", category: "document", people: ["Emma"], date_estimate: "2024-11-15", tags: ["school", "report"], sentiment: "neutral" },
    createdAt: "2024-11-16T12:00:00Z",
  },
];

export default function FamilyHub() {
  const [tab, setTab] = useState("chat");
  const [online, setOnline] = useState(null);
  const [manifests, setManifests] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [lightbox, setLightbox] = useState({ src: null, alt: null });
  const [showReview, setShowReview] = useState(false);

  const openPhoto = useCallback((src, alt) => setLightbox({ src, alt }), []);
  const closePhoto = useCallback(() => setLightbox({ src: null, alt: null }), []);

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
    } catch { return false; }
  }, []);

  const loadManifests = useCallback(async () => {
    try {
      const r = await apiFetch("/api/manifests");
      if (!r.ok) throw new Error();
      return (await r.json()).manifests || [];
    } catch { return null; }
  }, []);

  const loadClusters = useCallback(async () => {
    try {
      const r = await apiFetch("/api/clusters");
      if (!r.ok) throw new Error();
      return (await r.json()).clusters || [];
    } catch { return []; }
  }, []);

  const loadUnreviewed = useCallback(async () => {
    try {
      const r = await apiFetch("/api/manifests/unreviewed");
      if (!r.ok) throw new Error();
      return (await r.json()).count || 0;
    } catch { return 0; }
  }, []);

  const loadSyncStatus = useCallback(async () => {
    try {
      const r = await apiFetch("/api/sync/status");
      if (!r.ok) throw new Error();
      return await r.json();
    } catch { return null; }
  }, []);

  // Initial load
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [isOnline, manifestData, syncData, clusterData, unrevCount] = await Promise.all([
        checkHealth(), loadManifests(), loadSyncStatus(), loadClusters(), loadUnreviewed(),
      ]);
      setOnline(isOnline);
      setManifests(isOnline && manifestData ? manifestData : DEMO_MANIFESTS);
      if (syncData) setSyncStatus(syncData);
      setClusters(clusterData);
      setUnreviewedCount(unrevCount);
      setLoading(false);
    })();
  }, [checkHealth, loadManifests, loadSyncStatus, loadClusters, loadUnreviewed]);

  const refreshAll = async () => {
    const [manifestData, clusterData, unrevCount] = await Promise.all([
      loadManifests(), loadClusters(), loadUnreviewed(),
    ]);
    if (manifestData) setManifests(manifestData);
    setClusters(clusterData);
    setUnreviewedCount(unrevCount);
  };

  const triggerSync = async () => {
    if (!online) {
      setSyncResult({ error: "Backend is offline." });
      return;
    }
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await apiFetch("/api/sync/await", { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const data = await r.json();
      setSyncResult(data);
      await refreshAll();
      const syncData = await loadSyncStatus();
      if (syncData) setSyncStatus(syncData);
    } catch (e) {
      setSyncResult({ error: e.message });
    } finally {
      setSyncing(false);
    }
  };

  const regenClusters = async () => {
    try {
      const r = await apiFetch("/api/clusters/generate", { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const clusterData = await loadClusters();
      setClusters(clusterData);
    } catch (e) {
      console.error("Cluster regeneration failed:", e.message);
    }
  };

  const tabs = [
    { id: "chat", label: "Chat", icon: "\u{1F4AC}" },
    { id: "explore", label: `Explore`, icon: "\u{1F5BC}" },
    { id: "settings", label: "Settings", icon: "\u2699\uFE0F" },
  ];

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column",
      background: C.cream, color: C.text,
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      {/* Header */}
      <header style={{
        padding: "12px 20px", background: C.brown, color: C.cream,
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>Family Hub</span>
          {online === null ? (
            <Badge color={C.amberBorder} bg={C.amber + "30"}>Connecting...</Badge>
          ) : online ? (
            <Badge color="#4ade80" bg="#16a34a20">Live</Badge>
          ) : (
            <Badge color={C.amberBorder} bg={C.amber + "30"}>Demo</Badge>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={async () => {
                setTab(t.id);
                if (online && t.id === "explore") await refreshAll();
              }}
              style={{
                padding: "6px 16px", borderRadius: 8, border: "none",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: tab === t.id ? C.amber : "transparent",
                color: tab === t.id ? C.white : "rgba(253,248,240,0.65)",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <span style={{ fontSize: 14 }}>{t.icon}</span>
              {t.label}
              {t.id === "explore" && unreviewedCount > 0 && (
                <span style={{
                  marginLeft: 4, padding: "1px 6px", borderRadius: 10, fontSize: 10, fontWeight: 700,
                  background: "#ef4444", color: "#fff",
                }}>
                  {unreviewedCount}
                </span>
              )}
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
          <ChatView onPhotoClick={openPhoto} />
        ) : tab === "explore" ? (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <ExploreView
              clusters={clusters}
              manifests={manifests}
              unreviewedCount={unreviewedCount}
              onPhotoClick={openPhoto}
              onRefresh={refreshAll}
              onOpenReview={() => setShowReview(true)}
            />
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <SettingsView
              syncStatus={syncStatus}
              onSync={triggerSync}
              syncing={syncing}
              syncResult={syncResult}
              online={online}
              onRegenClusters={regenClusters}
            />
          </div>
        )}
      </main>

      {/* Lightbox */}
      <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={closePhoto} />

      {/* Review Queue overlay */}
      {showReview && (
        <ReviewQueue
          onClose={() => setShowReview(false)}
          onRefresh={refreshAll}
        />
      )}
    </div>
  );
}
