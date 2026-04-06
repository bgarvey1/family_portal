import { C } from "../lib/palette";
import { thumbUrl } from "../lib/api";
import { Badge } from "./Badge";

export const VaultCard = ({ item, onPhotoClick, onEdit, onTagFace, compact }) => {
  const cl = item.classification || {};
  const sentimentColors = { joyful: C.green, neutral: C.muted, formal: C.blue, somber: "#5B3FA6" };
  const isPhoto = (item.driveFileId || item.source === "upload") && cl.category === "photo";
  const imgSrc = isPhoto ? thumbUrl(item) : null;

  return (
    <div style={{
      background: C.white, borderRadius: 14, overflow: "hidden",
      border: `1.5px solid ${C.amberBorder}`, display: "flex", flexDirection: "column",
      boxShadow: "0 2px 8px rgba(74,46,14,0.06)",
    }}>
      {isPhoto ? (
        <div onClick={() => onPhotoClick && onPhotoClick(imgSrc, cl.title || item.fileName)} style={{ cursor: "pointer" }}>
          <img src={imgSrc} alt={cl.title || item.fileName}
            style={{ width: "100%", height: compact ? 140 : 170, objectFit: "cover", background: C.warm }}
            onError={(e) => {
              e.target.onerror = null;
              e.target.parentElement.innerHTML = `<div style="width:100%;height:${compact ? 140 : 170}px;background:${C.warm};display:flex;align-items:center;justify-content:center;font-size:40px">\u{1F5BC}</div>`;
            }}
          />
        </div>
      ) : (
        <div style={{
          width: "100%", height: compact ? 140 : 170, background: C.warm,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40,
        }}>
          {cl.category === "photo" ? "\u{1F5BC}" : cl.category === "receipt" ? "\u{1F9FE}" : "\u{1F4C4}"}
        </div>
      )}
      <div style={{ padding: compact ? 12 : 16, flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontWeight: 600, fontSize: compact ? 13 : 15, color: C.brown }}>{cl.title || item.fileName}</div>
        {!compact && cl.description && (
          <div style={{ fontSize: 13, color: C.lightText, lineHeight: 1.5 }}>{cl.description}</div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {cl.category && <Badge color={C.amber}>{cl.category}</Badge>}
          {!compact && cl.sentiment && <Badge color={sentimentColors[cl.sentiment] || C.muted}>{cl.sentiment}</Badge>}
          {cl.date_estimate && cl.date_estimate !== "unknown" && <Badge color={C.blue}>{cl.date_estimate}</Badge>}
        </div>
        {(cl.people?.length > 0 || item.corrections?.people?.length > 0) && (
          <div style={{ fontSize: 12, color: C.muted }}>
            {(item.corrections?.people || cl.people || []).join(", ")}
          </div>
        )}
        {!compact && cl.tags?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: "auto" }}>
            {cl.tags.map((t) => (
              <span key={t} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: C.warm, color: C.soft }}>
                #{t}
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button onClick={(e) => { e.stopPropagation(); onEdit && onEdit(item); }}
            style={{
              padding: "6px 14px", borderRadius: 8, border: `1.5px solid ${C.amberBorder}`,
              background: C.cream, color: C.soft, fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>
            Edit
          </button>
          {isPhoto && onTagFace && (
            <button onClick={(e) => { e.stopPropagation(); onTagFace(item); }}
              style={{
                padding: "6px 14px", borderRadius: 8, border: `1.5px solid ${C.green}40`,
                background: C.greenBg, color: C.green, fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}>
              Tag Face
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
