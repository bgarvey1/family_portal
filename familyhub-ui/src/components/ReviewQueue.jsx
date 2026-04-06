import { useState, useEffect, useRef } from "react";
import { C } from "../lib/palette";
import { apiFetch, thumbUrl } from "../lib/api";
import { Badge } from "./Badge";

export const ReviewQueue = ({ onClose, onRefresh }) => {
  const [items, setItems] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ people: "", location: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const touchStart = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch("/api/manifests/unreviewed");
        if (r.ok) {
          const data = await r.json();
          setItems(data.manifests || []);
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  const current = items[currentIndex];
  const cl = current?.classification || {};
  const imgSrc = current ? thumbUrl(current) : null;
  const isPhoto = current && (current.mimeType?.startsWith("image/") || cl.category === "photo");

  const confirmCurrent = async () => {
    if (!current) return;
    try {
      await apiFetch(`/api/manifests/${current.id}/review`, { method: "POST" });
    } catch {}
    advance();
  };

  const skipCurrent = () => advance();

  const advance = () => {
    setDragOffset(0);
    setEditing(false);
    setCurrentIndex((prev) => prev + 1);
  };

  const saveAndConfirm = async () => {
    if (!current) return;
    setSaving(true);
    try {
      const body = {};
      if (editForm.people.trim()) body.people = editForm.people.split(",").map(s => s.trim()).filter(Boolean);
      if (editForm.location.trim()) body.location = editForm.location.trim();
      if (editForm.tags.trim()) body.tags = editForm.tags.split(",").map(s => s.trim()).filter(Boolean);

      if (Object.keys(body).length > 0) {
        await apiFetch(`/api/manifests/${current.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      await apiFetch(`/api/manifests/${current.id}/review`, { method: "POST" });
    } catch {}
    setSaving(false);
    advance();
  };

  const acceptAll = async () => {
    try {
      await apiFetch("/api/manifests/review-all", { method: "POST" });
    } catch {}
    if (onRefresh) onRefresh();
    onClose();
  };

  // Touch handlers for swipe
  const onTouchStart = (e) => {
    touchStart.current = e.touches[0].clientX;
    setIsDragging(true);
  };

  const onTouchMove = (e) => {
    if (touchStart.current == null) return;
    const delta = e.touches[0].clientX - touchStart.current;
    setDragOffset(delta);
  };

  const onTouchEnd = () => {
    setIsDragging(false);
    if (dragOffset > 100) {
      confirmCurrent();
    } else if (dragOffset < -100) {
      skipCurrent();
    } else {
      setDragOffset(0);
    }
    touchStart.current = null;
  };

  const openEdit = () => {
    const corrections = current?.corrections || {};
    setEditForm({
      people: (corrections.people || cl.people || []).join(", "),
      location: corrections.location || cl.location || "",
      tags: (corrections.tags || cl.tags || []).join(", "),
    });
    setEditing(true);
  };

  // Loading
  if (loading) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", color: C.cream }}>
        Loading...
      </div>
    );
  }

  // Done!
  if (currentIndex >= items.length) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: C.cream, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ fontSize: 64 }}>{"\u2705"}</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: C.brown }}>All caught up!</div>
        <div style={{ fontSize: 16, color: C.muted }}>
          {items.length === 0 ? "No new photos to review." : `Reviewed ${items.length} photo${items.length !== 1 ? "s" : ""}.`}
        </div>
        <button
          onClick={() => { if (onRefresh) onRefresh(); onClose(); }}
          style={{ padding: "14px 32px", borderRadius: 14, border: "none", background: C.amber, color: C.white, fontSize: 16, fontWeight: 600, cursor: "pointer", marginTop: 8 }}
        >
          Done
        </button>
      </div>
    );
  }

  const fieldStyle = {
    width: "100%", padding: "10px 14px", borderRadius: 10,
    border: `1.5px solid ${C.amberBorder}`, background: C.cream,
    color: C.text, fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: C.cream, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.warmBorder}` }}>
        <button onClick={onClose} style={{
          padding: "6px 14px", borderRadius: 8, border: `1.5px solid ${C.warmBorder}`,
          background: C.white, color: C.soft, fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>
          Close
        </button>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.brown }}>
          {currentIndex + 1} of {items.length}
        </div>
        <button onClick={acceptAll} style={{
          padding: "6px 14px", borderRadius: 8, border: "none",
          background: C.green, color: C.white, fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>
          Accept All
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: C.warmBorder }}>
        <div style={{ height: "100%", background: C.amber, width: `${((currentIndex + 1) / items.length) * 100}%`, transition: "width 0.3s" }} />
      </div>

      {/* Card area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, overflow: "hidden" }}>
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            width: "100%", maxWidth: 400,
            transform: `translateX(${dragOffset}px) rotate(${dragOffset * 0.03}deg)`,
            transition: isDragging ? "none" : "transform 0.3s ease",
            background: C.white, borderRadius: 20, overflow: "hidden",
            boxShadow: "0 8px 32px rgba(74,46,14,0.12)",
            border: `1.5px solid ${C.amberBorder}`,
          }}
        >
          {/* Photo */}
          {isPhoto && imgSrc ? (
            <div onClick={!editing ? openEdit : undefined} style={{ cursor: editing ? "default" : "pointer" }}>
              <img src={imgSrc} alt={cl.title} style={{ width: "100%", height: 300, objectFit: "cover", background: C.warm }}
                onError={(e) => { e.target.style.display = "none"; }} />
            </div>
          ) : (
            <div style={{ width: "100%", height: 200, background: C.warm, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48 }}>
              {"\u{1F4C4}"}
            </div>
          )}

          <div style={{ padding: 20 }}>
            {!editing ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.brown, marginBottom: 8 }}>{cl.title || current.fileName}</div>
                {cl.description && <div style={{ fontSize: 14, color: C.lightText, marginBottom: 12, lineHeight: 1.5 }}>{cl.description}</div>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {cl.people?.length > 0 && cl.people.map((p) => <Badge key={p} color={C.soft}>{p}</Badge>)}
                  {cl.location && cl.location !== "unknown" && <Badge color={C.blue}>{cl.location}</Badge>}
                  {cl.date_estimate && cl.date_estimate !== "unknown" && <Badge color={C.amber}>{cl.date_estimate}</Badge>}
                </div>
                {cl.tags?.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {cl.tags.map((t) => (
                      <span key={t} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: C.warm, color: C.soft }}>#{t}</span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 12, color: C.muted, marginTop: 10, textAlign: "center" }}>
                  Tap photo to edit details
                </div>
              </>
            ) : (
              /* Inline edit form */
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.soft, textTransform: "uppercase" }}>People</div>
                <input value={editForm.people} onChange={(e) => setEditForm(f => ({ ...f, people: e.target.value }))}
                  placeholder="e.g. Ryan, Mia" style={fieldStyle} />
                <div style={{ fontSize: 12, fontWeight: 600, color: C.soft, textTransform: "uppercase" }}>Location</div>
                <input value={editForm.location} onChange={(e) => setEditForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="e.g. Steamboat Springs, CO" style={fieldStyle} />
                <div style={{ fontSize: 12, fontWeight: 600, color: C.soft, textTransform: "uppercase" }}>Tags</div>
                <input value={editForm.tags} onChange={(e) => setEditForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="e.g. skiing, winter" style={fieldStyle} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={saveAndConfirm} disabled={saving} style={{
                    flex: 1, padding: "10px", borderRadius: 10, border: "none",
                    background: saving ? C.warmBorder : C.amber, color: C.white, fontSize: 14, fontWeight: 600, cursor: saving ? "default" : "pointer",
                  }}>
                    {saving ? "Saving..." : "Save & Confirm"}
                  </button>
                  <button onClick={() => setEditing(false)} style={{
                    padding: "10px 16px", borderRadius: 10, border: `1.5px solid ${C.warmBorder}`,
                    background: C.white, color: C.soft, fontSize: 14, cursor: "pointer",
                  }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Swipe hints */}
        {!editing && (
          <div style={{ display: "flex", gap: 4, marginTop: 12, fontSize: 12, color: C.muted }}>
            <span>\u2190 Skip</span>
            <span style={{ margin: "0 12px" }}>\u2022</span>
            <span>Confirm \u2192</span>
          </div>
        )}
      </div>

      {/* Action buttons (non-editing) */}
      {!editing && (
        <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.warmBorder}`, display: "flex", gap: 12, justifyContent: "center" }}>
          <button onClick={skipCurrent} style={{
            flex: 1, maxWidth: 180, padding: "14px", borderRadius: 14,
            border: `2px solid ${C.warmBorder}`, background: C.white, color: C.soft,
            fontSize: 16, fontWeight: 600, cursor: "pointer",
          }}>
            Skip
          </button>
          <button onClick={confirmCurrent} style={{
            flex: 1, maxWidth: 180, padding: "14px", borderRadius: 14,
            border: "none", background: C.green, color: C.white,
            fontSize: 16, fontWeight: 600, cursor: "pointer",
          }}>
            Confirm \u2713
          </button>
        </div>
      )}
    </div>
  );
};
