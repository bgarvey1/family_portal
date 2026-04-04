import { useState, useEffect } from "react";
import { C } from "../../constants/palette";
import { apiFetch } from "../../api/fetch";
import Badge from "../shared/Badge";

// ── Propagate Panel ─────────────────────────────────────────────────────────
const PropagatePanel = ({ item, onClose, onRefresh }) => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [applying, setApplying] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [applied, setApplied] = useState(false);

  const runDryRun = async () => {
    setLoading(true);
    setResults(null);
    try {
      const r = await apiFetch(`/api/manifests/${item.id}/propagate?dryRun=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setResults(data);
      setSelected(new Set(data.matches.map(m => m.id)));
    } catch (err) {
      setResults({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const applySelected = async () => {
    setApplying(true);
    try {
      const r = await apiFetch(`/api/manifests/${item.id}/propagate?dryRun=false`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setApplied(true);
      if (onRefresh) onRefresh();
    } catch (err) {
      setResults(prev => ({ ...prev, error: err.message }));
    } finally {
      setApplying(false);
    }
  };

  useEffect(() => { runDryRun(); }, []);

  const confColor = { high: C.green, medium: C.amber, low: C.muted };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
      <div style={{ background: C.cream, borderRadius: 16, padding: 24, maxWidth: 560, width: "95%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: C.brown, margin: 0 }}>Propagate Labels</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.muted }}>x</button>
        </div>

        <div style={{ background: C.white, borderRadius: 10, padding: 14, marginBottom: 16, border: `1px solid ${C.amberBorder}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: C.amber, marginBottom: 6 }}>Source Labels</div>
          <div style={{ fontSize: 13, color: C.lightText }}>
            <strong>{item.classification?.title}</strong><br/>
            People: {(item.corrections?.people || item.classification?.people || []).join(", ") || "\u2014"}<br/>
            Location: {item.corrections?.location || item.classification?.location || "\u2014"}<br/>
            Tags: {(item.corrections?.tags || item.classification?.tags || []).join(", ") || "\u2014"}
          </div>
        </div>

        {loading && <div style={{ textAlign: "center", padding: 30, color: C.muted }}>Searching for similar items...</div>}

        {results?.error && <div style={{ background: C.redBg, borderRadius: 10, padding: 14, color: C.red, fontSize: 13, marginBottom: 12 }}>{results.error}</div>}

        {results && !results.error && (
          <>
            {results.matches.length === 0 ? (
              <div style={{ textAlign: "center", padding: 20, color: C.muted, fontSize: 14 }}>No similar items found. Try adding more corrections to the source item first.</div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
                  Found {results.matches.length} match{results.matches.length !== 1 ? "es" : ""} out of {results.candidates} candidates:
                </div>
                {results.matches.map((m) => (
                  <div key={m.id} style={{
                    background: C.white, borderRadius: 10, padding: 12, marginBottom: 8,
                    border: `1px solid ${selected.has(m.id) ? C.amber : C.warmBorder}`,
                    opacity: applied ? 0.7 : 1,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={selected.has(m.id)} disabled={applied}
                        onChange={() => setSelected(prev => {
                          const next = new Set(prev);
                          next.has(m.id) ? next.delete(m.id) : next.add(m.id);
                          return next;
                        })} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: C.brown }}>{m.title}</div>
                        <div style={{ fontSize: 12, color: C.lightText, marginTop: 2 }}>{m.reason}</div>
                      </div>
                      <Badge color={confColor[m.confidence] || C.muted} bg={(confColor[m.confidence] || C.muted) + "20"}>
                        {m.confidence}
                      </Badge>
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 6, marginLeft: 28 }}>
                      {m.applyPeople?.length > 0 && <span>+People: {m.applyPeople.join(", ")} </span>}
                      {m.applyLocation && <span>+Location: {m.applyLocation} </span>}
                      {m.applyTags?.length > 0 && <span>+Tags: {m.applyTags.join(", ")}</span>}
                    </div>
                  </div>
                ))}

                {!applied && (
                  <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
                    <button onClick={onClose} style={{ padding: "8px 20px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.lightText, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                    <button onClick={applySelected} disabled={applying || selected.size === 0}
                      style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: selected.size === 0 ? C.warmBorder : C.green, color: C.white, fontSize: 13, fontWeight: 600, cursor: applying || selected.size === 0 ? "not-allowed" : "pointer" }}>
                      {applying ? "Applying..." : `Apply to ${selected.size} item${selected.size !== 1 ? "s" : ""}`}
                    </button>
                  </div>
                )}

                {applied && (
                  <div style={{ background: C.greenBg, borderRadius: 10, padding: 12, marginTop: 12, fontSize: 13, color: C.green, fontWeight: 600 }}>
                    Labels propagated successfully!
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

export default PropagatePanel;
