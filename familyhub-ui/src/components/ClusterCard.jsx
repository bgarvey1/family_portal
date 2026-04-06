import { C } from "../lib/palette";
import { thumbUrl } from "../lib/api";
import { Badge } from "./Badge";

export const ClusterCard = ({ cluster, manifests, onSelect }) => {
  // Find cover manifest
  const cover = manifests?.find((m) => m.id === cluster.coverManifestId);
  const imgSrc = cover ? thumbUrl(cover) : null;
  const meta = cluster.metadata || {};
  const photoCount = cluster.manifestIds?.length || 0;

  return (
    <div
      onClick={() => onSelect && onSelect(cluster)}
      style={{
        background: C.white,
        borderRadius: 16,
        overflow: "hidden",
        border: `1.5px solid ${C.amberBorder}`,
        cursor: "pointer",
        transition: "transform 0.15s, box-shadow 0.15s",
        boxShadow: "0 2px 12px rgba(74,46,14,0.08)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 6px 20px rgba(74,46,14,0.14)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 2px 12px rgba(74,46,14,0.08)";
      }}
    >
      {/* Cover image */}
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={cluster.title}
          style={{ width: "100%", height: 200, objectFit: "cover", background: C.warm }}
          onError={(e) => {
            e.target.onerror = null;
            e.target.style.display = "none";
            e.target.parentElement.querySelector(".fallback").style.display = "flex";
          }}
        />
      ) : null}
      <div
        className="fallback"
        style={{
          width: "100%",
          height: imgSrc ? 0 : 200,
          background: `linear-gradient(135deg, ${C.warm}, ${C.amberLight})`,
          display: imgSrc ? "none" : "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 48,
        }}
      >
        {cluster.clusterType === "people" ? "\u{1F46A}" :
         cluster.clusterType === "activity" ? "\u{1F3BF}" :
         cluster.clusterType === "location" ? "\u{1F4CD}" :
         cluster.clusterType === "temporal" ? "\u{1F4C5}" : "\u{1F5BC}"}
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: C.brown }}>{cluster.title}</div>
        {cluster.description && (
          <div style={{
            fontSize: 13, color: C.lightText, lineHeight: 1.5,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {cluster.description}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <Badge color={C.amber}>
            {photoCount} photo{photoCount !== 1 ? "s" : ""}
          </Badge>
          {meta.dateRange?.start && (
            <Badge color={C.blue}>
              {meta.dateRange.start === meta.dateRange.end
                ? meta.dateRange.start
                : `${meta.dateRange.start.slice(0, 7)} \u2014 ${meta.dateRange.end.slice(0, 7)}`}
            </Badge>
          )}
        </div>
        {meta.people?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {meta.people.map((p) => (
              <span key={p} style={{
                fontSize: 11, padding: "2px 8px", borderRadius: 10,
                background: C.warm, color: C.soft, fontWeight: 500,
              }}>
                {p}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
