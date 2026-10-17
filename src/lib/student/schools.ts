// School identity is separate from its learning-platform adapter. This is a
// curated pilot directory, not an exhaustive or live national school database.
export type SchoolChoice = { id: string; name: string; city: string; website: string; districtId: "fuhsd" | "pausd" | null; portal: string | null; ncesId?: string };
export const SCHOOLS: SchoolChoice[] = [
  { id: "palo-alto-high", name: "Palo Alto High School", city: "Palo Alto, CA", website: "https://www.paly.net", districtId: "pausd", portal: "https://pausd.schoology.com" },
  { id: "gunn-high", name: "Henry M. Gunn High School", city: "Palo Alto, CA", website: "https://gunn.pausd.org", districtId: "pausd", portal: "https://pausd.schoology.com" },
  { id: "cupertino-high", name: "Cupertino High School", city: "Cupertino, CA", website: "https://chs.fuhsd.org", districtId: "fuhsd", portal: "https://fuhsd.schoology.com" },
  { id: "fremont-high", name: "Fremont High School", city: "Sunnyvale, CA", website: "https://fhs.fuhsd.org", districtId: "fuhsd", portal: "https://fuhsd.schoology.com" },
  { id: "homestead-high", name: "Homestead High School", city: "Cupertino, CA", website: "https://hhs.fuhsd.org", districtId: "fuhsd", portal: "https://fuhsd.schoology.com" },
  { id: "lynbrook-high", name: "Lynbrook High School", city: "San Jose, CA", website: "https://lhs.fuhsd.org", districtId: "fuhsd", portal: "https://fuhsd.schoology.com" },
  { id: "monta-vista-high", name: "Monta Vista High School", city: "Cupertino, CA", website: "https://mvhs.fuhsd.org", districtId: "fuhsd", portal: "https://fuhsd.schoology.com" },
];
export function publicSchoolUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname) || /\.(local|localhost|internal|lan|test|invalid|example)$/i.test(url.hostname)) throw new Error("Use a public HTTPS school address without login tokens, query parameters or a port.");
  return url.href;
}
export function parseSchool(value: unknown): SchoolChoice | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const known = SCHOOLS.find(s => s.id === v.id); if (known) return known;
  if (typeof v.ncesId === "string" && /^\d{12}$/.test(v.ncesId) && v.id === `nces-${v.ncesId}` && typeof v.name === "string" && v.name.trim() && v.name.length <= 120) return { id: v.id, name: v.name.trim(), city: typeof v.city === "string" ? v.city.slice(0, 80) : "US public school", ncesId: v.ncesId, website: "", portal: null, districtId: null };
  if (v.id !== "custom" || typeof v.name !== "string" || !v.name.trim() || v.name.length > 120 || typeof v.website !== "string" || v.website.length > 500) return null;
  try { return { id: "custom", name: v.name.trim(), city: "School supplied by you", website: publicSchoolUrl(v.website), districtId: null, portal: typeof v.portal === "string" && v.portal.length <= 500 && v.portal.trim() ? publicSchoolUrl(v.portal) : null }; } catch { return null; }
}
export const schoolStorageKey = (userId: string) => `relay-school-choice-v1:${userId}`;
