import { useState, useEffect } from "react";
import { C } from "../../constants/palette";
import { apiFetch } from "../../api/fetch";
import { BACKEND_URL, BACKEND_KEY } from "../../api/config";
import { thumbUrl } from "../../api/helpers";
import { calcAge } from "../../utils/helpers";
import Badge from "../shared/Badge";
import ConfirmDialog from "../shared/ConfirmDialog";
import PropagatePanel from "./PropagatePanel";
import FaceScanPanel from "../faces/FaceScanPanel";

// ── Admin View ───────────────────────────────────────────────────────────────
const AdminView = ({ syncStatus, onSync, syncing, syncResult, manifests, online, onRefresh }) => {
  const [section, setSection] = useState("manage"); // manage | knowledge | faces | family | sync
  const [selected, setSelected] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(null); // null | { ids: [...] }
  const [deleting, setDeleting] = useState(false);
  const [propagateItem, setPropagateItem] = useState(null);
  const [knowledge, setKnowledge] = useState([]);
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const [newFact, setNewFact] = useState("");
  const [faces, setFaces] = useState({ faces: [], byPerson: {} });
  const [loadingFaces, setLoadingFaces] = useState(false);
  const [scanPerson, setScanPerson] = useState(null);
  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [profileWeather, setProfileWeather] = useState({});
  const [editingProfile, setEditingProfile] = useState(null); // null | profile object (empty = new)
  const [profileForm, setProfileForm] = useState({ name: "", birthday: "", school: "", city: "", state: "", activities: "", notes: "", links: [] });

  const loadKnowledge = async () => {
    setLoadingKnowledge(true);
    try {
      const r = await apiFetch("/api/knowledge");
      if (r.ok) {
        const data = await r.json();
        setKnowledge(data.knowledge || []);
      }
    } catch {} finally { setLoadingKnowledge(false); }
  };

  const loadFaces = async () => {
    setLoadingFaces(true);
    try {
      const r = await apiFetch("/api/faces");
      if (r.ok) {
        const data = await r.json();
        setFaces(data);
      }
    } catch {} finally { setLoadingFaces(false); }
  };

  const deleteFace = async (id) => {
    try {
      const r = await apiFetch(`/api/faces/${id}`, { method: "DELETE" });
      if (r.ok) loadFaces();
    } catch {}
  };

  const loadProfiles = async () => {
    setLoadingProfiles(true);
    try {
      const [pr, wr] = await Promise.all([
        apiFetch("/api/profiles"),
        apiFetch("/api/profiles/weather"),
      ]);
      if (pr.ok) {
        const data = await pr.json();
        setProfiles(data.profiles || []);
      }
      if (wr.ok) {
        const data = await wr.json();
        const map = {};
        for (const w of data.weather || []) map[w.profileId] = w.weather;
        setProfileWeather(map);
      }
    } catch {} finally { setLoadingProfiles(false); }
  };

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
        await apiFetch(`/api/profiles/${editingProfile.id}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch("/api/profiles", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      setEditingProfile(null);
      setProfileForm({ name: "", birthday: "", school: "", city: "", state: "", activities: "", notes: "", links: [] });
      loadProfiles();
    } catch {}
  };

  const deleteProfile = async (id) => {
    try {
      const r = await apiFetch(`/api/profiles/${id}`, { method: "DELETE" });
      if (r.ok) loadProfiles();
    } catch {}
  };

  const startEditProfile = (p) => {
    setEditingProfile(p);
    setProfileForm({
      name: p.name || "",
      birthday: p.birthday || "",
      school: p.school || "",
      city: p.location?.city || "",
      state: p.location?.state || "",
      activities: (p.activities || []).join(", "),
      notes: p.notes || "",
      links: p.links || [],
    });
  };

  useEffect(() => { if (section === "knowledge") loadKnowledge(); }, [section]);
  useEffect(() => { if (section === "faces") loadFaces(); }, [section]);
  useEffect(() => { if (section === "family") loadProfiles(); }, [section]);

  const handleDelete = async (ids) => {
    setDeleting(true);
    try {
      if (ids.length === 1) {
        const r = await apiFetch(`/api/manifests/${ids[0]}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } else {
        const r = await apiFetch("/api/manifests/bulk-delete", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      }
      setSelected(new Set());
      if (onRefresh) await onRefresh();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  const addFact = async () => {
    if (!newFact.trim()) return;
    try {
      const r = await apiFetch("/api/knowledge", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fact: newFact.trim() }),
      });
      if (r.ok) { setNewFact(""); loadKnowledge(); }
    } catch {}
  };

  const deleteFact = async (id) => {
    try {
      const r = await apiFetch(`/api/knowledge/${id}`, { method: "DELETE" });
      if (r.ok) loadKnowledge();
    } catch {}
  };

  const filtered = manifests.filter(m => {
    if (!search) return true;
    const s = search.toLowerCase();
    const c = m.classification || {};
    return (c.title || "").toLowerCase().includes(s) ||
      (c.people || []).join(" ").toLowerCase().includes(s) ||
      (c.tags || []).join(" ").toLowerCase().includes(s) ||
      (m.corrections?.people || []).join(" ").toLowerCase().includes(s);
  });

  const catCounts = {};
  manifests.forEach(m => {
    const cat = m.classification?.category || "other";
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });

  const sectionBtn = (id, label) => (
    <button key={id} onClick={() => setSection(id)} style={{
      padding: "8px 16px", borderRadius: 8, border: section === id ? `2px solid ${C.amber}` : `1px solid ${C.warmBorder}`,
      background: section === id ? C.amberLight : C.white, color: section === id ? C.brown : C.lightText,
      fontSize: 13, fontWeight: 600, cursor: "pointer",
    }}>{label}</button>
  );

  const cardStyle = { background: C.white, borderRadius: 14, padding: 20, marginBottom: 16, border: `1.5px solid ${C.amberBorder}` };
  const sectionLabel = { fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.amber, marginBottom: 10 };

  return (
    <div style={{ padding: 24, maxWidth: 700 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: C.brown, marginBottom: 16, fontFamily: "inherit" }}>Admin</h2>

      {/* Vault stats bar */}
      <div style={{ ...cardStyle, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.brown }}>{manifests.length}</div>
          <div style={{ fontSize: 12, color: C.muted }}>total items</div>
        </div>
        <div style={{ height: 36, width: 1, background: C.warmBorder }} />
        {Object.entries(catCounts).sort((a,b) => b[1]-a[1]).map(([cat, count]) => (
          <div key={cat} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.brown }}>{count}</div>
            <div style={{ fontSize: 11, color: C.muted, textTransform: "capitalize" }}>{cat}</div>
          </div>
        ))}
      </div>

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {sectionBtn("manage", `Manage Items (${manifests.length})`)}
        {sectionBtn("family", "Family")}
        {sectionBtn("faces", "Face Library")}
        {sectionBtn("knowledge", "Knowledge Base")}
        {sectionBtn("sync", "Drive Sync")}
      </div>

      {/* ── Manage Items ─────────────────────────────────────────── */}
      {section === "manage" && (
        <div>
          {/* Search + bulk actions */}
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items..."
              style={{ flex: 1, minWidth: 180, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
            {selected.size > 0 && (
              <button onClick={() => setConfirmDelete({ ids: [...selected] })}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: C.red, color: C.white, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Delete {selected.size} selected
              </button>
            )}
          </div>

          {/* Select all */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: C.muted, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0}
                onChange={() => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(m => m.id)))} />
              Select all ({filtered.length})
            </label>
          </div>

          {/* Item list */}
          {filtered.map(m => {
            const c = m.classification || {};
            const hasCor = !!m.corrections;
            return (
              <div key={m.id} style={{
                background: C.white, borderRadius: 10, padding: 12, marginBottom: 6,
                border: `1px solid ${selected.has(m.id) ? C.amber : C.warmBorder}`,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <input type="checkbox" checked={selected.has(m.id)}
                  onChange={() => setSelected(prev => {
                    const next = new Set(prev);
                    next.has(m.id) ? next.delete(m.id) : next.add(m.id);
                    return next;
                  })} />
                <div style={{
                  width: 44, height: 44, borderRadius: 6, overflow: "hidden", flexShrink: 0,
                  background: C.warm, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {(m.mimeType || "").startsWith("image/") ? (
                    <img src={thumbUrl(m)} alt="" style={{ width: 44, height: 44, objectFit: "cover" }}
                      onError={e => { e.target.style.display = "none"; }} />
                  ) : (
                    <span style={{ fontSize: 18 }}>{c.category === "document" ? "\u{1F4C4}" : "\u{1F4CE}"}</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.brown, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.title || m.fileName}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                    <span style={{ textTransform: "capitalize" }}>{c.category}</span>
                    {(m.corrections?.people || c.people || []).length > 0 && (
                      <span>{(m.corrections?.people || c.people).join(", ")}</span>
                    )}
                    {hasCor && <Badge color={C.green} bg={C.greenBg}>corrected</Badge>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {hasCor && (
                    <button onClick={() => setPropagateItem(m)} title="Propagate labels to similar items"
                      style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.amberBorder}`, background: C.amberLight, color: C.amber, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      Propagate
                    </button>
                  )}
                  <button onClick={() => setConfirmDelete({ ids: [m.id] })} title="Delete"
                    style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.red, fontSize: 12, cursor: "pointer" }}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Family Profiles ─────────────────────────────────────── */}
      {section === "family" && (
        <div>
          {/* Add / Edit form */}
          <div style={cardStyle}>
            <div style={sectionLabel}>{editingProfile?.id ? `Edit ${editingProfile.name}` : "Add Family Member"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={profileForm.name} onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))} placeholder="Name *"
                  style={{ flex: 2, minWidth: 140, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
                <input value={profileForm.birthday} onChange={e => setProfileForm(f => ({ ...f, birthday: e.target.value }))} type="date"
                  style={{ flex: 1, minWidth: 140, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
                {profileForm.birthday && calcAge(profileForm.birthday) !== null && (
                  <span style={{ fontSize: 13, color: C.lightText, whiteSpace: "nowrap", alignSelf: "center" }}>Age: {calcAge(profileForm.birthday)}</span>
                )}
              </div>
              <input value={profileForm.school} onChange={e => setProfileForm(f => ({ ...f, school: e.target.value }))} placeholder="School"
                style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
              <div style={{ display: "flex", gap: 8 }}>
                <input value={profileForm.city} onChange={e => setProfileForm(f => ({ ...f, city: e.target.value }))} placeholder="City"
                  style={{ flex: 2, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
                <input value={profileForm.state} onChange={e => setProfileForm(f => ({ ...f, state: e.target.value }))} placeholder="State"
                  style={{ width: 80, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
              </div>
              <input value={profileForm.activities} onChange={e => setProfileForm(f => ({ ...f, activities: e.target.value }))} placeholder="Activities (comma separated, e.g. soccer, piano, swimming)"
                style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
              <input value={profileForm.notes} onChange={e => setProfileForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes (anything else to remember)"
                style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
              {/* Links */}
              <div style={{ fontSize: 12, color: C.lightText, marginTop: 4 }}>Links</div>
              {profileForm.links.map((link, li) => (
                <div key={li} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input value={link.label} onChange={e => { const links = [...profileForm.links]; links[li] = { ...links[li], label: e.target.value }; setProfileForm(f => ({ ...f, links })); }}
                    placeholder="Label (e.g. School Website)" style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, fontSize: 12, background: C.white }} />
                  <input value={link.url} onChange={e => { const links = [...profileForm.links]; links[li] = { ...links[li], url: e.target.value }; setProfileForm(f => ({ ...f, links })); }}
                    placeholder="https://..." style={{ flex: 2, padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, fontSize: 12, background: C.white }} />
                  <button onClick={() => { const links = profileForm.links.filter((_, j) => j !== li); setProfileForm(f => ({ ...f, links })); }}
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
          </div>

          {/* Profile cards */}
          {loadingProfiles ? (
            <div style={{ padding: 20, textAlign: "center", color: C.muted }}>Loading profiles...</div>
          ) : profiles.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 14 }}>
              No family profiles yet. Add a family member above so the chat knows about your family.
            </div>
          ) : (
            profiles.map(p => {
              const w = profileWeather[p.id];
              return (
                <div key={p.id} style={{ ...cardStyle }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: C.brown }}>{p.name}</div>
                      <div style={{ fontSize: 13, color: C.lightText, marginTop: 2 }}>
                        {[
                          p.birthday && calcAge(p.birthday) !== null && `Age ${calcAge(p.birthday)}`,
                          p.birthday && `Birthday: ${new Date(p.birthday + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}`,
                        ].filter(Boolean).join(" \u2022 ")}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => startEditProfile(p)}
                        style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.amberBorder}`, background: C.amberLight, color: C.amber, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        Edit
                      </button>
                      <button onClick={() => deleteProfile(p.id)}
                        style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.red, fontSize: 12, cursor: "pointer" }}>
                        Delete
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: C.lightText }}>
                    {p.school && <div>School: <strong style={{ color: C.brown }}>{p.school}</strong></div>}
                    {p.location?.city && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span>Location: <strong style={{ color: C.brown }}>{p.location.city}{p.location.state ? `, ${p.location.state}` : ""}</strong></span>
                        {w && (
                          <span style={{ padding: "2px 10px", borderRadius: 6, background: C.warm, fontSize: 12 }}>
                            {Math.round(w.temperature)}{"\u00B0"}F {"\u00A0\u2022\u00A0"} {w.description}
                          </span>
                        )}
                      </div>
                    )}
                    {p.activities?.length > 0 && <div>Activities: <strong style={{ color: C.brown }}>{p.activities.join(", ")}</strong></div>}
                    {p.links?.length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                        {p.links.map((l, li) => (
                          <a key={li} href={l.url} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 12, color: C.amber, textDecoration: "none", padding: "2px 8px", borderRadius: 6, background: C.amberLight, border: `1px solid ${C.amberBorder}` }}>
                            {l.label || l.url}
                          </a>
                        ))}
                      </div>
                    )}
                    {p.notes && <div style={{ fontStyle: "italic", color: C.muted, marginTop: 2 }}>{p.notes}</div>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Face Library ─────────────────────────────────────────── */}
      {section === "faces" && (
        <div>
          <div style={cardStyle}>
            <div style={sectionLabel}>How It Works</div>
            <div style={{ fontSize: 13, color: C.lightText, lineHeight: 1.6 }}>
              1. Go to <strong>Vault</strong> and click <strong>"Tag Face"</strong> on any photo<br/>
              2. Click on a person in the photo to crop their face<br/>
              3. Type their name and save<br/>
              4. Come back here and click <strong>"Find in Vault"</strong> — Gemini will scan all your photos to find that person
            </div>
          </div>

          {loadingFaces ? (
            <div style={{ padding: 20, textAlign: "center", color: C.muted }}>Loading face library...</div>
          ) : Object.keys(faces.byPerson || {}).length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 14 }}>
              No face references yet. Go to the Vault tab and click "Tag Face" on a photo to get started.
            </div>
          ) : (
            Object.entries(faces.byPerson || {}).map(([name, refs]) => (
              <div key={name} style={{ ...cardStyle }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.brown }}>{name}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setScanPerson(name)}
                      style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: C.green, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      Find in Vault
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {refs.map(ref => (
                    <div key={ref.id} style={{ position: "relative" }}>
                      <img
                        src={`${BACKEND_URL}/api/faces/${ref.id}/image?key=${BACKEND_KEY}`}
                        alt={name}
                        style={{ width: 80, height: 80, borderRadius: 8, objectFit: "cover", border: `2px solid ${C.amberBorder}` }}
                      />
                      <button onClick={() => deleteFace(ref.id)}
                        style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", border: "none", background: C.red, color: "#fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        x
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{refs.length} reference{refs.length !== 1 ? "s" : ""}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Knowledge Base ────────────────────────────────────────── */}
      {section === "knowledge" && (
        <div>
          <div style={cardStyle}>
            <div style={sectionLabel}>Add Family Fact</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={newFact} onChange={e => setNewFact(e.target.value)} placeholder='e.g. "Mia is 9 and loves ballet"'
                onKeyDown={e => e.key === "Enter" && addFact()}
                style={{ flex: 1, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.warmBorder}`, fontSize: 13, background: C.white }} />
              <button onClick={addFact} disabled={!newFact.trim()}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: newFact.trim() ? C.amber : C.warmBorder, color: C.white, fontSize: 13, fontWeight: 600, cursor: newFact.trim() ? "pointer" : "not-allowed" }}>
                Add
              </button>
            </div>
          </div>

          {loadingKnowledge ? (
            <div style={{ padding: 20, textAlign: "center", color: C.muted }}>Loading...</div>
          ) : knowledge.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: C.muted, fontSize: 14 }}>
              No facts yet. Add facts manually or correct photos — the system auto-learns from corrections.
            </div>
          ) : (
            knowledge.map(k => (
              <div key={k.id} style={{
                background: C.white, borderRadius: 10, padding: 12, marginBottom: 6,
                border: `1px solid ${C.warmBorder}`, display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: C.brown }}>{k.fact}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    Source: {k.source || "unknown"} {k.createdAt && `\u2022 ${new Date(k.createdAt).toLocaleDateString()}`}
                  </div>
                </div>
                <button onClick={() => deleteFact(k.id)}
                  style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.warmBorder}`, background: C.white, color: C.red, fontSize: 12, cursor: "pointer" }}>
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Drive Sync ───────────────────────────────────────────── */}
      {section === "sync" && (
        <div>
          {syncStatus && (
            <div style={cardStyle}>
              <div style={sectionLabel}>Last Sync</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 14, color: C.lightText }}>
                  Time: <strong style={{ color: C.brown }}>{syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString() : "Never"}</strong>
                </div>
                {syncStatus.lastSyncResult && (
                  <>
                    <div style={{ fontSize: 14, color: C.lightText }}>Processed: <strong style={{ color: C.green }}>{syncStatus.lastSyncResult.processed}</strong></div>
                    <div style={{ fontSize: 14, color: C.lightText }}>Skipped: <strong>{syncStatus.lastSyncResult.skipped}</strong></div>
                    {syncStatus.lastSyncResult.errors?.length > 0 && (
                      <div style={{ fontSize: 14, color: C.red }}>Errors: <strong>{syncStatus.lastSyncResult.errors.length}</strong></div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {!online && (
            <div style={{ ...cardStyle, background: C.warm }}>
              <div style={sectionLabel}>Troubleshooting</div>
              <div style={{ fontSize: 14, color: C.lightText, lineHeight: 1.7 }}>
                Backend not reachable. Check Cloud Run deployment, CORS, or start local backend with <strong>npm run dev</strong>.
              </div>
            </div>
          )}

          <button onClick={onSync} disabled={syncing || !online}
            style={{ padding: "12px 28px", borderRadius: 12, border: "none", fontSize: 15, fontWeight: 600,
              cursor: syncing || !online ? "not-allowed" : "pointer",
              background: syncing || !online ? C.warmBorder : C.amber, color: C.white }}>
            {syncing ? "Syncing..." : online ? "Sync Now" : "Sync (Backend Offline)"}
          </button>

          {syncResult && (
            <div style={{ ...cardStyle, marginTop: 16, borderColor: syncResult.error ? C.red : C.green }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: syncResult.error ? C.red : C.green, marginBottom: 8 }}>
                {syncResult.error ? "Sync Failed" : "Sync Complete"}
              </div>
              {syncResult.error ? (
                <div style={{ fontSize: 13, color: C.red }}>{syncResult.error}</div>
              ) : (
                <div style={{ display: "flex", gap: 20, fontSize: 13, color: C.lightText }}>
                  <div>Processed: <strong style={{ color: C.green }}>{syncResult.processed}</strong></div>
                  <div>Skipped: <strong>{syncResult.skipped}</strong></div>
                  {syncResult.errors?.length > 0 && <div>Errors: <strong style={{ color: C.red }}>{syncResult.errors.length}</strong></div>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <ConfirmDialog
          message={`Delete ${confirmDelete.ids.length} item${confirmDelete.ids.length !== 1 ? "s" : ""}? This cannot be undone.`}
          onConfirm={() => handleDelete(confirmDelete.ids)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Propagation panel */}
      {propagateItem && (
        <PropagatePanel item={propagateItem} onClose={() => setPropagateItem(null)} onRefresh={onRefresh} />
      )}

      {/* Face scan panel */}
      {scanPerson && (
        <FaceScanPanel personName={scanPerson} onClose={() => setScanPerson(null)} onRefresh={onRefresh} />
      )}
    </div>
  );
};

export default AdminView;
