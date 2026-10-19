import { districtByOrigin } from "../../../extensions/course-reader/districts.js";
// Shared validation for extension messages, local storage, and the AI endpoint.
// Every imported page is untrusted content, never an instruction to the application.
export const READER_MAX_PAGES = 8;
export const READER_LIBRARY_LIMIT = 300;
export const READER_CARD_LIMIT = 1200;
export const READER_MAX_TEXT = 6000;
export const READER_AI_TEXT_LIMIT = 32000;
export type ReaderPage = { readDepth?: "description" | "excerpt" | "pdf"; courseId?: string; pdfPage?: number; description?: string; descriptionSource?: string; services?: "turnitin"[]; id: string; url: string; title: string; text: string; capturedAt: string; warnings: string[]; links: { title: string; url: string }[] };
export type ReaderCapture = { version: 1; pages: ReaderPage[] };
export type ReaderCard = {
  id: string; sourceId: string; sourceUrl: string; sourceTitle: string; sourceTextHash: string;
  title: string; course: string; kind: "assignment" | "event" | "policy" | "insight";
  requirement: "required" | "optional" | "unclear";
  quote: string; due: string | null; dueQuote: string | null;
  status: "draft" | "accepted" | "stale";
  hiddenAt?: string | null; doneAt?: string | null; doneSourceHash?: string | null; hiddenSourceHash?: string | null; capturedAt?: string; dateOrigin?: "source" | "reviewed";
};
export type ReaderSyncReport = { id: string; status: "running" | "checked" | "partial" | "paused" | "login-required"; startedAt: string; finishedAt: string | null; courses: { id: string; title: string }[]; read: number; changed: number; checked: number; queued: number; unreadCount: number; limited: boolean; message: string; unread: { url: string; title: string; reason: string; scope: "source" | "attachment" }[] };
export type ReaderState = { version: 1; pages: ReaderPage[]; cards: ReaderCard[]; analyzedAt: string | null; dailyReport?: ReaderSyncReport; dailySourceIds?: string[]; completionMigrated?: boolean; setupFinished?: "ai" | "local"; hiddenItems?: string[] };
export const EMPTY_READER: ReaderState = { version: 1, pages: [], cards: [], analyzedAt: null };
export function safeReaderUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1200) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    if (districtByOrigin(u.origin)) {
      if (!/^\/(courses|home(?:\/assignments)?|grades\/grades|assignment\/\d+|page\/\d+|course\/\d+\/(?:materials(?:\/gp\/\d+)?|updates))\/?$/.test(u.pathname)) return null;
      const f = u.searchParams.get("f"), p = u.searchParams.get("page"); u.search = "";
      if (f && /^\d{1,20}$/.test(f)) u.searchParams.set("f", f);
      if (p && /^\d{1,2}$/.test(p) && Number(p) <= 20) u.searchParams.set("page", p);
    } else if (u.hostname === "docs.google.com") {
      const m = /^\/(document|presentation)\/d\/([a-zA-Z0-9_-]+)(?:\/.*)?$/.exec(u.pathname);
      if (!m) return null;
      u.pathname = `/${m[1]}/d/${m[2]}/edit`; u.search = "";
    } else return null;
    if (!/^#excerpt-[2-8]$/.test(u.hash) && (!districtByOrigin(u.origin) || !/^#pdf-[a-f0-9]{8}-page-\d{1,2}$/.test(u.hash))) u.hash = ""; return u.href;
  } catch { return null; }
}
function short(value: unknown, max: number): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
export function validateCapture(value: unknown, maxPages = READER_MAX_PAGES): ReaderCapture {
  const capture = value as Partial<ReaderCapture> | null;
  if (!capture || capture.version !== 1 || !Array.isArray(capture.pages) || !capture.pages.length || capture.pages.length > maxPages) throw new Error(`Choose between 1 and ${maxPages} captured course pages.`);
  const ids = new Set<string>(); const urls = new Set<string>();
  const pages = capture.pages.map((raw: unknown): ReaderPage => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid captured page.");
    const p = raw as Record<string, unknown>;
    const url = safeReaderUrl(p.url);
    const id = short(p.id, 80);
    if (!url || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id) || urls.has(url)) throw new Error("A captured page has an unsupported URL or duplicate identifier.");
    ids.add(id); urls.add(url);
    if (typeof p.text !== "string" || p.text.trim().length < 30 || p.text.length > READER_MAX_TEXT) throw new Error("Each page needs 30–6,000 characters of readable text.");
    if (typeof p.capturedAt !== "string" || !Number.isFinite(Date.parse(p.capturedAt)) || Date.parse(p.capturedAt) > Date.now() + 300000) throw new Error("A page has an invalid capture time.");
    const warnings = Array.isArray(p.warnings) ? p.warnings.filter(w => typeof w === "string").slice(0, 6).map(w => short(w, 350)) : [];
    const links = Array.isArray(p.links) ? p.links.slice(0, 30).flatMap(rawLink => {
      if (!rawLink || typeof rawLink !== "object") return [];
      const link = rawLink as Record<string, unknown>; const safe = safeReaderUrl(link.url);
      return safe ? [{ url: safe, title: short(link.title, 160) || "Open linked page" }] : [];
    }) : [];
    return { id, url, courseId: typeof p.courseId === "string" && /^\d{1,20}$/.test(p.courseId) ? p.courseId : undefined, pdfPage: Number.isInteger(p.pdfPage) && Number(p.pdfPage) >= 1 && Number(p.pdfPage) <= 20 ? Number(p.pdfPage) : undefined, readDepth: p.readDepth === "pdf" ? "pdf" : p.readDepth === "description" || /\/materials\/gp\//.test(url) ? "description" : "excerpt", description: short(p.description, 500), descriptionSource: safeReaderUrl(p.descriptionSource) || undefined, services: Array.isArray(p.services) && p.services.includes("turnitin") ? ["turnitin"] : [], title: short(p.title, 180) || "Course page", text: p.text.trim(), capturedAt: new Date(p.capturedAt).toISOString(), warnings, links };
  });
  return { version: 1, pages };
}
export function mergeReaderPages(current: ReaderState, incoming: ReaderCapture): ReaderState {
  const byUrl = new Map(current.pages.map(p => [p.url, p]));
  const changed = new Set<string>();
  for (const page of incoming.pages) {
    const previous = byUrl.get(page.url);
    if (previous && (previous.text !== page.text || (previous.readDepth || "excerpt") !== (page.readDepth || "excerpt"))) changed.add(page.url);
    byUrl.set(page.url, previous ? { ...page, id: previous.id } : page);
  }
  if (byUrl.size > READER_LIBRARY_LIMIT) throw new Error("Your reader holds 300 excerpts. Remove older manual imports before syncing more.");
  if (new Set([...byUrl.values()].map(p => p.id)).size !== byUrl.size) throw new Error("Two pages have the same identifier. Clear this capture and read the pages again.");
  return { ...current, pages: [...byUrl.values()], cards: current.cards.map(c => changed.has(c.sourceUrl) ? { ...c, status: "stale" } : c) };
}
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function quoteExists(text: string, quote: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  return normalize(quote).length >= 8 && normalize(text).includes(normalize(quote));
}
