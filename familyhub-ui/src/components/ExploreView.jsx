import { useState, useRef } from "react";
import { C } from "../lib/palette";
import { CATEGORIES } from "../lib/constants";
import { apiFetch, BACKEND_URL } from "../lib/api";
import { ClusterCard } from "./ClusterCard";
import { ClusterDetail } from "./ClusterDetail";
import { VaultCard } from "./VaultCard";
import { EditPanel } from "./EditPanel";
import { FaceLabelModal } from "./FaceLabelModal";
import { thumbUrl } from "../lib/api";

export const ExploreView = ({ clusters, manifests, unreviewedCount, onPhotoClick, onRefresh, onOpenReview }) => {
  const [mode, setMode] = useState("collections"); // collections | all
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState(null);
  const [tagging, setTagging] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const fileInputRef = useRef(null);

  const handleUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadStatus(null);
    const results = [];
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("contributor", "Family");
        const r = await fetch(`${BACKEND_URL}/api/upload`, {
          method: "POST",
          body: formData,
        });
        if (!r.ok) {
          const err = await r.json();
          results.push({ name: file.name, ok: false, error: err.error });
        } else {
          results.push({ name: file.name, ok: true });
        }
      } catch (err) {
        results.push({ name: file.name, ok: false, error: err.message });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    setUploadStatus({
      ok: failed === 0,
      msg: `${succeeded} photo${succeeded !== 1 ? "s" : ""} uploaded${failed > 0 ? `, ${failed} failed` : ""}`,
    });
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (succeeded > 0 && onRefresh) onRefresh();
  };

  // If viewing a cluster detail
  if (selectedCluster) {
    return (
      <ClusterDetail
        cluster={selectedCluster}
        onBack={() => setSelectedCluster(null)}
        onPhotoClick={onPhotoClick}
        onRefresh={onRefresh}
      />
    );
  }

  // Filter clusters by search
  const filteredClusters = clusters.filter((cl) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      cl.title.toLowerCase().includes(q) ||
      cl.description?.toLowerCase().includes(q) ||
      (cl.metadata?.people || []).join(" ").toLowerCase().includes(q) ||
      (cl.metadata?.activity || "").toLowerCase().includes(q) ||
      (cl.metadata?.location || "").toLowerCase().includes(q)
    );
  });

  // Filter manifests for "all photos" mode
  const filteredManifests = manifests.filter((m) => {
    const cl = m.classification || {};
    if (category !== "all" && cl.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = [cl.title, cl.description, m.fileName, ...(cl.tags || []), ...(cl.people || [])]
        .filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={{ padding: 24 }}>
      {/* Review banner */}
      {unreviewedCount > 0 && (
        <div
          onClick={onOpenReview}
          style={{
            background: `linear-gradient(135deg, ${C.amber}, ${C.brown})`,
            borderRadius: 14, padding: "16px 20px", marginBottom: 20,
            display: "flex", alignItems: "center", justifyContent: "space-between",
            cursor: "pointer", color: C.cream,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {unreviewedCount} new photo{unreviewedCount !== 1 ? "s" : ""} to review
            </div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
              Tap to confirm or correct AI suggestions
            </div>
          </div>
          <div style={{ fontSize: 28 }}>\u2192</div>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, alignItems: "center" }}>
        {/* Mode toggle */}
        <div style={{ display: "flex", borderRadius: 10, border: `1.5px solid ${C.amberBorder}`, overflow: "hidden" }}>
          {[{ id: "collections", label: "Collections" }, { id: "all", label: "All Photos" }].map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              style={{
                padding: "7px 16px", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: mode === m.id ? C.amber : C.white,
                color: mode === m.id ? C.white : C.soft,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder={mode === "collections" ? "Search collections..." : "Search photos..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "8px 16px", borderRadius: 10, border: `1.5px solid ${C.amberBorder}`,
            background: C.white, color: C.text, fontSize: 14, outline: "none", flex: 1, minWidth: 180,
          }}
        />

        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleUpload} style={{ display: "none" }} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            padding: "8px 20px", borderRadius: 10, border: "none",
            background: uploading ? C.warmBorder : C.amber, color: C.white,
            fontSize: 14, fontWeight: 600, cursor: uploading ? "default" : "pointer",
          }}
        >
          {uploading ? "Uploading..." : "+ Add Photos"}
        </button>
      </div>

      {/* Upload status */}
      {uploadStatus && (
        <div style={{
          padding: "10px 16px", borderRadius: 10, marginBottom: 12,
          background: uploadStatus.ok ? C.greenBg : C.redBg,
          color: uploadStatus.ok ? C.green : C.red, fontSize: 14,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>{uploadStatus.msg}</span>
          <button onClick={() => setUploadStatus(null)}
            style={{ background: "none", border: "none", color: "inherit", fontSize: 16, cursor: "pointer" }}>
            \u2715
          </button>
        </div>
      )}

      {/* Category filters (All Photos mode only) */}
      {mode === "all" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCategory(c)} style={{
              padding: "5px 14px", borderRadius: 20,
              border: `1.5px solid ${category === c ? C.amber : C.amberBorder}`,
              fontSize: 12, fontWeight: 500, cursor: "pointer",
              background: category === c ? C.amber : C.cream,
              color: category === c ? C.white : C.soft,
            }}>
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Collections mode */}
      {mode === "collections" && (
        <>
          {filteredClusters.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: C.muted, fontSize: 16 }}>
              {clusters.length === 0
                ? "No collections yet. Sync some photos and collections will be generated automatically."
                : "No collections match your search."}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>
              {filteredClusters.map((cl) => (
                <ClusterCard key={cl.id} cluster={cl} manifests={manifests} onSelect={setSelectedCluster} />
              ))}
            </div>
          )}
        </>
      )}

      {/* All Photos mode */}
      {mode === "all" && (
        <>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
            {filteredManifests.length} item{filteredManifests.length !== 1 && "s"}
            {category !== "all" && ` in "${category}"`}
            {search && ` matching "${search}"`}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {filteredManifests.map((m) => (
              <VaultCard key={m.id || m.driveFileId} item={m} onPhotoClick={onPhotoClick} onEdit={setEditing} onTagFace={setTagging} />
            ))}
          </div>
          {filteredManifests.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: C.muted, fontSize: 16 }}>No items found.</div>
          )}
        </>
      )}

      {editing && (
        <EditPanel
          item={editing}
          onClose={() => setEditing(null)}
          onSave={() => { if (onRefresh) onRefresh(); }}
          onReclassify={() => { if (onRefresh) onRefresh(); setEditing(null); }}
        />
      )}

      {tagging && (
        <FaceLabelModal
          item={tagging}
          imgSrc={thumbUrl(tagging)}
          onClose={() => setTagging(null)}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
};
