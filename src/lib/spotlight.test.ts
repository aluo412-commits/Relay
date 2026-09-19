import { test } from "node:test";
import assert from "node:assert/strict";
import { interpolateSpotlight } from "./spotlight.ts";

test("spotlight transitions use one rectangle and settle exactly on their target", () => {
  const composer = { top: 850, left: 280, right: 1100, bottom: 910 };
  const draft = { top: 78, left: 500, right: 1072, bottom: 710 };
  assert.deepEqual(interpolateSpotlight(composer, draft, 0), composer);
  assert.deepEqual(interpolateSpotlight(composer, draft, 1), draft);
  assert.deepEqual(interpolateSpotlight(composer, draft, 2), draft);
  for (const progress of [.1, .25, .5, .75]) {
    const r = interpolateSpotlight(composer, draft, progress);
    assert.ok(r.right > r.left && r.bottom > r.top);
    assert.ok(r.top > draft.top && r.top < composer.top);
  }
});
