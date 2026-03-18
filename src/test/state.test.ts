import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadStateInput, detectOnChainStateAnchor, buildArtifactStateMetadata, verifyStateAgainstArtifact } from "../core/state";
import { SimplicityArtifact } from "../core/types";
import { DefinitionError, UnsupportedFeatureError } from "../core/errors";
import { compileFromFile, compileFromPreset } from "../core/compiler";
import { SimplicityClientConfig } from "../core/types";

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

test("state hash is stable regardless of object key order", async () => {
  const left = await loadStateInput({
    type: "bond-issuance",
    id: "ISSUE-1",
    value: { bondId: "BOND-1", outstandingPrincipal: 100, redeemedPrincipal: 0 },
  });
  const right = await loadStateInput({
    type: "bond-issuance",
    id: "ISSUE-1",
    value: { redeemedPrincipal: 0, outstandingPrincipal: 100, bondId: "BOND-1" },
  });
  assert.equal(left.canonicalJson, right.canonicalJson);
  assert.equal(left.hash, right.hash);
});

test("state hash changes when outstandingPrincipal changes", async () => {
  const left = await loadStateInput({
    type: "bond-issuance",
    id: "ISSUE-1",
    value: { bondId: "BOND-1", outstandingPrincipal: 100, redeemedPrincipal: 0 },
  });
  const right = await loadStateInput({
    type: "bond-issuance",
    id: "ISSUE-1",
    value: { bondId: "BOND-1", outstandingPrincipal: 90, redeemedPrincipal: 10 },
  });
  assert.notEqual(left.hash, right.hash);
});

test("state rejects jsonPath and value together", async () => {
  await assert.rejects(
    () =>
      loadStateInput({
        type: "bond-issuance",
        id: "ISSUE-1",
        jsonPath: "/tmp/example.json",
        value: { bondId: "BOND-1" },
      }),
    DefinitionError
  );
});

test("detectOnChainStateAnchor rejects comments and requires main call", () => {
  const source = `
/*
fn require_state_anchor() {
  let anchored_state_hash: u256 = 0x{{STATE_HASH}};
  let zero_hash: u256 = 0x0000000000000000000000000000000000000000000000000000000000000000;
  assert!(not(jet::eq_256(anchored_state_hash, zero_hash)));
}
*/
fn main() {
  unit
}
`;
  const result = detectOnChainStateAnchor(source);
  assert.equal(result.sourceVerified, false);
});

test("verifyStateAgainstArtifact does not trust mutable artifact metadata alone", async () => {
  const state = await loadStateInput({
    type: "bond-issuance",
    id: "ISSUE-1",
    value: { bondId: "BOND-1", issuedPrincipal: 100, outstandingPrincipal: 100, redeemedPrincipal: 0 },
  });
  const artifact: SimplicityArtifact = {
    version: 6,
    kind: "simplicity-artifact",
    createdAt: "2026-03-10T00:00:00.000Z",
    network: "liquidtestnet",
    source: {
      mode: "file",
      simfPath: "/tmp/missing-bond-state.simf",
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
  };

  const result = await verifyStateAgainstArtifact({
    artifact,
    state: {
      type: "bond-issuance",
      id: "ISSUE-1",
      value: { bondId: "BOND-1", issuedPrincipal: 100, outstandingPrincipal: 100, redeemedPrincipal: 0 },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.trust.artifactMatch, true);
  assert.equal(result.trust.onChainAnchorPresent, true);
  assert.equal(result.trust.onChainAnchorVerified, false);
  assert.equal(result.trust.effectiveMode, "on-chain-constant-committed");
});

test("compileFromPreset rejects on-chain constant-committed state anchors", async () => {
  await assert.rejects(
    () =>
      compileFromPreset(TEST_CONFIG, {
        preset: "p2pkLockHeight",
        params: {
          MIN_HEIGHT: 2344430,
          SIGNER_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        },
        state: {
          type: "bond-issuance",
          id: "ISSUE-1",
          value: { bondId: "BOND-1", issuedPrincipal: 100, outstandingPrincipal: 100, redeemedPrincipal: 0 },
          anchorMode: "on-chain-constant-committed",
        },
      }),
    UnsupportedFeatureError
  );
});

test("different issuance state hashes change program, cmr, and contract address", async (t) => {
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
    "docs/definitions/bond-issuance-anchor.simf"
  );
  const definition = {
    type: "bond",
    id: "BOND-1",
    value: {
      bondId: "BOND-1",
      issuer: "Hazbase Treasury",
      faceValue: 1000,
      couponBps: 500,
      issueDate: "2026-03-10",
      maturityDate: 2344430,
      currencyAssetId: "bitcoin",
      controllerXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    anchorMode: "on-chain-constant-committed" as const,
  };
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
      definition,
      state: {
        type: "bond-issuance",
        id: "ISSUE-1",
        value: {
          issuanceId: "ISSUE-1",
          bondId: "BOND-1",
          issuerEntityId: "hazbase-treasury",
          issuedPrincipal: 1000,
          outstandingPrincipal: 1000,
          redeemedPrincipal: 0,
          currencyAssetId: "bitcoin",
          controllerXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          issuedAt: "2026-03-10T00:00:00Z",
          status: "ISSUED",
        },
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
      definition,
      state: {
        type: "bond-issuance",
        id: "ISSUE-1",
        value: {
          issuanceId: "ISSUE-1",
          bondId: "BOND-1",
          issuerEntityId: "hazbase-treasury",
          issuedPrincipal: 1000,
          outstandingPrincipal: 900,
          redeemedPrincipal: 100,
          currencyAssetId: "bitcoin",
          controllerXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
          issuedAt: "2026-03-10T00:00:00Z",
          status: "ISSUED",
        },
        anchorMode: "on-chain-constant-committed",
      },
    }
  );

  assert.notEqual(left.compiled.program, right.compiled.program);
  assert.notEqual(left.compiled.cmr, right.compiled.cmr);
  assert.notEqual(left.compiled.contractAddress, right.compiled.contractAddress);
});
