import { C } from "../../constants/palette";

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

export default ConfirmDialog;
