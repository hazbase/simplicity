import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadArtifact, normalizeArtifact, saveArtifact } from "../core/artifact";
import { loadDefinitionInput, buildArtifactDefinitionMetadata } from "../core/definition";
import { buildArtifactStateMetadata, loadStateInput } from "../core/state";

test("normalizeArtifact upgrades v5 artifact to v6", () => {
  const artifact = normalizeArtifact({
    version: 5,
    createdAt: "2026-03-09T00:24:45.818Z",
    simfTemplatePath: "./p2pk_lockheight.simf.tmpl",
    params: {
      minHeight: 2344430,
      signerXonly: "79be",
    },
    compiled: {
      program: "prog",
      cmr: "cmr",
      internalKey: "internal",
      contractAddress: "tex1",
    },
    toolchain: {
      simcPath: "/usr/bin/simc",
      halSimplicity: "hal-simplicity 0.2.0",
    },
  });

  assert.equal(artifact.version, 6);
  assert.equal(artifact.kind, "simplicity-artifact");
  assert.equal(artifact.compiled.contractAddress, "tex1");
  assert.equal(artifact.legacy?.params?.minHeight, 2344430);
  assert.equal(artifact.definition, undefined);
});

test("saveArtifact/loadArtifact roundtrip preserves definition metadata", async () => {
  const definition = await loadDefinitionInput({
    type: "bond",
    id: "BOND-1",
    value: { issuer: "Hazbase", couponBps: 500 },
  });
  const dir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-artifact-"));
  const simfPath = path.join(dir, "contract.simf");
  const artifactPath = path.join(dir, "artifact.json");
  await writeFile(simfPath, "main := unit", "utf8");
  await saveArtifact(artifactPath, {
    version: 6,
    kind: "simplicity-artifact",
    createdAt: "2026-03-10T00:00:00.000Z",
    network: "liquidtestnet",
    source: {
      mode: "file",
      simfPath,
      templateVars: {},
    },
    compiled: {
      program: "prog",
      cmr: "cmr",
      internalKey: "internal",
      contractAddress: "tex1",
    },
    toolchain: {
      simcPath: "simc",
      halSimplicity: "hal-simplicity",
    },
    metadata: {
      sdkVersion: "0.0.1",
      notes: null,
    },
    definition: buildArtifactDefinitionMetadata(definition),
  });

  const loaded = await loadArtifact(artifactPath, "liquidtestnet");
  assert.equal(loaded.definition?.definitionType, "bond");
  assert.equal(loaded.definition?.definitionId, "BOND-1");
  assert.equal(loaded.definition?.hash, definition.hash);
  assert.equal(loaded.definition?.anchorMode, "artifact-hash-anchor");
});

test("saveArtifact/loadArtifact roundtrip preserves on-chain anchor metadata", async () => {
  const definition = await loadDefinitionInput({
    type: "bond",
    id: "BOND-2",
    value: { issuer: "Hazbase", couponBps: 500 },
  });
  const dir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-artifact-"));
  const simfPath = path.join(dir, "contract.simf");
  const artifactPath = path.join(dir, "artifact.json");
  await writeFile(simfPath, "main := unit", "utf8");
  await saveArtifact(artifactPath, {
    version: 6,
    kind: "simplicity-artifact",
    createdAt: "2026-03-10T00:00:00.000Z",
    network: "liquidtestnet",
    source: {
      mode: "file",
      simfPath,
      templateVars: {},
    },
    compiled: {
      program: "prog",
      cmr: "cmr",
      internalKey: "internal",
      contractAddress: "tex1",
    },
    toolchain: {
      simcPath: "simc",
      halSimplicity: "hal-simplicity",
    },
    metadata: {
      sdkVersion: "0.0.2",
      notes: null,
    },
    definition: buildArtifactDefinitionMetadata(definition, {
      anchorMode: "on-chain-constant-committed",
      onChainAnchor: {
        helper: "nonzero-eq_256",
        templateVar: "DEFINITION_HASH",
        sourceVerified: true,
      },
    }),
  });

  const loaded = await loadArtifact(artifactPath, "liquidtestnet");
  assert.equal(loaded.definition?.anchorMode, "on-chain-constant-committed");
  assert.equal(loaded.definition?.onChainAnchor?.helper, "nonzero-eq_256");
  assert.equal(loaded.definition?.onChainAnchor?.sourceVerified, true);
});

test("saveArtifact/loadArtifact roundtrip preserves state metadata", async () => {
  const state = await loadStateInput({
    type: "bond-issuance",
    id: "ISSUE-1",
    value: { bondId: "BOND-1", issuedPrincipal: 100, outstandingPrincipal: 100, redeemedPrincipal: 0 },
  });
  const dir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-artifact-"));
  const simfPath = path.join(dir, "contract.simf");
  const artifactPath = path.join(dir, "artifact.json");
  await writeFile(simfPath, "main := unit", "utf8");
  await saveArtifact(artifactPath, {
    version: 6,
    kind: "simplicity-artifact",
    createdAt: "2026-03-10T00:00:00.000Z",
    network: "liquidtestnet",
    source: {
      mode: "file",
      simfPath,
      templateVars: {},
    },
    compiled: {
      program: "prog",
      cmr: "cmr",
      internalKey: "internal",
      contractAddress: "tex1",
    },
    toolchain: {
      simcPath: "simc",
      halSimplicity: "hal-simplicity",
    },
    metadata: {
      sdkVersion: "0.0.3",
      notes: null,
    },
    state: buildArtifactStateMetadata(state, {
      anchorMode: "on-chain-constant-committed",
      onChainAnchor: {
        helper: "nonzero-eq_256",
        templateVar: "STATE_HASH",
        sourceVerified: true,
      },
    }),
  });

  const loaded = await loadArtifact(artifactPath, "liquidtestnet");
  assert.equal(loaded.state?.stateType, "bond-issuance");
  assert.equal(loaded.state?.stateId, "ISSUE-1");
  assert.equal(loaded.state?.anchorMode, "on-chain-constant-committed");
  assert.equal(loaded.state?.onChainAnchor?.templateVar, "STATE_HASH");
});
