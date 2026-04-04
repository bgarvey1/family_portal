import { useState, useEffect, useRef } from "react";
import { C } from "../../constants/palette";
import { apiFetch } from "../../api/fetch";
import { ragChat } from "../../api/chat";
import { weatherIcon } from "../../utils/helpers";
import ChatMessage from "./ChatMessage";

// ── Chat View ────────────────────────────────────────────────────────────────
const ChatView = ({ manifests, onPhotoClick }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState(null);
  const [weatherBar, setWeatherBar] = useState([]);
  const [weatherExpanded, setWeatherExpanded] = useState(null); // profileId or null
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, thinking]);

  // Load weather for family members
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
      } catch {}
    })();
  }, []);

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

export default ChatView;
