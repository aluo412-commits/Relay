import type { ReaderPage } from "./reader";
export const SCHOOL_PAGE_LIMIT = 20;
export type SchoolCapture = { version: 1; kind: "school"; pages: ReaderPage[] };
export function schoolPageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1200) return null;
  try {
    const u = new URL(value);
    if (u.origin !== "https://lhs.fuhsd.org" || u.username || u.password || u.port || u.search) return null;
    if (/(?:^|\/)(?:login|logout|signin|signout|admin|portal|private|account|authenticate|cfp|fs)(?:\/|$)|\.(?:pdf|ics|xml|json|js|css|jpg|png|zip)$/i.test(decodeURIComponent(u.pathname))) return null;
    u.hash = ""; return u.href;
  } catch { return null; }
}
export function isLynbrookWorkspace(account: { district: { id: string }; school?: { id?: string; website?: string } | null }): boolean {
  return account.district.id === "fuhsd" && account.school?.id === "lynbrook-high" && account.school.website === "https://lhs.fuhsd.org";
}
export function validateSchoolCapture(value: unknown, max = 8): SchoolCapture {
  const v = value as Partial<SchoolCapture> | null;
  if (!v || v.version !== 1 || v.kind !== "school" || !Array.isArray(v.pages) || !v.pages.length || v.pages.length > max) throw new Error("Choose 1–8 Lynbrook website snapshots, separately from course imports.");
  const ids = new Set<string>(), urls = new Set<string>();
  const short = (v: unknown, n: number) => typeof v === "string" ? v.trim().slice(0, n) : "";
  return { version: 1, kind: "school", pages: v.pages.map(raw => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid school snapshot.");
    const p = raw as ReaderPage, url = schoolPageUrl(p.url), id = short(p.id, 80);
    if (!url || !/^school-[a-f0-9]{24}$/.test(id) || ids.has(id) || urls.has(url)) throw new Error("Unsupported or duplicate school snapshot.");
    ids.add(id); urls.add(url);
    if (typeof p.text !== "string" || p.text.trim().length < 30 || p.text.length > 6000) throw new Error("School snapshots require 30–6,000 characters.");
    if (typeof p.capturedAt !== "string" || !Number.isFinite(Date.parse(p.capturedAt)) || Date.parse(p.capturedAt) > Date.now() + 300000) throw new Error("Invalid school capture time.");
    return { id, url, title: short(p.title, 180) || "Lynbrook public page", text: p.text.trim(), capturedAt: new Date(p.capturedAt).toISOString(),
      warnings: Array.isArray(p.warnings) ? p.warnings.filter(w => typeof w === "string").slice(0, 6).map(w => short(w, 350)) : [],
      links: Array.isArray(p.links) ? p.links.slice(0, 30).flatMap(l => { const safe = schoolPageUrl(l?.url); return safe ? [{ url: safe, title: short(l.title, 160) || "Open linked page" }] : []; }) : [] };
  }) };
}
export function mergeSchoolPages(current: ReaderPage[], incoming: SchoolCapture): ReaderPage[] {
  const byUrl = new Map(current.map(p => [p.url, p]));
  for (const page of validateSchoolCapture(incoming).pages) {
    const previous = byUrl.get(page.url);
    if (previous && Date.parse(previous.capturedAt) > Date.parse(page.capturedAt)) continue;
    byUrl.set(page.url, previous ? { ...page, id: previous.id } : page);
  }
  if (byUrl.size > SCHOOL_PAGE_LIMIT) throw new Error("School snapshots are limited to 20 pages. Remove an old snapshot before importing another.");
  return validateSchoolCapture({ version: 1, kind: "school", pages: [...byUrl.values()] }, SCHOOL_PAGE_LIMIT).pages;
}
