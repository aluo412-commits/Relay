"use client";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { StudentSession } from "@/lib/student/accountTypes";
import { assertDistrictPages } from "@/lib/student/readerSync";
import type { ReaderState } from "@/lib/student/reader";
import { shouldAutoAnalyze } from "@/lib/student/readerPolicy";
import { autoBatch, excerptFingerprint, mergeDailySnapshot } from "@/lib/student/readerSync";
import type { ReaderAiStatus } from "./useCourseReader";
const PREF = "relay-reader-automation-v1", LOG = "relay-reader-analysis-attempts-v1", VERSIONS = "relay-reader-analyzed-versions-v1";
const AUTO_LIMIT = 8;
type Pref = { imports: boolean; aiKey: string };
type Log = { day: string; attempts: number; completed: string[]; attempted: string[] };
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function readLog(scope: string): Log {
  try { const x = JSON.parse(localStorage.getItem(`${LOG}:${scope}`) || "{}"); x.completed = JSON.parse(localStorage.getItem(`${VERSIONS}:${scope}`) || "[]"); return { day: day(), attempts: x.day === day() && Number.isInteger(x.attempts) ? Math.max(0, x.attempts) : 0, completed: Array.isArray(x.completed) ? x.completed.filter((v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)).slice(-3000) : [], attempted: x.day === day() && Array.isArray(x.attempted) ? x.attempted.slice(-300) : [] }; } catch { return { day: day(), attempts: 0, completed: [], attempted: [] }; }
}
export async function recordAnalyzed(pages: { url: string; text: string }[], scope: string) {
  const hashes = await Promise.all(pages.map(p => excerptFingerprint(p.url, p.text)));
  const log = readLog(scope); log.completed = [...new Set([...log.completed, ...hashes])].slice(-3000);
  localStorage.setItem(`${VERSIONS}:${scope}`, JSON.stringify(log.completed));
}
export function useReaderAutomation({ account, current, ready, ai, analyzing, analyze, persist, readSaved, refreshAi, onError }: {
  account: StudentSession; current: MutableRefObject<ReaderState>; ready: boolean; ai: ReaderAiStatus | null; analyzing: boolean;
  analyze: (ids: string[], consent: boolean) => Promise<boolean | undefined>; persist: (next: ReaderState) => Promise<boolean>; readSaved: () => Promise<ReaderState>; refreshAi: () => Promise<ReaderAiStatus | null>; onError: (message: string) => void;
}) {
  const PREF = `relay-reader-automation-v1:${account.scope}`, LOG = `relay-reader-analysis-attempts-v1:${account.scope}`, VERSIONS = `relay-reader-analyzed-versions-v1:${account.scope}`;
  const [preferences, setPreferences] = useState<Pref>({ imports: false, aiKey: "" });
  const identity = ai?.authenticated && ai.configured && typeof ai.identity === "string" && /^[a-f0-9]{64}$/.test(ai.identity) ? ai.identity : "";
  const [pending, setPending] = useState(0);
  const [autoMessage, setAutoMessage] = useState("");
  const latest = useRef({ current, ready, ai, analyzing, analyze, persist, readSaved, refreshAi, onError }); latest.current = { current, ready, ai, analyzing, analyze, persist, readSaved, refreshAi, onError };
  const pref = useRef(preferences), key = useRef(identity); key.current = identity;
  const handling = useRef(false);
  useEffect(() => {
    const load = () => {
      try { const saved = JSON.parse(localStorage.getItem(PREF) || "{}"); pref.current = { imports: saved.imports === true, aiKey: typeof saved.aiKey === "string" ? saved.aiKey : "" }; setPreferences(pref.current); } catch { pref.current = { imports: false, aiKey: "" }; setPreferences(pref.current); }
      if (!pref.current.imports) delete document.documentElement.dataset.relayDailyReaderReady;
      delete document.documentElement.dataset.relayDailyRevision;
    };
    load();
    const storage = (e: StorageEvent) => { if (e.key === PREF || e.key === null) load(); };
    window.addEventListener("storage", storage); return () => window.removeEventListener("storage", storage);
  }, []);
  useEffect(() => {
    if (ready && preferences.imports) document.documentElement.dataset.relayDailyReaderReady = "1";
    else delete document.documentElement.dataset.relayDailyReaderReady;
    return () => { delete document.documentElement.dataset.relayDailyReaderReady; };
  }, [ready, preferences.imports]);
  function update(next: Pref) {
    try { localStorage.setItem(PREF, JSON.stringify(next)); pref.current = next; setPreferences(next); if (!next.imports) delete document.documentElement.dataset.relayDailyReaderReady; delete document.documentElement.dataset.relayDailyRevision; }
    catch { latest.current.onError("This browser could not save automation preferences. Automation was not enabled."); }
  }
  useEffect(() => {
    let alive = true;
    const receive = async (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== "relay.reader.daily" || event.data.scope !== account.scope || event.data.binding !== account.binding || typeof event.data.id !== "string" || event.data.id.length > 100 || !pref.current.imports || !latest.current.ready || latest.current.analyzing || handling.current) return;
      handling.current = true;
      try {
        const base = await latest.current.readSaved();
        if (!alive || !pref.current.imports || latest.current.analyzing) return;
        const next = mergeDailySnapshot(base, event.data.capture, event.data.report);
        assertDistrictPages(next.pages, account.district.schoology);
        if (await latest.current.persist(next) && alive && pref.current.imports) window.postMessage({ type: "relay.reader.synced", id: event.data.id }, location.origin);
      } catch { latest.current.onError("A daily snapshot could not be imported. No automatic AI analysis was started for that update."); }
      finally { handling.current = false; }
    };
    window.addEventListener("message", receive);
    let running = false, retryStatusAt = 0;
    const work = async () => {
      const p = pref.current, s = latest.current;
      if (running || !s.ready || s.analyzing || handling.current || !p.imports || !key.current || p.aiKey !== key.current || !s.ai?.authenticated || !s.ai.configured || document.hidden || !navigator.onLine || s.current.current.dailyReport?.status === "running") return;
      if (!navigator.locks) { setAutoMessage("This browser does not support safe automatic analysis. Use Analyze manually."); return; }
      running = true;
      try {
        await navigator.locks.request(`relay-reader-auto-ai:${account.scope}`,  { ifAvailable: true }, async lock => {
          if (!lock || !alive) return;
          const unread = new Set(s.current.current.dailyReport?.unread.filter(x => x.scope === "source").map(x => x.url) || []);
          const pages = s.current.current.pages.filter(page => !unread.has(page.url) && shouldAutoAnalyze(page));
          const staleIds = new Set(s.current.current.cards.filter(c => c.status === "stale").map(c => c.sourceId));
          const pairs = await Promise.all(pages.map(async page => [page.id, await excerptFingerprint(page.url, page.text)] as const));
          if (!alive || !key.current || !latest.current.ai?.authenticated || latest.current.analyzing || pref.current.aiKey !== key.current || !pref.current.imports) return;
          const fingerprints = new Map(pairs), log = readLog(account.scope);
          const staleHashes = new Set(pages.filter(page => staleIds.has(page.id)).map(page => fingerprints.get(page.id)!));
          const completed = new Set(log.completed.filter(hash => !staleHashes.has(hash)));
          const remaining = pages.filter(page => !completed.has(fingerprints.get(page.id)!));
          setPending(remaining.length);
          if (!remaining.length) { setAutoMessage("Important readable instructions are up to date. Background resources stay description-only; ambiguous or unread sources are not assumed complete."); return; }
          if (log.attempts >= AUTO_LIMIT) { setAutoMessage(`${remaining.length} excerpts waiting. Automatic limit: 8 requests per Pacific day, within your shared 12-request quota. Continues on a later day when Relay is open.`); return; }
          if (Date.now() < retryStatusAt) return;
          const fresh = await latest.current.refreshAi();
          if (!alive || !fresh?.authenticated || fresh.identity !== pref.current.aiKey || !pref.current.imports || latest.current.analyzing || handling.current) return;
          if (!fresh.remaining) { retryStatusAt = Date.now() + 60000; setAutoMessage("Shared AI quota used. Excerpts remain local; availability is rechecked while this dashboard is open."); return; }
          const batch = autoBatch(pages, new Set([...completed, ...log.attempted]), fingerprints);
          if (!batch.length) { setAutoMessage("Some excerpts are deferred after an attempt today. They can retry tomorrow, or you can review the source and try manually."); return; }
          log.attempts++; log.attempted.push(...batch.map(page => fingerprints.get(page.id)!));
          // Reserve in local storage while holding a cross-tab lock; failed
          // attempts are not retried in a tight loop or billed repeatedly today.
          localStorage.setItem(LOG, JSON.stringify({ day: log.day, attempts: log.attempts, attempted: log.attempted }));
          setAutoMessage(`Automatically analyzing ${batch.length} important new or changed sources · ${log.attempts}/${AUTO_LIMIT} automatic requests today.`);
          await latest.current.analyze(batch.map(page => page.id), true);
        });
      } catch { if (alive) setAutoMessage("Automatic analysis paused after a local error. Your imported sources remain available."); }
      finally { running = false; }
    };
    const timer = window.setInterval(() => void work(), 10000);
    const focus = () => void work(); window.addEventListener("focus", focus);
    return () => { alive = false; window.removeEventListener("message", receive); window.removeEventListener("focus", focus); clearInterval(timer); };
  }, []);
  return { autoImports: preferences.imports, autoAi: !!identity && preferences.aiKey === identity, canAutoAi: !!identity, autoMessage, pending, setAutoImports: (on: boolean) => update({ imports: on, aiKey: on ? pref.current.aiKey : "" }), setAutoAi: (on: boolean) => update({ ...pref.current, aiKey: on ? key.current : "" }), disableAutomation: () => { update({ imports: false, aiKey: "" }); try { const log = readLog(account.scope); localStorage.removeItem(VERSIONS); localStorage.setItem(LOG, JSON.stringify({ day: log.day, attempts: log.attempts, attempted: [] })); } catch { /* The visible storage error covers non-persistent private profiles. */ } } };
}
