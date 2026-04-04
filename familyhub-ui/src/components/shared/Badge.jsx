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

export default Badge;
