import { useState, useEffect, useCallback, useRef } from "react";

// ── Configuration ────────────────────────────────────────────────────────────
// Backend (Cloud Run) — handles vault storage, Drive sync, classification
// In local dev (Vite proxy), leave BACKEND_URL empty so requests go to /api/*
// In production (Cloud Run), set the full URL.
const CLOUD_BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://familyhub-backend-761807984124.us-east1.run.app";
const BACKEND_KEY = import.meta.env.VITE_BACKEND_KEY || "";

// Auto-detect: if running on localhost with a local backend, use Vite proxy (empty base);
// otherwise use Cloud Run URL directly.
const IS_LOCAL = typeof window !== "undefined" && window.location.hostname === "localhost";
const BACKEND_URL = CLOUD_BACKEND_URL;

// ── Demo data (used when backend is unreachable) ────────────────────────────
const DEMO_MANIFESTS = [
  {
    id: "demo-1",
    driveFileId: "demo-1",
    fileName: "family-picnic-2024.jpg",
    mimeType: "image/jpeg",
    thumbnailLink: null,
    webViewLink: null,
    classification: {
      title: "Summer Family Picnic",
      description: "The whole family gathered at Riverside Park for the annual summer picnic. Kids playing on the grass, grandparents watching from the shade.",
      category: "photo",
      people: ["Grandma", "Grandpa", "kids"],
      date_estimate: "2024-07-15",
      tags: ["summer", "picnic", "family", "outdoors"],
      sentiment: "joyful",
    },
    createdAt: "2024-07-16T10:00:00Z",
  },
  {
    id: "demo-2",
    driveFileId: "demo-2",
    fileName: "birthday-card-emma.pdf",
    mimeType: "application/pdf",
    thumbnailLink: null,
    webViewLink: null,
    classification: {
      title: "Emma's Birthday Card",
      description: "A handmade birthday card from Emma with colorful drawings and a sweet message.",
      category: "letter",
      people: ["Emma"],
      date_estimate: "2024-09-22",
      tags: ["birthday", "card", "handmade", "emma"],
      sentiment: "joyful",
    },
    createdAt: "2024-09-23T08:00:00Z",
  },
  {
    id: "demo-3",
    driveFileId: "demo-3",
    fileName: "school-report-fall2024.pdf",
    mimeType: "application/pdf",
    thumbnailLink: null,
    webViewLink: null,
    classification: {
      title: "Fall 2024 School Report",
      description: "Excellent progress report from school showing strong performance in reading and math.",
      category: "document",
      people: ["Emma"],
      date_estimate: "2024-11-15",
      tags: ["school", "report", "grades", "education"],
      sentiment: "neutral",
    },
    createdAt: "2024-11-16T12:00:00Z",
  },
];

// ── API helpers ──────────────────────────────────────────────────────────────
const apiFetch = (path, opts = {}) =>
  fetch(`${BACKEND_URL}${path}`, {
    ...opts,
    headers: { "x-api-key": BACKEND_KEY, ...opts.headers },
  });

// Build a proxied thumbnail URL — works for both Drive files and uploaded files
const thumbUrl = (item) => {
  if (!item) return null;
  // Uploaded files (stored in GCS)
  if (item.source === "upload") {
    return `${BACKEND_URL}/api/uploads/${item.id}/image?key=${BACKEND_KEY}`;
  }
  // Drive files
  if (item.driveFileId) {
    return `${BACKEND_URL}/api/files/${item.driveFileId}/thumbnail?key=${BACKEND_KEY}`;
  }
  return null;
};

// Legacy helper for code that only has a driveFileId
const driveThumbUrl = (driveFileId) =>
  driveFileId
    ? `${BACKEND_URL}/api/files/${driveFileId}/thumbnail?key=${BACKEND_KEY}`
    : null;

// ── Agentic Chat (backend handles tool use) ─────────────────────────────────
const agenticChat = async (message, history) => {
  const r = await apiFetch("/api/chat/agentic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Chat API ${r.status}: ${err}`);
  }
  const data = await r.json();
  const sources = (data.sources || []).map((s) => ({
    ...s,
    thumbUrl: thumbUrl(s),
  }));
  return { text: data.text || "", sources };
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function calcAge(birthday) {
  if (!birthday) return null;
  const d = new Date(birthday);
  if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

function weatherIcon(code) {
  if (code === 0) return "\u2600\uFE0F";       // Clear
  if (code <= 2) return "\u26C5";              // Partly cloudy
  if (code === 3) return "\u2601\uFE0F";       // Overcast
  if (code <= 48) return "\uD83C\uDF2B\uFE0F"; // Fog
  if (code <= 57) return "\uD83C\uDF27\uFE0F"; // Drizzle
  if (code <= 67) return "\uD83C\uDF27\uFE0F"; // Rain
  if (code <= 77) return "\u2744\uFE0F";       // Snow
  if (code <= 82) return "\uD83C\uDF26\uFE0F"; // Rain showers
  if (code <= 86) return "\uD83C\uDF28\uFE0F"; // Snow showers
  return "\u26C8\uFE0F";                       // Thunderstorm
}

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  cream: "#FDF8F0",
  warm: "#F7EDD5",
  warmBorder: "#E8D5A8",
  brown: "#4A2E0E",
  amber: "#B8760A",
  amberLight: "#F2DFA8",
  amberBorder: "#DCBB6A",
  soft: "#7A5535",
  muted: "#A0845C",
  green: "#2E7D52",
  greenBg: "#E8F5EE",
  red: "#9B2020",
  redBg: "#FBE8E8",
  blue: "#1A5A8A",
  white: "#FFFFFF",
  text: "#2A1A06",
  lightText: "#5A4A36",
};

const CATEGORIES = [
  "all", "photo", "document", "receipt", "letter",
  "certificate", "medical", "legal", "financial", "other",
];

// ── Lightbox (full-screen photo viewer, stays in-app) ───────────────────────
const Lightbox = ({ src, alt, onClose }) => {
  if (!src) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          width: 48,
          height: 48,
          borderRadius: "50%",
          border: "none",
          background: "rgba(255,255,255,0.2)",
          color: "#fff",
          fontSize: 28,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
        }}
      >
        ✕
      </button>
      {/* Caption */}
      {alt && (
        <div
          style={{
            position: "absolute",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            color: "rgba(255,255,255,0.85)",
            fontSize: 16,
            fontWeight: 500,
            textAlign: "center",
            maxWidth: "80%",
            textShadow: "0 1px 4px rgba(0,0,0,0.5)",
          }}
        >
          {alt}
        </div>
      )}
      {/* Photo */}
      <img
        src={src}
        alt={alt || "Photo"}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "90vw",
          maxHeight: "85vh",
          objectFit: "contain",
          borderRadius: 8,
          boxShadow: "0 4px 30px rgba(0,0,0,0.4)",
          cursor: "default",
        }}
      />
    </div>
  );
};

// ── Small components ─────────────────────────────────────────────────────────
const Badge = ({ color, bg, children }) => (
  <span
    style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      background: bg || color + "18",
      color,
      border: `1.5px solid ${color}40`,
    }}
  >
    {children}
  </span>
);

const SourcePill = ({ item }) => {
  const c = item.classification || {};
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 10px",
        borderRadius: 16,
        fontSize: 11,
        fontWeight: 500,
        background: C.amberLight,
        color: C.soft,
        border: `1px solid ${C.amberBorder}`,
      }}
    >
      {c.category === "photo" ? "\u{1F5BC}" : "\u{1F4C4}"} {c.title}
    </span>
  );
};

// ── Chat Message ─────────────────────────────────────────────────────────────
const ChatMessage = ({ msg, onPhotoClick }) => {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        marginBottom: 20,
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          padding: "14px 20px",
          borderRadius: isUser ? "20px 20px 4px 20px" : "20px 20px 20px 4px",
          background: isUser ? C.brown : C.white,
          color: isUser ? C.cream : C.text,
          fontSize: 17,
          lineHeight: 1.6,
          boxShadow: "0 1px 4px rgba(74,46,14,0.08)",
          border: isUser ? "none" : `1px solid ${C.warmBorder}`,
          whiteSpace: "pre-wrap",
        }}
      >
        {msg.content}
      </div>
      {/* Source pills */}
      {msg.sources && msg.sources.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 8,
            maxWidth: "85%",
          }}
        >
          {msg.sources.map((s) => (
            <SourcePill key={s.id} item={s} />
          ))}
        </div>
      )}
      {/* Inline photos from sources */}
      {msg.sources && msg.sources.filter((s) => (s.driveFileId || s.source === "upload") && (s.classification?.category === "photo" || s.mimeType?.startsWith("image/"))).length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 10,
            flexWrap: "wrap",
            maxWidth: "85%",
          }}
        >
          {msg.sources
            .filter((s) => (s.driveFileId || s.source === "upload") && (s.classification?.category === "photo" || s.mimeType?.startsWith("image/")))
            .map((s) => (
              <div
                key={s.id}
                onClick={() => onPhotoClick && onPhotoClick(thumbUrl(s), s.classification?.title || "Photo")}
                style={{ cursor: "pointer" }}
              >
                <img
                  src={thumbUrl(s)}
                  alt={s.classification?.title || "Photo"}
                  style={{
                    width: 120,
                    height: 90,
                    objectFit: "cover",
                    borderRadius: 10,
                    border: `2px solid ${C.amberBorder}`,
                    background: C.warm,
                  }}
                  onError={(e) => (e.target.style.display = "none")}
                />
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

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
      if (people.trim()) body.people = people.split(",").map((s) => s.trim()).filter(Boolean);
      if (location.trim()) body.location = location.trim();
      if (context.trim()) body.context = context.trim();
      if (tags.trim()) body.tags = tags.split(",").map((s) => s.trim()).filter(Boolean);

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
            ✕
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

// ── Vault Card ───────────────────────────────────────────────────────────────
const VaultCard = ({ item, onPhotoClick, onEdit, onTagFace }) => {
  const cl = item.classification || {};
  const sentimentColors = {
    joyful: C.green,
    neutral: C.muted,
    formal: C.blue,
    somber: "#5B3FA6",
  };
  const isPhoto = (item.driveFileId || item.source === "upload") && cl.category === "photo";
  const imgSrc = isPhoto ? thumbUrl(item) : null;
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 14,
        overflow: "hidden",
        border: `1.5px solid ${C.amberBorder}`,
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 2px 8px rgba(74,46,14,0.06)",
      }}
    >
      {isPhoto ? (
        <div
          onClick={() => onPhotoClick && onPhotoClick(imgSrc, cl.title || item.fileName)}
          style={{ cursor: "pointer" }}
        >
          <img
            src={imgSrc}
            alt={cl.title || item.fileName}
            style={{ width: "100%", height: 170, objectFit: "cover", background: C.warm }}
            onError={(e) => {
              e.target.onerror = null;
              e.target.parentElement.innerHTML = `<div style="width:100%;height:170px;background:${C.warm};display:flex;align-items:center;justify-content:center;font-size:40px">\u{1F5BC}</div>`;
            }}
          />
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            height: 170,
            background: C.warm,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 40,
          }}
        >
          {cl.category === "photo" ? "\u{1F5BC}" : cl.category === "receipt" ? "\u{1F9FE}" : "\u{1F4C4}"}
        </div>
      )}
      <div style={{ padding: 16, flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: C.brown }}>{cl.title || item.fileName}</div>
        {cl.description && (
          <div style={{ fontSize: 13, color: C.lightText, lineHeight: 1.5 }}>{cl.description}</div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {cl.category && <Badge color={C.amber}>{cl.category}</Badge>}
          {cl.sentiment && (
            <Badge color={sentimentColors[cl.sentiment] || C.muted}>{cl.sentiment}</Badge>
          )}
          {cl.date_estimate && cl.date_estimate !== "unknown" && (
            <Badge color={C.blue}>{cl.date_estimate}</Badge>
          )}
        </div>
        {cl.people && cl.people.length > 0 && (
          <div style={{ fontSize: 12, color: C.muted }}>People: {cl.people.join(", ")}</div>
        )}
        {cl.location && (
          <div style={{ fontSize: 12, color: C.muted }}>Location: {cl.location}</div>
        )}
        {item.corrections && (
          <div style={{ fontSize: 11, color: C.green, fontStyle: "italic" }}>
            Corrected{item.corrections.people ? ` — ${item.corrections.people.join(", ")}` : ""}
          </div>
        )}
        {cl.tags && cl.tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: "auto" }}>
            {cl.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: C.warm,
                  color: C.soft,
                }}
              >
                #{t}
              </span>
            ))}
          </div>
        )}
        {/* Action buttons */}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit && onEdit(item); }}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: `1.5px solid ${C.amberBorder}`,
              background: C.cream,
              color: C.soft,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Edit Details
          </button>
          {isPhoto && (
            <button
              onClick={(e) => { e.stopPropagation(); onTagFace && onTagFace(item); }}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: `1.5px solid ${C.green}40`,
                background: C.greenBg,
                color: C.green,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Tag Face
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Suggestion Chips ────────────────────────────────────────────────────────
const SUGGESTION_CHIPS = [
  { label: "Catch me up", icon: "\u2615", message: "Catch me up on the family! What's everyone been up to lately?" },
  { label: "On this day", icon: "\uD83D\uDCC5", message: "Show me any photos or memories from this day in previous years." },
  { label: "Recent photos", icon: "\uD83D\uDCF8", message: "Show me the most recent family photos." },
];

// ── Chat View ────────────────────────────────────────────────────────────────
const ChatView = ({ onPhotoClick }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState(null);
  const [weatherBar, setWeatherBar] = useState([]);
  const [weatherExpanded, setWeatherExpanded] = useState(null); // profileId or null
  const [familyNames, setFamilyNames] = useState([]); // for dynamic "What's new with..." chips
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, thinking]);

  // Load weather + family names for chips
  useEffect(() => {
    (async () => {
      try {
        const [pRes, wRes] = await Promise.all([apiFetch("/api/profiles"), apiFetch("/api/profiles/weather")]);
        const profiles = pRes.ok ? (await pRes.json()).profiles || [] : [];
        const weatherList = wRes.ok ? (await wRes.json()).weather || [] : [];
        const wMap = {};
        for (const w of weatherList) wMap[w.profileId] = w.weather;
        const items = profiles.filter(p => p.location?.city && wMap[p.id]).map(p => ({
          id: p.id,
          name: p.name,
          city: p.location.city,
          state: p.location.state,
          temp: Math.round(wMap[p.id].temperature),
          desc: wMap[p.id].description,
          forecast: wMap[p.id].forecast || [],
        }));
        setWeatherBar(items);
        setFamilyNames(profiles.map(p => p.name));
      } catch {}
    })();
  }, []);

  // Send a message (from input or suggestion chip)
  const sendMessage = useCallback(async (text) => {
    const q = text.trim();
    if (!q || thinking) return;
    setInput("");
    setError(null);

    const userMsg = { role: "user", content: q };
    setMessages((prev) => [...prev, userMsg]);
    setThinking(true);

    try {
      const result = await agenticChat(q, messages);
      setMessages((prev) => [...prev, { role: "assistant", content: result.text, sources: result.sources }]);
    } catch (err) {
      setError(err.message);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I'm having a little trouble right now. Please try again in a moment.",
          sources: [],
        },
      ]);
    } finally {
      setThinking(false);
    }
  }, [thinking, messages]);

  const send = () => sendMessage(input);

  // Build full chip list: static chips + dynamic per-person chips
  const allChips = [
    ...SUGGESTION_CHIPS,
    ...familyNames.map(name => ({
      label: `What's new with ${name}?`,
      icon: "\uD83D\uDC64",
      message: `What's new with ${name}? How are they doing lately?`,
    })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Weather bar */}
      {weatherBar.length > 0 && (
        <div style={{ background: C.warm, borderBottom: `1px solid ${C.warmBorder}`, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 16, padding: "10px 20px", overflowX: "auto" }}>
            {weatherBar.map((w) => (
              <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.brown, whiteSpace: "nowrap", cursor: "pointer" }}
                onClick={() => setWeatherExpanded(prev => prev === w.id ? null : w.id)}>
                <strong>{w.name}</strong>
                <span style={{ color: C.lightText }}>{w.city}{w.state ? `, ${w.state}` : ""}</span>
                <span style={{ padding: "1px 8px", borderRadius: 10, background: C.white, fontSize: 12, color: C.amber, fontWeight: 600 }}>
                  {w.temp}{"\u00B0"}F
                </span>
                <span style={{ fontSize: 12, color: C.muted }}>{w.desc}</span>
                <span style={{ fontSize: 10, color: C.amberBorder, marginLeft: 2 }}>{weatherExpanded === w.id ? "\u25B2" : "\u25BC"}</span>
              </div>
            ))}
          </div>
          {/* 7-day forecast */}
          {weatherBar.filter(w => w.id === weatherExpanded && w.forecast.length > 0).map(w => (
            <div key={w.id + "-fc"} style={{ display: "flex", gap: 2, padding: "4px 20px 10px", overflowX: "auto" }}>
              {w.forecast.map((d, i) => {
                const day = i === 0 ? "Today" : new Date(d.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4px 8px", borderRadius: 8, background: i === 0 ? C.white : "transparent", minWidth: 52, fontSize: 11 }}>
                    <span style={{ fontWeight: 600, color: C.brown, fontSize: 11 }}>{day}</span>
                    <span style={{ fontSize: 16, margin: "2px 0" }}>{weatherIcon(d.weatherCode)}</span>
                    <span style={{ color: C.amber, fontWeight: 700, fontSize: 12 }}>{d.high}{"\u00B0"}</span>
                    <span style={{ color: C.muted, fontSize: 10 }}>{d.low}{"\u00B0"}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 20px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {messages.length === 0 && !thinking && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              color: C.muted,
              textAlign: "center",
              padding: 40,
            }}
          >
            <div style={{ fontSize: 48 }}>{"\u{1F46A}"}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: C.brown }}>
              Your Family Storyteller
            </div>
            <div style={{ fontSize: 17, maxWidth: 440, lineHeight: 1.6 }}>
              I can catch you up on the family, find photos, check on the kids,
              and share memories. What would you like to know?
            </div>
            {/* Suggestion chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 12, maxWidth: 500 }}>
              {allChips.map((chip, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(chip.message)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "10px 16px",
                    borderRadius: 20,
                    border: `1.5px solid ${C.amberBorder}`,
                    background: C.white,
                    color: C.brown,
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.warm; e.currentTarget.style.borderColor = C.amber; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = C.white; e.currentTarget.style.borderColor = C.amberBorder; }}
                >
                  <span>{chip.icon}</span>
                  <span>{chip.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <ChatMessage key={i} msg={m} onPhotoClick={onPhotoClick} />
        ))}
        {thinking && (
          <div
            style={{
              alignSelf: "flex-start",
              padding: "12px 20px",
              borderRadius: 20,
              background: C.white,
              color: C.muted,
              fontSize: 16,
              border: `1px solid ${C.warmBorder}`,
            }}
          >
            Thinking...
          </div>
        )}
        {error && (
          <div
            style={{
              fontSize: 13,
              color: C.red,
              padding: "8px 16px",
              background: C.redBg,
              borderRadius: 8,
              alignSelf: "center",
              marginTop: 8,
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div
        style={{
          borderTop: `1px solid ${C.warmBorder}`,
          padding: "16px 20px",
          background: C.white,
          display: "flex",
          gap: 10,
          alignItems: "flex-end",
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask about the family..."
          rows={1}
          style={{
            flex: 1,
            padding: "14px 18px",
            borderRadius: 16,
            border: `1.5px solid ${C.amberBorder}`,
            background: C.cream,
            color: C.text,
            fontSize: 17,
            fontFamily: "inherit",
            resize: "none",
            outline: "none",
            lineHeight: 1.5,
          }}
        />
        <button
          onClick={send}
          disabled={thinking || !input.trim()}
          style={{
            padding: "14px 24px",
            borderRadius: 16,
            border: "none",
            background: thinking || !input.trim() ? C.warmBorder : C.amber,
            color: C.white,
            fontSize: 16,
            fontWeight: 600,
            cursor: thinking || !input.trim() ? "default" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};

// ── Vault View ───────────────────────────────────────────────────────────────
const VaultView = ({ manifests, onPhotoClick, onRefresh }) => {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [tagging, setTagging] = useState(null); // item being face-tagged
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
        formData.append("contributor", "Brendan"); // TODO: make configurable

        const r = await fetch(`${BACKEND_URL}/api/upload`, {
          method: "POST",
          headers: { "x-api-key": BACKEND_KEY },
          body: formData,
        });

        if (!r.ok) {
          const err = await r.json();
          results.push({ name: file.name, ok: false, error: err.error });
        } else {
          const data = await r.json();
          results.push({ name: file.name, ok: true, title: data.title });
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
      details: results,
    });
    setUploading(false);

    // Clear the file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";

    // Refresh the manifest list
    if (succeeded > 0 && onRefresh) onRefresh();
  };

  const filtered = manifests.filter((m) => {
    const cl = m.classification || {};
    if (category !== "all" && cl.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = [cl.title, cl.description, m.fileName, ...(cl.tags || []), ...(cl.people || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={{ padding: 24 }}>
      {/* Upload + Search bar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, alignItems: "center" }}>
        {/* Upload button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleUpload}
          style={{ display: "none" }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            padding: "8px 20px",
            borderRadius: 10,
            border: "none",
            background: uploading ? C.warmBorder : C.amber,
            color: C.white,
            fontSize: 14,
            fontWeight: 600,
            cursor: uploading ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {uploading ? "Uploading..." : "+ Add Photos"}
        </button>

        <input
          type="text"
          placeholder="Search vault..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "8px 16px",
            borderRadius: 10,
            border: `1.5px solid ${C.amberBorder}`,
            background: C.white,
            color: C.text,
            fontSize: 14,
            outline: "none",
            minWidth: 200,
            flex: 1,
          }}
        />
      </div>

      {/* Upload status */}
      {uploadStatus && (
        <div
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            marginBottom: 12,
            background: uploadStatus.ok ? C.greenBg : C.redBg,
            color: uploadStatus.ok ? C.green : C.red,
            fontSize: 14,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{uploadStatus.msg}</span>
          <button
            onClick={() => setUploadStatus(null)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              fontSize: 16,
              cursor: "pointer",
              padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Category filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, alignItems: "center" }}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            style={{
              padding: "5px 14px",
              borderRadius: 20,
              border: `1.5px solid ${category === c ? C.amber : C.amberBorder}`,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              background: category === c ? C.amber : C.cream,
              color: category === c ? C.white : C.soft,
            }}
          >
            {c}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
        {filtered.length} item{filtered.length !== 1 && "s"}
        {category !== "all" && ` in "${category}"`}
        {search && ` matching "${search}"`}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {filtered.map((m) => (
          <VaultCard key={m.id || m.driveFileId} item={m} onPhotoClick={onPhotoClick} onEdit={setEditing} onTagFace={setTagging} />
        ))}
      </div>
      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: C.muted, fontSize: 16 }}>
          No items found.
        </div>
      )}

      {/* Edit side panel */}
      {editing && (
        <EditPanel
          item={editing}
          onClose={() => setEditing(null)}
          onSave={() => { if (onRefresh) onRefresh(); }}
          onReclassify={() => { if (onRefresh) onRefresh(); setEditing(null); }}
        />
      )}

      {/* Face tag modal */}
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

// ── Face Label Modal ────────────────────────────────────────────────────────
// Click on a photo to tag a person — captures click coordinates, sends to backend for cropping
const FaceLabelModal = ({ item, imgSrc, onClose, onRefresh }) => {
  const [step, setStep] = useState("click"); // click | name | saving | done
  const [clickPos, setClickPos] = useState(null);
  const [personName, setPersonName] = useState("");
  const [status, setStatus] = useState(null);
  const imgRef = useRef(null);

  const handleImageClick = (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setClickPos({ x, y, screenX: e.clientX - rect.left, screenY: e.clientY - rect.top, rectW: rect.width, rectH: rect.height });
    setStep("name");
  };

  const handleSave = async () => {
    if (!personName.trim()) return;
    setStep("saving");
    try {
      const r = await apiFetch("/api/faces/label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifestId: item.id,
          clickX: clickPos.x,
          clickY: clickPos.y,
          personName: personName.trim(),
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setStatus({ ok: true, msg: `Saved face reference for "${personName.trim()}"` });
      setStep("done");
      if (onRefresh) onRefresh();
    } catch (err) {
      setStatus({ ok: false, msg: err.message });
      setStep("name");
    }
  };

  // Calculate crop preview box — matches backend's 15% crop
  const cropPreview = clickPos ? (() => {
    const size = Math.min(clickPos.rectW, clickPos.rectH) * 0.15;
    const half = size / 2;
    return {
      left: Math.max(0, clickPos.screenX - half),
      top: Math.max(0, clickPos.screenY - half),
      width: Math.min(size, clickPos.rectW - Math.max(0, clickPos.screenX - half)),
      height: Math.min(size, clickPos.rectH - Math.max(0, clickPos.screenY - half)),
    };
  })() : null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.8)" }}>
      <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Close button */}
        <button onClick={onClose} style={{ position: "absolute", top: -40, right: 0, background: "none", border: "none", color: "#fff", fontSize: 28, cursor: "pointer", zIndex: 2 }}>x</button>

        {/* Instructions */}
        <div style={{ color: "#fff", fontSize: 14, textAlign: "center", padding: "0 20px" }}>
          {step === "click" && "Click on a person in the photo to tag them"}
          {step === "name" && "Great! Now name this person:"}
          {step === "saving" && "Saving face reference..."}
          {step === "done" && status?.msg}
        </div>

        {/* Image with click handler */}
        <div style={{ position: "relative", display: "inline-block" }}>
          <img
            ref={imgRef}
            src={imgSrc}
            alt=""
            onClick={step === "click" ? handleImageClick : undefined}
            style={{
              maxWidth: "85vw", maxHeight: "70vh", borderRadius: 8,
              cursor: step === "click" ? "crosshair" : "default",
            }}
          />
          {/* Crop preview box */}
          {cropPreview && (
            <div style={{
              position: "absolute",
              left: cropPreview.left, top: cropPreview.top,
              width: cropPreview.width, height: cropPreview.height,
              border: "3px solid #4ade80",
              borderRadius: 8,
              boxShadow: "0 0 20px rgba(74,222,128,0.4)",
              pointerEvents: "none",
            }} />
          )}
        </div>

        {/* Name input */}
        {step === "name" && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <input
              autoFocus
              value={personName}
              onChange={e => setPersonName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder="Person's name..."
              style={{ padding: "10px 16px", borderRadius: 10, border: "none", fontSize: 15, width: 220 }}
            />
            <button onClick={handleSave} disabled={!personName.trim()}
              style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: personName.trim() ? C.green : C.warmBorder, color: "#fff", fontSize: 15, fontWeight: 600, cursor: personName.trim() ? "pointer" : "not-allowed" }}>
              Save
            </button>
            <button onClick={() => { setStep("click"); setClickPos(null); }}
              style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.3)", background: "transparent", color: "#fff", fontSize: 15, cursor: "pointer" }}>
              Re-pick
            </button>
          </div>
        )}

        {/* Done — offer to scan */}
        {step === "done" && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button onClick={() => { setStep("click"); setClickPos(null); setPersonName(""); setStatus(null); }}
              style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.3)", background: "transparent", color: "#fff", fontSize: 14, cursor: "pointer" }}>
              Tag Another Person
            </button>
            <button onClick={onClose}
              style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: C.amber, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Done
            </button>
          </div>
        )}

        {status && !status.ok && (
          <div style={{ color: "#f87171", fontSize: 13, textAlign: "center" }}>{status.msg}</div>
        )}
      </div>
    </div>
  );
};

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

// ── Confirm Dialog ──────────────────────────────────────────────────────────
const ConfirmDialog = ({ message, onConfirm, onCancel }) => (
  <div style={{
    position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
  }}>
    <div style={{ background: C.white, borderRadius: 16, padding: 28, maxWidth: 400, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
      <div style={{ fontSize: 15, color: C.brown, marginBottom: 20, lineHeight: 1.5 }}>{message}</div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ padding: "8px 20px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.lightText, fontSize: 14, cursor: "pointer" }}>Cancel</button>
        <button onClick={onConfirm} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: C.red, color: C.white, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Delete</button>
      </div>
    </div>
  </div>
);

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
            People: {(item.corrections?.people || item.classification?.people || []).join(", ") || "—"}<br/>
            Location: {item.corrections?.location || item.classification?.location || "—"}<br/>
            Tags: {(item.corrections?.tags || item.classification?.tags || []).join(", ") || "—"}
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

// ── Admin View ───────────────────────────────────────────────────────────────
const AdminView = ({ syncStatus, onSync, syncing, syncResult, manifests, online, onRefresh }) => {
  const [section, setSection] = useState("manage"); // manage | knowledge | faces | family | sync
  const [selected, setSelected] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(null); // null | { ids: [...] }
  const [deleting, setDeleting] = useState(false);
  const [propagateItem, setPropagateItem] = useState(null);
  const [knowledge, setKnowledge] = useState([]);
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const [newFact, setNewFact] = useState("");
  const [faces, setFaces] = useState({ faces: [], byPerson: {} });
  const [loadingFaces, setLoadingFaces] = useState(false);
  const [scanPerson, setScanPerson] = useState(null);
  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [profileWeather, setProfileWeather] = useState({});
  const [editingProfile, setEditingProfile] = useState(null); // null | profile object (empty = new)
  const [profileForm, setProfileForm] = useState({ name: "", birthday: "", school: "", city: "", state: "", activities: "", notes: "", links: [] });

  const loadKnowledge = async () => {
    setLoadingKnowledge(true);
    try {
      const r = await apiFetch("/api/knowledge");
      if (r.ok) {
        const data = await r.json();
        setKnowledge(data.knowledge || []);
      }
    } catch {} finally { setLoadingKnowledge(false); }
  };

  const loadFaces = async () => {
    setLoadingFaces(true);
    try {
      const r = await apiFetch("/api/faces");
      if (r.ok) {
        const data = await r.json();
        setFaces(data);
      }
    } catch {} finally { setLoadingFaces(false); }
  };

  const deleteFace = async (id) => {
    try {
      const r = await apiFetch(`/api/faces/${id}`, { method: "DELETE" });
      if (r.ok) loadFaces();
    } catch {}
  };

  const loadProfiles = async () => {
    setLoadingProfiles(true);
    try {
      const [pr, wr] = await Promise.all([
        apiFetch("/api/profiles"),
        apiFetch("/api/profiles/weather"),
      ]);
      if (pr.ok) {
        const data = await pr.json();
        setProfiles(data.profiles || []);
      }
      if (wr.ok) {
        const data = await wr.json();
        const map = {};
        for (const w of data.weather || []) map[w.profileId] = w.weather;
        setProfileWeather(map);
      }
    } catch {} finally { setLoadingProfiles(false); }
  };

  const saveProfile = async () => {
    if (!profileForm.name.trim()) return;
    const body = {
      name: profileForm.name.trim(),
      birthday: profileForm.birthday || null,
      school: profileForm.school || null,
      location: profileForm.city ? { city: profileForm.city, state: profileForm.state || null } : null,
      activities: profileForm.activities ? profileForm.activities.split(",").map(a => a.trim()).filter(Boolean) : [],
      notes: profileForm.notes || null,
      links: profileForm.links.filter(l => l.url.trim()),
    };
    try {
      if (editingProfile?.id) {
        await apiFetch(`/api/profiles/${editingProfile.id}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch("/api/profiles", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      setEditingProfile(null);
      setProfileForm({ name: "", birthday: "", school: "", city: "", state: "", activities: "", notes: "", links: [] });
      loadProfiles();
    } catch {}
  };

  const deleteProfile = async (id) => {
    try {
      const r = await apiFetch(`/api/profiles/${id}`, { method: "DELETE" });
      if (r.ok) loadProfiles();
    } catch {}
  };

  const startEditProfile = (p) => {
    setEditingProfile(p);
    setProfileForm({
      name: p.name || "",
      birthday: p.birthday || "",
      school: p.school || "",
      city: p.location?.city || "",
      state: p.location?.state || "",
      activities: (p.activities || []).join(", "),
      notes: p.notes || "",
      links: p.links || [],
    });
  };

  useEffect(() => { if (section === "knowledge") loadKnowledge(); }, [section]);
  useEffect(() => { if (section === "faces") loadFaces(); }, [section]);
  useEffect(() => { if (section === "family") loadProfiles(); }, [section]);

  const handleDelete = async (ids) => {
    setDeleting(true);
    try {
      if (ids.length === 1) {
        const r = await apiFetch(`/api/manifests/${ids[0]}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } else {
        const r = await apiFetch("/api/manifests/bulk-delete", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      }
      setSelected(new Set());
      if (onRefresh) await onRefresh();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  const addFact = async () => {
    if (!newFact.trim()) return;
    try {
      const r = await apiFetch("/api/knowledge", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fact: newFact.trim() }),
      });
      if (r.ok) { setNewFact(""); loadKnowledge(); }
    } catch {}
  };

  const deleteFact = async (id) => {
    try {
      const r = await apiFetch(`/api/knowledge/${id}`, { method: "DELETE" });
      if (r.ok) loadKnowledge();
    } catch {}
  };

  const filtered = manifests.filter(m => {
    if (!search) return true;
    const s = search.toLowerCase();
    const c = m.classification || {};
    return (c.title || "").toLowerCase().includes(s) ||
      (c.people || []).join(" ").toLowerCase().includes(s) ||
      (c.tags || []).join(" ").toLowerCase().includes(s) ||
      (m.corrections?.people || []).join(" ").toLowerCase().includes(s);
  });

  const catCounts = {};
  manifests.forEach(m => {
    const cat = m.classification?.category || "other";
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });

  const sectionBtn = (id, label) => (
    <button key={id} onClick={() => setSection(id)} style={{
      padding: "8px 16px", borderRadius: 8, border: section === id ? `2px solid ${C.amber}` : `1px solid ${C.warmBorder}`,
      background: section === id ? C.amberLight : C.white, color: section === id ? C.brown : C.lightText,
      fontSize: 13, fontWeight: 600, cursor: "pointer",
    }}>{label}</button>
  );

  const cardStyle = { background: C.white, borderRadius: 14, padding: 20, marginBottom: 16, border: `1.5px solid ${C.amberBorder}` };
  const sectionLabel = { fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.amber, marginBottom: 10 };

  return (
    <div style={{ padding: 24, maxWidth: 700 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: C.brown, marginBottom: 16, fontFamily: "inherit" }}>Admin</h2>

      {/* Vault stats bar */}
      <div style={{ ...cardStyle, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.brown }}>{manifests.length}</div>
          <div style={{ fontSize: 12, color: C.muted }}>total items</div>
        </div>
        <div style={{ height: 36, width: 1, background: C.warmBorder }} />
        {Object.entries(catCounts).sort((a,b) => b[1]-a[1]).map(([cat, count]) => (
          <div key={cat} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.brown }}>{count}</div>
            <div style={{ fontSize: 11, color: C.muted, textTransform: "capitalize" }}>{cat}</div>
          </div>
        ))}
      </div>

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {sectionBtn("manage", `Manage Items (${manifests.length})`)}
        {sectionBtn("family", "Family")}
        {sectionBtn("faces", "Face Library")}
        {sectionBtn("knowledge", "Knowledge Base")}
        {sectionBtn("sync", "Drive Sync")}
      </div>

      {/* ── Manage Items ─────────────────────────────────────────── */}
      {section === "manage" && (
        <div>
          {/* Search + bulk actions */}
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items..."
              style={{ flex: 1, minWidth: 180, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
            {selected.size > 0 && (
              <button onClick={() => setConfirmDelete({ ids: [...selected] })}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: C.red, color: C.white, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Delete {selected.size} selected
              </button>
            )}
          </div>

          {/* Select all */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: C.muted, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0}
                onChange={() => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(m => m.id)))} />
              Select all ({filtered.length})
            </label>
          </div>

          {/* Item list */}
          {filtered.map(m => {
            const c = m.classification || {};
            const hasCor = !!m.corrections;
            return (
              <div key={m.id} style={{
                background: C.white, borderRadius: 10, padding: 12, marginBottom: 6,
                border: `1px solid ${selected.has(m.id) ? C.amber : C.warmBorder}`,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <input type="checkbox" checked={selected.has(m.id)}
                  onChange={() => setSelected(prev => {
                    const next = new Set(prev);
                    next.has(m.id) ? next.delete(m.id) : next.add(m.id);
                    return next;
                  })} />
                <div style={{
                  width: 44, height: 44, borderRadius: 6, overflow: "hidden", flexShrink: 0,
                  background: C.warm, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {(m.mimeType || "").startsWith("image/") ? (
                    <img src={thumbUrl(m)} alt="" style={{ width: 44, height: 44, objectFit: "cover" }}
                      onError={e => { e.target.style.display = "none"; }} />
                  ) : (
                    <span style={{ fontSize: 18 }}>{c.category === "document" ? "\u{1F4C4}" : "\u{1F4CE}"}</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.brown, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.title || m.fileName}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                    <span style={{ textTransform: "capitalize" }}>{c.category}</span>
                    {(m.corrections?.people || c.people || []).length > 0 && (
                      <span>{(m.corrections?.people || c.people).join(", ")}</span>
                    )}
                    {hasCor && <Badge color={C.green} bg={C.greenBg}>corrected</Badge>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {hasCor && (
                    <button onClick={() => setPropagateItem(m)} title="Propagate labels to similar items"
                      style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.amberBorder}`, background: C.amberLight, color: C.amber, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      Propagate
                    </button>
                  )}
                  <button onClick={() => setConfirmDelete({ ids: [m.id] })} title="Delete"
                    style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.red, fontSize: 12, cursor: "pointer" }}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Family Profiles ─────────────────────────────────────── */}
      {section === "family" && (
        <div>
          {/* Add / Edit form */}
          <div style={cardStyle}>
            <div style={sectionLabel}>{editingProfile?.id ? `Edit ${editingProfile.name}` : "Add Family Member"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={profileForm.name} onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))} placeholder="Name *"
                  style={{ flex: 2, minWidth: 140, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
                <input value={profileForm.birthday} onChange={e => setProfileForm(f => ({ ...f, birthday: e.target.value }))} type="date"
                  style={{ flex: 1, minWidth: 140, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
                {profileForm.birthday && calcAge(profileForm.birthday) !== null && (
                  <span style={{ fontSize: 13, color: C.lightText, whiteSpace: "nowrap", alignSelf: "center" }}>Age: {calcAge(profileForm.birthday)}</span>
                )}
              </div>
              <input value={profileForm.school} onChange={e => setProfileForm(f => ({ ...f, school: e.target.value }))} placeholder="School"
                style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
              <div style={{ display: "flex", gap: 8 }}>
                <input value={profileForm.city} onChange={e => setProfileForm(f => ({ ...f, city: e.target.value }))} placeholder="City"
                  style={{ flex: 2, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
                <input value={profileForm.state} onChange={e => setProfileForm(f => ({ ...f, state: e.target.value }))} placeholder="State"
                  style={{ width: 80, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
              </div>
              <input value={profileForm.activities} onChange={e => setProfileForm(f => ({ ...f, activities: e.target.value }))} placeholder="Activities (comma separated, e.g. soccer, piano, swimming)"
                style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
              <input value={profileForm.notes} onChange={e => setProfileForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes (anything else to remember)"
                style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
              {/* Links */}
              <div style={{ fontSize: 12, color: C.lightText, marginTop: 4 }}>Links</div>
              {profileForm.links.map((link, li) => (
                <div key={li} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input value={link.label} onChange={e => { const links = [...profileForm.links]; links[li] = { ...links[li], label: e.target.value }; setProfileForm(f => ({ ...f, links })); }}
                    placeholder="Label (e.g. School Website)" style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, fontSize: 12, background: C.white }} />
                  <input value={link.url} onChange={e => { const links = [...profileForm.links]; links[li] = { ...links[li], url: e.target.value }; setProfileForm(f => ({ ...f, links })); }}
                    placeholder="https://..." style={{ flex: 2, padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, fontSize: 12, background: C.white }} />
                  <button onClick={() => { const links = profileForm.links.filter((_, j) => j !== li); setProfileForm(f => ({ ...f, links })); }}
                    style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.red, fontSize: 12, cursor: "pointer" }}>{"\u00D7"}</button>
                </div>
              ))}
              <button onClick={() => setProfileForm(f => ({ ...f, links: [...f.links, { label: "", url: "" }] }))}
                style={{ alignSelf: "flex-start", padding: "4px 12px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.amber, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                + Add Link
              </button>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button onClick={saveProfile} disabled={!profileForm.name.trim()}
                  style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: profileForm.name.trim() ? C.amber : C.warmBorder, color: C.white, fontSize: 13, fontWeight: 600, cursor: profileForm.name.trim() ? "pointer" : "not-allowed" }}>
                  {editingProfile?.id ? "Save Changes" : "Add"}
                </button>
                {editingProfile?.id && (
                  <button onClick={() => { setEditingProfile(null); setProfileForm({ name: "", birthday: "", school: "", city: "", state: "", activities: "", notes: "", links: [] }); }}
                    style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.lightText, fontSize: 13, cursor: "pointer" }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Profile cards */}
          {loadingProfiles ? (
            <div style={{ padding: 20, textAlign: "center", color: C.muted }}>Loading profiles...</div>
          ) : profiles.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 14 }}>
              No family profiles yet. Add a family member above so the chat knows about your family.
            </div>
          ) : (
            profiles.map(p => {
              const w = profileWeather[p.id];
              return (
                <div key={p.id} style={{ ...cardStyle }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: C.brown }}>{p.name}</div>
                      <div style={{ fontSize: 13, color: C.lightText, marginTop: 2 }}>
                        {[
                          p.birthday && calcAge(p.birthday) !== null && `Age ${calcAge(p.birthday)}`,
                          p.birthday && `Birthday: ${new Date(p.birthday + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}`,
                        ].filter(Boolean).join(" \u2022 ")}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => startEditProfile(p)}
                        style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.amberBorder}`, background: C.amberLight, color: C.amber, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        Edit
                      </button>
                      <button onClick={() => deleteProfile(p.id)}
                        style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.red, fontSize: 12, cursor: "pointer" }}>
                        Delete
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: C.lightText }}>
                    {p.school && <div>School: <strong style={{ color: C.brown }}>{p.school}</strong></div>}
                    {p.location?.city && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span>Location: <strong style={{ color: C.brown }}>{p.location.city}{p.location.state ? `, ${p.location.state}` : ""}</strong></span>
                        {w && (
                          <span style={{ padding: "2px 10px", borderRadius: 6, background: C.warm, fontSize: 12 }}>
                            {Math.round(w.temperature)}{"\u00B0"}F {"\u00A0\u2022\u00A0"} {w.description}
                          </span>
                        )}
                      </div>
                    )}
                    {p.activities?.length > 0 && <div>Activities: <strong style={{ color: C.brown }}>{p.activities.join(", ")}</strong></div>}
                    {p.links?.length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                        {p.links.map((l, li) => (
                          <a key={li} href={l.url} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 12, color: C.amber, textDecoration: "none", padding: "2px 8px", borderRadius: 6, background: C.amberLight, border: `1px solid ${C.amberBorder}` }}>
                            {l.label || l.url}
                          </a>
                        ))}
                      </div>
                    )}
                    {p.notes && <div style={{ fontStyle: "italic", color: C.muted, marginTop: 2 }}>{p.notes}</div>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Face Library ─────────────────────────────────────────── */}
      {section === "faces" && (
        <div>
          <div style={cardStyle}>
            <div style={sectionLabel}>How It Works</div>
            <div style={{ fontSize: 13, color: C.lightText, lineHeight: 1.6 }}>
              1. Go to <strong>Vault</strong> and click <strong>"Tag Face"</strong> on any photo<br/>
              2. Click on a person in the photo to crop their face<br/>
              3. Type their name and save<br/>
              4. Come back here and click <strong>"Find in Vault"</strong> — Gemini will scan all your photos to find that person
            </div>
          </div>

          {loadingFaces ? (
            <div style={{ padding: 20, textAlign: "center", color: C.muted }}>Loading face library...</div>
          ) : Object.keys(faces.byPerson || {}).length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 14 }}>
              No face references yet. Go to the Vault tab and click "Tag Face" on a photo to get started.
            </div>
          ) : (
            Object.entries(faces.byPerson || {}).map(([name, refs]) => (
              <div key={name} style={{ ...cardStyle }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.brown }}>{name}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setScanPerson(name)}
                      style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: C.green, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      Find in Vault
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {refs.map(ref => (
                    <div key={ref.id} style={{ position: "relative" }}>
                      <img
                        src={`${BACKEND_URL}/api/faces/${ref.id}/image?key=${BACKEND_KEY}`}
                        alt={name}
                        style={{ width: 80, height: 80, borderRadius: 8, objectFit: "cover", border: `2px solid ${C.amberBorder}` }}
                      />
                      <button onClick={() => deleteFace(ref.id)}
                        style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", border: "none", background: C.red, color: "#fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        x
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{refs.length} reference{refs.length !== 1 ? "s" : ""}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Knowledge Base ────────────────────────────────────────── */}
      {section === "knowledge" && (
        <div>
          <div style={cardStyle}>
            <div style={sectionLabel}>Add Family Fact</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={newFact} onChange={e => setNewFact(e.target.value)} placeholder='e.g. "Mia is 9 and loves ballet"'
                onKeyDown={e => e.key === "Enter" && addFact()}
                style={{ flex: 1, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
              <button onClick={addFact} disabled={!newFact.trim()}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: newFact.trim() ? C.amber : C.warmBorder, color: C.white, fontSize: 13, fontWeight: 600, cursor: newFact.trim() ? "pointer" : "not-allowed" }}>
                Add
              </button>
            </div>
          </div>

          {loadingKnowledge ? (
            <div style={{ padding: 20, textAlign: "center", color: C.muted }}>Loading...</div>
          ) : knowledge.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 14 }}>
              No facts yet. Add facts manually or correct photos — the system auto-learns from corrections.
            </div>
          ) : (
            knowledge.map(k => (
              <div key={k.id} style={{
                background: C.white, borderRadius: 10, padding: 12, marginBottom: 6,
                border: `1px solid ${C.warmBorder}`, display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: C.brown }}>{k.fact}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    Source: {k.source || "unknown"} {k.createdAt && `\u2022 ${new Date(k.createdAt).toLocaleDateString()}`}
                  </div>
                </div>
                <button onClick={() => deleteFact(k.id)}
                  style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.red, fontSize: 12, cursor: "pointer" }}>
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Drive Sync ───────────────────────────────────────────── */}
      {section === "sync" && (
        <div>
          {syncStatus && (
            <div style={cardStyle}>
              <div style={sectionLabel}>Last Sync</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 14, color: C.lightText }}>
                  Time: <strong style={{ color: C.brown }}>{syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString() : "Never"}</strong>
                </div>
                {syncStatus.lastSyncResult && (
                  <>
                    <div style={{ fontSize: 14, color: C.lightText }}>Processed: <strong style={{ color: C.green }}>{syncStatus.lastSyncResult.processed}</strong></div>
                    <div style={{ fontSize: 14, color: C.lightText }}>Skipped: <strong>{syncStatus.lastSyncResult.skipped}</strong></div>
                    {syncStatus.lastSyncResult.errors?.length > 0 && (
                      <div style={{ fontSize: 14, color: C.red }}>Errors: <strong>{syncStatus.lastSyncResult.errors.length}</strong></div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {!online && (
            <div style={{ ...cardStyle, background: C.warm }}>
              <div style={sectionLabel}>Troubleshooting</div>
              <div style={{ fontSize: 14, color: C.lightText, lineHeight: 1.7 }}>
                Backend not reachable. Check Cloud Run deployment, CORS, or start local backend with <strong>npm run dev</strong>.
              </div>
            </div>
          )}

          <button onClick={onSync} disabled={syncing || !online}
            style={{ padding: "12px 28px", borderRadius: 12, border: "none", fontSize: 15, fontWeight: 600,
              cursor: syncing || !online ? "not-allowed" : "pointer",
              background: syncing || !online ? C.warmBorder : C.amber, color: C.white }}>
            {syncing ? "Syncing..." : online ? "Sync Now" : "Sync (Backend Offline)"}
          </button>

          {syncResult && (
            <div style={{ ...cardStyle, marginTop: 16, borderColor: syncResult.error ? C.red : C.green }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: syncResult.error ? C.red : C.green, marginBottom: 8 }}>
                {syncResult.error ? "Sync Failed" : "Sync Complete"}
              </div>
              {syncResult.error ? (
                <div style={{ fontSize: 13, color: C.red }}>{syncResult.error}</div>
              ) : (
                <div style={{ display: "flex", gap: 20, fontSize: 13, color: C.lightText }}>
                  <div>Processed: <strong style={{ color: C.green }}>{syncResult.processed}</strong></div>
                  <div>Skipped: <strong>{syncResult.skipped}</strong></div>
                  {syncResult.errors?.length > 0 && <div>Errors: <strong style={{ color: C.red }}>{syncResult.errors.length}</strong></div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <ConfirmDialog
          message={`Delete ${confirmDelete.ids.length} item${confirmDelete.ids.length !== 1 ? "s" : ""}? This cannot be undone.`}
          onConfirm={() => handleDelete(confirmDelete.ids)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Propagation panel */}
      {propagateItem && (
        <PropagatePanel item={propagateItem} onClose={() => setPropagateItem(null)} onRefresh={onRefresh} />
      )}

      {/* Face scan panel */}
      {scanPerson && (
        <FaceScanPanel personName={scanPerson} onClose={() => setScanPerson(null)} onRefresh={onRefresh} />
      )}
    </div>
  );
};

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
          <ChatView onPhotoClick={openPhoto} />
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
