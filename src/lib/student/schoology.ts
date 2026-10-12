import { createHash } from "node:crypto";
import { limitedText } from "./security";
import { districtById } from "../../../extensions/course-reader/districts.js";
import { SCHOOL_TIMEZONE, type StudyItem } from "./types";

function hosts(districtId: string) { const d = districtById(districtId); if (!d) throw new Error("Unsupported district."); return new Set([new URL(d.schoology).hostname, "app.schoology.com", "api.schoology.com"]); }
export function validateCalendarUrl(input: string, districtId = "fuhsd"): URL {
  let url: URL;
  try { url = new URL(input.trim().replace(/^webcal:\/\//i, "https://")); } catch { throw new Error("Paste a complete Schoology calendar subscription URL."); }
  if (url.protocol !== "https:" || !hosts(districtId).has(url.hostname) || url.port || url.username || url.password || input.length > 1500) {
    throw new Error("Use an HTTPS calendar link for your selected district, app.schoology.com, or api.schoology.com. Other district hosts are not accepted.");
  }
  url.hash = "";
  return url;
}
function unescapeText(text: string): string {
  return text.replace(/\\([nN,;\\])/g, (_, c: string) => c.toLowerCase() === "n" ? "\n" : c).replace(/<[^>]*>/g, "").slice(0, 6000);
}
function calendarDate(raw: string, params: string, fallbackZone: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(raw);
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  const wall = `${day}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}`;
  const utc = new Date(`${wall}Z`);
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 19) !== wall) return null;
  if (!m[4]) return day;
  if (m[7]) return utc.toISOString();
  const zone = /TZID="?([^;:"]+)/.exec(params)?.[1] ?? fallbackZone;
  try {
    // Interpret a floating/TZID wall clock in the source's zone, not the server zone.
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    let candidate = utc.getTime();
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(format.formatToParts(candidate).map(x => [x.type, x.value]));
      const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
      const adjustment = utc.getTime() - local;
      candidate += adjustment;
      if (!adjustment) return new Date(candidate).toISOString();
    }
  } catch { /* Unknown timezone: don't manufacture a deadline. */ }
  return null;
}
export function parseSchoologyCalendar(text: string, districtId = "fuhsd"): { items: StudyItem[]; warnings: string[] } {
  if (!text.trimStart().startsWith("BEGIN:VCALENDAR") || !text.includes("END:VCALENDAR")) throw new Error("This link returned a login page or an invalid calendar. Use Schoology’s calendar export/subscription link, not the address of the calendar page.");
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const zone = /^X-WR-TIMEZONE:(.+)$/m.exec(unfolded)?.[1].trim() ?? SCHOOL_TIMEZONE;
  const records = new Map<string, StudyItem | null>();
  const warnings = new Set<string>();
  const blocks = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g)];
  if (blocks.length > 3000) throw new Error("This calendar has too many entries. Please use a smaller calendar feed.");
  for (const block of blocks) {
    const fields = new Map<string, { value: string; params: string }>();
    let nested = 0;
    for (const line of block[1].split(/\r?\n/)) {
      if (line.startsWith("BEGIN:")) { nested++; continue; }
      if (line.startsWith("END:")) { nested = Math.max(0, nested - 1); continue; }
      if (nested) continue; // VALARM descriptions are not assignment descriptions.
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const [name, ...params] = line.slice(0, colon).split(";");
      fields.set(name.toUpperCase(), { value: line.slice(colon + 1), params: params.join(";") });
    }
    const get = (name: string) => fields.get(name)?.value ?? "";
    const uid = get("UID") || `${get("SUMMARY")}:${get("DTSTART")}`;
    const id = `schoology:${createHash("sha256").update(uid + get("RECURRENCE-ID")).digest("hex").slice(0, 24)}`;
    if (get("STATUS") === "CANCELLED") { records.set(id, null); continue; }
    const title = unescapeText(get("SUMMARY"));
    if (!title) continue;
    const start = fields.get("DUE") ?? fields.get("DTSTART");
    const date = start ? calendarDate(start.value, start.params, zone) : null;
    if (!date) warnings.add("Some dates could not be read. Check their original Schoology entries.");
    if (get("RRULE")) warnings.add("Recurring entries show their first occurrence only; check Schoology for the full series.");
    let url = districtById(districtId)!.schoology + "/calendar";
    try {
      const source = new URL(get("URL"));
      if (source.protocol === "https:" && hosts(districtId).has(source.hostname) && !source.username && !source.password) url = source.href;
    } catch { /* Safe source fallback. */ }
    const category = unescapeText(get("CATEGORIES"));
    const assignment = /\/(assignment|assessment)\//i.test(url) || /\b(assignment|assessment|homework)\b/i.test(category);
    records.set(id, { id, source: "schoology", kind: assignment ? "assignment" : "event", title, description: unescapeText(get("DESCRIPTION")), date, allDay: !!date && date.length === 10, url, course: category || undefined });
  }
  return { items: [...records.values()].filter((x): x is StudyItem => !!x), warnings: [...warnings] };
}
export async function readSchoology(urlString: string, districtId = "fuhsd") {
  const url = validateCalendarUrl(urlString, districtId);
  const res = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(12000), headers: { Accept: "text/calendar" } });
  if (!res.ok) throw new Error(res.status >= 300 && res.status < 400 ? "Schoology redirected this link. Copy the direct calendar subscription URL; Relay will not follow login redirects." : "Schoology could not be reached. Check that calendar export is enabled and the link is current.");
  return parseSchoologyCalendar(await limitedText(res, 1_500_000), districtId);
}
