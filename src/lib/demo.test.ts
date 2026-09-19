import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoTransport, DEMO_REQUEST, DEMO_LOG, DEMO_TASK } from "./demo.ts";

const post = (body = {}) => ({ method: "POST", body: JSON.stringify(body) });

test("scripted tour: draft → edited publication → partial log → evaluation", async () => {
  const fetch = createDemoTransport();
  const initial = await (await fetch("/api/state")).json();
  assert.equal(initial.state.boards[0].tasks.length, 1);
  assert.deepEqual((await (await fetch("/api/reconcile", post())).json()).items, []);
  const events = (await (await fetch("/api/chat", post({ message: DEMO_REQUEST }))).text()).trim().split("\n").map(line => JSON.parse(line));
  const draft = events.at(-1).drafts[0];
  assert.equal(draft.tasks[0].name, DEMO_TASK);
  assert.match(draft.tasks[0].due, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await (await fetch("/api/state")).json()).state.boards[0].tasks.length, 1, "a draft is not published");
  draft.tasks[0].due = "2027-02-01";
  draft.tasks[0].owner = "Jordan";
  const published = await (await fetch("/api/publish", post({ draft }))).json();
  assert.equal(published.state.boards[0].tasks[1].due, "2027-02-01");
  assert.equal(published.state.boards[0].tasks[1].owner.name, "Jordan");
  const logged = await (await fetch("/api/log", post({ text: DEMO_LOG }))).json();
  assert.equal(logged.state.boards[0].tasks[1].status, "inprogress");
  assert.equal(logged.state.boards[0].tasks[0].status, "blocked");
  assert.equal(logged.state.updates.length, 1);
  assert.match(logged.entry.synced, /not Done/);
  const reviewed = await (await fetch("/api/reconcile", post())).json();
  assert.equal(reviewed.items.length, 1);
  assert.match(reviewed.items[0].text, /encoder direction has no completion evidence/);
  assert.deepEqual((await (await fetch("/api/reconcile", post())).json()).items, reviewed.items, "evaluation is repeatable");
});

test("sandbox isolates instances and fails closed for unsupported routes", async () => {
  const sandbox = createDemoTransport();
  assert.equal((await sandbox("/api/workspace", post())).status, 400);
  assert.equal((await sandbox("/api/files", post())).status, 400);
  assert.equal((await sandbox("https://example.invalid/unknown", post())).status, 400);
  await sandbox("/api/chat", post({ message: DEMO_REQUEST }));
  const fresh = createDemoTransport();
  assert.deepEqual((await (await fresh("/api/state")).json()).messages, []);
});
