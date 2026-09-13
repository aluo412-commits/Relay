"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "./demo.css";

const PITCH = `Relay is an AI execution layer for teams that move fast and communicate constantly. A robotics team can spend hours building, testing, and solving hard problems — but still lose time because an important detail was buried in chat, a task was never updated, or a teammate did not know they were blocked. Relay changes that. People keep talking naturally. Relay turns those conversations into real tasks, decisions, and shared knowledge. Then it follows the work: it looks for evidence of progress, notices when something is blocked or stale, and asks the right person the right question. Unlike a traditional project-management tool, Relay does not ask a team to maintain a second system. Unlike a chatbot, it does not stop at answering. It keeps the team's picture of reality current and helps move the work forward. Chat is for people. Work runs on Relay.`;

const SLIDES = [
  { label: "Capture", title: "A field note lands in Relay.", sub: "No form. No status update ritual. Just the context the team already has." },
  { label: "Understand", title: "Relay turns context into work.", sub: "It separates what changed, what is blocked, and what needs an owner." },
  { label: "Follow up", title: "Relay spots the blocker early.", sub: "A specific question goes to the person who can move the work." },
  { label: "Shared state", title: "Everyone sees the same state.", sub: "Evidence, owners, blockers, and progress stay together." },
  { label: "The point", title: "The team keeps building.", sub: "Relay keeps the picture current while people focus on the robot." },
];

function Task({ state, title, detail, owner }: { state: string; title: string; detail: string; owner: string }) {
  return <div className="demo-task"><span className={`task-dot ${state}`} /><div><b>{title}</b><small>{detail}</small></div><span className="task-owner">{owner}</span></div>;
}

function RelayWorkspace({ slide, onSend, followupSent, onFollowup, taskDrafted, onDraftTasks }: { slide: number; onSend: (message: string) => void; followupSent: boolean; onFollowup: () => void; taskDrafted: boolean; onDraftTasks: () => void }) {
  const [draft, setDraft] = useState("");
  const showFollowup = slide >= 2;
  const showBoard = slide >= 3;
  return (
    <div className="relay-window">
      <header className="relay-topbar"><div className="relay-brand"><span className="brand-mark">◆</span> Relay</div><span className="workspace-name">Family / Robot v2</span><span className="top-spacer" /><span className="top-sync"><i /> IN SYNC</span><span className="avatar">AL</span></header>
      <div className="relay-body">
        <aside className="relay-rail"><div className="rail-label">WORKSTREAMS</div><div className="rail-stream active"><i /> Robot v2 <em>3</em></div><div className="rail-stream"><i /> Drive base</div><div className="rail-stream"><i /> Competition prep</div><div className="rail-bottom">Chat is for people.<br /><b>Work runs on Relay.</b></div></aside>
        <main className="relay-chat"><div className="chat-head"><button>Robot v2 <span>⌄</span></button><span className="chat-mode">Ask Relay</span><span className="chat-search">Search this chat…</span></div><div className="chat-content">
          <div className="relay-kicker">{SLIDES[slide].label.toUpperCase()} / RELAY</div><h1>{SLIDES[slide].title}</h1><p className="slide-sub">{SLIDES[slide].sub}</p>
          {slide === 0 && <div className="message-stack"><div className="user-msg"><span className="small-avatar">AL</span><div><p>“The intake is finally consistent. Controller wiring is next — autonomous testing can&apos;t start until that lands.”</p><small>Alex · just now</small></div></div></div>}
          {slide === 1 && <div className="insight-card"><div className="insight-head"><span>✦</span><b>Relay understood</b><small>evidence found in team log</small></div><div className="insight-grid"><div><label>COMPLETED</label><strong>Validate intake geometry</strong><small>Marked complete from explicit evidence</small></div><div><label>DEPENDENCY</label><strong>Controller wiring</strong><small>Required before autonomous testing</small></div></div><div className="insight-actions"><button onClick={onDraftTasks}>{taskDrafted ? "Drafts created ✓" : "Draft tasks from this note"}</button><button>Dismiss</button></div></div>}
          {slide === 2 && <div className="followup-card"><div className="followup-tag">FOLLOW-UP NEEDED</div><h3>Jordan&apos;s controller wiring is still in progress.</h3><p>Alex&apos;s autonomous test is blocked by it. Relay found no new evidence since yesterday.</p><div className="followup-actions"><button onClick={onFollowup}>{followupSent ? "Question sent ✓" : "Ask Jordan"}</button><button className="quiet" onClick={() => setDraft("Show me the controller task")}>Open task</button></div></div>}
          {slide === 3 && <div className="activity-card"><div className="activity-title"><b>Shared execution</b><span>updated now</span></div><Task state="done" title="Validate intake geometry" detail="Evidence found · Complete" owner="Maya" /><Task state="live" title="Wire motor controller" detail="In progress · 2 criteria left" owner="Jordan" /><Task state="risk" title="Run full autonomous test" detail="Blocked by controller wiring" owner="Alex" /></div>}
          {slide === 4 && <div className="pitch-card"><div className="pitch-label">THE RELAY DIFFERENCE</div><p>“It doesn&apos;t ask the team to maintain another system. It watches the work people already do — and follows up when the shared picture becomes uncertain.”</p><button onClick={() => navigator.clipboard?.writeText(PITCH)}>Copy 60-second pitch</button></div>}
        </div><form className="chat-composer" onSubmit={(event) => { event.preventDefault(); if (!draft.trim()) return; onSend(draft.trim()); setDraft(""); }}><input aria-label="Message Relay" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={slide === 2 ? "Reply to Relay…" : "Tell Relay what you did…"} /><button aria-label="Send message" type="submit">→</button></form></main>
        <aside className="relay-memory"><div className="memory-label">PROJECT MEMORY</div><h2>Robot v2</h2><span className="memory-meta">shared workstream</span><div className="memory-rule" /><div className="memory-label">WHAT MATTERS</div><div className="memory-note important"><b>Dependency</b><span>Controller wiring gates autonomous testing.</span></div><div className="memory-note"><b>Decision</b><span>Intake geometry is consistent enough to move on.</span></div>{taskDrafted && <div className="memory-note draft"><b>Draft created</b><span>Two tasks are ready for review.</span></div>}{showFollowup && <div className="memory-note alert"><b>Relay is following up</b><span>Jordan owns the next unblock.</span></div>}{showBoard && <div className="memory-progress"><span>Project progress</span><b>42%</b><i><em /></i></div>}</aside>
      </div>
    </div>
  );
}

export default function RoboticsDemoPage() {
  const [slide, setSlide] = useState(0);
  const [lastMessage, setLastMessage] = useState("");
  const [followupSent, setFollowupSent] = useState(false);
  const [taskDrafted, setTaskDrafted] = useState(false);
  const next = () => setSlide((s) => Math.min(SLIDES.length - 1, s + 1));
  const prev = () => setSlide((s) => Math.max(0, s - 1));
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowRight") next(); if (e.key === "ArrowLeft") prev(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); });
  return <main className="demo-page"><header className="demo-nav"><Link href="/" className="demo-logo"><span>◆</span> Relay</Link><span className="demo-context">ROBOTICS TEAM / PRODUCT DEMO</span><div className="demo-nav-right"><span>{String(slide + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}</span><Link href="/app">Open workspace ↗</Link></div></header><section className="demo-stage"><RelayWorkspace slide={slide} onSend={setLastMessage} followupSent={followupSent} onFollowup={() => setFollowupSent(true)} taskDrafted={taskDrafted} onDraftTasks={() => setTaskDrafted(true)} />{lastMessage && <div className="interaction-toast">Captured: “{lastMessage}”</div>}<button className="arrow left" onClick={prev} disabled={slide === 0} aria-label="Previous slide">←</button><button className="arrow right" onClick={next} disabled={slide === SLIDES.length - 1} aria-label="Next slide">→</button></section><div className="demo-footer"><div className="slide-dots">{SLIDES.map((s, i) => <button key={s.label} className={i === slide ? "on" : ""} onClick={() => setSlide(i)} aria-label={`Go to ${s.label}`}><i /></button>)}</div><span>Use ← → to move through Relay</span><span className="demo-tagline">Chat is for people. Work runs on Relay.</span></div></main>;
}
