"use client";

import { useEffect, useState, type CSSProperties } from "react";

const CHAPTERS = [
  { title: "Click the message bar", text: "Click the highlighted input. Watch the sample request type itself, then click Send.", target: ".workspace .composer" },
  { title: "Review, edit, then publish", text: "This is Relay’s real task editor. Check the owner, tomorrow’s due date and the two criteria. Click Publish to continue.", target: ".artifact-window.draft" },
  { title: "Report partial progress", text: "Click the Log input to type the sample evidence. Then click the send arrow. The encoder check is still missing.", target: ".workspace .composer" },
  { title: "The board updated—not to Done", text: "Your log changed the task to In progress and added a work record. Now inspect the scripted evidence review.", target: ".log-stream" },
  { title: "Evidence, not a guess", text: "One criterion is confirmed; one is missing. Relay keeps the task open and asks a specific follow-up. This evaluation is prerecorded, not a live AI call.", target: ".sync-panel" },
  { title: "Inspect the result yourself", text: "Click the controller task to inspect its status, evidence and deadline. Autonomous testing remains blocked. No production data has changed.", target: ".kanban" },
];

type Rect = { top: number; left: number; right: number; bottom: number };
export default function ScriptedDemoGuide({ step, typing, onEvaluate, onBoard, onExplore }: {
  step: number; typing: boolean; onEvaluate: () => Promise<void>; onBoard: () => void; onExplore: () => void;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [minimized, setMinimized] = useState(false);
  const chapter = CHAPTERS[step];
  useEffect(() => {
    if (!chapter || minimized) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMinimized(true); return; }
      if (event.key !== "Tab") return;
      const target = step === 5 ? document.querySelector(".modal") ?? document.querySelector(chapter.target) : document.querySelector(chapter.target);
      const guide = document.querySelector(".tour-guide");
      const focusable = [target, guide].flatMap(root => root ? Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]')) : []).filter(el => el.getClientRects().length > 0);
      if (!focusable.length) return;
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chapter, minimized, step]);
  useEffect(() => {
    if (!chapter || minimized) { setRect(null); return; }
    let frame = 0;
    let lastTarget: Element | null = null;
    const measure = () => {
      // A task detail opened from the board becomes the new interaction target.
      const el = step === 5 ? document.querySelector(".modal") ?? document.querySelector(chapter.target) : document.querySelector(chapter.target);
      if (el && el !== lastTarget) {
        lastTarget = el;
        el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      }
      if (el) {
        // The chat's normal auto-scroll follows the latest message. During the
        // evidence chapter, keep the review at the top instead of below the viewport.
        if (step === 4) {
          const stream = el.closest<HTMLElement>(".stream");
          if (stream) stream.scrollTop = 0;
        }
        const r = el.getBoundingClientRect();
        const next = { top: Math.max(0, r.top - 6), left: Math.max(0, r.left - 6), right: Math.min(innerWidth, r.right + 6), bottom: Math.min(innerHeight, r.bottom + 6) };
        setRect(old => old && Object.keys(next).every(k => old[k as keyof Rect] === next[k as keyof Rect]) ? old : next);
      } else setRect(null);
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [chapter, step, minimized]);

  const panels: CSSProperties[] = rect ? [
    { top: 0, left: 0, right: 0, height: rect.top },
    { top: rect.bottom, left: 0, right: 0, bottom: 0 },
    { top: rect.top, left: 0, width: rect.left, height: rect.bottom - rect.top },
    { top: rect.top, left: rect.right, right: 0, height: rect.bottom - rect.top },
  ] : [{ inset: 0 }];
  if (!chapter || minimized) return <div className="tour-badge">Scripted sandbox · no AI / no saved changes <button onClick={() => { if (!chapter) location.reload(); else setMinimized(false); }}>{chapter ? "Resume guide" : "Restart tour"}</button><a href="/">Exit</a></div>;
  return <>
    <div className="tour-shade" aria-hidden="true">{panels.map((style, i) => <div key={i} style={style} />)}</div>
    {rect && <div className="tour-outline" aria-hidden="true" style={{ top: rect.top, left: rect.left, width: rect.right - rect.left, height: rect.bottom - rect.top }} />}
    <aside className={`tour-guide tour-step-${step}`} aria-label="Relay guided demo">
      <header><span>SCRIPTED DEMO · {step + 1} / {CHAPTERS.length}</span><button onClick={() => setMinimized(true)} aria-label="Minimize demo guide">−</button></header>
      <h2>{chapter.title}</h2><p>{chapter.text}</p>
      <div className="tour-progress" aria-hidden="true">{CHAPTERS.map((_, i) => <i key={i} className={i <= step ? "complete" : ""} />)}</div>
      <div role="status" className="tour-status">{typing ? "Typing the example…" : step < 3 ? "Continue by interacting with the highlighted area." : "All results in this tour are scripted."}</div>
      {step === 3 && <button className="tour-action" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await onEvaluate(); } catch { setError("Couldn't show the evaluation. Try again."); } finally { setBusy(false); } }}>Show evaluation →</button>}
      {step === 4 && <button className="tour-action" onClick={onBoard}>Inspect the board →</button>}
      {step === 5 && <button className="tour-action" onClick={onExplore}>Finish walkthrough</button>}
      {error && <p role="alert">{error}</p>}
      <footer><span>No AI calls. Nothing saved.</span><a href="/">Exit demo</a></footer>
    </aside>
  </>;
}
