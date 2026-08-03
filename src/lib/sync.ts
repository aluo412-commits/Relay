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
