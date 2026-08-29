// Public marketing + pricing page shown at "/". The product app lives at "/app".
// Server component: static, fast, SEO-friendly. Motion is CSS-only (see landing.css)
// and respects prefers-reduced-motion. Colors reuse the app's design tokens so the
// site and the product read as one brand.

import Link from "next/link";
import "../app/landing.css";

function RelayLogo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1.4" y="1.4" width="29.2" height="29.2" rx="8" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="9" cy="16" r="3" fill="var(--accent)" />
      <circle cx="23" cy="9" r="3" fill="var(--ai)" />
      <circle cx="23" cy="23" r="3" fill="var(--ai)" />
      <path d="M11.6 14.6 20.4 10.2M11.6 17.4 20.4 21.8" stroke="var(--ai)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// The one-to-many relay mark used as the transformation hinge in the hero demo.
function RelayFlow() {
  return (
    <svg viewBox="0 0 96 72" fill="none" aria-hidden="true" className="lp-flow">
      <path className="lp-flow-wire" d="M14 36 H50" />
      <path className="lp-flow-wire" d="M50 36 C64 36 66 16 82 16" />
      <path className="lp-flow-wire" d="M50 36 C64 36 66 56 82 56" />
      <circle className="lp-flow-in" cx="14" cy="36" r="6" />
      <circle className="lp-flow-out lp-flow-out-1" cx="82" cy="16" r="6" />
      <circle className="lp-flow-out lp-flow-out-2" cx="82" cy="56" r="6" />
      <circle className="lp-flow-spark" cx="14" cy="36" r="3.2" />
    </svg>
  );
}

const SURFACES = [
  {
    tag: "01 · Log",
    title: "You just say what happened.",
    body: "Jot a line in plain language — no forms, no fields. Relay's agent silently turns it into synced tasks, a work record, and shared knowledge. Capture is the whole job.",
    accent: "ai" as const,
  },
  {
    tag: "02 · Ask Relay",
    title: "Hand it a goal, get real work back.",
    body: "Tell Relay a goal and it drafts fully-specced tasks, records, even documents and decks. Draft-then-confirm: you review and edit — nothing touches the team's board until you publish.",
    accent: "accent" as const,
  },
  {
    tag: "03 · The Board",
    title: "Status that's true without upkeep.",
    body: "Living Kanbans where progress is derived from the work, not hand-curated. Check-ins are AI-reviewed; a change to a teammate's task becomes an approval request. The board is finally honest.",
    accent: "ai" as const,
  },
];

const FEATURES = [
  { h: "Per-member briefings", p: "Your open work plus everything that changed while you were away — waiting the moment you arrive." },
  { h: "Connectors", p: "When a change affects someone, Relay loops in exactly that person. No more being the last to hear." },
  { h: "Importance weighting", p: "Critical news surfaces louder; noise stays quiet. The feed ranks itself by what matters to you." },
  { h: "Attributed team log", p: "Who did what, when — a timestamped, shared record the whole team can trust as the source of truth." },
  { h: "Real artifacts", p: "The agent produces genuine markdown docs and .pptx decks as draggable windows, not just chat replies." },
  { h: "Honest by design", p: "Relay says what it drafted, never overclaims, and never changes shared state without your confirmation." },
];

const PLANS = [
  {
    name: "Free",
    price: "$0",
    unit: "forever",
    tagline: "For a small team finding its feet.",
    features: ["1 workspace", "Up to 3 boards", "14 days of history", "Core capture agent", "Attributed team log"],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Team",
    price: "$10",
    unit: "per seat / month",
    tagline: "For teams that live in the work.",
    features: ["Unlimited boards & workstreams", "Full agent + artifacts & decks", "Briefings & notifications", "Connectors & change requests", "Full history"],
    cta: "Start a Team trial",
    featured: true,
  },
  {
    name: "Business",
    price: "$22",
    unit: "per seat / month",
    tagline: "For orgs that need control.",
    features: ["Everything in Team", "Admin & member management", "SSO & audit log", "Priority models", "Bring-your-own-model"],
    cta: "Talk to us",
    featured: false,
  },
];

export default function Landing() {
  return (
    <div className="lp">
      {/* ---------- Nav ---------- */}
      <header className="lp-nav">
        <Link href="/" className="lp-brand" aria-label="Relay home">
          <RelayLogo />
          <span>Relay</span>
        </Link>
        <nav className="lp-nav-links">
          <a href="#how">How it works</a>
          <a href="#why">Why Relay</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="lp-nav-cta">
          <Link href="/app" className="lp-link-quiet">Sign in</Link>
          <Link href="/app" className="lp-btn lp-btn-primary">Get started</Link>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-eyebrow">AI-native team coordination</span>
          <h1 className="lp-h1">
            Chat is for people.<br />
            <span className="lp-h1-accent">Work runs on Relay.</span>
          </h1>
          <p className="lp-lede">
            Your team spends more effort <em>reporting</em> work than doing it. Relay's agent
            listens to what you already say and quietly turns it into structured, shared,
            up-to-date work — so nobody files a status report again.
          </p>
          <div className="lp-hero-actions">
            <Link href="/app" className="lp-btn lp-btn-primary lp-btn-lg">Get started free</Link>
            <a href="#how" className="lp-btn lp-btn-ghost lp-btn-lg">See how it works</a>
          </div>
          <p className="lp-hero-note">No credit card · Free for student & lab teams</p>
        </div>

        {/* Signature: capture → structure. A plain human line becomes real work. */}
        <div className="lp-demo" aria-hidden="true">
          <div className="lp-demo-card lp-demo-in">
            <span className="lp-demo-tag">someone types</span>
            <p className="lp-demo-line">
              shipped the checkout API — Priya&apos;s blocked till the keys land
              <span className="lp-caret" />
            </p>
          </div>

          <div className="lp-demo-hinge">
            <RelayFlow />
            <span className="lp-demo-hinge-label">Relay files it</span>
          </div>

          <div className="lp-demo-out">
            <div className="lp-out-chip lp-out-1">
              <span className="lp-out-icon task">▤</span>
              <span className="lp-out-main"><b>Ship checkout API</b><span>moved to Done · you</span></span>
              <span className="lp-out-badge done">done</span>
            </div>
            <div className="lp-out-chip lp-out-2">
              <span className="lp-out-icon record">◆</span>
              <span className="lp-out-main"><b>Checkout API shipped</b><span>posted to the timeline</span></span>
              <span className="lp-out-badge">record</span>
            </div>
            <div className="lp-out-chip lp-out-3">
              <span className="lp-out-icon connect">⇄</span>
              <span className="lp-out-main"><b>Priya looped in</b><span>unblocked — keys are next</span></span>
              <span className="lp-out-badge live">sent</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Problem ---------- */}
      <section className="lp-band lp-problem">
        <span className="lp-eyebrow center">The coordination tax</span>
        <h2 className="lp-h2 center">Every team pays it. Most just call it &ldquo;overhead.&rdquo;</h2>
        <div className="lp-tax">
          <div className="lp-tax-item"><b>Updates get buried.</b> Real progress is a message in a fast thread, gone by tomorrow.</div>
          <div className="lp-tax-item"><b>Status goes stale.</b> The board is only true right after someone remembers to update it.</div>
          <div className="lp-tax-item"><b>Context is scattered.</b> Decision in chat, doc in Drive, task in Jira. Nobody has the whole picture.</div>
          <div className="lp-tax-item"><b>People repeat themselves.</b> And the person a change affects is the last to hear.</div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how" className="lp-band">
        <span className="lp-eyebrow center">How it works</span>
        <h2 className="lp-h2 center">Three surfaces. One shared memory.</h2>
        <p className="lp-sub center">
          Relay splits the two jobs a &ldquo;collaboration tool&rdquo; is asked to do and gives each to
          whoever&apos;s better at it. People talk. The agent keeps the work true.
        </p>
        <div className="lp-surfaces">
          {SURFACES.map((s) => (
            <div key={s.tag} className={`lp-surface lp-surface-${s.accent}`}>
              <span className="lp-surface-tag">{s.tag}</span>
              <h3 className="lp-surface-title">{s.title}</h3>
              <p className="lp-surface-body">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Why AI-native ---------- */}
      <section id="why" className="lp-band lp-why">
        <div className="lp-why-head">
          <span className="lp-eyebrow">Why it&apos;s different</span>
          <h2 className="lp-h2">
            AI-native, not AI bolted on.
          </h2>
          <p className="lp-sub">
            In Relay the agent is the mechanism that keeps your team&apos;s state true — not a
            chatbot in a sidebar. Capture is the input; a structured, shared work-graph is the
            output. Remove the AI and the product doesn&apos;t work. That&apos;s the point.
          </p>
        </div>
        <div className="lp-features">
          {FEATURES.map((f) => (
            <div key={f.h} className="lp-feature">
              <div className="lp-feature-dot" />
              <h4>{f.h}</h4>
              <p>{f.p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Pricing ---------- */}
      <section id="pricing" className="lp-band lp-pricing">
        <span className="lp-eyebrow center">Pricing</span>
        <h2 className="lp-h2 center">Free to start. Priced to grow with the team.</h2>
        <p className="lp-sub center">Per seat, billed monthly. Upgrade only when your team&apos;s work outgrows the free tier.</p>
        <div className="lp-plans">
          {PLANS.map((p) => (
            <div key={p.name} className={`lp-plan${p.featured ? " featured" : ""}`}>
              {p.featured ? <span className="lp-plan-flag">Most popular</span> : null}
              <div className="lp-plan-name">{p.name}</div>
              <div className="lp-plan-price">
                <span className="lp-plan-amt">{p.price}</span>
                <span className="lp-plan-unit">{p.unit}</span>
              </div>
              <p className="lp-plan-tagline">{p.tagline}</p>
              <ul className="lp-plan-features">
                {p.features.map((f) => (
                  <li key={f}><span className="lp-check">✓</span>{f}</li>
                ))}
              </ul>
              <Link href="/app" className={`lp-btn ${p.featured ? "lp-btn-primary" : "lp-btn-ghost"} lp-plan-cta`}>
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
        <div className="lp-edu">
          <div className="lp-edu-mark"><RelayLogo /></div>
          <div className="lp-edu-copy">
            <b>Free for students &amp; labs.</b> Competitive engineering and robotics teams and academic
            labs get full Team features at no cost. Coordination-starved, deadline-driven — exactly who
            Relay is built for.
          </div>
          <Link href="/app" className="lp-btn lp-btn-ghost">Claim education access</Link>
        </div>
      </section>

      {/* ---------- Closing CTA ---------- */}
      <section className="lp-cta">
        <h2 className="lp-cta-title">Stop reporting the work.<br />Start doing it.</h2>
        <p className="lp-cta-sub">Set up a workspace in a minute. Log one line and watch Relay do the filing.</p>
        <Link href="/app" className="lp-btn lp-btn-primary lp-btn-lg">Get started free</Link>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="lp-footer">
        <div className="lp-brand">
          <RelayLogo />
          <span>Relay</span>
        </div>
        <p className="lp-footer-line">Chat is for people. Work runs on Relay.</p>
        <div className="lp-footer-links">
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <Link href="/app">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
