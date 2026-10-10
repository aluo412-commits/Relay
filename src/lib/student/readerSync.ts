import { READER_LIBRARY_LIMIT, mergeReaderPages, safeReaderUrl, validateCapture, type ReaderState, type ReaderSyncReport } from "./reader";

export function validateSyncReport(raw: unknown): ReaderSyncReport {
  if (!raw || typeof raw !== "object") throw new Error("Missing sync report.");
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, n: number) => typeof v === "string" ? v.slice(0, n) : "";
  const count = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, 100000) : 0;
  const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) && Date.parse(v) <= Date.now() + 300000 ? new Date(v).toISOString() : null;
  const startedAt = date(r.startedAt);
  if (!startedAt || typeof r.id !== "string" || r.id.length > 100 || !["running", "checked", "partial", "paused", "login-required"].includes(String(r.status))) throw new Error("Invalid sync report.");
  return { id: r.id, status: r.status as ReaderSyncReport["status"], startedAt, finishedAt: date(r.finishedAt), courses: Array.isArray(r.courses) ? r.courses.slice(0, 40).flatMap(c => c && /^\d{1,20}$/.test(c.id) ? [{ id: String(c.id), title: text(c.title, 180) }] : []) : [], read: count(r.read), changed: count(r.changed), checked: count(r.checked), queued: count(r.queued), unreadCount: count(r.unreadCount), limited: r.limited === true, message: text(r.message, 500), unread: Array.isArray(r.unread) ? r.unread.slice(0, 240).flatMap(x => { const url = safeReaderUrl(x?.url); return url ? [{ url, title: text(x.title, 180), reason: text(x.reason, 350), scope: x.scope === "attachment" ? "attachment" as const : "source" as const }] : []; }) : [] };
}
export function mergeDailySnapshot(current: ReaderState, rawCapture: unknown, rawReport: unknown): ReaderState {
  const report = validateSyncReport(rawReport);
  const previousReport = current.dailyReport;
  if (previousReport && (Date.parse(report.startedAt) < Date.parse(previousReport.startedAt) || (report.id === previousReport.id && (report.checked < previousReport.checked || (!!previousReport.finishedAt && report.status === "running"))))) return current;
  const raw = rawCapture as { version?: unknown; pages?: unknown[] } | null;
  const capture = raw?.version === 1 && Array.isArray(raw.pages) && !raw.pages.length ? { version: 1 as const, pages: [] } : validateCapture(raw, READER_LIBRARY_LIMIT);
  capture.pages = capture.pages.map(p => {
    const newer = current.pages.find(old => old.url === p.url && Date.parse(old.capturedAt) > Date.parse(p.capturedAt));
    return newer || p;
  });
  const prior = new Set(current.dailySourceIds || []), nextUrls = new Set(capture.pages.map(p => p.url));
  const retained = current.pages.filter(p => !prior.has(p.id) || nextUrls.has(p.url));
  const base = { ...current, pages: retained, cards: current.cards.filter(c => retained.some(p => p.id === c.sourceId)) };
  const next = mergeReaderPages(base, capture);
  const unread = new Set(report.unread.filter(x => x.scope === "source").map(x => x.url));
  return { ...next, dailyReport: report, dailySourceIds: next.pages.filter(p => capture.pages.some(x => x.url === p.url)).map(p => p.id), cards: next.cards.map(c => unread.has(c.sourceUrl) ? { ...c, status: "stale" } : c) };
}
export async function excerptFingerprint(url: string, text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url + "\n" + text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export function autoBatch<T extends { id: string; url: string; text: string }>(pages: T[], completed: Set<string>, fingerprints: Map<string, string>): T[] {
  // Assignments and individual pages before folders/grade tables. No model calls
  // for unchanged successful versions. At most five 6k excerpts fit a request.
  const rank = (p: T) => /\/assignment\//.test(p.url) ? 0 : /\/page\/|docs.google.com/.test(p.url) ? 1 : /\/updates/.test(p.url) ? 2 : 3;
  return pages.filter(p => !completed.has(fingerprints.get(p.id) || "")).sort((a, b) => rank(a) - rank(b)).slice(0, 5);
}
