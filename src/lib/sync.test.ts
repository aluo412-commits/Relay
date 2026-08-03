import { test } from "node:test";
import assert from "node:assert/strict";
import { dueSignals, computeSyncFeed, type SyncTask, type SyncInput } from "./sync.ts";

const NOW = new Date(2026, 7, 10);
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const task = (over: Partial<SyncTask>): SyncTask => ({
  name: "T",
  status: "inprogress",
  boardId: "b1",
  due: null,
  ownerName: "Alex",
  dependencies: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...over,
});

const feed = (over: Partial<SyncInput>): SyncInput => ({
  memberName: "Alex",
  tasks: [],
  updates: [],
  knowledge: [],
  lastSeenAt: "2026-08-05T00:00:00.000Z",
  now: NOW,
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

test("computeSyncFeed: unblocked when a named dependency is done", () => {
  const items = computeSyncFeed(
    feed({
      tasks: [
        task({ name: "Wire dashboard", dependencies: "needs the API done first" }),
        task({ name: "API", status: "done", ownerName: "Sam" }),
      ],
    })
  );
  // "API" (len 3) appears in the deps text and is done → unblocked
  assert.ok(items.some((i) => i.verdict === "unblocked" && i.taskName === "Wire dashboard"));
});

test("computeSyncFeed: fyi from a teammate's update since last seen; own update excluded", () => {
  const items = computeSyncFeed(
    feed({
      updates: [
        { title: "Mount done", author: "Sam", summary: "shipped", createdAt: "2026-08-08T00:00:00.000Z" },
        { title: "Mine", author: "Alex", summary: "", createdAt: "2026-08-08T00:00:00.000Z" },
      ],
    })
  );
  assert.ok(items.some((i) => i.verdict === "fyi" && /Sam/.test(i.text)));
  assert.ok(!items.some((i) => /“Mine”|Mine/.test(i.text)));
});

test("computeSyncFeed: irrelevant change yields an empty feed", () => {
  const items = computeSyncFeed(
    feed({
      tasks: [task({ name: "Someone else task", ownerName: "Jordan", status: "inprogress" })],
      updates: [{ title: "old", author: "Sam", summary: "", createdAt: "2026-08-01T00:00:00.000Z" }], // before lastSeen
    })
  );
  assert.equal(items.length, 0);
});

test("computeSyncFeed: dismissed keys are excluded", () => {
  const input = feed({ tasks: [task({ name: "Claw", due: iso(2026, 8, 8) })] });
  const all = computeSyncFeed(input);
  assert.ok(all.length >= 1);
  const dismissed = computeSyncFeed(input, new Set(all.map((i) => i.key)));
  assert.equal(dismissed.length, 0);
});

test("computeSyncFeed: ranks deadline/actionable above fyi", () => {
  const items = computeSyncFeed(
    feed({
      tasks: [task({ name: "Claw", due: iso(2026, 8, 8) })],
      updates: [{ title: "News", author: "Sam", summary: "", createdAt: "2026-08-09T00:00:00.000Z" }],
    })
  );
  assert.equal(items[0].verdict, "deadline");
  assert.equal(items[items.length - 1].verdict, "fyi");
});
