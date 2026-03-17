import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { computeRawOutputV1Hash, hashHexBytes } from "../core/outputBinding";
import {
  summarizeExpectedOutputDescriptor,
  buildEvidenceBundle,
  verifyEvidenceBundle,
  buildExpectedOutputDescriptor,
  compileBondScriptBoundSettlementMachine,
  compileBondDescriptorBoundSettlementMachine,
  verifyBondScriptBoundSettlementMachineArtifact,
  verifyBondDescriptorBoundSettlementMachineArtifact,
} from "../domain/bond";
import type { BondExpectedOutputDescriptor, SimplicityArtifact } from "../core/types";
import { createSimplicityClient } from "../client/SimplicityClient";

const execFileAsync = promisify(execFile);

const TEST_CONFIG = {
  network: "liquidtestnet" as const,
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

function makeExpectedOutputDescriptor(
  overrides: Partial<BondExpectedOutputDescriptor> = {},
): BondExpectedOutputDescriptor {
  return {
    nextContractAddress: "tex1pexamplecontractaddress0000000000000000000000000000000000000000",
    nextOutputScriptHash: "a".repeat(64),
    nextOutputHash: "b".repeat(64),
    nextAmountSat: 1900,
    assetId: "bitcoin",
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
    ...overrides,
  };
}

const RAW_OUTPUT_V1 = {
  assetBytesHex: `01${"22".repeat(32)}`,
  amountBytesHex: "01000000000000076c",
  nonceBytesHex: "00",
  scriptPubKeyHex: `5120${"11".repeat(32)}`,
  rangeProofHex: "",
};

const RAW_OUTPUT_V1_HASHED = {
  assetBytesHex: RAW_OUTPUT_V1.assetBytesHex,
  amountBytesHex: RAW_OUTPUT_V1.amountBytesHex,
  nonceBytesHex: RAW_OUTPUT_V1.nonceBytesHex,
  scriptPubKeyHashHex: hashHexBytes(RAW_OUTPUT_V1.scriptPubKeyHex),
  rangeProofHashHex: hashHexBytes(RAW_OUTPUT_V1.rangeProofHex),
};

async function hasToolchain(): Promise<boolean> {
  try {
    await execFileAsync("simc", ["--version"]);
    await execFileAsync("hal-simplicity", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function hasLocalElementsRpc(): Promise<boolean> {
  try {
    const sdk = createSimplicityClient(TEST_CONFIG);
    await sdk.rpc.call("getblockchaininfo", []);
    return true;
  } catch {
    return false;
  }
}

test("expected output descriptor hash is stable", () => {
  const left = summarizeExpectedOutputDescriptor(makeExpectedOutputDescriptor());
  const right = summarizeExpectedOutputDescriptor(
    JSON.parse(JSON.stringify(makeExpectedOutputDescriptor())),
  );
  assert.equal(left.canonicalJson, right.canonicalJson);
  assert.equal(left.hash, right.hash);
});

test("changing nextContractAddress changes expected output descriptor hash", () => {
  const left = summarizeExpectedOutputDescriptor(makeExpectedOutputDescriptor());
  const right = summarizeExpectedOutputDescriptor(
    makeExpectedOutputDescriptor({
      nextContractAddress: "tex1palternatecontractaddress0000000000000000000000000000000000",
    }),
  );
  assert.notEqual(left.hash, right.hash);
});

test("changing nextAmountSat changes expected output descriptor hash", () => {
  const left = summarizeExpectedOutputDescriptor(makeExpectedOutputDescriptor({ nextAmountSat: 1900 }));
  const right = summarizeExpectedOutputDescriptor(makeExpectedOutputDescriptor({ nextAmountSat: 1800 }));
  assert.notEqual(left.hash, right.hash);
});

test("changing nextOutputHash changes expected output descriptor hash", () => {
  const left = summarizeExpectedOutputDescriptor(makeExpectedOutputDescriptor({ nextOutputHash: "b".repeat(64) }));
  const right = summarizeExpectedOutputDescriptor(makeExpectedOutputDescriptor({ nextOutputHash: "c".repeat(64) }));
  assert.notEqual(left.hash, right.hash);
});

test("descriptor-bound request falls back to script-bound without nextOutputHash", async (t) => {
  if (!(await hasToolchain())) {
    t.skip("simc/hal-simplicity not available");
    return;
  }
  if (!(await hasLocalElementsRpc())) {
    t.skip("local Elements RPC not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const result = await buildExpectedOutputDescriptor(sdk, {
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextAmountSat: 1900,
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
  });

  assert.equal(result.descriptor.outputBindingMode, "script-bound");
  assert.equal(result.descriptor.nextOutputHash, undefined);
  assert.ok(result.descriptor.nextOutputScriptHash);
});

test("bond expected output descriptor auto-derives nextOutputHash for explicit descriptor-bound outputs", async (t) => {
  if (!(await hasToolchain())) {
    t.skip("simc/hal-simplicity not available");
    return;
  }
  if (!(await hasLocalElementsRpc())) {
    t.skip("local Elements RPC not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const result = await buildExpectedOutputDescriptor(sdk, {
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextAmountSat: 1900,
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
  });

  assert.equal(result.descriptor.outputBindingMode, "descriptor-bound");
  assert.equal(result.supportedForm, "explicit-v1");
  assert.equal(result.reasonCode, "OK_EXPLICIT");
  assert.equal(result.autoDerivedNextOutputHash, true);
  assert.match(result.descriptor.nextOutputHash ?? "", /^[0-9a-f]{64}$/);
});

test("bond expected output descriptor keeps descriptor-bound for manual hash on unsupported output forms", async (t) => {
  if (!(await hasToolchain())) {
    t.skip("simc/hal-simplicity not available");
    return;
  }
  if (!(await hasLocalElementsRpc())) {
    t.skip("local Elements RPC not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const result = await buildExpectedOutputDescriptor(sdk, {
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextAmountSat: 1900,
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
    nextOutputHash: "f".repeat(64),
    outputForm: {
      nonceForm: "confidential",
    },
  });

  assert.equal(result.descriptor.outputBindingMode, "descriptor-bound");
  assert.equal(result.supportedForm, "unsupported");
  assert.equal(result.reasonCode, "OK_MANUAL_HASH");
  assert.equal(result.autoDerivedNextOutputHash, false);
  assert.equal(result.descriptor.nextOutputHash, "f".repeat(64));
});

test("bond expected output descriptor auto-derives nextOutputHash for raw-output-v1", async (t) => {
  if (!(await hasToolchain())) {
    t.skip("simc/hal-simplicity not available");
    return;
  }
  if (!(await hasLocalElementsRpc())) {
    t.skip("local Elements RPC not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const result = await buildExpectedOutputDescriptor(sdk, {
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextAmountSat: 1900,
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
    rawOutput: RAW_OUTPUT_V1,
  });

  assert.equal(result.descriptor.outputBindingMode, "descriptor-bound");
  assert.equal(result.supportedForm, "raw-output-v1");
  assert.equal(result.reasonCode, "OK_RAW_OUTPUT");
  assert.equal(result.autoDerivedNextOutputHash, true);
  assert.match(result.descriptor.nextOutputHash ?? "", /^[0-9a-f]{64}$/);
  assert.equal(result.bindingInputs.rawOutputComponents?.scriptPubKey, "raw-bytes");
  assert.equal(result.bindingInputs.rawOutputComponents?.rangeProof, "raw-bytes");
  assert.equal(result.descriptor.nextOutputHash, computeRawOutputV1Hash(RAW_OUTPUT_V1));
});

test("bond expected output descriptor auto-derives nextOutputHash for hash-backed raw-output-v1", async (t) => {
  if (!(await hasToolchain())) {
    t.skip("simc/hal-simplicity not available");
    return;
  }
  if (!(await hasLocalElementsRpc())) {
    t.skip("local Elements RPC not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const result = await buildExpectedOutputDescriptor(sdk, {
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextAmountSat: 1900,
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
    rawOutput: RAW_OUTPUT_V1_HASHED,
  });

  assert.equal(result.descriptor.outputBindingMode, "descriptor-bound");
  assert.equal(result.supportedForm, "raw-output-v1");
  assert.equal(result.reasonCode, "OK_RAW_OUTPUT");
  assert.equal(result.autoDerivedNextOutputHash, true);
  assert.equal(result.bindingInputs.rawOutputComponents?.scriptPubKey, "hash");
  assert.equal(result.bindingInputs.rawOutputComponents?.rangeProof, "hash");
  assert.equal(result.descriptor.nextOutputHash, computeRawOutputV1Hash(RAW_OUTPUT_V1_HASHED));
});

test("bond expected output descriptor falls back for unsupported output forms without manual hash", async (t) => {
  if (!(await hasToolchain())) {
    t.skip("simc/hal-simplicity not available");
    return;
  }
  if (!(await hasLocalElementsRpc())) {
    t.skip("local Elements RPC not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const result = await buildExpectedOutputDescriptor(sdk, {
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextAmountSat: 1900,
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
    outputForm: {
      amountForm: "confidential",
    },
  });

  assert.equal(result.descriptor.outputBindingMode, "script-bound");
  assert.equal(result.supportedForm, "unsupported");
  assert.equal(result.reasonCode, "FALLBACK_UNSUPPORTED_OUTPUT_FORM");
  assert.match(result.fallbackReason ?? "", /explicit-v1/);
  assert.match(result.fallbackReason ?? "", /amountForm=confidential/);
  assert.equal(result.descriptor.nextOutputHash, undefined);
});

test("bond expected output descriptor falls back for incomplete raw-output-v1 inputs", async (t) => {
  if (!(await hasToolchain())) {
    t.skip("simc/hal-simplicity not available");
    return;
  }
  if (!(await hasLocalElementsRpc())) {
    t.skip("local Elements RPC not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const result = await buildExpectedOutputDescriptor(sdk, {
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextAmountSat: 1900,
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
    rawOutput: {
      assetBytesHex: RAW_OUTPUT_V1.assetBytesHex,
      amountBytesHex: RAW_OUTPUT_V1.amountBytesHex,
    },
  });

  assert.equal(result.descriptor.outputBindingMode, "script-bound");
  assert.equal(result.reasonCode, "FALLBACK_INCOMPLETE_RAW_OUTPUT");
  assert.match(result.fallbackReason ?? "", /missing nonceBytesHex, scriptPubKeyHex\|scriptPubKeyHashHex, rangeProofHex\|rangeProofHashHex/);
});

test("bond expected output descriptor falls back for mismatched raw-output-v1 hash components", async (t) => {
  if (!(await hasToolchain())) {
    t.skip("simc/hal-simplicity not available");
    return;
  }
  if (!(await hasLocalElementsRpc())) {
    t.skip("local Elements RPC not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const result = await buildExpectedOutputDescriptor(sdk, {
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextAmountSat: 1900,
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
    rawOutput: {
      ...RAW_OUTPUT_V1,
      rangeProofHashHex: "ff".repeat(32),
    },
  });

  assert.equal(result.descriptor.outputBindingMode, "script-bound");
  assert.equal(result.reasonCode, "FALLBACK_INVALID_RAW_OUTPUT");
  assert.match(result.fallbackReason ?? "", /rangeProofHashHex=mismatch/);
});

test("evidence bundle roundtrip preserves hashes and trust snapshot", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "simplicity-evidence-"));
  const simfPath = path.join(tempDir, "contract.simf");
  await writeFile(simfPath, "fn main() { jet::check_lock_height(0); }", "utf8");

  const artifact: SimplicityArtifact = {
    version: 6,
    kind: "simplicity-artifact",
    createdAt: "2026-03-11T00:00:00.000Z",
    network: "liquidtestnet",
    source: {
      mode: "file",
      simfPath,
      templateVars: {},
    },
    compiled: {
      program: "program",
      cmr: "a".repeat(64),
      internalKey: "b".repeat(64),
      contractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    },
    toolchain: {
      simcPath: "simc",
      halSimplicity: "hal-simplicity",
    },
    metadata: {
      sdkVersion: "0.0.5",
      notes: null,
    },
    definition: {
      definitionType: "bond",
      definitionId: "BOND-1",
      schemaVersion: "1",
      hash: "c".repeat(64),
      trustMode: "hash-anchor",
      anchorMode: "artifact-hash-anchor",
    },
    state: {
      stateType: "bond-issuance",
      stateId: "ISSUE-1",
      schemaVersion: "1",
      hash: "d".repeat(64),
      trustMode: "hash-anchor",
      anchorMode: "artifact-hash-anchor",
    },
  };

  const fakeSdk = {
    verifyDefinitionAgainstArtifact: async () => ({
      ok: true,
      reason: undefined,
      definition: {
        definitionType: "bond",
        definitionId: "BOND-1",
        schemaVersion: "1",
        canonicalJson:
          '{"bondId":"BOND-1","controllerXonly":"79be","couponBps":500,"currencyAssetId":"bitcoin","faceValue":1000,"issueDate":"2026-03-10","issuer":"Hazbase Treasury","maturityDate":2344430}',
        hash: "c".repeat(64),
      },
      artifactDefinition: artifact.definition,
      trust: {
        artifactMatch: true,
        onChainAnchorPresent: false,
        onChainAnchorVerified: false,
        effectiveMode: "artifact-hash-anchor" as const,
      },
    }),
    verifyStateAgainstArtifact: async () => ({
      ok: true,
      reason: undefined,
      state: {
        stateType: "bond-issuance",
        stateId: "ISSUE-1",
        schemaVersion: "1",
        canonicalJson:
          '{"bondId":"BOND-1","controllerXonly":"79be","currencyAssetId":"bitcoin","issuedAt":"2026-03-10T00:00:00Z","issuedPrincipal":1000,"issuanceId":"ISSUE-1","issuerEntityId":"hazbase","outstandingPrincipal":1000,"redeemedPrincipal":0,"status":"ISSUED"}',
        hash: "d".repeat(64),
      },
      artifactState: artifact.state,
      trust: {
        artifactMatch: true,
        onChainAnchorPresent: false,
        onChainAnchorVerified: false,
        effectiveMode: "artifact-hash-anchor" as const,
      },
    }),
  } as any;

  const bundle = await buildEvidenceBundle(fakeSdk, { artifact });
  const verification = await verifyEvidenceBundle(fakeSdk, {
    bundleValue: bundle,
  });

  assert.equal(verification.verified, true);
  assert.equal(verification.checks.definitionHashMatch, true);
  assert.equal(verification.checks.issuanceHashMatch, true);
  assert.equal(verification.checks.cmrMatch, true);
  assert.equal(verification.checks.contractAddressMatch, true);
});

test("compile script-bound settlement machine and verify artifact", async (t) => {
  if (!(await hasToolchain())) {
    t.skip("simc/hal-simplicity not available");
    return;
  }
  if (!(await hasLocalElementsRpc())) {
    t.skip("local Elements RPC not available");
    return;
  }

  const sdk = createSimplicityClient(TEST_CONFIG);
  const tempDir = await mkdtemp(path.join(tmpdir(), "simplicity-script-bound-"));
  const artifactPath = path.join(tempDir, "machine.artifact.json");

  const compiled = await compileBondScriptBoundSettlementMachine(sdk, {
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    previousIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextAmountSat: 1900,
    maxFeeSat: 100,
    artifactPath,
  });

  assert.equal(compiled.outputBindingMode, "script-bound");
  assert.ok(compiled.expectedOutputDescriptorHash);

  const verification = await verifyBondScriptBoundSettlementMachineArtifact(sdk, {
    artifactPath,
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    previousIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextAmountSat: 1900,
    maxFeeSat: 100,
  });

  assert.equal(verification.verified, true);
  assert.equal(verification.outputBindingTrust.mode, "script-bound");
  assert.equal(verification.outputBindingTrust.outputCountRuntimeBound, true);
  assert.equal(verification.outputBindingTrust.feeIndexRuntimeBound, true);
  assert.equal(verification.outputBindingTrust.nextOutputScriptRuntimeBound, true);
});

test("compile descriptor-bound settlement machine and verify artifact", async (t) => {
  if (!(await hasToolchain())) {
    t.skip("simc/hal-simplicity not available");
    return;
  }
  if (!(await hasLocalElementsRpc())) {
    t.skip("local Elements RPC not available");
    return;
  }

  const sdk = createSimplicityClient(TEST_CONFIG);
  const tempDir = await mkdtemp(path.join(tmpdir(), "simplicity-descriptor-bound-"));
  const artifactPath = path.join(tempDir, "machine.artifact.json");

  const compiled = await compileBondDescriptorBoundSettlementMachine(sdk, {
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    previousIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextOutputHash: "f".repeat(64),
    nextAmountSat: 1900,
    maxFeeSat: 100,
    artifactPath,
  });

  assert.equal(compiled.outputBindingMode, "descriptor-bound");
  assert.ok(compiled.expectedOutputDescriptorHash);

  const verification = await verifyBondDescriptorBoundSettlementMachineArtifact(sdk, {
    artifactPath,
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    previousIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextOutputHash: "f".repeat(64),
    nextAmountSat: 1900,
    maxFeeSat: 100,
  });

  assert.equal(verification.verified, true);
  assert.equal(verification.outputBindingTrust.mode, "descriptor-bound");
  assert.equal(verification.outputBindingTrust.nextOutputHashRuntimeBound, true);
});

test("compile descriptor-bound settlement machine auto-derives nextOutputHash for bond flows", async (t) => {
  if (!(await hasToolchain())) {
    t.skip("simc/hal-simplicity not available");
    return;
  }
  if (!(await hasLocalElementsRpc())) {
    t.skip("local Elements RPC not available");
    return;
  }

  const sdk = createSimplicityClient(TEST_CONFIG);
  const tempDir = await mkdtemp(path.join(tmpdir(), "simplicity-bond-descriptor-auto-"));
  const artifactPath = path.join(tempDir, "machine.artifact.json");

  const compiled = await compileBondDescriptorBoundSettlementMachine(sdk, {
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    previousIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextAmountSat: 1900,
    maxFeeSat: 100,
    artifactPath,
  });

  assert.equal(compiled.outputBindingMode, "descriptor-bound");

  const verification = await verifyBondDescriptorBoundSettlementMachineArtifact(sdk, {
    artifactPath,
    definitionPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json"),
    previousIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json"),
    nextIssuancePath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json"),
    nextStateSimfPath: path.resolve("/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf"),
    nextAmountSat: 1900,
    maxFeeSat: 100,
  });

  assert.equal(verification.verified, true);
  assert.equal(verification.outputBindingTrust.mode, "descriptor-bound");
  assert.equal(verification.outputBindingTrust.supportedForm, "explicit-v1");
  assert.equal(verification.outputBindingTrust.reasonCode, "OK_EXPLICIT");
  assert.equal(verification.outputBindingTrust.autoDerived, true);
});
