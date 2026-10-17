"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import type { StudentSession } from "@/lib/student/accountTypes";
export type ReaderConnection = { detected: boolean; checking: boolean; version?: string; paired?: boolean; enabled?: boolean; websiteReady?: boolean; status?: string | null; read?: number; message?: string };
export function useReaderConnection(account: StudentSession, ready: boolean) {
  const [status, setStatus] = useState<ReaderConnection>({ detected: false, checking: true });
  const request = useRef<() => void>(() => {});
  useEffect(() => {
    if (!ready) return;
    let pending = "", timeout: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (document.hidden || pending) return;
      pending = crypto.randomUUID();
      window.postMessage({ type: "relay.reader.status.request", id: pending, binding: account.binding }, location.origin);
      timeout = setTimeout(() => { pending = ""; setStatus({ detected: false, checking: false }); }, 6000);
    };
    const receive = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== location.origin || e.data?.type !== "relay.reader.status.response" || !pending || e.data.id !== pending || e.data.binding !== account.binding) return;
      clearTimeout(timeout); pending = "";
      const r = e.data.result;
      if (!r || typeof r.ok !== "boolean") return;
      setStatus({ detected: true, checking: false, version: typeof r.version === "string" ? r.version.slice(0, 20) : undefined, paired: r.ok && r.paired === true, enabled: r.ok && r.enabled === true, websiteReady: r.ok && r.websiteReady === true, status: typeof r.status === "string" ? r.status.slice(0, 40) : null, read: Number.isSafeInteger(r.read) ? Math.max(0, r.read) : 0, message: typeof (r.error || r.message) === "string" ? (r.error || r.message).slice(0, 500) : "" });
    };
    request.current = check;
    window.addEventListener("message", receive); window.addEventListener("focus", check);
    const timer = setInterval(check, 8000); check();
    return () => { clearInterval(timer); clearTimeout(timeout); request.current = () => {}; window.removeEventListener("message", receive); window.removeEventListener("focus", check); };
  }, [account.binding, ready]);
  return { ...status, check: useCallback(() => request.current(), []) };
}
