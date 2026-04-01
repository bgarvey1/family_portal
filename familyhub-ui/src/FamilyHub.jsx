import { useState, useEffect, useCallback, useRef } from "react";

// ── Configuration ────────────────────────────────────────────────────────────
// Backend (Cloud Run) — handles vault storage, Drive sync, classification
// In local dev (Vite proxy), leave BACKEND_URL empty so requests go to /api/*
// In production (Cloud Run), set the full URL.
const CLOUD_BACKEND_URL = "https://familyhub-backend-761807984124.us-east1.run.app";
const BACKEND_KEY = "82499e764781230d465dc768064fb155b821f510ee1fad6db71938f7ea59182f";

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

// Build a proxied thumbnail URL for a Drive file (goes through our backend)
const thumbUrl = (driveFileId) =>
  driveFileId
    ? `${BACKEND_URL}/api/files/${driveFileId}/thumbnail?key=${BACKEND_KEY}`
    : null;

const claudeChat = async (messages, system) => {
  const r = await apiFetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, system }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Chat API ${r.status}: ${err}`);
  }
  const data = await r.json();
  return data.text || "";
};

// ── Two-pass RAG ─────────────────────────────────────────────────────────────
const buildIndex = (manifests) =>
  manifests
    .map((m) => {
      const c = m.classification || {};
      return [
        `ID:${m.id}`,
        c.category,
        `"${c.title}"`,
        `People:${(c.people || []).join(",")}`,
        `Tags:${(c.tags || []).join(",")}`,
        c.description,
      ].join(" | ");
    })
    .join("\n");

async function ragChat(question, manifests, history) {
  // Pass 1 — relevance selection
  const index = buildIndex(manifests);
  const selectionResult = await claudeChat(
    [
      {
        role: "user",
        content: `Question from a grandparent: "${question}"\n\nFamily Vault Index (${manifests.length} items):\n${index}\n\nReturn a JSON array of the IDs (max 5) most relevant to answering this question. Return ONLY the JSON array.`,
      },
    ],
    "You select relevant items from a family vault. Return only a valid JSON array of ID strings."
  );

  let selectedIds = [];
  try {
    const match = selectionResult.match(/\[[\s\S]*?\]/);
    selectedIds = match ? JSON.parse(match[0]) : [];
  } catch {
    selectedIds = [];
  }

  const selected = manifests.filter((m) => selectedIds.includes(m.id));

  // Pass 2 — grounded response (use friendly labels, never expose IDs)
  const itemContext = selected
    .map((m, idx) => {
      const c = m.classification || {};
      const label = c.title || m.fileName || `Item ${idx + 1}`;
      const people = (c.people || []).join(", ");
      const tags = (c.tags || []).join(", ");
      const lines = [`"${label}"`];
      if (c.description) lines.push(c.description);
      if (c.category) lines.push(`Type: ${c.category}`);
      if (people) lines.push(`People: ${people}`);
      if (c.date_estimate && c.date_estimate !== "unknown") lines.push(`Date: ${c.date_estimate}`);
      if (c.sentiment && c.sentiment !== "unknown") lines.push(`Mood: ${c.sentiment}`);
      if (tags) lines.push(`Tags: ${tags}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");

  const systemPrompt = `You are a warm, loving family assistant helping grandparents explore their family's photos and documents. Talk like a kind family member sitting next to them — personal, gentle, and natural.

STRICT RULES:
- Use ONLY the information from the items below. Never make up details.
- NEVER show IDs, reference numbers, UUIDs, file names, or any technical identifiers.
- NEVER say you "can't display" or "can't show" photos. The photos will appear automatically below your message. Instead, describe what's in them warmly and naturally, as if you're looking at them together.
- If photos are relevant, say things like "Here are some lovely photos..." or "Take a look at these..." — the app handles showing them.
- When describing photos, paint a picture with words: who's there, what they're doing, the feeling of the moment.
- Keep it short and warm — 2-3 paragraphs at most. No bullet points or lists.
- If nothing matches the question, gently say so and suggest things they could ask about.
- Never mention "vault," "manifests," "items," "database," or any system terminology.

FAMILY MEMORIES:
${itemContext || "(No matching memories found for this question.)"}`;

  const msgs = [
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];

  const response = await claudeChat(msgs, systemPrompt);
  return { text: response, sources: selected };
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
      {msg.sources && msg.sources.filter((s) => s.driveFileId && (s.classification?.category === "photo" || s.mimeType?.startsWith("image/"))).length > 0 && (
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
            .filter((s) => s.driveFileId && (s.classification?.category === "photo" || s.mimeType?.startsWith("image/")))
            .map((s) => (
              <div
                key={s.id}
                onClick={() => onPhotoClick && onPhotoClick(thumbUrl(s.driveFileId), s.classification?.title || "Photo")}
                style={{ cursor: "pointer" }}
              >
                <img
                  src={thumbUrl(s.driveFileId)}
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
const VaultCard = ({ item, onPhotoClick, onEdit }) => {
  const cl = item.classification || {};
  const sentimentColors = {
    joyful: C.green,
    neutral: C.muted,
    formal: C.blue,
    somber: "#5B3FA6",
  };
  const isPhoto = item.driveFileId && cl.category === "photo";
  const imgSrc = isPhoto ? thumbUrl(item.driveFileId) : null;
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
        {/* Edit button */}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit && onEdit(item); }}
          style={{
            marginTop: 8,
            padding: "6px 14px",
            borderRadius: 8,
            border: `1.5px solid ${C.amberBorder}`,
            background: C.cream,
            color: C.soft,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            alignSelf: "flex-start",
          }}
        >
          Edit Details
        </button>
      </div>
    </div>
  );
};

// ── Chat View ────────────────────────────────────────────────────────────────
const ChatView = ({ manifests, onPhotoClick }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, thinking]);

  const send = async () => {
    const q = input.trim();
    if (!q || thinking) return;
    setInput("");
    setError(null);

    const userMsg = { role: "user", content: q };
    setMessages((prev) => [...prev, userMsg]);
    setThinking(true);

    try {
      const { text, sources } = await ragChat(q, manifests, messages);
      setMessages((prev) => [...prev, { role: "assistant", content: text, sources }]);
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
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
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
        {messages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: C.muted,
              textAlign: "center",
              padding: 40,
            }}
          >
            <div style={{ fontSize: 48 }}>{"\u{1F46A}"}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: C.brown }}>
              Hi there!
            </div>
            <div style={{ fontSize: 17, maxWidth: 400, lineHeight: 1.6 }}>
              Ask me anything about the family. I can show you photos, tell you
              what everyone's been up to, and more.
            </div>
            <div style={{ fontSize: 14, color: C.amberBorder, marginTop: 8 }}>
              Try: "Show me recent photos" or "What's new with the family?"
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, alignItems: "center" }}>
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
          }}
        />
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
          <VaultCard key={m.id || m.driveFileId} item={m} onPhotoClick={onPhotoClick} onEdit={setEditing} />
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
    </div>
  );
};

// ── Admin View ───────────────────────────────────────────────────────────────
const AdminView = ({ syncStatus, onSync, syncing, syncResult, manifests, online }) => (
  <div style={{ padding: 24, maxWidth: 600 }}>
    <h2
      style={{
        fontSize: 20,
        fontWeight: 700,
        color: C.brown,
        marginBottom: 20,
        fontFamily: "inherit",
      }}
    >
      Admin
    </h2>

    {/* Vault stats */}
    <div
      style={{
        background: C.white,
        borderRadius: 14,
        padding: 20,
        marginBottom: 16,
        border: `1.5px solid ${C.amberBorder}`,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.amber, marginBottom: 10 }}>
        Vault
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: C.brown }}>{manifests.length}</div>
      <div style={{ fontSize: 13, color: C.muted }}>classified items</div>
    </div>

    {/* Sync status */}
    {syncStatus && (
      <div
        style={{
          background: C.white,
          borderRadius: 14,
          padding: 20,
          marginBottom: 16,
          border: `1.5px solid ${C.amberBorder}`,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.amber, marginBottom: 10 }}>
          Last Sync
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 14, color: C.lightText }}>
            Time:{" "}
            <strong style={{ color: C.brown }}>
              {syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString() : "Never"}
            </strong>
          </div>
          {syncStatus.lastSyncResult && (
            <>
              <div style={{ fontSize: 14, color: C.lightText }}>
                Processed: <strong style={{ color: C.green }}>{syncStatus.lastSyncResult.processed}</strong>
              </div>
              <div style={{ fontSize: 14, color: C.lightText }}>
                Skipped: <strong>{syncStatus.lastSyncResult.skipped}</strong>
              </div>
              {syncStatus.lastSyncResult.errors?.length > 0 && (
                <div style={{ fontSize: 14, color: C.red }}>
                  Errors: <strong>{syncStatus.lastSyncResult.errors.length}</strong>
                </div>
              )}
            </>
          )}
          {syncStatus.syncInProgress && <Badge color={C.amber}>Sync in progress...</Badge>}
        </div>
      </div>
    )}

    {/* Connection status */}
    {!online && (
      <div
        style={{
          background: C.warm,
          borderRadius: 14,
          padding: 20,
          marginBottom: 16,
          border: `1.5px solid ${C.amberBorder}`,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.amber, marginBottom: 10 }}>
          Troubleshooting
        </div>
        <div style={{ fontSize: 14, color: C.lightText, lineHeight: 1.7 }}>
          The backend is not reachable. Common causes:
          <br />
          {"\u2022"} Cloud Run deployed with <strong style={{ color: C.brown }}>--no-allow-unauthenticated</strong> — redeploy with <strong style={{ color: C.green }}>--allow-unauthenticated</strong>
          <br />
          {"\u2022"} Cloud Run service is stopped or scaled to zero (cold start can take ~10s)
          <br />
          {"\u2022"} CORS or network issue — check browser console for details
          <br />
          {"\u2022"} For local dev, start the backend with <strong style={{ color: C.brown }}>npm run dev</strong> in familyhub-backend/
        </div>
      </div>
    )}

    {/* Sync button */}
    <button
      onClick={onSync}
      disabled={syncing || !online}
      style={{
        padding: "12px 28px",
        borderRadius: 12,
        border: "none",
        fontSize: 15,
        fontWeight: 600,
        cursor: syncing || !online ? "not-allowed" : "pointer",
        background: syncing || !online ? C.warmBorder : C.amber,
        color: C.white,
      }}
    >
      {syncing ? "Syncing..." : online ? "Sync Now" : "Sync (Backend Offline)"}
    </button>

    {/* Sync result */}
    {syncResult && (
      <div
        style={{
          background: C.white,
          borderRadius: 14,
          padding: 20,
          marginTop: 16,
          border: `1.5px solid ${syncResult.error ? C.red : C.green}`,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: syncResult.error ? C.red : C.green, marginBottom: 8 }}>
          {syncResult.error ? "Sync Failed" : "Sync Complete"}
        </div>
        {syncResult.error ? (
          <div style={{ fontSize: 13, color: C.red }}>{syncResult.error}</div>
        ) : (
          <div style={{ display: "flex", gap: 20, fontSize: 13, color: C.lightText }}>
            <div>
              Processed: <strong style={{ color: C.green }}>{syncResult.processed}</strong>
            </div>
            <div>
              Skipped: <strong>{syncResult.skipped}</strong>
            </div>
            {syncResult.errors?.length > 0 && (
              <div>
                Errors: <strong style={{ color: C.red }}>{syncResult.errors.length}</strong>
              </div>
            )}
          </div>
        )}
      </div>
    )}
  </div>
);

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
              onClick={() => setTab(t.id)}
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
            />
          </div>
        )}
      </main>

      {/* Full-screen photo viewer */}
      <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={closePhoto} />
    </div>
  );
}
