"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { interpolateSpotlight, type SpotlightRect } from "@/lib/spotlight";

const CHAPTERS = [
  { title: "Click the message bar", text: "Click the highlighted input. Watch the sample request type itself, then click Send.", target: ".workspace .composer" },
  { title: "Review, edit, then publish", text: "This is Relay’s real task editor. Check the owner, tomorrow’s due date and the two criteria. Click Publish to continue.", target: ".artifact-window.draft" },
  { title: "Report partial progress", text: "Click the Log input to type the sample evidence. Then click the send arrow. The encoder check is still missing.", target: ".workspace .composer" },
  { title: "The board updated—not to Done", text: "Your log changed the task to In progress and added a work record. Now inspect the scripted evidence review.", target: ".log-stream" },
  { title: "Evidence, not a guess", text: "One criterion is confirmed; one is missing. Relay keeps the task open and asks a specific follow-up. This evaluation is prerecorded, not a live AI call.", target: ".sync-panel" },
  { title: "Inspect the result yourself", text: "Click the controller task to inspect its status, evidence and deadline. Autonomous testing remains blocked. No production data has changed.", target: ".kanban" },
];

type Rect = SpotlightRect;
function tourTarget(selector: string, step: number): Element | null {
  if (step === 5 && document.querySelector(".modal")) return document.querySelector(".modal");
  const matches = document.querySelectorAll(selector);
  if (selector.endsWith(".msg.ai")) return matches[matches.length - 1] ?? document.querySelector(".workspace .stream");
  return matches[0] ?? null;
}
export default function ScriptedDemoGuide({ step, mode, typing, sending, streaming, logging, publishing, draftReady, published, onOpenDraft, onStartLog, onEvaluate, onBoard, onExplore }: {
  step: number; mode: "chat" | "log"; typing: boolean; sending: boolean; streaming: boolean; logging: boolean; publishing: boolean; draftReady: boolean; published: boolean;
  onOpenDraft: () => void; onStartLog: () => void; onEvaluate: () => Promise<void>; onBoard: () => void; onExplore: () => void;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [minimized, setMinimized] = useState(false);
  const chapter = useMemo(() => {
    const base = CHAPTERS[step];
    if (step === 0 && sending) return {
      title: streaming ? "Watch the response take shape" : "Your request has arrived",
      text: streaming ? "Relay is explaining the task, owner and deadline. Read along—the editor won't open over the response." : "First the request, then the response. This brief pause is part of the scripted walkthrough, not a live AI call.",
      target: ".workspace .stream .msg.ai",
    };
    if (step === 0 && draftReady) return { title: "Read the reply, then open the draft", text: "The task is only a draft—not published. When you're ready, open it to inspect the owner, due date and acceptance criteria.", target: ".workspace .stream .msg.ai" };
    if (step === 1 && published) return { title: "Your task is now on the board", text: "Publishing is the moment the draft becomes shared work. Take a moment to read the confirmation, then try recording progress.", target: ".workspace .stream .msg.ai" };
    if (step === 1 && publishing) return { ...base, title: "Adding your reviewed task…", text: "The draft keeps your edits. Next you'll see a confirmation before moving on to Log." };
    if (step === 2 && mode === "chat") return { title: "Now switch from Chat to Log", text: "Chat is where you ask Relay to plan work. Log is where you record what happened. Click the highlighted Log tab yourself—we'll stay here until you do.", target: ".mode-toggle" };
    if (step === 2 && logging) return { title: "Reading the progress evidence…", text: "The motors respond, but the encoder check is still missing. Watch what changes—and what stays blocked.", target: ".log-stream" };
    if (step === 3 && busy) return { ...base, title: "Comparing evidence with criteria…", text: "Checking motor responses first, then encoder directions. Partial progress must not be mistaken for completion." };
    return base;
  }, [step, mode, sending, streaming, draftReady, publishing, published, logging, busy]);
  const reading = (step === 0 && (sending || draftReady)) || (step === 1 && published);
  const status = typing ? "Typing the example—then you click Send." : sending ? (streaming ? "Revealing the scripted reply…" : "Request received · preparing the preview…") : publishing ? "Publishing the reviewed task…" : logging ? "Reading your log and updating the task…" : busy ? "Evaluating the missing evidence…" : draftReady && step === 0 ? "Paused here. Continue when you've finished reading." : published && step === 1 ? "Published. You choose when to try the next feature." : step === 2 && mode === "chat" ? "Your next click: Log, beside Ask Relay." : step < 3 ? "Continue by interacting with the highlighted area." : "Take your time. The next step starts with your click.";
  useEffect(() => {
    if (!chapter || minimized) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMinimized(true); return; }
      if (event.key !== "Tab") return;
      const target = tourTarget(chapter.target, step);
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
    let from: Rect | null = null;
    let transitionStarted = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const measure = () => {
      // A task detail opened from the board becomes the new interaction target.
      const el = tourTarget(chapter.target, step);
      if (el && el !== lastTarget) {
        from = rectRef.current;
        transitionStarted = performance.now();
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
        const destination = { top: Math.max(0, r.top - 6), left: Math.max(0, r.left - 6), right: Math.min(innerWidth, r.right + 6), bottom: Math.min(innerHeight, r.bottom + 6) };
        const progress = reducedMotion.matches ? 1 : Math.min(1, (performance.now() - transitionStarted) / 550);
        const next = from && progress < 1 ? interpolateSpotlight(from, destination, progress) : destination;
        rectRef.current = next;
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
    <div className="tour-shade" data-waiting={!rect} aria-hidden="true">{panels.map((style, i) => <div key={i} style={style} />)}</div>
    {rect && <div className="tour-outline" aria-hidden="true" style={{ top: rect.top, left: rect.left, width: rect.right - rect.left, height: rect.bottom - rect.top }} />}
    <aside className={`tour-guide tour-step-${step}${reading ? " tour-reading" : ""}${step === 2 && mode === "chat" ? " tour-mode-switch" : ""}`} aria-label="Relay guided demo">
      <header><span>SCRIPTED DEMO · {step + 1} / {CHAPTERS.length}</span><button onClick={() => setMinimized(true)} aria-label="Minimize demo guide">−</button></header>
      <div className="tour-copy" key={chapter.title}><h2>{chapter.title}</h2><p>{chapter.text}</p></div>
      {step === 0 && <div className="tour-sequence" aria-label="Request flow"><span className={sending || draftReady ? "passed" : "current"}>1. Request</span><span aria-hidden="true">→</span><span className={sending || draftReady ? "current" : ""}>2. Reply</span><span aria-hidden="true">→</span><span>3. Draft</span></div>}
      <div className="tour-progress" aria-hidden="true">{CHAPTERS.map((_, i) => <i key={i} className={i <= step ? "complete" : ""} />)}</div>
      <div role="status" className="tour-status">{status}</div>
      {step === 0 && draftReady && !sending && <button className="tour-action" onClick={onOpenDraft}>Open the task draft →</button>}
      {step === 1 && published && <button className="tour-action" onClick={onStartLog}>Try a progress update →</button>}
      {step === 3 && <button className="tour-action" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await onEvaluate(); } catch { setError("Couldn't show the evaluation. Try again."); } finally { setBusy(false); } }}>{busy ? "Comparing evidence…" : "Show evaluation →"}</button>}
      {step === 4 && <button className="tour-action" onClick={onBoard}>Inspect the board →</button>}
      {step === 5 && <button className="tour-action" onClick={onExplore}>Finish walkthrough</button>}
      {error && <p role="alert">{error}</p>}
      <footer><span>No AI calls. Nothing saved.</span><a href="/">Exit demo</a></footer>
    </aside>
  </>;
}
