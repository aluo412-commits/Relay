"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { encryptLocal, decryptLocal } from "../../../extensions/course-reader/vault.js";
import { studentHeaders, type StudentSession } from "@/lib/student/accountTypes";
import { useReaderConnection } from "./useReaderConnection";
import { recordAnalyzed, useReaderAutomation } from "./useReaderAutomation";
import { assertDistrictPages, validateSyncReport } from "@/lib/student/readerSync";
import { EMPTY_READER, READER_LIBRARY_LIMIT, READER_CARD_LIMIT, isDateOnly, mergeReaderPages, quoteExists, validateCapture, type ReaderCapture, type ReaderCard, type ReaderState } from "@/lib/student/reader";

const DB = "relay-course-reader-owned-v1";
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>, scope: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(`${DB}:${scope}`, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("workspace");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result; const tx = db.transaction("workspace", mode); const request = run(tx.objectStore("workspace"));
      tx.oncomplete = () => { resolve(request.result); db.close(); };
      tx.onerror = tx.onabort = () => { reject(tx.error); db.close(); };
    };
  });
}
function restore(value: unknown): ReaderState {
  if (!value || typeof value !== "object") return EMPTY_READER;
  const saved = value as ReaderState;
  if (saved.version !== 1 || !Array.isArray(saved.pages)) return EMPTY_READER;
  const capture = saved.pages.length ? validateCapture({ version: 1, pages: saved.pages }, READER_LIBRARY_LIMIT) : { version: 1, pages: [] };
  let dailyReport; try { if (saved.dailyReport) dailyReport = validateSyncReport(saved.dailyReport); } catch { /* Discard invalid report, not valid saved excerpts. */ }
  const cards = Array.isArray(saved.cards) ? saved.cards.slice(0, READER_CARD_LIMIT).flatMap((c): ReaderCard[] => {
    const page = capture.pages.find(p => p.id === c?.sourceId && p.url === c?.sourceUrl);
    if (!page || !c || typeof c.title !== "string" || c.title.length > 180 || typeof c.id !== "string" || !/^reader-[\da-f]{24}$/.test(c.id) || typeof c.quote !== "string" || c.quote.length > 1200 || !["assignment", "event", "policy", "insight"].includes(c.kind) || !["required", "optional", "unclear"].includes(c.requirement) || !["draft", "accepted", "stale"].includes(c.status)) return [];
    return [{ ...c, course: typeof c.course === "string" ? c.course.slice(0, 120) : "", sourceTitle: page.title, due: isDateOnly(c.due) ? c.due : null, dueQuote: typeof c.dueQuote === "string" ? c.dueQuote.slice(0, 800) : null, status: quoteExists(page.text, c.quote) ? c.status : "stale" }];
  }) : [];
  return { version: 1, pages: capture.pages, cards, dailyReport, dailySourceIds: Array.isArray(saved.dailySourceIds) ? saved.dailySourceIds.filter(id => capture.pages.some(p => p.id === id)) : [], analyzedAt: typeof saved.analyzedAt === "string" && Number.isFinite(Date.parse(saved.analyzedAt)) ? saved.analyzedAt : null };
}
export type ReaderAiStatus = { identity?: string | null; authenticated: boolean; email: string | null; googleEnabled: boolean; configured: boolean; provider: string; model: string; remaining: number; dailyLimit: number };
export function useCourseReader(account: StudentSession) {
  const [state, setState] = useState<ReaderState>(EMPTY_READER);
  const [ready, setReady] = useState(false);
  const [incoming, setIncoming] = useState<ReaderCapture | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [ai, setAi] = useState<ReaderAiStatus | null>(null);
  const current = useRef(state);
  const pending = useRef<ReaderCapture | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const busy = useRef(false);
  const persist = useCallback((next: ReaderState) => {
    current.current = next; setState(next);
    const write = writes.current.then(async () => { if (next.pages.length || next.dailyReport) { const encrypted = await encryptLocal(next, account.dataKey, account.scope); await withStore("readwrite", store => store.put(encrypted, "current"), account.scope); } else await withStore("readwrite", store => store.delete("current"), account.scope); return true; }).catch(() => { if (mounted.current) setError("This browser could not save the reader. Keep this page open; changes may be lost on reload."); return false; });
    writes.current = write; return write;
  }, []);
  const refreshAi = useCallback(async () => {
    try { const res = await fetch("/api/student/analyze", { cache: "no-store", headers: studentHeaders(account) }); const value = await res.json(); if (!res.ok) throw new Error(value.error); if (mounted.current) setAi(value); return value as ReaderAiStatus; }
    catch { if (mounted.current) setAi(null); return null; }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    withStore("readonly", store => store.get("current"), account.scope).then(async value => { const plain = value ? await decryptLocal(value, account.dataKey, account.scope) : null; if (!stopped) { const restored = restore(plain); assertDistrictPages(restored.pages, account.district.schoology); current.current = restored; setState(restored); } }).catch(() => { if (!stopped) setError("Saved course pages could not be opened. You can re-import from the reader."); }).finally(() => { if (!stopped) { setReady(true); document.documentElement.dataset.relayReaderReady = "1"; document.documentElement.dataset.relayReaderAccount = JSON.stringify({ scope: account.scope, binding: account.binding, districtId: account.district.id }); } });
    void refreshAi();
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== "relay.reader.capture" || event.data.binding !== account.binding || event.data.scope !== account.scope || typeof event.data.id !== "string" || event.data.id.length > 100 || pending.current) return;
      try {
        const capture = validateCapture(event.data.payload);
        assertDistrictPages(capture.pages, account.district.schoology);
        pending.current = capture; setIncoming(capture); setError("");
        window.postMessage({ type: "relay.reader.received", id: event.data.id }, location.origin);
      } catch { setError("The reader sent an unsupported capture. No data was imported."); }
    };
    window.addEventListener("message", receive);
    return () => { stopped = true; mounted.current = false; delete document.documentElement.dataset.relayReaderReady; delete document.documentElement.dataset.relayReaderAccount; window.removeEventListener("message", receive); request.current?.abort(); generation.current++; };
  }, [refreshAi]);
  function dismissIncoming() { pending.current = null; setIncoming(null); }
  function acceptIncoming(ids: string[]) {
    if (!ready || !pending.current || busy.current) return;
    try {
      const selected = validateCapture({ version: 1, pages: pending.current.pages.filter(p => ids.includes(p.id)) });
      persist(mergeReaderPages(current.current, selected)); dismissIncoming(); setError("");
      setMessage("Imported on this browser. No text was sent to AI. Changed pages require a new review before their old cards return to the board.");
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed."); }
  }
  function cancelAnalysis() { request.current?.abort(); generation.current++; busy.current = false; setAnalyzing(false); }
  function removePage(id: string) {
    cancelAnalysis();
    persist({ ...current.current, pages: current.current.pages.filter(p => p.id !== id), cards: current.current.cards.filter(c => c.sourceId !== id) });
  }
  function clear() { automation.disableAutomation(); cancelAnalysis(); persist(EMPTY_READER); dismissIncoming(); setMessage("Course pages and extracted cards cleared from this browser. Clear captured pages in the extension separately."); }
  function updateCard(id: string, changes: Pick<ReaderCard, "title" | "due" | "requirement" | "status">) {
    if (!changes.title.trim() || (changes.due && !isDateOnly(changes.due))) return;
    persist({ ...current.current, cards: current.current.cards.map(c => c.id === id && c.status !== "stale" ? { ...c, ...changes, title: changes.title.trim().slice(0, 180) } : c) });
  }
  function discardCard(id: string) { persist({ ...current.current, cards: current.current.cards.filter(c => c.id !== id) }); }
  async function analyze(ids: string[], consent: boolean) {
    if (!consent || !ready || busy.current) return;
    let capture: ReaderCapture;
    try { capture = validateCapture({ version: 1, pages: current.current.pages.filter(p => ids.includes(p.id)).map(p => ({ ...p, links: [], warnings: [] })) }); } catch (e) { setError((e as Error).message); return; }
    busy.current = true; setAnalyzing(true); setError(""); setMessage("");
    const turn = ++generation.current; const abort = new AbortController(); request.current = abort;
    try {
      const res = await fetch("/api/student/analyze", { method: "POST", headers: { "Content-Type": "application/json", ...studentHeaders(account) }, body: JSON.stringify({ capture, consent: true, expectedAiIdentity: ai?.identity || undefined }), signal: abort.signal });
      const body = await res.json(); if (!res.ok) throw new Error(body.error || "Analysis failed.");
      if (turn !== generation.current || !mounted.current) return;
      const kept = current.current.cards.filter(c => !ids.includes(c.sourceId) || c.status === "accepted");
      const cards: ReaderCard[] = Array.isArray(body.cards) ? body.cards : [];
      const known = new Set(kept.map(c => c.id));
      const additions = cards.filter(c => !known.has(c.id));
      if (kept.length + additions.length > READER_CARD_LIMIT) throw new Error("The reader holds up to 1,200 cards. Remove older cards before adding another analysis.");
      const next = restore({ ...current.current, cards: [...kept, ...additions], analyzedAt: body.analyzedAt });
      persist(next);
      try { await recordAnalyzed(capture.pages, account.scope); } catch { setError("Cards returned, but analysis history could not be saved in this browser."); }
      setMessage((cards.length ? `${cards.length} evidence-linked draft${cards.length === 1 ? "" : "s"} returned. Review each card before adding it to your board.` : "No supported tasks or rules were found. Try the assignment itself or a text document; linked PDFs were not read.") + (body.rejected ? ` ${body.rejected} unsupported draft(s) were discarded.` : ""));
      return true;
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Analysis failed."); }
    finally { if (turn === generation.current) { busy.current = false; setAnalyzing(false); } void refreshAi(); }
  }
  async function readSaved() {
    const saved = await writes.current;
    if (saved === false) return current.current;
    const encrypted = await withStore("readonly", store => store.get("current"), account.scope);
    return restore(encrypted ? await decryptLocal(encrypted, account.dataKey, account.scope) : null);
  }
  const automation = useReaderAutomation({ account, current, ready, ai, analyzing, analyze, persist, readSaved, refreshAi, onError: setError });
  const connection = useReaderConnection(account, ready);
  return { connection, account, state, ready, incoming, error, message, analyzing, ai, automation, acceptIncoming, dismissIncoming, removePage, clear, analyze, cancelAnalysis, updateCard, discardCard, refreshAi };
}
export type CourseReaderController = ReturnType<typeof useCourseReader>;
