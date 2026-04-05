import { C } from "../../constants/palette";

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

export default SourcePill;
