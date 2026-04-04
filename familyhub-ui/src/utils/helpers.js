// ── Helpers ─────────────────────────────────────────────────────────────────
export function calcAge(birthday) {
  if (!birthday) return null;
  const d = new Date(birthday);
  if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

export function weatherIcon(code) {
  if (code === 0) return "\u2600\uFE0F";       // Clear
  if (code <= 2) return "\u26C5";              // Partly cloudy
  if (code === 3) return "\u2601\uFE0F";       // Overcast
  if (code <= 48) return "\uD83C\uDF2B\uFE0F"; // Fog
  if (code <= 57) return "\uD83C\uDF27\uFE0F"; // Drizzle
  if (code <= 67) return "\uD83C\uDF27\uFE0F"; // Rain
  if (code <= 77) return "\u2744\uFE0F";       // Snow
  if (code <= 82) return "\uD83C\uDF26\uFE0F"; // Rain showers
  if (code <= 86) return "\uD83C\uDF28\uFE0F"; // Snow showers
  return "\u26C8\uFE0F";                       // Thunderstorm
}
