import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildArtifactDefinitionMetadata,
  detectOnChainDefinitionAnchor,
  loadDefinitionInput,
  verifyDefinitionAgainstArtifact,
  verifyDefinitionDescriptorAgainstArtifact,
} from "../core/definition";
import { DefinitionError, UnsupportedFeatureError, ValidationError } from "../core/errors";
import { compileFromFile, compileFromPreset } from "../core/compiler";
import { SimplicityArtifact, SimplicityClientConfig } from "../core/types";

const execFileAsync = promisify(execFile);

const TEST_CONFIG: SimplicityClientConfig = {
  network: "liquidtestnet",
  rpc: {
    url: "http://127.0.0.1:18884",
    username: "user",
    password: "pass",
    wallet: "simplicity-test",
  },
  toolchain: {
    simcPath: "simc",
    halSimplicityPath: "hal-simplicity",
    elementsCliPath: "eltc",
  },
};

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
  assert.equal(result.trust.artifactMatch, true);
  assert.equal(result.trust.effectiveMode, "artifact-hash-anchor");
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
  assert.equal(result.trust.effectiveMode, "artifact-hash-anchor");
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

test("detectOnChainDefinitionAnchor succeeds for blessed helper pattern", () => {
  const source = `
fn require_definition_anchor() {
    let anchored_definition_hash: u256 = 0x{{DEFINITION_HASH}};
    let zero_hash: u256 = 0x0000000000000000000000000000000000000000000000000000000000000000;
    assert!(not(jet::eq_256(anchored_definition_hash, zero_hash)));
}

fn main() {
    require_definition_anchor();
}
`;
  const result = detectOnChainDefinitionAnchor(source);
  assert.equal(result.sourceVerified, true);
  assert.equal(result.helper, "nonzero-eq_256");
});

test("detectOnChainDefinitionAnchor fails when helper is not called", () => {
  const source = `
fn require_definition_anchor() {
    let anchored_definition_hash: u256 = 0x{{DEFINITION_HASH}};
    let zero_hash: u256 = 0x0000000000000000000000000000000000000000000000000000000000000000;
    assert!(not(jet::eq_256(anchored_definition_hash, zero_hash)));
}

fn main() {
    unit
}
`;
  const result = detectOnChainDefinitionAnchor(source);
  assert.equal(result.sourceVerified, false);
  assert.match(result.reason ?? "", /not called/i);
});

test("detectOnChainDefinitionAnchor ignores blessed strings in comments", () => {
  const source = `
/*
fn require_definition_anchor() {
    let anchored_definition_hash: u256 = 0x{{DEFINITION_HASH}};
    let zero_hash: u256 = 0x0000000000000000000000000000000000000000000000000000000000000000;
    assert!(not(jet::eq_256(anchored_definition_hash, zero_hash)));
}
*/
fn main() {
    // require_definition_anchor();
    unit
}
`;
  const result = detectOnChainDefinitionAnchor(source);
  assert.equal(result.sourceVerified, false);
  assert.match(result.reason ?? "", /placeholder is missing|helper function is missing/i);
});

test("detectOnChainDefinitionAnchor requires call from main, not other function", () => {
  const source = `
fn not(bit: bool) -> bool {
    <u1>::into(jet::complement_1(<bool>::into(bit)))
}

fn require_definition_anchor() {
    let anchored_definition_hash: u256 = 0x{{DEFINITION_HASH}};
    let zero_hash: u256 = 0x0000000000000000000000000000000000000000000000000000000000000000;
    assert!(not(jet::eq_256(anchored_definition_hash, zero_hash)));
}

fn call_helper() {
    require_definition_anchor();
}

fn main() {
    unit
}
`;
  const result = detectOnChainDefinitionAnchor(source);
  assert.equal(result.sourceVerified, false);
  assert.match(result.reason ?? "", /not called from main/i);
});

test("compileFromFile rejects on-chain mode when helper pattern is malformed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-definition-"));
  const simfPath = path.join(dir, "broken-anchor.simf");
  await writeFile(
    simfPath,
    `
fn main() {
    let anchored_definition_hash: u256 = 0x{{DEFINITION_HASH}};
    unit
}
`,
    "utf8"
  );

  await assert.rejects(
    () =>
      compileFromFile(TEST_CONFIG, {
        simfPath,
        definition: {
          type: "bond",
          id: "BOND-1",
          value: { issuer: "Hazbase" },
          anchorMode: "on-chain-constant-committed",
        },
      }),
    ValidationError
  );
});

test("compileFromFile rejects DEFINITION_HASH override when definition is supplied", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-definition-"));
  const simfPath = path.join(dir, "anchor.simf");
  await writeFile(
    simfPath,
    `
fn not(bit: bool) -> bool {
    <u1>::into(jet::complement_1(<bool>::into(bit)))
}
fn require_definition_anchor() {
    let anchored_definition_hash: u256 = 0x{{DEFINITION_HASH}};
    let zero_hash: u256 = 0x0000000000000000000000000000000000000000000000000000000000000000;
    assert!(not(jet::eq_256(anchored_definition_hash, zero_hash)));
}
fn main() {
    require_definition_anchor();
}
`,
    "utf8"
  );

  await assert.rejects(
    () =>
      compileFromFile(TEST_CONFIG, {
        simfPath,
        templateVars: { DEFINITION_HASH: "deadbeef" },
        definition: {
          type: "bond",
          id: "BOND-1",
          value: { issuer: "Hazbase" },
          anchorMode: "on-chain-constant-committed",
        },
      }),
    (error: unknown) =>
      error instanceof ValidationError &&
      error.details !== undefined &&
      (error.details as { code?: string }).code === "DEFINITION_HASH_OVERRIDE_FORBIDDEN"
  );
});

test("compileFromFile rejects DEFINITION_ID override when definition is supplied", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-definition-"));
  const simfPath = path.join(dir, "anchor.simf");
  await writeFile(
    simfPath,
    `
fn not(bit: bool) -> bool {
    <u1>::into(jet::complement_1(<bool>::into(bit)))
}
fn require_definition_anchor() {
    let anchored_definition_hash: u256 = 0x{{DEFINITION_HASH}};
    let zero_hash: u256 = 0x0000000000000000000000000000000000000000000000000000000000000000;
    assert!(not(jet::eq_256(anchored_definition_hash, zero_hash)));
}
fn main() {
    require_definition_anchor();
}
`,
    "utf8"
  );

  await assert.rejects(
    () =>
      compileFromFile(TEST_CONFIG, {
        simfPath,
        templateVars: { DEFINITION_ID: "BAD-ID" },
        definition: {
          type: "bond",
          id: "BOND-1",
          value: { issuer: "Hazbase" },
          anchorMode: "on-chain-constant-committed",
        },
      }),
    (error: unknown) =>
      error instanceof ValidationError &&
      error.details !== undefined &&
      (error.details as { code?: string }).code === "DEFINITION_ID_OVERRIDE_FORBIDDEN"
  );
});

test("compileFromPreset rejects on-chain constant-committed anchors", async () => {
  await assert.rejects(
    () =>
      compileFromPreset(TEST_CONFIG, {
        preset: "p2pkLockHeight",
        params: {
          MIN_HEIGHT: 2344430,
          SIGNER_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        },
        definition: {
          type: "bond",
          id: "BOND-1",
          value: { issuer: "Hazbase" },
          anchorMode: "on-chain-constant-committed",
        },
      }),
    UnsupportedFeatureError
  );
});

test("definition verify does not trust mutable artifact metadata alone", async () => {
  const definition = await loadDefinitionInput({
    type: "bond",
    id: "BOND-1",
    value: { issuer: "Hazbase", couponBps: 500 },
  });
  const artifact: SimplicityArtifact = {
    version: 6,
    kind: "simplicity-artifact",
    createdAt: "2026-03-10T00:00:00.000Z",
    network: "liquidtestnet",
    source: {
      mode: "file",
      simfPath: "/tmp/does-not-exist.simf",
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
      sdkVersion: "0.1.0",
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
  };

  const result = await verifyDefinitionAgainstArtifact({
    artifact,
    definition: {
      type: "bond",
      id: "BOND-1",
      value: { issuer: "Hazbase", couponBps: 500 },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.trust.artifactMatch, true);
  assert.equal(result.trust.onChainAnchorPresent, true);
  assert.equal(result.trust.onChainAnchorVerified, false);
  assert.equal(result.trust.effectiveMode, "on-chain-constant-committed");
});

test("different definition hashes change program, cmr, and contract address", async (t) => {
  const simcPath = process.env.SIMC_PATH || "simc";
  const halPath = process.env.HAL_SIMPLICITY_PATH || "hal-simplicity";
  try {
    await execFileAsync(simcPath, ["--help"]);
    await execFileAsync(halPath, ["--version"]);
  } catch {
    t.skip("simc/hal-simplicity are not available");
    return;
  }

  const simfPath = path.resolve(
    "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-anchor.simf"
  );
  const left = await compileFromFile(
    {
      ...TEST_CONFIG,
      toolchain: {
        ...TEST_CONFIG.toolchain,
        simcPath,
        halSimplicityPath: halPath,
      },
    },
    {
      simfPath,
      templateVars: {
        MIN_HEIGHT: 2344430,
        SIGNER_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      },
      definition: {
        type: "bond",
        id: "BOND-1",
        value: { issuer: "Hazbase", couponBps: 500 },
        anchorMode: "on-chain-constant-committed",
      },
    }
  );
  const right = await compileFromFile(
    {
      ...TEST_CONFIG,
      toolchain: {
        ...TEST_CONFIG.toolchain,
        simcPath,
        halSimplicityPath: halPath,
      },
    },
    {
      simfPath,
      templateVars: {
        MIN_HEIGHT: 2344430,
        SIGNER_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      },
      definition: {
        type: "bond",
        id: "BOND-1",
        value: { issuer: "Hazbase", couponBps: 600 },
        anchorMode: "on-chain-constant-committed",
      },
    }
  );

  assert.notEqual(left.compiled.program, right.compiled.program);
  assert.notEqual(left.compiled.cmr, right.compiled.cmr);
  assert.notEqual(left.compiled.contractAddress, right.compiled.contractAddress);
});
