import { useState, useEffect, useCallback, useRef } from "react";
import { C } from "../lib/palette";
import { apiFetch, agenticChat, thumbUrl } from "../lib/api";
import { SUGGESTION_CHIPS, weatherIcon } from "../lib/constants";
import { Badge } from "./Badge";

const SourcePill = ({ item }) => {
  const c = item.classification || {};
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 10px", borderRadius: 16, fontSize: 11, fontWeight: 500,
      background: C.amberLight, color: C.soft, border: `1px solid ${C.amberBorder}`,
    }}>
      {c.category === "photo" ? "\u{1F5BC}" : "\u{1F4C4}"} {c.title}
    </span>
  );
};

const ChatMessage = ({ msg, onPhotoClick }) => {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", marginBottom: 20 }}>
      <div style={{
        maxWidth: "85%", padding: "14px 20px",
        borderRadius: isUser ? "20px 20px 4px 20px" : "20px 20px 20px 4px",
        background: isUser ? C.brown : C.white, color: isUser ? C.cream : C.text,
        fontSize: 17, lineHeight: 1.6, boxShadow: "0 1px 4px rgba(74,46,14,0.08)",
        border: isUser ? "none" : `1px solid ${C.warmBorder}`, whiteSpace: "pre-wrap",
      }}>
        {msg.content}
      </div>
      {msg.sources?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, maxWidth: "85%" }}>
          {msg.sources.map((s) => <SourcePill key={s.id} item={s} />)}
        </div>
      )}
      {msg.sources?.filter((s) => (s.driveFileId || s.source === "upload") && (s.classification?.category === "photo" || s.mimeType?.startsWith("image/"))).length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", maxWidth: "85%" }}>
          {msg.sources
            .filter((s) => (s.driveFileId || s.source === "upload") && (s.classification?.category === "photo" || s.mimeType?.startsWith("image/")))
            .map((s) => (
              <div key={s.id} onClick={() => onPhotoClick && onPhotoClick(thumbUrl(s), s.classification?.title || "Photo")} style={{ cursor: "pointer" }}>
                <img src={thumbUrl(s)} alt={s.classification?.title || "Photo"}
                  style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 10, border: `2px solid ${C.amberBorder}`, background: C.warm }}
                  onError={(e) => (e.target.style.display = "none")} />
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export const ChatView = ({ onPhotoClick }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState(null);
  const [weatherBar, setWeatherBar] = useState([]);
  const [weatherExpanded, setWeatherExpanded] = useState(null);
  const [familyNames, setFamilyNames] = useState([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, thinking]);

  useEffect(() => {
    (async () => {
      try {
        const [pRes, wRes] = await Promise.all([apiFetch("/api/profiles"), apiFetch("/api/profiles/weather")]);
        const profiles = pRes.ok ? (await pRes.json()).profiles || [] : [];
        const weatherList = wRes.ok ? (await wRes.json()).weather || [] : [];
        const wMap = {};
        for (const w of weatherList) wMap[w.profileId] = w.weather;
        const items = profiles.filter(p => p.location?.city && wMap[p.id]).map(p => ({
          id: p.id, name: p.name, city: p.location.city, state: p.location.state,
          temp: Math.round(wMap[p.id].temperature), desc: wMap[p.id].description,
          forecast: wMap[p.id].forecast || [], code: wMap[p.id].weatherCode,
        }));
        setWeatherBar(items);
        setFamilyNames(profiles.map(p => p.name));
      } catch {}
    })();
  }, []);

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
      setMessages((prev) => [...prev, { role: "assistant", content: "I'm having a little trouble right now. Please try again in a moment.", sources: [] }]);
    } finally {
      setThinking(false);
    }
  }, [thinking, messages]);

  const send = () => sendMessage(input);

  const allChips = [
    ...SUGGESTION_CHIPS,
    ...familyNames.map(name => ({ label: `What's new with ${name}?`, icon: "\uD83D\uDC64", message: `What's new with ${name}? How are they doing lately?` })),
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
                <span style={{ padding: "1px 8px", borderRadius: 10, background: C.white, fontSize: 12, color: C.amber, fontWeight: 600 }}>{w.temp}{"\u00B0"}F</span>
                <span style={{ fontSize: 12, color: C.muted }}>{w.desc}</span>
                <span style={{ fontSize: 10, color: C.amberBorder, marginLeft: 2 }}>{weatherExpanded === w.id ? "\u25B2" : "\u25BC"}</span>
              </div>
            ))}
          </div>
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
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "24px 20px", display: "flex", flexDirection: "column" }}>
        {messages.length === 0 && !thinking && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, color: C.muted, textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 48 }}>{"\u{1F46A}"}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: C.brown }}>Your Family Storyteller</div>
            <div style={{ fontSize: 17, maxWidth: 440, lineHeight: 1.6 }}>
              I can catch you up on the family, find photos, check on the kids, and share memories. What would you like to know?
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 12, maxWidth: 500 }}>
              {allChips.map((chip, i) => (
                <button key={i} onClick={() => sendMessage(chip.message)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "10px 16px",
                    borderRadius: 20, border: `1.5px solid ${C.amberBorder}`, background: C.white,
                    color: C.brown, fontSize: 14, fontWeight: 500, cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.warm; e.currentTarget.style.borderColor = C.amber; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = C.white; e.currentTarget.style.borderColor = C.amberBorder; }}>
                  <span>{chip.icon}</span><span>{chip.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => <ChatMessage key={i} msg={m} onPhotoClick={onPhotoClick} />)}
        {thinking && (
          <div style={{ alignSelf: "flex-start", padding: "12px 20px", borderRadius: 20, background: C.white, color: C.muted, fontSize: 16, border: `1px solid ${C.warmBorder}` }}>
            Thinking...
          </div>
        )}
        {error && (
          <div style={{ fontSize: 13, color: C.red, padding: "8px 16px", background: C.redBg, borderRadius: 8, alignSelf: "center", marginTop: 8 }}>
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ borderTop: `1px solid ${C.warmBorder}`, padding: "16px 20px", background: C.white, display: "flex", gap: 10, alignItems: "flex-end" }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask about the family..." rows={1}
          style={{
            flex: 1, padding: "14px 18px", borderRadius: 16, border: `1.5px solid ${C.amberBorder}`,
            background: C.cream, color: C.text, fontSize: 17, fontFamily: "inherit", resize: "none", outline: "none", lineHeight: 1.5,
          }} />
        <button onClick={send} disabled={thinking || !input.trim()}
          style={{
            padding: "14px 24px", borderRadius: 16, border: "none",
            background: thinking || !input.trim() ? C.warmBorder : C.amber, color: C.white,
            fontSize: 16, fontWeight: 600, cursor: thinking || !input.trim() ? "default" : "pointer", whiteSpace: "nowrap",
          }}>
          Send
        </button>
      </div>
    </div>
  );
};
