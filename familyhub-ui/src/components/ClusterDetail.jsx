import { useState, useEffect } from "react";
import { C } from "../lib/palette";
import { apiFetch } from "../lib/api";
import { VaultCard } from "./VaultCard";
import { EditPanel } from "./EditPanel";
import { Badge } from "./Badge";

export const ClusterDetail = ({ cluster, onBack, onPhotoClick, onRefresh }) => {
  const [manifests, setManifests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const meta = cluster.metadata || {};

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await apiFetch(`/api/clusters/${cluster.id}`);
        if (r.ok) {
          const data = await r.json();
          setManifests(data.manifests || []);
        }
      } catch {}
      setLoading(false);
    })();
  }, [cluster.id]);

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <button
          onClick={onBack}
          style={{
            width: 36, height: 36, borderRadius: "50%", border: `1.5px solid ${C.amberBorder}`,
            background: C.white, color: C.brown, fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          \u2190
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.brown }}>{cluster.title}</div>
          {cluster.description && (
            <div style={{ fontSize: 14, color: C.lightText, marginTop: 4 }}>{cluster.description}</div>
          )}
        </div>
      </div>

      {/* Metadata pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        <Badge color={C.amber}>{manifests.length} photo{manifests.length !== 1 ? "s" : ""}</Badge>
        {meta.location && <Badge color={C.blue}>{meta.location}</Badge>}
        {meta.activity && <Badge color={C.green}>{meta.activity}</Badge>}
        {meta.people?.map((p) => (
          <Badge key={p} color={C.soft}>{p}</Badge>
        ))}
      </div>

      {/* Photo grid */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: C.muted, fontSize: 16 }}>Loading photos...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
          {manifests.map((m) => (
            <VaultCard key={m.id} item={m} compact onPhotoClick={onPhotoClick} onEdit={setEditing} />
          ))}
        </div>
      )}

      {manifests.length === 0 && !loading && (
        <div style={{ textAlign: "center", padding: 40, color: C.muted }}>No photos in this collection.</div>
      )}

      {editing && (
        <EditPanel
          item={editing}
          onClose={() => setEditing(null)}
          onSave={() => { if (onRefresh) onRefresh(); }}
          onReclassify={() => { if (onRefresh) onRefresh(); setEditing(null); }}
        />
      )}
    </div>
  );
};
