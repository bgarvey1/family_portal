import { C } from "../../constants/palette";
import { thumbUrl } from "../../api/helpers";
import SourcePill from "../shared/SourcePill";

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

export default ChatMessage;
