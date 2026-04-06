export const Lightbox = ({ src, alt, onClose }) => {
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
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 20, right: 20,
          width: 48, height: 48, borderRadius: "50%", border: "none",
          background: "rgba(255,255,255,0.2)", color: "#fff",
          fontSize: 28, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
        }}
      >
        \u2715
      </button>
      {alt && (
        <div style={{
          position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)",
          color: "rgba(255,255,255,0.85)", fontSize: 16, fontWeight: 500,
          textAlign: "center", maxWidth: "80%", textShadow: "0 1px 4px rgba(0,0,0,0.5)",
        }}>
          {alt}
        </div>
      )}
      <img
        src={src}
        alt={alt || "Photo"}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain",
          borderRadius: 8, boxShadow: "0 4px 30px rgba(0,0,0,0.4)", cursor: "default",
        }}
      />
    </div>
  );
};
