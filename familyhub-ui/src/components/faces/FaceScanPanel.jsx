import { useState, useEffect } from "react";
import { C } from "../../constants/palette";
import { apiFetch } from "../../api/fetch";
import Badge from "../shared/Badge";

// ── Face Scan Panel ─────────────────────────────────────────────────────────
// Scans the entire vault for a person using Gemini face matching
// Per-match accept/reject — reject = "human decline" = permanent ground truth
const FaceScanPanel = ({ personName, onClose, onRefresh }) => {
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState(null);
  // Track per-match status: "pending" | "accepted" | "rejected"
  const [matchStatus, setMatchStatus] = useState({});

  const startScan = async () => {
    setScanning(true);
    try {
      const r = await apiFetch("/api/faces/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personName, apply: false }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setResults(data);
      // Initialize all as pending
      const initial = {};
      (data.matches || []).forEach(m => { initial[m.manifestId] = "pending"; });
      setMatchStatus(initial);
    } catch (err) {
      setResults({ error: err.message });
    } finally {
      setScanning(false);
    }
  };

  const acceptMatch = async (manifestId) => {
    setMatchStatus(prev => ({ ...prev, [manifestId]: "accepting" }));
    try {
      // Apply the label by running scan with apply=true for just this manifest
      const r = await apiFetch("/api/faces/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personName, apply: true }),
      });
      // Simpler: just PATCH the manifest directly
      const manifest = results.matches.find(m => m.manifestId === manifestId);
      if (manifest) {
        await apiFetch(`/api/manifests/${manifestId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ people: [personName] }),
        });
      }
      setMatchStatus(prev => ({ ...prev, [manifestId]: "accepted" }));
      if (onRefresh) onRefresh();
    } catch {
      setMatchStatus(prev => ({ ...prev, [manifestId]: "pending" }));
    }
  };

  const rejectMatch = async (manifestId) => {
    setMatchStatus(prev => ({ ...prev, [manifestId]: "rejecting" }));
    try {
      await apiFetch("/api/faces/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifestId, personName }),
      });
      setMatchStatus(prev => ({ ...prev, [manifestId]: "rejected" }));
    } catch {
      setMatchStatus(prev => ({ ...prev, [manifestId]: "pending" }));
    }
  };

  const acceptAll = async () => {
    const pending = Object.entries(matchStatus).filter(([, s]) => s === "pending").map(([id]) => id);
    for (const id of pending) {
      await acceptMatch(id);
    }
  };

  useEffect(() => { startScan(); }, []);

  const pendingCount = Object.values(matchStatus).filter(s => s === "pending").length;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
      <div style={{ background: C.cream, borderRadius: 16, padding: 24, maxWidth: 500, width: "95%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: C.brown, margin: 0 }}>Find "{personName}" Everywhere</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.muted }}>x</button>
        </div>

        {scanning && <div style={{ textAlign: "center", padding: 30, color: C.muted }}>Scanning vault photos with Gemini... This may take a minute.</div>}

        {results?.error && <div style={{ background: C.redBg, borderRadius: 10, padding: 14, color: C.red, fontSize: 13 }}>{results.error}</div>}

        {results && !results.error && (
          <>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
              Scanned {results.scanned} photos, found {results.matches?.length || 0} match{(results.matches?.length || 0) !== 1 ? "es" : ""}
            </div>

            {(results.matches || []).length === 0 ? (
              <div style={{ textAlign: "center", padding: 20, color: C.muted }}>No matches found. Try adding more reference photos of {personName}.</div>
            ) : (
              <>
                {results.matches.map((m, i) => {
                  const status = matchStatus[m.manifestId] || "pending";
                  return (
                    <div key={i} style={{
                      background: C.white, borderRadius: 10, padding: 12, marginBottom: 8,
                      border: `1px solid ${status === "accepted" ? C.green : status === "rejected" ? C.red + "40" : C.warmBorder}`,
                      opacity: status === "rejected" ? 0.5 : 1,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: C.brown }}>{m.title}</div>
                          {m.matches.map((match, j) => (
                            <div key={j} style={{ fontSize: 12, color: C.lightText, marginTop: 4 }}>
                              <Badge color={match.confidence === "high" ? C.green : match.confidence === "medium" ? C.amber : C.muted}>
                                {match.confidence}
                              </Badge>
                              <span style={{ marginLeft: 6 }}>{match.description}</span>
                            </div>
                          ))}
                        </div>
                        {status === "pending" && (
                          <div style={{ display: "flex", gap: 4, flexShrink: 0, marginLeft: 8 }}>
                            <button onClick={() => acceptMatch(m.manifestId)} title={`Yes, this is ${personName}`}
                              style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: C.green, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                              Yes
                            </button>
                            <button onClick={() => rejectMatch(m.manifestId)} title={`Not ${personName}`}
                              style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.red}40`, background: C.white, color: C.red, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                              Not {personName}
                            </button>
                          </div>
                        )}
                        {status === "accepting" && <span style={{ fontSize: 11, color: C.muted }}>Saving...</span>}
                        {status === "accepted" && <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>Labeled</span>}
                        {status === "rejecting" && <span style={{ fontSize: 11, color: C.muted }}>Saving...</span>}
                        {status === "rejected" && <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>Declined</span>}
                      </div>
                    </div>
                  );
                })}

                {pendingCount > 0 && (
                  <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
                    <button onClick={onClose} style={{ padding: "8px 20px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.lightText, fontSize: 13, cursor: "pointer" }}>Done</button>
                    <button onClick={acceptAll}
                      style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: C.green, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Accept all ({pendingCount})
                    </button>
                  </div>
                )}

                {pendingCount === 0 && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                    <button onClick={onClose}
                      style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: C.amber, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Done
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default FaceScanPanel;
