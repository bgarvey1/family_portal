import { apiFetch } from "./fetch";
import { calcAge } from "../utils/helpers";

export const claudeChat = async (messages, system) => {
  const r = await apiFetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, system }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Chat API ${r.status}: ${err}`);
  }
  const data = await r.json();
  return data.text || "";
};

// ── Two-pass RAG ─────────────────────────────────────────────────────────────
export const buildIndex = (manifests) =>
  manifests
    .map((m) => {
      const c = m.classification || {};
      const cor = m.corrections || {};
      // Prefer corrections over classification for people/tags/location
      const people = (cor.people || c.people || []).join(",");
      const tags = [...(cor.tags || []), ...(c.tags || [])].filter((v, i, a) => a.indexOf(v) === i).join(",");
      const location = cor.location || c.location || "";
      return [
        `ID:${m.id}`,
        c.category,
        `"${c.title}"`,
        people && `People:${people}`,
        location && `Location:${location}`,
        tags && `Tags:${tags}`,
        c.description,
        cor.context,
      ].filter(Boolean).join(" | ");
    })
    .join("\n");

export async function ragChat(question, manifests, history) {
  // Build conversation summary for context in Pass 1
  // This helps with follow-up questions like "when was this?"
  const recentHistory = history.slice(-6);
  let conversationContext = "";
  if (recentHistory.length > 0) {
    const summary = recentHistory
      .map((m) => `${m.role === "user" ? "Grandparent" : "Assistant"}: ${m.content.substring(0, 150)}`)
      .join("\n");
    conversationContext = `\nRecent conversation (for context on follow-up questions):\n${summary}\n`;
  }

  // Pass 1 — relevance selection (now with conversation context)
  const index = buildIndex(manifests);
  const selectionResult = await claudeChat(
    [
      {
        role: "user",
        content: `Question from a grandparent: "${question}"${conversationContext}\n\nFamily Vault Index (${manifests.length} items):\n${index}\n\nReturn a JSON array of the IDs (max 5) most relevant to answering this question. If the question is a follow-up, use the conversation context to understand what "this", "that", "those", etc. refer to. Return ONLY the JSON array.`,
      },
    ],
    "You select relevant items from a family vault. Return only a valid JSON array of ID strings."
  );

  let selectedIds = [];
  try {
    const match = selectionResult.match(/\[[\s\S]*?\]/);
    selectedIds = match ? JSON.parse(match[0]) : [];
  } catch {
    selectedIds = [];
  }

  const selected = manifests.filter((m) => selectedIds.includes(m.id));

  // Pass 2 — grounded response (use friendly labels, never expose IDs)
  const itemContext = selected
    .map((m, idx) => {
      const c = m.classification || {};
      const cor = m.corrections || {};
      const exif = m.exif || {};
      const label = c.title || m.fileName || `Item ${idx + 1}`;
      // Prefer corrected data, fall back to AI classification
      const people = (cor.people || c.people || []).join(", ");
      const location = cor.location || c.location || "";
      const tags = (cor.tags || c.tags || []).join(", ");
      const lines = [`"${label}"`];
      if (c.description) lines.push(c.description);
      if (cor.context) lines.push(`Context: ${cor.context}`);
      if (c.category) lines.push(`Type: ${c.category}`);
      if (people) lines.push(`People: ${people}`);
      if (location) lines.push(`Location: ${location}`);
      // Date info: prefer EXIF time, then classification estimate, then Drive timestamps
      if (exif.time) {
        lines.push(`Photo taken: ${exif.time}`);
      } else if (c.date_estimate && c.date_estimate !== "unknown") {
        lines.push(`Date: ${c.date_estimate}`);
      } else if (m.driveCreatedTime) {
        lines.push(`Uploaded: ${new Date(m.driveCreatedTime).toLocaleDateString()}`);
      }
      if (c.sentiment && c.sentiment !== "unknown") lines.push(`Mood: ${c.sentiment}`);
      if (tags) lines.push(`Tags: ${tags}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");

  // Load family profiles and weather for chat context
  let familyContext = "";
  let profiles = [];
  try {
    const [profilesRes, weatherRes] = await Promise.all([
      apiFetch("/api/profiles"),
      apiFetch("/api/profiles/weather"),
    ]);
    const profilesData = profilesRes.ok ? await profilesRes.json() : { profiles: [] };
    const weatherData = weatherRes.ok ? await weatherRes.json() : { weather: [] };

    profiles = profilesData.profiles || [];
    const weatherMap = {};
    for (const w of weatherData.weather || []) {
      weatherMap[w.profileId] = w.weather;
    }

    if (profiles.length > 0) {
      const lines = profiles.map(p => {
        const parts = [`${p.name}`];
        if (p.birthday) {
          const age = calcAge(p.birthday);
          if (age !== null) parts.push(`age ${age}`);
          parts.push(`birthday: ${new Date(p.birthday + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}`);
        }
        if (p.school) parts.push(`goes to ${p.school}`);
        if (p.location?.city) {
          const loc = p.location.state ? `${p.location.city}, ${p.location.state}` : p.location.city;
          parts.push(`lives in ${loc}`);
          const w = weatherMap[p.id];
          if (w) parts.push(`current weather there: ${Math.round(w.temperature)}\u00B0F and ${w.description.toLowerCase()}`);
        }
        if (p.activities?.length > 0) parts.push(`activities: ${p.activities.join(", ")}`);
        if (p.links?.length > 0) parts.push(`links: ${p.links.map(l => `${l.label || "link"}: ${l.url}`).join(", ")}`);
        if (p.notes) parts.push(`notes: ${p.notes}`);
        return `- ${parts.join(" | ")}`;
      });
      familyContext = `\nFAMILY MEMBERS:\n${lines.join("\n")}\n`;
    }
  } catch (err) {
    console.error("[ragChat] Error loading profiles/weather:", err);
  }

  // Fetch website content for profiles mentioned in the question (separate try/catch)
  try {
    const queryLower = question.toLowerCase();
    const relevantProfiles = profiles.filter(p => p.links?.length > 0 && queryLower.includes(p.name.toLowerCase()));
    console.log("[ragChat] Query:", question, "| Profiles with links matching:", relevantProfiles.map(p => p.name));
    if (relevantProfiles.length > 0) {
      const linkFetches = [];
      for (const p of relevantProfiles) {
        for (const link of p.links) {
          if (link.url) {
            console.log("[ragChat] Fetching link:", link.label, link.url);
            linkFetches.push(
              apiFetch("/api/profiles/fetch-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: link.url }) })
                .then(r => r.json())
                .then(d => {
                  console.log("[ragChat] Crawl result:", d.pages, "pages,", (d.text || "").length, "chars");
                  return d.text ? `\n--- ${p.name}'s ${link.label || "link"} (${link.url}) ---\n${d.text}` : "";
                })
                .catch(err => { console.error("[ragChat] fetch-link error:", err); return ""; })
            );
          }
        }
      }
      const linkTexts = (await Promise.all(linkFetches)).filter(Boolean);
      console.log("[ragChat] Total link content pieces:", linkTexts.length);
      if (linkTexts.length > 0) {
        familyContext += `\nREFERENCE WEBSITES (use this information to answer questions about their school/organization):${linkTexts.join("\n")}\n`;
      }
    }
  } catch (err) {
    console.error("[ragChat] Error fetching link content:", err);
  }

  const systemPrompt = `You are a warm, loving family assistant helping grandparents explore their family's photos and documents. Talk like a kind family member sitting next to them — personal, gentle, and natural.

STRICT RULES:
- ALWAYS respond in natural, conversational language. NEVER return JSON, arrays, code, or structured data.
- Use ONLY the information from the items below. Never make up details.
- NEVER show IDs, reference numbers, UUIDs, file names, or any technical identifiers.
- NEVER say you "can't display" or "can't show" photos. The photos will appear automatically below your message. Instead, describe what's in them warmly and naturally, as if you're looking at them together.
- If photos are relevant, say things like "Here are some lovely photos..." or "Take a look at these..." — the app handles showing them.
- When describing photos, paint a picture with words: who's there, what they're doing, the feeling of the moment.
- Keep it short and warm — 2-3 paragraphs at most. No bullet points or lists.
- If nothing matches the question, gently say so and suggest things they could ask about.
- Never mention "vault," "manifests," "items," "database," or any system terminology.
- You know about the family members listed below. Use this to personalize responses — mention their activities, schools, locations, or weather when relevant.
- If REFERENCE WEBSITES content is provided below, USE that information to answer questions about schools, organizations, or activities. Summarize key details warmly and naturally.
${familyContext}
FAMILY MEMORIES:
${itemContext || "(No matching memories found for this question.)"}`;

  const msgs = [
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];

  const response = await claudeChat(msgs, systemPrompt);

  // Safety: if the response looks like raw JSON (Pass 1 leak or model confusion), give a friendly fallback
  const trimmed = response.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      // It's valid JSON — the model returned data instead of a natural response
      if (selected.length > 0) {
        const titles = selected.map(s => s.classification?.title).filter(Boolean).join(", ");
        return { text: `Here are some memories I found: ${titles}. What would you like to know about them?`, sources: selected };
      }
      return { text: "I found some things but I'm having a little trouble putting it into words. Could you try asking again?", sources: selected };
    } catch {
      // Not valid JSON, just looks like it — proceed normally
    }
  }

  return { text: response, sources: selected };
}
