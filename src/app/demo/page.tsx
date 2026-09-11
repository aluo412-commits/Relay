"use client";

import Link from "next/link";
import "./demo.css";

const TASKS = [
  { state: "done", label: "Validate intake geometry", owner: "Maya", note: "Evidence found in the team log" },
  { state: "live", label: "Wire motor controller", owner: "Jordan", note: "In progress · 2 criteria left" },
  { state: "risk", label: "Run full autonomous test", owner: "Alex", note: "Blocked by controller wiring" },
];

const PITCH = `Relay is an AI execution layer for teams that move fast and communicate constantly.\n\nA robotics team can spend hours building, testing, and solving hard problems — but still lose time because the important detail was buried in chat, a task was never updated, or a teammate did not know they were blocked.\n\nRelay changes that. People keep talking naturally. Relay turns those conversations into real tasks, decisions, and shared knowledge. Then it follows the work: it looks for evidence of progress, notices when something is blocked or stale, and asks the right person the right question.\n\nUnlike a traditional project-management tool, Relay does not ask a team to maintain a second system. Unlike a chatbot, it does not stop at answering. It keeps the team's picture of reality current and helps move the work forward.\n\nChat is for people. Work runs on Relay.`;

export default function RoboticsDemoPage() {
  return (
    <main className="rd-page">
      <header className="rd-nav">
        <Link href="/" className="rd-brand"><span className="rd-mark">◆</span> Relay</Link>
        <span className="rd-nav-label">Robotics team demo / field notes</span>
        <Link href="/app" className="rd-open">Open Relay <span>↗</span></Link>
      </header>

      <section className="rd-hero">
        <div className="rd-kicker"><span className="rd-live-dot" /> A live product story for robot teams</div>
        <h1>Build the robot.<br /><em>Don&apos;t lose the work.</em></h1>
        <p className="rd-lede">A five-minute demonstration of how Relay turns messy team communication into tasks that stay visible, verifiable, and moving.</p>
        <div className="rd-hero-meta"><span>Designed for VEX / FIRST teams</span><span>·</span><span>One shared workstream</span><span>·</span><span>Zero status meetings</span></div>
      </section>

      <section className="rd-stage">
        <div className="rd-stage-head"><span>THE DEMO</span><b>From a field note to a team decision</b></div>
        <div className="rd-console">
          <aside className="rd-console-rail">
            <div className="rd-rail-label">WORKSTREAM</div>
            <div className="rd-stream active"><span className="rd-stream-mark" />Robot v2<span className="rd-stream-count">3</span></div>
            <div className="rd-stream"><span className="rd-stream-mark muted" />Drive base</div>
            <div className="rd-stream"><span className="rd-stream-mark muted" />Competition prep</div>
            <div className="rd-rail-foot">Relay is watching the work<br />so people can do the work.</div>
          </aside>
          <div className="rd-console-main">
            <div className="rd-console-top"><span>Robot v2 / Shared execution</span><span className="rd-status">● SYNCED</span></div>
            <div className="rd-signal"><span className="rd-signal-icon">✦</span><div><b>Relay found a dependency</b><p>Jordan&apos;s controller wiring is still in progress. Alex&apos;s autonomous test is blocked by it.</p></div><button>Open task</button></div>
            <div className="rd-console-grid">
              <div><div className="rd-mini-label">CAPTURED</div><blockquote>“The intake is finally consistent. Controller wiring is next — autonomous test can&apos;t start until that lands.”<cite>Alex · team log · 2 min ago</cite></blockquote></div>
              <div><div className="rd-mini-label">WHAT RELAY DID</div><ul><li>Updated intake task to Done</li><li>Kept controller task In progress</li><li>Connected the blocker to the test</li><li>Surfaced it to the right owner</li></ul></div>
            </div>
            <div className="rd-task-list">{TASKS.map((t) => <div className="rd-task" key={t.label}><span className={`rd-task-dot ${t.state}`} /><div><b>{t.label}</b><small>{t.note}</small></div><span className="rd-owner">{t.owner}</span></div>)}</div>
          </div>
        </div>
      </section>

      <section className="rd-steps">
        <div className="rd-section-intro"><span>WHY IT LANDS</span><h2>Three moments. One shared picture.</h2></div>
        <div className="rd-step"><span className="rd-step-num">01</span><h3>People talk normally</h3><p>No forms. No “please update Jira.” A quick field note is enough for Relay to understand what changed.</p></div>
        <div className="rd-step"><span className="rd-step-num">02</span><h3>The work becomes legible</h3><p>Relay drafts the task, records the decision, connects dependencies, and keeps evidence beside the work.</p></div>
        <div className="rd-step"><span className="rd-step-num">03</span><h3>Progress gets followed</h3><p>When a task is stale, blocked, or missing proof of completion, Relay asks the next useful question.</p></div>
      </section>

      <section className="rd-script">
        <div><span className="rd-section-intro-label">PITCH SCRIPT</span><h2>Say this in the room.</h2><p>About 60 seconds. Keep the product visible while you speak.</p></div>
        <div className="rd-script-card"><div className="rd-script-card-top"><span>RELAY / ELEVATED PITCH</span><button onClick={() => navigator.clipboard?.writeText(PITCH)}>Copy script</button></div><p>{PITCH}</p></div>
      </section>

      <footer className="rd-footer"><Link href="/">← Back to Relay</Link><span>Chat is for people. Work runs on Relay.</span><Link href="/app">Try the demo →</Link></footer>
    </main>
  );
}
