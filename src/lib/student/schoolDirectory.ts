import { SCHOOLS, type SchoolChoice } from "./schools";
export const NCES_SOURCE = "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_GEOCODE_PUBLICSCH_2425/MapServer/0";
export const NCES_IDS: Record<string, string> = { "062961004596": "palo-alto-high", "062961004587": "gunn-high", "061443001695": "cupertino-high", "061443001696": "fremont-high", "061443001697": "homestead-high", "061443001698": "lynbrook-high", "061443001699": "monta-vista-high" };
export function schoolSearchUrl(query: string, state = "") {
  const q = query.trim();
  if (q.length < 2 || q.length > 80 || !/^[\p{L}\p{N} .’'\-]+$/u.test(q) || (state && !/^[A-Z]{2}$/.test(state))) throw new Error("Enter 2–80 letters/numbers for a school or city, and an optional two-letter state.");
  const text = q.toUpperCase().replaceAll("'", "''");
  const where = `(UPPER(NAME) LIKE '%${text}%' OR UPPER(CITY) LIKE '%${text}%')${state ? ` AND STATE='${state}'` : ""}`;
  const url = new URL(NCES_SOURCE + "/query");
  url.search = new URLSearchParams({ f: "json", where, outFields: "NCESSCH,NAME,CITY,STATE,SCHOOLYEAR", returnGeometry: "false", orderByFields: "NAME,NCESSCH", resultRecordCount: "20" }).toString();
  return url;
}
export function parseSchoolResults(body: unknown): SchoolChoice[] {
  const d = body as { error?: unknown; features?: { attributes?: Record<string, unknown> }[] };
  if (!d || d.error || !Array.isArray(d.features)) throw new Error("The NCES directory did not return usable records.");
  return d.features.slice(0, 20).flatMap(f => {
    const a = f?.attributes;
    if (!a || typeof a.NCESSCH !== "string" || !/^\d{12}$/.test(a.NCESSCH) || typeof a.NAME !== "string" || !a.NAME.trim()) return [];
    const known = SCHOOLS.find(s => s.id === NCES_IDS[a.NCESSCH as string]);
    return [known || { id: `nces-${a.NCESSCH}`, name: a.NAME.slice(0, 120), city: `${String(a.CITY || "").slice(0, 60)}, ${String(a.STATE || "").slice(0, 2)}`, website: "", portal: null, districtId: null, ncesId: a.NCESSCH }];
  });
}
