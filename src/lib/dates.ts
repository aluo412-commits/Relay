// Optional task due dates. Stored on Task.due as an ISO "YYYY-MM-DD" string;
// unset (null/"") is a first-class, common state — never coerced to a date.

export type DueState = "none" | "soon" | "today" | "overdue";

export const SOON_DAYS = 3; // "due soon" = within this many days (inclusive)

/** Local calendar day at midnight, so comparisons are date-based, not time-based. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Parse an ISO YYYY-MM-DD into a local midnight Date, or null if absent/invalid. */
export function parseDue(due: string | null | undefined): Date | null {
  if (!due) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** Whole calendar days from today to the due date (negative = past). null if no due. */
export function daysUntilDue(due: string | null | undefined, now: Date = new Date()): number | null {
  const d = parseDue(due);
  if (!d) return null;
  const ms = startOfDay(d).getTime() - startOfDay(now).getTime();
  return Math.round(ms / 86_400_000);
}

/** Derive the display state for a due date. */
export function dueState(due: string | null | undefined, now: Date = new Date()): DueState {
  const days = daysUntilDue(due, now);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= SOON_DAYS) return "soon";
  return "none"; // has a date, but far off — not flagged
}

/** Short human label, e.g. "Aug 5". Empty string if no due date. */
export function formatDue(due: string | null | undefined): string {
  const d = parseDue(due);
  if (!d) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A one-word urgency label for chips ("overdue", "today", "soon"), else "". */
export function dueLabel(due: string | null | undefined, now: Date = new Date()): string {
  const s = dueState(due, now);
  return s === "none" ? "" : s;
}

// Sort ordering for open work: overdue → today → soon → other-dated → undated.
const RANK: Record<DueState, number> = { overdue: 0, today: 1, soon: 2, none: 3 };

/** Comparator: most-urgent due first; undated last; ties broken by the date itself. */
export function compareDue(
  a: string | null | undefined,
  b: string | null | undefined,
  now: Date = new Date()
): number {
  const ra = RANK[dueState(a, now)];
  const rb = RANK[dueState(b, now)];
  if (ra !== rb) return ra - rb;
  const da = parseDue(a);
  const db = parseDue(b);
  if (da && db) return da.getTime() - db.getTime();
  if (da) return -1; // a is dated, b is not → a first
  if (db) return 1;
  return 0;
}
