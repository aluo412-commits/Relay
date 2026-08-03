---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
date: 2026-08-02
---

# Active-Sync AI (+ Optional Task Due Dates) - Plan

## Goal Capsule
- **Objective:** Turn Relay's passive notification bell into an **active per-person sync loop** — the AI reaches out and keeps each person's picture of the work correct, at the intensity the moment deserves. Include an **optional, structured task due-date system** that feeds this loop.
- **Product authority:** User (Aaron). Direction settled this session: *"the AI actively syncs information with the user"* — all four delivery shapes wanted, unified into one engine.
- **Open blockers:** None to start. Noise-control (how it stays helpful, not annoying) is the primary design risk to resolve in planning.
- **Scope note:** Two independently-shippable areas live here — the **sync engine** (primary) and the **due-date subsystem** (supporting, can ship first). Due dates are a sync trigger, so they're captured together.

---

## Product Contract

### Problem
Today information reaches people through a **passive notification bell** you must go check, plus a per-visit briefing. Consequences:
- You don't know something changed until you look.
- Notifications are crude (fire by assignee / importance flag) and shallow (one stripped line, no context, no way to act).
- Nothing catches when your *understanding* has gone stale — you can keep building against an old spec and never know.

The bell stores what changed. It does not **make sure you know**.

### Users
Every team member, in their own private workspace. The sync is per-person: the same underlying change is judged and delivered differently for each person it touches (or not delivered to those it doesn't).

### The concept — one relevance engine, graduated delivery
When shared state changes (a log entry, a task moves, knowledge is shared, a deadline shifts or nears), the AI judges the change **for each person**:
- Does it touch their work?
- Does it unblock or block them?
- Does it contradict what they currently believe / are building against?

That single relevance judgment is then delivered at **the intensity the moment deserves**, tuned by **importance × actionability × whether the person is present**:

1. **Ambient — a live "In sync" panel.** A persistent surface the AI keeps continuously true: "here's what changed that touches *your* work," reconciled and re-ranked as things move. Replaces going to check the bell.
2. **On return — a guided catch-up.** When you come back, the AI walks you through "what moved and what it means for you," each item act-on-it.
3. **Proactive — the AI speaks up.** When something is *urgent AND actionable*, Relay initiates in chat ("Sam finished the API — you're unblocked. Start it?").
4. **Reconciliation — it corrects your picture.** The smartest tier: when your understanding is stale or conflicts with new info, it syncs *you* specifically ("you're building against the old spec; the acceptance criteria changed").

These are **not four features** — they are four intensities of the same engine, selected by the relevance judgment.

### Requirements

**Sync engine**
- The AI evaluates each material change in shared state against **each affected person's** current work and understanding, producing a per-person relevance verdict (touches you / unblocks / blocks / contradicts / FYI / irrelevant).
- Each verdict carries an **intensity**: ambient, catch-up, or proactive — derived from importance × actionability × presence. Irrelevant → nothing (the engine must be willing to stay silent).
- **Ambient "In sync" panel** per member: always-current, ranked, reconciled items ("Sam's API done → your task unblocked"; "deadline moved to Fri"; "2 need your reply"). Items resolve/disappear as they're handled or go stale.
- **Return catch-up**: on re-entry after time away, a guided, act-on-it recap of what moved and what it means — an evolution of today's briefing.
- **Proactive speak-up**: for urgent + actionable items, the AI posts a message in the person's chat with inline actions (start / accept / open / reply / dismiss). Rate-limited (see noise control).
- **Reconciliation**: detect when a person's active task is now inconsistent with newer shared info (changed spec, changed dependency, moved deadline) and surface a specific correction with a one-click fix where possible.
- Every surfaced item is **actionable in place** (act / open the linked work / reply / dismiss) — knowing and doing are not two trips.
- **Attribution + context**: each item names who/what caused it and links the underlying task/record/knowledge.

**Noise control (primary design constraint — a requirement, not a nicety)**
- The engine must be **willing to deliver nothing**; silence is a valid, common output.
- Proactive interruptions are reserved for urgent + actionable; everything else waits in ambient/catch-up.
- Per-person controls to tune what escalates (at minimum: mute a stream, or drop proactive down to ambient). Exact controls: planning.
- No duplicate nagging: an item delivered ambiently and acted on never also interrupts.

**Optional task due dates (supporting subsystem)**
- A task **may** carry a due date; assigning one is **always optional** (unset is a first-class, common state — no default, no pressure).
- Due dates are **structured** (a real date), not the current free-text `Task.due` string — set via a date picker in the task spec / draft editor.
- Derived states surfaced consistently: **due soon**, **due today**, **overdue** (and "no due date" shown as neutral, never as a warning).
- Due dates **feed the sync engine**: approaching/overdue on *your* task → ambient or proactive per urgency; a deadline change by someone else on your task → a sync item.
- Sorting/filtering by due where tasks are listed (board, "your open work"). Exact surfaces: planning.
- Migration note: the existing free-text `due` values must be preserved or sensibly migrated (planning owns the how).

### Acceptance examples (representative)
- Sam marks the API task done → Alex (owner of a task that depended on it) sees an ambient "you're unblocked" item **and**, because it's actionable, Relay speaks up in Alex's chat offering to start it; Jordan (unrelated) sees nothing.
- Jordan edits a task's acceptance criteria that Alex is actively working → Alex gets a reconciliation item: "you're on the old spec," with a one-click "update my task."
- A task Alex owns crosses into **overdue** → it shows as overdue on the board and appears in Alex's In-sync panel; if also blocking others, it escalates.
- A teammate sets no due date on a task → it reads as neutral "no date," never nags, and is excluded from due-based sorting/warnings.
- Alex returns after a day → a catch-up lists the 3 things that moved and what each means, each with an action; acting on one clears it everywhere.

### Non-goals (for this work)
- Not replacing the Log or chat; this is about *reaching* people, not new capture.
- Not real-time multi-user presence/websockets infrastructure as a hard requirement (ambient panel can refresh on activity/poll; live transport is a planning choice, not a product requirement).
- Not calendar integration, recurring due dates, reminders-by-email, or time-of-day due times in v1.
- Not team-wide analytics/dashboards.

### Key decisions
- **session-settled:** The direction is *the AI actively syncs information with each user* — proactive, not a passive bell.
- **session-settled:** All four shapes are wanted, unified as **one relevance engine at four intensities** (ambient / catch-up / proactive / reconciliation), tuned by importance × actionability × presence.
- **session-settled:** Assigning a task due date is **optional**; unset is first-class.
- **session-settled:** This work is **captured now, built after the demo** (no code changes today).
- Build on existing pieces rather than net-new: notifications/`applyActions` (change events), briefings + `lastSeenAt` (what's-new + presence), the agent's reasoning (relevance). The bell grows a brain; it isn't ripped out.

### Outstanding questions (for planning)
- Relevance judgment: rule-based, AI-judged per change, or hybrid? (Cost/latency vs. quality — the reconciliation tier likely needs the AI.)
- What exactly defines "present" for presence-tuning (active tab, recent activity, `lastSeenAt` window)?
- Delivery transport for the ambient panel: poll vs. push; acceptable staleness.
- Escalation controls surface + defaults (how much a user can tune before it's built).
- Due-date migration: convert/parse existing free-text `due` values, or start fresh.
- Where the "In sync" panel lives spatially (its own rail region, top of chat, a dedicated surface) — a visual decision to probe in planning/design.

### How this work fits together
Relay's thesis is "chat is for people, work runs on Relay." This makes the *"work runs on Relay"* half active: the workspace doesn't just hold the shared picture, it **pushes it to the people who need it, correctly**. It sits directly on top of the just-built **Workstreams** (relevance is naturally stream-aware) and evolves the existing **notifications + briefings** rather than competing with them. Due dates are the first concrete, high-signal trigger that makes the engine's value obvious.

### Suggested phasing (for planning to refine)
1. **Due-date subsystem** (small, independently valuable, unblocks a clean trigger): structured optional due date + picker + soon/today/overdue states + sort.
2. **Ambient "In sync" panel** built from the existing briefing computation, made continuous and relevance-ranked.
3. **Proactive speak-up** on urgent+actionable items, with noise control.
4. **Reconciliation tier** (stale/conflict detection) — the differentiator, built last on top of the engine.
