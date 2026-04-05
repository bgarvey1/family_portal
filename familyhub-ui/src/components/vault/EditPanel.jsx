import { useState } from "react";
import { C } from "../../constants/palette";
import { apiFetch } from "../../api/fetch";

// ── Edit Panel (corrections UI) ─────────────────────────────────────────────
const EditPanel = ({ item, onSave, onReclassify, onClose }) => {
  const cl = item.classification || {};
  const existing = item.corrections || {};
  const [people, setPeople] = useState(
    (existing.people || cl.people || []).join(", ")
  );
  const [location, setLocation] = useState(
    existing.location || cl.location || ""
  );
  const [context, setContext] = useState(existing.context || "");
  const [tags, setTags] = useState(
    (existing.tags || cl.tags || []).join(", ")
  );
  const [saving, setSaving] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [status, setStatus] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const body = {};
      body.people = people.trim() ? people.split(",").map((s) => s.trim()).filter(Boolean) : [];
      body.location = location.trim() || "";
      body.context = context.trim() || "";
      body.tags = tags.trim() ? tags.split(",").map((s) => s.trim()).filter(Boolean) : [];

      const r = await apiFetch(`/api/manifests/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const learned = data.knowledgeLearned?.length || 0;
      setStatus({ ok: true, msg: `Saved! ${learned > 0 ? `Learned ${learned} new fact${learned > 1 ? "s" : ""}.` : ""}` });
      if (onSave) onSave();
    } catch (err) {
      setStatus({ ok: false, msg: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleReclassify = async () => {
    setReclassifying(true);
    setStatus(null);
    try {
      const r = await apiFetch(`/api/manifests/${item.id}/reclassify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStatus({ ok: true, msg: "Re-classified with latest knowledge!" });
      if (onReclassify) onReclassify();
    } catch (err) {
      setStatus({ ok: false, msg: err.message });
    } finally {
      setReclassifying(false);
    }
  };

  const fieldStyle = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1.5px solid ${C.amberBorder}`,
    background: C.cream,
    color: C.text,
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: C.soft,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 4,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }}
      />
      {/* Panel */}
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 440,
          background: C.white,
          overflowY: "auto",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.brown }}>Edit Details</div>
          <button
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "none",
              background: C.warm,
              color: C.soft,
              fontSize: 18,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {"\u2715"}
          </button>
        </div>

        {/* Current title */}
        <div style={{ fontSize: 14, color: C.lightText, padding: "8px 12px", background: C.warm, borderRadius: 8 }}>
          {cl.title || item.fileName}
        </div>

        {/* People */}
        <div>
          <div style={labelStyle}>People (comma-separated)</div>
          <input
            type="text"
            value={people}
            onChange={(e) => setPeople(e.target.value)}
            placeholder='e.g. Ryan (blue jacket), Justin (orange jacket)'
            style={fieldStyle}
          />
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
            Tip: Add descriptions like "Ryan (blue jacket)" to teach the system
          </div>
        </div>

        {/* Location */}
        <div>
          <div style={labelStyle}>Location</div>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Buffalo Pass, near Steamboat Springs, CO"
            style={fieldStyle}
          />
        </div>

        {/* Context */}
        <div>
          <div style={labelStyle}>Context / Notes</div>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="e.g. Annual cat skiing trip with the boys, January 2024"
            rows={3}
            style={{ ...fieldStyle, resize: "vertical" }}
          />
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
            This becomes family knowledge — future photos will be classified smarter
          </div>
        </div>

        {/* Tags */}
        <div>
          <div style={labelStyle}>Tags (comma-separated)</div>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g. skiing, family trip, winter"
            style={fieldStyle}
          />
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button
            onClick={handleSave}
            disabled={saving || reclassifying}
            style={{
              flex: 1,
              padding: "12px 20px",
              borderRadius: 10,
              border: "none",
              background: saving ? C.warmBorder : C.amber,
              color: C.white,
              fontSize: 15,
              fontWeight: 600,
              cursor: saving ? "default" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save Corrections"}
          </button>
          <button
            onClick={handleReclassify}
            disabled={saving || reclassifying}
            style={{
              padding: "12px 20px",
              borderRadius: 10,
              border: `1.5px solid ${C.amberBorder}`,
              background: reclassifying ? C.warm : C.white,
              color: reclassifying ? C.muted : C.soft,
              fontSize: 15,
              fontWeight: 600,
              cursor: reclassifying ? "default" : "pointer",
            }}
          >
            {reclassifying ? "Re-classifying..." : "Re-classify"}
          </button>
        </div>

        {/* Status message */}
        {status && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              background: status.ok ? C.greenBg : C.redBg,
              color: status.ok ? C.green : C.red,
              border: `1px solid ${status.ok ? C.green + "30" : C.red + "30"}`,
            }}
          >
            {status.msg}
          </div>
        )}
      </div>
    </div>
  );
};

export default EditPanel;
