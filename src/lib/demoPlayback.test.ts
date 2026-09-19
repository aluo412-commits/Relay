import { test } from "node:test";
import assert from "node:assert/strict";
import { demoPause, scriptedReplyStream } from "./demoPlayback.ts";

const reply = "First read the response. Then open the draft when you are ready.";

test("scripted reply arrives in readable chunks, followed by one done event", async () => {
  const reader = scriptedReplyStream(reply, { type: "done", drafts: ["draft"] }, { pace: .01 }).getReader();
  const decoder = new TextDecoder();
  const first = await reader.read();
  const event = JSON.parse(decoder.decode(first.value).trim());
  assert.equal(event.type, "delta");
  assert.ok(event.text.length < reply.length);
  let output = decoder.decode(first.value);
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    output += decoder.decode(chunk.value);
  }
  const events = output.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events.filter(e => e.type === "delta").map(e => e.text).join(""), reply);
  assert.equal(events.filter(e => e.type === "done").length, 1);
  assert.equal(events.at(-1).type, "done");
});

test("stopping playback cancels pending animation and prevents the draft event", async () => {
  const abort = new AbortController();
  const reader = scriptedReplyStream(reply, { type: "done" }, { pace: .01, signal: abort.signal }).getReader();
  await reader.read();
  abort.abort();
  await assert.rejects(reader.read(), { name: "AbortError" });
  await assert.rejects(demoPause(1, abort.signal), { name: "AbortError" });
});

test("reduced motion reveals the whole reply without a typewriter effect", async () => {
  const raw = await new Response(scriptedReplyStream(reply, { type: "done" }, { pace: 0, reducedMotion: true })).text();
  const events = raw.trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(events, [{ type: "delta", text: reply }, { type: "done" }]);
});
