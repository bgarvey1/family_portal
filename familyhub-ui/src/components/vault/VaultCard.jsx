import { C } from "../../constants/palette";
import { thumbUrl } from "../../api/helpers";
import Badge from "../shared/Badge";

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
            Corrected{item.corrections.people ? ` \u2014 ${item.corrections.people.join(", ")}` : ""}
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

export default VaultCard;
