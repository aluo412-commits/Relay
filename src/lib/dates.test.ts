import { test } from "node:test";
import assert from "node:assert/strict";
import { dueState, daysUntilDue, compareDue, formatDue, parseDue, SOON_DAYS } from "./dates.ts";

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

test("compareDue: overdue < today < soon < undated; earlier date first within rank", () => {
  const items = [null, iso(2026, 8, 12), iso(2026, 8, 9), iso(2026, 8, 10), iso(2026, 8, 11)];
  const sorted = [...items].sort((a, b) => compareDue(a, b, NOW));
  assert.deepEqual(sorted, [iso(2026, 8, 9), iso(2026, 8, 10), iso(2026, 8, 11), iso(2026, 8, 12), null]);
});
