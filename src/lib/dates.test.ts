import { test } from "node:test";
import assert from "node:assert/strict";
import { dueState, daysUntilDue, compareDue, formatDue, parseDue, inferDueDate, SOON_DAYS } from "./dates.ts";

// Fixed "now" so tests are deterministic: 2026-08-10 (a Monday-ish anchor).
const NOW = new Date(2026, 7, 10);
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

test("dueState: overdue / today / soon / none", () => {
  assert.equal(dueState(iso(2026, 8, 9), NOW), "overdue"); // yesterday
  assert.equal(dueState(iso(2026, 8, 10), NOW), "today");
  assert.equal(dueState(iso(2026, 8, 12), NOW), "soon"); // +2 days
  assert.equal(dueState(null, NOW), "none");
  assert.equal(dueState("", NOW), "none");
});

test("dueState: SOON_DAYS boundary is inclusive; beyond it is not flagged", () => {
  assert.equal(dueState(iso(2026, 8, 10 + SOON_DAYS), NOW), "soon"); // exactly +3 → soon
  assert.equal(dueState(iso(2026, 8, 10 + SOON_DAYS + 1), NOW), "none"); // +4 → not flagged
});

test("daysUntilDue: whole calendar days, sign correct", () => {
  assert.equal(daysUntilDue(iso(2026, 8, 10), NOW), 0);
  assert.equal(daysUntilDue(iso(2026, 8, 13), NOW), 3);
  assert.equal(daysUntilDue(iso(2026, 8, 7), NOW), -3);
  assert.equal(daysUntilDue(null, NOW), null);
});

test("parseDue / formatDue: valid, empty, garbage", () => {
  assert.ok(parseDue(iso(2026, 8, 10)) instanceof Date);
  assert.equal(parseDue(""), null);
  assert.equal(parseDue("not-a-date"), null);
  assert.equal(formatDue(null), "");
  assert.equal(formatDue(iso(2026, 8, 5)), "Aug 5");
});

test("inferDueDate: relative, weekday, absolute, and Chinese deadlines", () => {
  assert.equal(inferDueDate("finish this tomorrow", NOW), iso(2026, 8, 11));
  assert.equal(inferDueDate("by Friday", NOW), iso(2026, 8, 14));
  assert.equal(inferDueDate("next Monday", NOW), iso(2026, 8, 17));
  assert.equal(inferDueDate("下周一完成", NOW), iso(2026, 8, 17));
  assert.equal(inferDueDate("in 2 weeks", NOW), iso(2026, 8, 24));
  assert.equal(inferDueDate("三天后", NOW), iso(2026, 8, 13));
  assert.equal(inferDueDate("within 48 hours", NOW), iso(2026, 8, 12));
  assert.equal(inferDueDate("August 20", NOW), iso(2026, 8, 20));
  assert.equal(inferDueDate("2026年8月22日", NOW), iso(2026, 8, 22));
  assert.equal(inferDueDate("下个月 5号", NOW), iso(2026, 9, 5));
  assert.equal(inferDueDate("no deadline mentioned", NOW), null);
});

test("compareDue: overdue < today < soon < undated; earlier date first within rank", () => {
  const items = [null, iso(2026, 8, 12), iso(2026, 8, 9), iso(2026, 8, 10), iso(2026, 8, 11)];
  const sorted = [...items].sort((a, b) => compareDue(a, b, NOW));
  assert.deepEqual(sorted, [iso(2026, 8, 9), iso(2026, 8, 10), iso(2026, 8, 11), iso(2026, 8, 12), null]);
});
