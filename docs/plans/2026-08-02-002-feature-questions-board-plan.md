---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
date: 2026-08-02
---

# Questions on the Board (AI-Brokered Q&A) - Plan

## Goal Capsule
- **Objective:** Let anyone **hang a question on a workstream** to get a specific answer from specific people — with optional **answer-triggered actions**, **AI mediation** of the answer, and **flexible audience/visibility**. Turns "asking someone a detail" from a lost chat line into a tracked, actionable object.
- **Product authority:** User (Aaron). Direction settled this session.
- **Open blockers:** None to start. The multi-answerer resolution rule (below) is the main product fork to settle in planning.
- **Relationship:** Sibling to the **Active-Sync AI** plan (`2026-08-02-001`). Sync *pushes* what changed; this *pulls* a needed answer. A hung question is **delivered by the sync engine**, executes via the existing **board-action** system, and reuses the agent's **coaching/mediation** pattern.

---

## Product Contract

### Problem
Asking a teammate for a specific detail has no home. It's a chat message that scrolls away: no structure, no tracking of whether it was answered, no follow-through when it is, and no control over who's asked vs. who can see it. The asker then has to remember to chase it and manually do the thing the answer unblocks.

### Users
- **Asker** — needs a specific detail to move forward, and often already knows what they'll do with each answer.
- **Answerer(s)** — the specific person/people (or everyone) who can answer.
- Bystanders — teammates who may or may not be allowed to see the question, by the asker's choice.

### The concept — a Question is a first-class object
You **hang a question on a workstream**. It carries: the ask, an **audience + visibility** choice, **optional answer-conditioned actions**, and an **AI-brokered answer**. It's tracked (open → answered → resolved) and lives with the work it's about.

### Requirements

**Asking**
- Create a question on a workstream; it becomes a tracked object with a clear open/answered/resolved state.
- **Audience × visibility model** (the asker picks one):
  1. **Ask specific people — private:** only the asked can see it. (a quiet side-question)
  2. **Ask specific people — visible:** the asked are pinged; the rest of the team can see it too. (transparent but directed)
  3. **Ask everyone:** broadcast to the workstream/team.
- **Optional answer-conditioned actions:** the asker may attach follow-through per answer — e.g. *"if yes → mark 'ship' in progress; if no → create task 'revisit spec'."* The "do X" reuses existing **board actions** (create/complete/update task, share knowledge, notify). Actions are **optional** — a question can simply gather an answer.

**Answering (AI-brokered)**
- Asked people are **actively reached** (via the sync engine / notification), not left to notice.
- When an answerer responds, the agent **works with them to polish the answer** — clarify, complete, tighten — the same coaching pattern used elsewhere, applied to answers. The answerer confirms the polished version.
- The polished answer is **returned to the asker**, attributed, attached to the question.
- If the question had answer-conditioned actions, the matching branch **executes automatically** on answer, and the asker is told what fired.

**Tracking & delivery**
- Open questions are visible to exactly those the visibility choice allows; answered questions show the polished answer + which actions fired.
- Questions integrate with the sync engine as first-class sync items ("Sam answered your question"; "you have 1 unanswered question").

### Acceptance examples (representative)
- Alex hangs *"Is the sensor spec final?"* on the Robotics stream, asks **Jordan privately**, and attaches *yes → mark 'mount sensor' ready; no → create 'finalize spec'*. Jordan is pinged, answers "not yet, changing the mount," the agent polishes it into a clear answer, returns it to Alex, and auto-creates "finalize spec." Nobody else saw the exchange.
- Alex asks **everyone** *"Anyone have the old firmware hash?"* (visible, no branch). Answers come back polished and attributed; the asker picks the useful one.
- Alex asks **Sam, visible to the team** — teammates can see the question and the eventual answer, so the detail becomes shared knowledge, not a private DM.

### Non-goals (for this work)
- Not a threaded discussion forum or general chat replacement.
- Not anonymous polling or analytics dashboards (simple answer collection only).
- Not required approvals/routing chains (that's ChangeRequests' job).

### Key decisions
- **session-settled:** Questions are **hung on a workstream** as tracked objects (not ephemeral chat).
- **session-settled:** Three audience/visibility modes — ask-specific-private, ask-specific-visible, ask-everyone.
- **session-settled:** Answers can carry **optional conditional actions** ("if yes/no → do X"), executed via existing board actions.
- **session-settled:** The agent **mediates the answer** with the answerer (polishes it) before returning it to the asker.
- Reuse over net-new: board actions for branching, the coaching pattern for polishing, the sync engine for delivery, Workstreams for scoping.

### Outstanding questions (for planning)
- **Multi-answerer resolution (biggest fork):** when specific-multiple or everyone can answer, and the question has yes/no branching — does the **first** answer trigger the branch, does each answer stand alone (no branch), or does the **asker choose** which answer counts? Branching fits a single designated answerer most cleanly; broadcast leans "gather, asker decides." Likely: branching only offered when exactly one person is asked.
- **Answer types:** yes/no (branchable) vs open-ended (polished text, no branch) — support both; branches require a structured (yes/no or choice) answer.
- **Where a question lives visually:** a card on the Kanban, a dedicated "Questions" lane on the workstream, or a distinct surface. (A visual decision — probe in planning/design.)
- Can an answerer **decline or reassign** ("ask Jordan instead")?
- Can visibility change after asking? Who can see the answer vs. the question?
- Does asking-everyone need a "first good answer closes it" vs. staying open for more?

### How this work fits together
It completes the information-flow picture: **Active-Sync** pushes what changed, **Questions** pulls what's missing — both AI-brokered, both delivered by the same sync engine, both workstream-scoped. It reuses three things already in the codebase (board actions, the agent's coaching/mediation, notifications), so it's an extension of Relay's grain, not a new subsystem.

### Suggested phasing (for planning to refine)
1. **Question object + the three audience/visibility modes**, delivered via existing notifications/sync — ask and get a plain answer, tracked.
2. **AI answer mediation** (polish-with-answerer, return to asker).
3. **Answer-conditioned actions** (the "if yes/no → do X" branching, on single-answerer questions).
