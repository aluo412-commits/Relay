import { test } from "node:test";
import assert from "node:assert/strict";
import { selectRecallIds } from "./recall.ts";

test("recall stays bounded and ranks matching memory without an AI call", () => {
  const entries = [
    { id: "a", heading: "Budget", summary: "Travel costs" },
    { id: "b", heading: "Encoder verification", summary: "Motor direction checks" },
    { id: "c", heading: "Intake", summary: "Geometry" },
    { id: "d", heading: "控制器接线", summary: "电机验证" },
  ];
  assert.equal(selectRecallIds("encoder checks", entries)[0], "b");
  assert.equal(selectRecallIds("接线完成了吗", entries)[0], "d");
  assert.deepEqual(selectRecallIds("continue", entries), ["a", "b"]);
  assert.deepEqual(selectRecallIds("", entries), []);
  assert.deepEqual(selectRecallIds("continue", entries.slice(0, 2)), ["a", "b"]);
});
