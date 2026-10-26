"use client";
import { useEffect, useRef, useState } from "react";
import { encryptLocal, decryptLocal } from "../../../extensions/course-reader/vault.js";
import type { StudentSession } from "@/lib/student/accountTypes";
import type { ReaderPage } from "@/lib/student/reader";
import { isLynbrookWorkspace, mergeSchoolPages, SCHOOL_PAGE_LIMIT, validateSchoolCapture, type SchoolCapture } from "@/lib/student/schoolReader";

// Separate database: older course-reader tabs cannot overwrite campus snapshots.
async function store<T>(scope: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(`relay-school-reader-v1:${scope}`, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("snapshots");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("snapshots", mode), req = action(tx.objectStore("snapshots"));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
export function useSchoolReader(account: StudentSession) {
  const supported = isLynbrookWorkspace(account);
  const [pages, setPages] = useState<ReaderPage[]>([]), [incoming, setIncoming] = useState<SchoolCapture | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<SchoolCapture | null>(null), generation = useRef(0), writing = useRef(false);
  async function load() {
    const encrypted = await store(account.scope, "readonly", s => s.get("current"));
    if (!encrypted) return [];
    const value = await decryptLocal(encrypted, account.dataKey, `school:${account.scope}`);
    if (value?.version === 1 && value?.kind === "school" && Array.isArray(value.pages) && value.pages.length === 0) return [];
    return validateSchoolCapture(value, SCHOOL_PAGE_LIMIT).pages;
  }
  useEffect(() => {
    const turn = ++generation.current;
    setPages([]); setIncoming(null); pending.current = null; setReady(false); setError(""); setBusy(false);
    if (!supported) return;
    let stopped = false;
    void load().then(p => {
      if (stopped) return;
      setPages(p); setReady(true); document.documentElement.dataset.relaySchoolReaderReady = "1";
    }).catch(() => { if (!stopped) setError("School snapshots could not be opened. No saved text was replaced."); });
    const receive = (e: MessageEvent) => {
      if (stopped || e.source !== window || e.origin !== location.origin || e.data?.type !== "relay.school.capture" || e.data.scope !== account.scope || e.data.binding !== account.binding || typeof e.data.id !== "string" || e.data.id.length > 100 || pending.current) return;
      try {
        const capture = validateSchoolCapture(e.data.payload);
        pending.current = capture; setIncoming(capture); setError("");
        window.postMessage({ type: "relay.school.received", id: e.data.id }, location.origin);
      } catch { setError("Invalid school snapshot. Nothing was imported."); }
    };
    window.addEventListener("message", receive);
    return () => { stopped = true; if (generation.current === turn) generation.current++; delete document.documentElement.dataset.relaySchoolReaderReady; window.removeEventListener("message", receive); pending.current = null; };
  }, [account.binding, supported]);
  function dismiss() { pending.current = null; setIncoming(null); }
  async function update(change: (old: ReaderPage[]) => ReaderPage[]) {
    if (!ready || !supported || writing.current) return false;
    writing.current = true; setBusy(true); setError(""); const turn = generation.current;
    try {
      if (!navigator.locks) throw new Error("Use desktop Chrome with local storage enabled.");
      await navigator.locks.request(`relay-school:${account.scope}`, async () => {
        if (turn !== generation.current) throw new Error("School or account changed; import canceled.");
        const next = change(await load());
        const encrypted = await encryptLocal({ version: 1, kind: "school", pages: next }, account.dataKey, `school:${account.scope}`);
        if (turn !== generation.current) throw new Error("School or account changed; import canceled.");
        await store(account.scope, "readwrite", s => s.put(encrypted, "current"));
        if (turn === generation.current) setPages(next);
      });
      return turn === generation.current;
    } catch (e) { if (turn === generation.current) setError(e instanceof Error ? e.message : "School snapshots could not be saved."); return false; }
    finally { writing.current = false; if (turn === generation.current) setBusy(false); }
  }
  async function accept(ids: string[]) {
    const capture = pending.current;
    if (capture && await update(old => mergeSchoolPages(old, { ...capture, pages: capture.pages.filter(p => ids.includes(p.id)) }))) { dismiss(); return true; }
    return false;
  }
  function remove(id: string) { return update(old => old.filter(p => p.id !== id)); }
  return { supported, pages, incoming, ready, busy, error, accept, dismiss, remove };
}
export type SchoolReaderController = ReturnType<typeof useSchoolReader>;
