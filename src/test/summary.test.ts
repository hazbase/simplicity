import test from "node:test";
import assert from "node:assert/strict";
import { stableStringify, summarize } from "../core/summary";

test("stableStringify sorts object keys", () => {
  const a = stableStringify({ b: 1, a: 2 });
  const b = stableStringify({ a: 2, b: 1 });
  assert.equal(a, b);
});

test("summarize returns deterministic hash", () => {
  const left = summarize({ z: 1, a: [2, 3] });
  const right = summarize({ a: [2, 3], z: 1 });
  assert.equal(left.canonicalJson, right.canonicalJson);
  assert.equal(left.hash, right.hash);
});
