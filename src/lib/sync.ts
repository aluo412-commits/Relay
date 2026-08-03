// The Active-Sync relevance engine: turn shared-state changes into a per-person,
// ranked feed of what-it-means-to-you. Rule-based tiers here; the reconciliation
// tier (AI-judged) is layered on in a later unit.

import type { SyncItem } from "./types";
import { dueState } from "./dates";

// The minimal task shape the engine reasons over (a subset of TaskDTO).
export interface SyncTask {
  name: string;
  status: string; // "new" | "inprogress" | "blocked" | "done"
  boardId: string | null;
  due: string | null;
  ownerName: string | null;
  dependencies: string | null;
  createdAt: string;
}

export interface SyncInput {
  memberName: string;
  tasks: SyncTask[];
  updates: { title: string; author: string | null; summary: string | null; createdAt: string }[];
  knowledge: { tag: string; text: string; importance: string; createdAt: string }[];
  lastSeenAt: string | null;
  now?: Date;
}

/**
 * Deadline signals for a person: their own not-done tasks that are overdue, due
 * today, or due soon. Overdue/today are actionable and can escalate; soon is ambient.
 */
export function dueSignals(memberName: string, tasks: SyncTask[], now: Date = new Date()): SyncItem[] {
  const items: SyncItem[] = [];
  for (const t of tasks) {
    if (t.status === "done") continue;
    if (!t.ownerName || t.ownerName.toLowerCase() !== memberName.toLowerCase()) continue;
    const s = dueState(t.due, now);
    if (s === "none") continue;
    const text =
      s === "overdue"
        ? `“${t.name}” is overdue.`
        : s === "today"
        ? `“${t.name}” is due today.`
        : `“${t.name}” is due soon.`;
    items.push({
      key: `deadline:${t.name.toLowerCase()}:${s}`,
      verdict: "deadline",
      intensity: s === "soon" ? "ambient" : "proactive",
      text,
      actionable: s !== "soon",
      taskName: t.name,
      boardId: t.boardId,
      fromName: null,
      createdAt: (t.due ?? "") + "T00:00:00.000Z",
    });
  }
  return items;
}

const isMine = (t: SyncTask, name: string) => !!t.ownerName && t.ownerName.toLowerCase() === name.toLowerCase();
const after = (iso: string, since: string | null) => (since ? new Date(iso) > new Date(since) : true);

// Priority for ranking the panel: lower sorts first.
const RANK: Record<string, number> = { deadline: 0, unblocked: 1, blocked: 2, assigned: 3, reconcile: 1, fyi: 5 };

/**
 * The full per-person relevance feed: what changed that touches YOU, ranked, with a
 * delivery intensity. Rule-based verdicts; willing to return an empty feed.
 *   - deadline  : your task overdue/today/soon
 *   - unblocked : your task whose named dependency is now done
 *   - blocked   : your task sitting in the blocked column
 *   - assigned  : a task assigned to you since you were last here
 *   - fyi       : a teammate's record or shared knowledge since you were last here
 */
export function computeSyncFeed(input: SyncInput, dismissedKeys: Set<string> = new Set()): SyncItem[] {
  const { memberName, tasks, updates, knowledge, lastSeenAt } = input;
  const now = input.now ?? new Date();
  const items: SyncItem[] = [];
  const doneNames = new Set(tasks.filter((t) => t.status === "done").map((t) => t.name.toLowerCase()));

  items.push(...dueSignals(memberName, tasks, now));

  for (const t of tasks) {
    if (!isMine(t, memberName) || t.status === "done") continue;

    // Unblocked: a dependency task named in this task's deps text is now done.
    if (t.dependencies) {
      const deps = t.dependencies.toLowerCase();
      const clearedBy = [...doneNames].find((n) => n.length > 2 && deps.includes(n));
      if (clearedBy) {
        items.push({
          key: `unblocked:${t.name.toLowerCase()}`,
          verdict: "unblocked",
          intensity: "proactive",
          text: `“${t.name}” looks unblocked — a dependency is done.`,
          actionable: true,
          taskName: t.name,
          boardId: t.boardId,
          fromName: null,
          createdAt: now.toISOString(),
        });
      }
    }

    // Blocked: sitting in the blocked column.
    if (t.status === "blocked") {
      items.push({
        key: `blocked:${t.name.toLowerCase()}`,
        verdict: "blocked",
        intensity: "ambient",
        text: `“${t.name}” is blocked.`,
        actionable: true,
        taskName: t.name,
        boardId: t.boardId,
        fromName: null,
        createdAt: now.toISOString(),
      });
    }

    // Assigned: a task that landed on your plate since you were last here.
    if (t.status === "new" && after(t.createdAt, lastSeenAt)) {
      items.push({
        key: `assigned:${t.name.toLowerCase()}`,
        verdict: "assigned",
        intensity: "ambient",
        text: `New on your plate: “${t.name}”.`,
        actionable: true,
        taskName: t.name,
        boardId: t.boardId,
        fromName: null,
        createdAt: t.createdAt,
      });
    }
  }

  // FYI: teammates' records and shared knowledge since you were last here.
  for (const u of updates) {
    if (u.author && u.author.toLowerCase() === memberName.toLowerCase()) continue;
    if (!after(u.createdAt, lastSeenAt)) continue;
    items.push({
      key: `fyi-update:${u.title.toLowerCase()}`,
      verdict: "fyi",
      intensity: "ambient",
      text: `${u.author ?? "Someone"} posted “${u.title}”${u.summary ? ` — ${u.summary}` : ""}.`,
      actionable: false,
      taskName: null,
      boardId: null,
      fromName: u.author,
      createdAt: u.createdAt,
    });
  }
  for (const k of knowledge) {
    if (!after(k.createdAt, lastSeenAt)) continue;
    const strong = k.importance === "important" || k.importance === "critical";
    items.push({
      key: `fyi-know:${k.tag.toLowerCase()}:${k.createdAt}`,
      verdict: "fyi",
      intensity: strong ? "proactive" : "ambient",
      text: `${k.importance === "critical" ? "🔴 " : strong ? "❗ " : ""}${k.tag}: ${k.text}`,
      actionable: false,
      taskName: null,
      boardId: null,
      fromName: null,
      createdAt: k.createdAt,
    });
  }

  return items
    .filter((it) => !dismissedKeys.has(it.key))
    .sort((a, b) => {
      const ra = RANK[a.verdict] ?? 9;
      const rb = RANK[b.verdict] ?? 9;
      if (ra !== rb) return ra - rb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

/** The items worth interrupting for right now: proactive + actionable, not yet delivered. */
export function proactiveItems(feed: SyncItem[]): SyncItem[] {
  return feed.filter((it) => it.intensity === "proactive" && it.actionable);
}
