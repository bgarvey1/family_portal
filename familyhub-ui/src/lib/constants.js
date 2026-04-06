export const CATEGORIES = [
  "all", "photo", "document", "receipt", "letter",
  "certificate", "medical", "legal", "financial", "other",
];

export const SUGGESTION_CHIPS = [
  { label: "Catch me up", icon: "\u2615", message: "Catch me up on the family! What's everyone been up to lately?" },
  { label: "On this day", icon: "\uD83D\uDCC5", message: "Show me any photos or memories from this day in previous years." },
  { label: "Recent photos", icon: "\uD83D\uDCF8", message: "Show me the most recent family photos." },
];

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
  if (code === 0) return "\u2600\uFE0F";
  if (code <= 2) return "\u26C5";
  if (code === 3) return "\u2601\uFE0F";
  if (code <= 48) return "\uD83C\uDF2B\uFE0F";
  if (code <= 57) return "\uD83C\uDF27\uFE0F";
  if (code <= 67) return "\uD83C\uDF27\uFE0F";
  if (code <= 77) return "\u2744\uFE0F";
  if (code <= 82) return "\uD83C\uDF26\uFE0F";
  if (code <= 86) return "\uD83C\uDF28\uFE0F";
  return "\u26C8\uFE0F";
}
