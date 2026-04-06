import { useState, useEffect } from "react";
import { C } from "../lib/palette";
import { apiFetch, BACKEND_URL, BACKEND_KEY } from "../lib/api";
import { calcAge } from "../lib/constants";
import { Badge } from "./Badge";

// Collapsible section
const Section = ({ title, defaultOpen, children }) => {
  const [open, setOpen] = useState(defaultOpen || false);
  return (
    <div style={{ background: C.white, borderRadius: 14, marginBottom: 16, border: `1.5px solid ${C.amberBorder}`, overflow: "hidden" }}>
      <button onClick={() => setOpen(!open)} style={{
        width: "100%", padding: "16px 20px", border: "none", background: "transparent",
        display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer",
      }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.brown }}>{title}</span>
        <span style={{ color: C.muted, fontSize: 14 }}>{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && <div style={{ padding: "0 20px 20px" }}>{children}</div>}
    </div>
  );
};

export const SettingsView = ({ syncStatus, onSync, syncing, syncResult, online, onRegenClusters }) => {
  // ── Profiles ──
  const [profiles, setProfiles] = useState([]);
  const [profileWeather, setProfileWeather] = useState({});
  const [editingProfile, setEditingProfile] = useState(null);
  const [profileForm, setProfileForm] = useState({ name: "", birthday: "", school: "", city: "", state: "", activities: "", notes: "", links: [] });

  // ── Knowledge ──
  const [knowledge, setKnowledge] = useState([]);
  const [newFact, setNewFact] = useState("");

  // ── Faces ──
  const [faces, setFaces] = useState({ faces: [], byPerson: {} });
  const [scanPerson, setScanPerson] = useState(null);
  const [regenerating, setRegenerating] = useState(false);

  const loadProfiles = async () => {
    try {
      const [pr, wr] = await Promise.all([apiFetch("/api/profiles"), apiFetch("/api/profiles/weather")]);
      if (pr.ok) setProfiles((await pr.json()).profiles || []);
      if (wr.ok) {
        const map = {};
        for (const w of (await wr.json()).weather || []) map[w.profileId] = w.weather;
        setProfileWeather(map);
      }
    } catch {}
  };

  const loadKnowledge = async () => {
    try {
      const r = await apiFetch("/api/knowledge");
      if (r.ok) setKnowledge((await r.json()).knowledge || []);
    } catch {}
  };

  const loadFaces = async () => {
    try {
      const r = await apiFetch("/api/faces");
      if (r.ok) setFaces(await r.json());
    } catch {}
  };

  useEffect(() => { loadProfiles(); loadKnowledge(); loadFaces(); }, []);

  const saveProfile = async () => {
    if (!profileForm.name.trim()) return;
    const body = {
      name: profileForm.name.trim(),
      birthday: profileForm.birthday || null,
      school: profileForm.school || null,
      location: profileForm.city ? { city: profileForm.city, state: profileForm.state || null } : null,
      activities: profileForm.activities ? profileForm.activities.split(",").map(a => a.trim()).filter(Boolean) : [],
      notes: profileForm.notes || null,
      links: profileForm.links.filter(l => l.url.trim()),
    };
    try {
      if (editingProfile?.id) {
        await apiFetch(`/api/profiles/${editingProfile.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      } else {
        await apiFetch("/api/profiles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      }
      setEditingProfile(null);
      setProfileForm({ name: "", birthday: "", school: "", city: "", state: "", activities: "", notes: "", links: [] });
      loadProfiles();
    } catch {}
  };

  const startEditProfile = (p) => {
    setEditingProfile(p);
    setProfileForm({
      name: p.name || "", birthday: p.birthday || "", school: p.school || "",
      city: p.location?.city || "", state: p.location?.state || "",
      activities: (p.activities || []).join(", "), notes: p.notes || "", links: p.links || [],
    });
  };

  const deleteProfile = async (id) => {
    try { const r = await apiFetch(`/api/profiles/${id}`, { method: "DELETE" }); if (r.ok) loadProfiles(); } catch {}
  };

  const addFact = async () => {
    if (!newFact.trim()) return;
    try {
      const r = await apiFetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fact: newFact.trim() }) });
      if (r.ok) { setNewFact(""); loadKnowledge(); }
    } catch {}
  };

  const deleteFact = async (id) => {
    try { const r = await apiFetch(`/api/knowledge/${id}`, { method: "DELETE" }); if (r.ok) loadKnowledge(); } catch {}
  };

  const deleteFace = async (id) => {
    try { const r = await apiFetch(`/api/faces/${id}`, { method: "DELETE" }); if (r.ok) loadFaces(); } catch {}
  };

  const handleRegenClusters = async () => {
    setRegenerating(true);
    try { await onRegenClusters(); } catch {}
    setRegenerating(false);
  };

  const inputStyle = { width: "100%", padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white, fontFamily: "inherit", boxSizing: "border-box" };

  return (
    <div style={{ padding: 24, maxWidth: 700 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: C.brown, marginBottom: 16, fontFamily: "inherit" }}>Settings</h2>

      {/* ── Family Profiles ── */}
      <Section title="Family Profiles" defaultOpen>
        {/* Add / Edit form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.amber }}>
            {editingProfile?.id ? `Edit ${editingProfile.name}` : "Add Family Member"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={profileForm.name} onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))} placeholder="Name *"
              style={{ ...inputStyle, flex: 2, minWidth: 140 }} />
            <input value={profileForm.birthday} onChange={e => setProfileForm(f => ({ ...f, birthday: e.target.value }))} type="date"
              style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
            {profileForm.birthday && calcAge(profileForm.birthday) !== null && (
              <span style={{ fontSize: 13, color: C.lightText, whiteSpace: "nowrap", alignSelf: "center" }}>Age: {calcAge(profileForm.birthday)}</span>
            )}
          </div>
          <input value={profileForm.school} onChange={e => setProfileForm(f => ({ ...f, school: e.target.value }))} placeholder="School" style={inputStyle} />
          <div style={{ display: "flex", gap: 8 }}>
            <input value={profileForm.city} onChange={e => setProfileForm(f => ({ ...f, city: e.target.value }))} placeholder="City" style={{ ...inputStyle, flex: 2 }} />
            <input value={profileForm.state} onChange={e => setProfileForm(f => ({ ...f, state: e.target.value }))} placeholder="State" style={{ ...inputStyle, width: 80 }} />
          </div>
          <input value={profileForm.activities} onChange={e => setProfileForm(f => ({ ...f, activities: e.target.value }))} placeholder="Activities (comma separated)" style={inputStyle} />
          <input value={profileForm.notes} onChange={e => setProfileForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes" style={inputStyle} />
          {/* Links */}
          <div style={{ fontSize: 12, color: C.lightText, marginTop: 4 }}>Links</div>
          {profileForm.links.map((link, li) => (
            <div key={li} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input value={link.label} onChange={e => { const links = [...profileForm.links]; links[li] = { ...links[li], label: e.target.value }; setProfileForm(f => ({ ...f, links })); }}
                placeholder="Label" style={{ ...inputStyle, flex: 1 }} />
              <input value={link.url} onChange={e => { const links = [...profileForm.links]; links[li] = { ...links[li], url: e.target.value }; setProfileForm(f => ({ ...f, links })); }}
                placeholder="https://..." style={{ ...inputStyle, flex: 2 }} />
              <button onClick={() => setProfileForm(f => ({ ...f, links: f.links.filter((_, j) => j !== li) }))}
                style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.red, fontSize: 12, cursor: "pointer" }}>{"\u00D7"}</button>
            </div>
          ))}
          <button onClick={() => setProfileForm(f => ({ ...f, links: [...f.links, { label: "", url: "" }] }))}
            style={{ alignSelf: "flex-start", padding: "4px 12px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.amber, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            + Add Link
          </button>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={saveProfile} disabled={!profileForm.name.trim()}
              style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: profileForm.name.trim() ? C.amber : C.warmBorder, color: C.white, fontSize: 13, fontWeight: 600, cursor: profileForm.name.trim() ? "pointer" : "not-allowed" }}>
              {editingProfile?.id ? "Save Changes" : "Add"}
            </button>
            {editingProfile?.id && (
              <button onClick={() => { setEditingProfile(null); setProfileForm({ name: "", birthday: "", school: "", city: "", state: "", activities: "", notes: "", links: [] }); }}
                style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.lightText, fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Profile cards */}
        {profiles.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: C.muted, fontSize: 14 }}>No family profiles yet.</div>
        ) : profiles.map(p => {
          const w = profileWeather[p.id];
          return (
            <div key={p.id} style={{ background: C.cream, borderRadius: 10, padding: 14, marginBottom: 8, border: `1px solid ${C.warmBorder}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.brown }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: C.lightText, marginTop: 2 }}>
                    {[p.birthday && calcAge(p.birthday) !== null && `Age ${calcAge(p.birthday)}`,
                      p.birthday && `Birthday: ${new Date(p.birthday + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}`
                    ].filter(Boolean).join(" \u2022 ")}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => startEditProfile(p)} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.amberBorder}`, background: C.amberLight, color: C.amber, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Edit</button>
                  <button onClick={() => deleteProfile(p.id)} style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.red, fontSize: 11, cursor: "pointer" }}>Delete</button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: C.lightText }}>
                {p.school && <div>School: <strong style={{ color: C.brown }}>{p.school}</strong></div>}
                {p.location?.city && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>{p.location.city}{p.location.state ? `, ${p.location.state}` : ""}</span>
                    {w && <span style={{ padding: "1px 8px", borderRadius: 6, background: C.warm, fontSize: 11 }}>{Math.round(w.temperature)}{"\u00B0"}F \u2022 {w.description}</span>}
                  </div>
                )}
                {p.activities?.length > 0 && <div>Activities: <strong style={{ color: C.brown }}>{p.activities.join(", ")}</strong></div>}
                {p.links?.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                    {p.links.map((l, li) => (
                      <a key={li} href={l.url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: C.amber, textDecoration: "none", padding: "1px 6px", borderRadius: 4, background: C.amberLight, border: `1px solid ${C.amberBorder}` }}>
                        {l.label || l.url}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </Section>

      {/* ── Face Library ── */}
      <Section title="Face Library">
        <div style={{ fontSize: 13, color: C.lightText, lineHeight: 1.6, marginBottom: 12 }}>
          Tag faces in the Explore tab, then use "Find in Vault" here to scan all photos with Gemini.
        </div>
        {Object.keys(faces.byPerson || {}).length === 0 ? (
          <div style={{ padding: 12, textAlign: "center", color: C.muted, fontSize: 13 }}>No face references yet.</div>
        ) : Object.entries(faces.byPerson || {}).map(([name, refs]) => (
          <div key={name} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.brown }}>{name}</span>
              <button onClick={() => setScanPerson(name)}
                style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: C.green, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                Find in Vault
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {refs.map(ref => (
                <div key={ref.id} style={{ position: "relative" }}>
                  <img src={`${BACKEND_URL}/api/faces/${ref.id}/image?key=${BACKEND_KEY}`} alt={name}
                    style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover", border: `2px solid ${C.amberBorder}` }} />
                  <button onClick={() => deleteFace(ref.id)}
                    style={{ position: "absolute", top: -4, right: -4, width: 18, height: 18, borderRadius: "50%", border: "none", background: C.red, color: "#fff", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>x</button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      {/* ── Knowledge Base ── */}
      <Section title="Knowledge Base">
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input value={newFact} onChange={e => setNewFact(e.target.value)} placeholder='e.g. "Mia is 9 and loves ballet"'
            onKeyDown={e => e.key === "Enter" && addFact()} style={{ ...inputStyle, flex: 1 }} />
          <button onClick={addFact} disabled={!newFact.trim()}
            style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: newFact.trim() ? C.amber : C.warmBorder, color: C.white, fontSize: 13, fontWeight: 600, cursor: newFact.trim() ? "pointer" : "not-allowed" }}>
            Add
          </button>
        </div>
        {knowledge.length === 0 ? (
          <div style={{ padding: 12, textAlign: "center", color: C.muted, fontSize: 13 }}>
            No facts yet. Add facts or correct photos \u2014 the system auto-learns.
          </div>
        ) : knowledge.map(k => (
          <div key={k.id} style={{ background: C.cream, borderRadius: 8, padding: 10, marginBottom: 4, border: `1px solid ${C.warmBorder}`, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: C.brown }}>{k.fact}</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                {k.source || "unknown"} {k.createdAt && `\u2022 ${new Date(k.createdAt).toLocaleDateString()}`}
              </div>
            </div>
            <button onClick={() => deleteFact(k.id)}
              style={{ padding: "3px 8px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.red, fontSize: 11, cursor: "pointer" }}>
              Delete
            </button>
          </div>
        ))}
      </Section>

      {/* ── Sync & Collections ── */}
      <Section title="Sync & Collections">
        {syncStatus && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: C.lightText }}>
              Last sync: <strong style={{ color: C.brown }}>{syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString() : "Never"}</strong>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={onSync} disabled={syncing || !online}
            style={{ padding: "10px 24px", borderRadius: 10, border: "none", fontSize: 14, fontWeight: 600,
              cursor: syncing || !online ? "not-allowed" : "pointer",
              background: syncing || !online ? C.warmBorder : C.amber, color: C.white }}>
            {syncing ? "Syncing..." : online ? "Sync Now" : "Sync (Offline)"}
          </button>
          <button onClick={handleRegenClusters} disabled={regenerating || !online}
            style={{ padding: "10px 24px", borderRadius: 10, border: `1.5px solid ${C.amberBorder}`, fontSize: 14, fontWeight: 600,
              cursor: regenerating || !online ? "not-allowed" : "pointer",
              background: regenerating ? C.warm : C.white, color: regenerating ? C.muted : C.soft }}>
            {regenerating ? "Regenerating..." : "Regenerate Collections"}
          </button>
        </div>

        {syncResult && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: syncResult.error ? C.redBg : C.greenBg, border: `1px solid ${syncResult.error ? C.red + "30" : C.green + "30"}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: syncResult.error ? C.red : C.green, marginBottom: 4 }}>
              {syncResult.error ? "Sync Failed" : "Sync Complete"}
            </div>
            {syncResult.error ? (
              <div style={{ fontSize: 12, color: C.red }}>{syncResult.error}</div>
            ) : (
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: C.lightText }}>
                <span>Processed: <strong style={{ color: C.green }}>{syncResult.processed}</strong></span>
                <span>Skipped: <strong>{syncResult.skipped}</strong></span>
                {syncResult.errors?.length > 0 && <span>Errors: <strong style={{ color: C.red }}>{syncResult.errors.length}</strong></span>}
              </div>
            )}
          </div>
        )}

        {!online && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: C.warm, fontSize: 13, color: C.lightText }}>
            Backend not reachable. Check Cloud Run deployment or start local backend.
          </div>
        )}
      </Section>
    </div>
  );
};
