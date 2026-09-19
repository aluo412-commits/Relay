import { test } from "node:test";
import assert from "node:assert/strict";
import { keepIfEqual, startWorkspaceSync, trackedFetch } from "./liveSync.ts";

const wait = () => new Promise(resolve => setTimeout(resolve, 0));
const clock = () => ({ revision: 0, pending: 0 });

test("live snapshots update without reloading and unchanged snapshots keep references", async () => {
  const data = { tasks: ["one"] };
  assert.equal(keepIfEqual(data, { tasks: ["one"] }), data);
  assert.notEqual(keepIfEqual(data, { tasks: ["two"] }), data);
  const received: unknown[] = [];
  const headers: (HeadersInit | undefined)[] = [];
  let calls = 0;
  const request: typeof fetch = async (_, init) => {
    headers.push(init?.headers);
    calls++;
    return calls === 2 ? new Response(null, { status: 304 }) : new Response(JSON.stringify({ tasks: calls === 1 ? ["one"] : ["one", "teammate task"] }), { headers: { ETag: '"v1"' } });
  };
  const sync = startWorkspaceSync({ request, clock: clock(), visible: () => true, apply: d => received.push(d), intervalMs: 100000 });
  try {
    await wait(); sync.refresh(); await wait();
    assert.equal(received.length, 1);
    assert.deepEqual(headers[1], { "If-None-Match": '"v1"' });
    sync.refresh(); await wait();
    assert.deepEqual(received.at(-1), { tasks: ["one", "teammate task"] });
  } finally { sync.stop(); }
});

test("a late snapshot cannot undo a local mutation or update an unmounted workspace", async () => {
  let resolve!: (r: Response) => void;
  const request: typeof fetch = () => new Promise(r => { resolve = r; });
  const mutation = clock();
  const received: unknown[] = [];
  const sync = startWorkspaceSync({ request, clock: mutation, visible: () => true, apply: d => received.push(d), intervalMs: 100000 });
  mutation.revision++;
  resolve(new Response('{"old":true}'));
  await wait();
  assert.equal(received.length, 0);
  sync.refresh(); sync.stop();
  resolve(new Response('{"old":true}'));
  await wait();
  assert.equal(received.length, 0);
});

test("hidden tabs skip polling; writes are tracked even when requests fail", async () => {
  let calls = 0, visible = false;
  const mutation = clock();
  const request: typeof fetch = async () => { calls++; return new Response("{}"); };
  const sync = startWorkspaceSync({ request, clock: mutation, visible: () => visible, apply: () => {}, intervalMs: 100000 });
  try {
    await wait(); assert.equal(calls, 0);
    visible = true; sync.refresh(); await wait(); assert.equal(calls, 1);
  } finally { sync.stop(); }
  const wrapped = trackedFetch(async () => { throw new Error("offline"); }, mutation);
  await assert.rejects(wrapped("/api/publish", { method: "POST" }));
  assert.equal(mutation.pending, 0);
  assert.equal(mutation.revision, 2);
});
