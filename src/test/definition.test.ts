import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildArtifactDefinitionMetadata,
  loadDefinitionInput,
  verifyDefinitionDescriptorAgainstArtifact,
} from "../core/definition";
import { DefinitionError } from "../core/errors";

test("definition hash is stable regardless of object key order", async () => {
  const left = await loadDefinitionInput({
    type: "bond",
    id: "BOND-1",
    value: { issuer: "Hazbase", couponBps: 500 },
  });
  const right = await loadDefinitionInput({
    type: "bond",
    id: "BOND-1",
    value: { couponBps: 500, issuer: "Hazbase" },
  });

  assert.equal(left.canonicalJson, right.canonicalJson);
  assert.equal(left.hash, right.hash);
});

test("definition hash changes when array order changes", async () => {
  const left = await loadDefinitionInput({
    type: "schedule",
    id: "S-1",
    value: { dates: ["2026-01-01", "2026-07-01"] },
  });
  const right = await loadDefinitionInput({
    type: "schedule",
    id: "S-1",
    value: { dates: ["2026-07-01", "2026-01-01"] },
  });

  assert.notEqual(left.hash, right.hash);
});

test("definition can be loaded from jsonPath", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-definition-"));
  const jsonPath = path.join(dir, "bond.json");
  await writeFile(jsonPath, JSON.stringify({ issuer: "Hazbase", couponBps: 500 }), "utf8");

  const descriptor = await loadDefinitionInput({
    type: "bond",
    id: "BOND-1",
    jsonPath,
  });

  assert.equal(descriptor.sourcePath, jsonPath);
  assert.match(descriptor.hash, /^[0-9a-f]{64}$/);
});

test("invalid json throws DefinitionError", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-definition-"));
  const jsonPath = path.join(dir, "broken.json");
  await writeFile(jsonPath, "{", "utf8");

  await assert.rejects(
    () => loadDefinitionInput({ type: "bond", id: "BOND-1", jsonPath }),
    DefinitionError
  );
});

test("jsonPath and value together reject", async () => {
  await assert.rejects(
    () =>
      loadDefinitionInput({
        type: "bond",
        id: "BOND-1",
        jsonPath: "/tmp/example.json",
        value: { issuer: "Hazbase" },
      }),
    DefinitionError
  );
});

test("missing type rejects", async () => {
  await assert.rejects(
    () => loadDefinitionInput({ type: "", id: "BOND-1", value: { issuer: "Hazbase" } }),
    DefinitionError
  );
});

test("missing id rejects", async () => {
  await assert.rejects(
    () => loadDefinitionInput({ type: "bond", id: "", value: { issuer: "Hazbase" } }),
    DefinitionError
  );
});

test("definition verification succeeds for matching artifact metadata", async () => {
  const definition = await loadDefinitionInput({
    type: "bond",
    id: "BOND-1",
    value: { issuer: "Hazbase", couponBps: 500 },
  });
  const result = verifyDefinitionDescriptorAgainstArtifact(
    definition,
    buildArtifactDefinitionMetadata(definition)
  );
  assert.equal(result.ok, true);
});

test("definition verification returns mismatch reason for tampered content", async () => {
  const original = await loadDefinitionInput({
    type: "bond",
    id: "BOND-1",
    value: { issuer: "Hazbase", couponBps: 500 },
  });
  const tampered = await loadDefinitionInput({
    type: "bond",
    id: "BOND-1",
    value: { issuer: "Hazbase", couponBps: 600 },
  });
  const result = verifyDefinitionDescriptorAgainstArtifact(
    tampered,
    buildArtifactDefinitionMetadata(original)
  );
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /hash mismatch/i);
});

test("definition descriptor canonicalJson roundtrips as valid json", async () => {
  const descriptor = await loadDefinitionInput({
    type: "bond",
    id: "BOND-1",
    value: { issuer: "Hazbase", couponBps: 500 },
  });
  const parsed = JSON.parse(descriptor.canonicalJson) as { issuer: string; couponBps: number };
  assert.equal(parsed.issuer, "Hazbase");
  assert.equal(parsed.couponBps, 500);
});
