import { useState, useRef } from "react";
import { C } from "../lib/palette";
import { apiFetch } from "../lib/api";

export const FaceLabelModal = ({ item, imgSrc, onClose, onRefresh }) => {
  const [step, setStep] = useState("click");
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
        body: JSON.stringify({ manifestId: item.id, clickX: clickPos.x, clickY: clickPos.y, personName: personName.trim() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStatus({ ok: true, msg: `Saved face reference for "${personName.trim()}"` });
      setStep("done");
      if (onRefresh) onRefresh();
    } catch (err) {
      setStatus({ ok: false, msg: err.message });
      setStep("name");
    }
  };

  const cropPreview = clickPos ? (() => {
    const size = Math.min(clickPos.rectW, clickPos.rectH) * 0.15;
    const half = size / 2;
    return {
      left: Math.max(0, clickPos.screenX - half), top: Math.max(0, clickPos.screenY - half),
      width: Math.min(size, clickPos.rectW - Math.max(0, clickPos.screenX - half)),
      height: Math.min(size, clickPos.rectH - Math.max(0, clickPos.screenY - half)),
    };
  })() : null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.8)" }}>
      <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh", display: "flex", flexDirection: "column", gap: 12 }}>
        <button onClick={onClose} style={{ position: "absolute", top: -40, right: 0, background: "none", border: "none", color: "#fff", fontSize: 28, cursor: "pointer", zIndex: 2 }}>x</button>
        <div style={{ color: "#fff", fontSize: 14, textAlign: "center", padding: "0 20px" }}>
          {step === "click" && "Click on a person in the photo to tag them"}
          {step === "name" && "Great! Now name this person:"}
          {step === "saving" && "Saving face reference..."}
          {step === "done" && status?.msg}
        </div>
        <div style={{ position: "relative", display: "inline-block" }}>
          <img ref={imgRef} src={imgSrc} alt="" onClick={step === "click" ? handleImageClick : undefined}
            style={{ maxWidth: "85vw", maxHeight: "70vh", borderRadius: 8, cursor: step === "click" ? "crosshair" : "default" }} />
          {cropPreview && (
            <div style={{ position: "absolute", left: cropPreview.left, top: cropPreview.top, width: cropPreview.width, height: cropPreview.height,
              border: "3px solid #4ade80", borderRadius: 8, boxShadow: "0 0 20px rgba(74,222,128,0.4)", pointerEvents: "none" }} />
          )}
        </div>
        {step === "name" && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <input autoFocus value={personName} onChange={e => setPersonName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder="Person's name..." style={{ padding: "10px 16px", borderRadius: 10, border: "none", fontSize: 15, width: 220 }} />
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
        {step === "done" && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button onClick={() => { setStep("click"); setClickPos(null); setPersonName(""); setStatus(null); }}
              style={{ padding: "10px 20px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.3)", background: "transparent", color: "#fff", fontSize: 14, cursor: "pointer" }}>
              Tag Another
            </button>
            <button onClick={onClose}
              style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: C.amber, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Done
            </button>
          </div>
        )}
        {status && !status.ok && <div style={{ color: "#f87171", fontSize: 13, textAlign: "center" }}>{status.msg}</div>}
      </div>
    </div>
  );
};
