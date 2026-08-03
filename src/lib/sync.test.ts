import { test } from "node:test";
import assert from "node:assert/strict";
import { dueSignals, type SyncTask } from "./sync.ts";

const NOW = new Date(2026, 7, 10);
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const task = (over: Partial<SyncTask>): SyncTask => ({
  name: "T",
  status: "inprogress",
  boardId: "b1",
  due: null,
  ownerName: "Alex",
  ...over,
});

test("dueSignals: overdue own task → one proactive, actionable deadline item", () => {
  const items = dueSignals("Alex", [task({ name: "Claw", due: iso(2026, 8, 8) })], NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0].verdict, "deadline");
  assert.equal(items[0].intensity, "proactive");
  assert.equal(items[0].actionable, true);
  assert.match(items[0].text, /overdue/);
});

test("dueSignals: soon → ambient, not actionable", () => {
  const items = dueSignals("Alex", [task({ due: iso(2026, 8, 12) })], NOW);
  assert.equal(items[0].intensity, "ambient");
  assert.equal(items[0].actionable, false);
});

test("dueSignals: no-due and far-off tasks produce nothing", () => {
  const items = dueSignals("Alex", [task({ due: null }), task({ due: iso(2026, 12, 1) })], NOW);
  assert.equal(items.length, 0);
});

test("dueSignals: someone else's overdue task is not mine", () => {
  const items = dueSignals("Alex", [task({ ownerName: "Sam", due: iso(2026, 8, 1) })], NOW);
  assert.equal(items.length, 0);
});

test("dueSignals: a done task never signals", () => {
  const items = dueSignals("Alex", [task({ status: "done", due: iso(2026, 8, 1) })], NOW);
  assert.equal(items.length, 0);
});
