import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createSimplicityClient } from "../client/SimplicityClient";
import {
  computeRawOutputV1Hash,
  describeOutputBindingSupport,
  evaluateOutputBindingSupport,
  hashHexBytes,
} from "../core/outputBinding";
import {
  buildPolicyOutputDescriptor,
  describePolicyTemplate,
  exportEvidence,
  listPolicyTemplates,
  loadPolicyTemplateManifest,
  summarizePolicyState,
  summarizePolicyOutputDescriptor,
  issue,
  prepareDirectTransfer,
  prepareTransfer,
  validatePolicyTemplateManifest,
  validatePolicyTemplateParams,
  verifyDirectTransfer,
  verifyTransfer,
} from "../domain/policies";
import type { PolicyState } from "../core/types";

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

function makePolicyState(overrides: Partial<PolicyState> = {}): PolicyState {
  return {
    policyTemplateId: "recursive-delay",
    policyHash: "a".repeat(64),
    recipient: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    amountSat: 6000,
    assetId: "bitcoin",
    params: { lockDistanceBlocks: 100 },
    propagationMode: "required",
    previousStateHash: null,
    hop: 0,
    status: "LOCKED",
    ...overrides,
  };
}

const RAW_OUTPUT_V1 = {
  assetBytesHex: `01${"22".repeat(32)}`,
  amountBytesHex: "010000000000001770",
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

test("policy state hash is stable", () => {
  const left = summarizePolicyState(makePolicyState());
  const right = summarizePolicyState(JSON.parse(JSON.stringify(makePolicyState())));
  assert.equal(left.canonicalJson, right.canonicalJson);
  assert.equal(left.hash, right.hash);
});

test("params change policy state hash", () => {
  const left = summarizePolicyState(makePolicyState({ params: { lockDistanceBlocks: 100 } }));
  const right = summarizePolicyState(makePolicyState({ params: { lockDistanceBlocks: 120 } }));
  assert.notEqual(left.hash, right.hash);
});

test("output descriptor hash changes with nextAmountSat", () => {
  const left = summarizePolicyOutputDescriptor({
    nextContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextOutputHash: "b".repeat(64),
    nextOutputScriptHash: "c".repeat(64),
    nextAmountSat: 6000,
    assetId: "bitcoin",
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
  });
  const right = summarizePolicyOutputDescriptor({
    nextContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextOutputHash: "b".repeat(64),
    nextOutputScriptHash: "c".repeat(64),
    nextAmountSat: 5000,
    assetId: "bitcoin",
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
  });
  assert.notEqual(left.hash, right.hash);
});

test("direct-transfer output descriptor hash changes with nextOutputHash", () => {
  const left = summarizePolicyOutputDescriptor({
    nextContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextOutputHash: "d".repeat(64),
    nextOutputScriptHash: "c".repeat(64),
    nextAmountSat: 6000,
    assetId: "bitcoin",
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
  });
  const right = summarizePolicyOutputDescriptor({
    nextContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextOutputHash: "e".repeat(64),
    nextOutputScriptHash: "c".repeat(64),
    nextAmountSat: 6000,
    assetId: "bitcoin",
    feeIndex: 1,
    nextOutputIndex: 0,
    maxFeeSat: 100,
    outputBindingMode: "descriptor-bound",
  });
  assert.notEqual(left.hash, right.hash);
});

test("buildPolicyOutputDescriptor auto-derives nextOutputHash for descriptor-bound explicit outputs", async () => {
  const sdk = {
    rpc: {
      call: async (method: string) => {
        if (method === "getaddressinfo") {
          return {
            scriptPubKey: "5120" + "11".repeat(32),
          };
        }
        if (method === "getsidechaininfo") {
          return {
            pegged_asset: "22".repeat(32),
          };
        }
        throw new Error(`unexpected rpc method: ${method}`);
      },
    },
  } as any;

  const result = await buildPolicyOutputDescriptor(sdk, {
    nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextAmountSat: 6000,
    assetId: "bitcoin",
    outputBindingMode: "descriptor-bound",
  });

  assert.equal(result.descriptor.outputBindingMode, "descriptor-bound");
  assert.equal(
    result.descriptor.nextOutputHash,
    "0b9a6db5cb4e214391603c17323233667ed0c2b431b1e5cfc0d1f2145adfbbc5",
  );
  assert.equal(result.autoDerivedNextOutputHash, true);
  assert.equal(result.supportedForm, "explicit-v1");
  assert.equal(result.reasonCode, "OK_EXPLICIT");
  assert.equal(result.fallbackReason, undefined);
});

test("buildPolicyOutputDescriptor falls back to script-bound when descriptor-bound cannot be derived", async () => {
  const sdk = {
    rpc: {
      call: async (method: string) => {
        if (method === "getaddressinfo") {
          return {
            scriptPubKey: "5120" + "11".repeat(32),
          };
        }
        if (method === "getsidechaininfo") {
          return {
            pegged_asset: "22".repeat(32),
          };
        }
        throw new Error(`unexpected rpc method: ${method}`);
      },
    },
  } as any;

  const result = await buildPolicyOutputDescriptor(sdk, {
    nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextAmountSat: 6000,
    assetId: "unsupported-asset-alias",
    outputBindingMode: "descriptor-bound",
  });

  assert.equal(result.descriptor.outputBindingMode, "script-bound");
  assert.equal(result.descriptor.nextOutputHash, undefined);
  assert.equal(result.supportedForm, "unsupported");
  assert.equal(result.reasonCode, "FALLBACK_UNSUPPORTED_ASSET");
  assert.match(result.fallbackReason ?? "", /descriptor-bound requested/);
});

test("buildPolicyOutputDescriptor auto-derives nextOutputHash for 64-hex asset ids", async () => {
  const sdk = {
    rpc: {
      call: async (method: string) => {
        if (method === "getaddressinfo") {
          return {
            scriptPubKey: "5120" + "11".repeat(32),
          };
        }
        throw new Error(`unexpected rpc method: ${method}`);
      },
    },
  } as any;

  const result = await buildPolicyOutputDescriptor(sdk, {
    nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextAmountSat: 6000,
    assetId: "22".repeat(32),
    outputBindingMode: "descriptor-bound",
  });

  assert.equal(result.descriptor.outputBindingMode, "descriptor-bound");
  assert.equal(
    result.descriptor.nextOutputHash,
    "0b9a6db5cb4e214391603c17323233667ed0c2b431b1e5cfc0d1f2145adfbbc5",
  );
  assert.equal(result.supportedForm, "explicit-v1");
  assert.equal(result.reasonCode, "OK_EXPLICIT");
});

test("buildPolicyOutputDescriptor auto-derives nextOutputHash for raw-output-v1", async () => {
  const sdk = {
    rpc: {
      call: async (method: string) => {
        if (method === "getaddressinfo") {
          return {
            scriptPubKey: "5120" + "11".repeat(32),
          };
        }
        throw new Error(`unexpected rpc method: ${method}`);
      },
    },
  } as any;

  const result = await buildPolicyOutputDescriptor(sdk, {
    nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextAmountSat: 6000,
    assetId: "unsupported-asset-alias",
    rawOutput: RAW_OUTPUT_V1,
    outputForm: {
      assetForm: "confidential",
      amountForm: "confidential",
      nonceForm: "confidential",
      rangeProofForm: "non-empty",
    },
    outputBindingMode: "descriptor-bound",
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

test("buildPolicyOutputDescriptor auto-derives nextOutputHash for hash-backed raw-output-v1", async () => {
  const sdk = {
    rpc: {
      call: async (method: string) => {
        if (method === "getaddressinfo") {
          return {
            scriptPubKey: "5120" + "11".repeat(32),
          };
        }
        throw new Error(`unexpected rpc method: ${method}`);
      },
    },
  } as any;

  const result = await buildPolicyOutputDescriptor(sdk, {
    nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextAmountSat: 6000,
    assetId: "unsupported-asset-alias",
    rawOutput: RAW_OUTPUT_V1_HASHED,
    outputForm: {
      assetForm: "confidential",
      amountForm: "confidential",
      nonceForm: "confidential",
      rangeProofForm: "non-empty",
    },
    outputBindingMode: "descriptor-bound",
  });

  assert.equal(result.descriptor.outputBindingMode, "descriptor-bound");
  assert.equal(result.supportedForm, "raw-output-v1");
  assert.equal(result.reasonCode, "OK_RAW_OUTPUT");
  assert.equal(result.autoDerivedNextOutputHash, true);
  assert.equal(result.bindingInputs.rawOutputComponents?.scriptPubKey, "hash");
  assert.equal(result.bindingInputs.rawOutputComponents?.rangeProof, "hash");
  assert.equal(result.descriptor.nextOutputHash, computeRawOutputV1Hash(RAW_OUTPUT_V1_HASHED));
});

test("buildPolicyOutputDescriptor keeps descriptor-bound for caller supplied nextOutputHash", async () => {
  const sdk = {
    rpc: {
      call: async (method: string) => {
        if (method === "getaddressinfo") {
          return {
            scriptPubKey: "5120" + "11".repeat(32),
          };
        }
        throw new Error(`unexpected rpc method: ${method}`);
      },
    },
  } as any;

  const result = await buildPolicyOutputDescriptor(sdk, {
    nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextAmountSat: 6000,
    assetId: "unsupported-asset-alias",
    nextOutputHash: "33".repeat(32),
    outputBindingMode: "descriptor-bound",
  });

  assert.equal(result.descriptor.outputBindingMode, "descriptor-bound");
  assert.equal(result.supportedForm, "unsupported");
  assert.equal(result.reasonCode, "OK_MANUAL_HASH");
  assert.equal(result.autoDerivedNextOutputHash, false);
  assert.equal(result.descriptor.nextOutputHash, "33".repeat(32));
});

test("buildPolicyOutputDescriptor falls back for unsupported output forms without manual hash", async () => {
  const sdk = {
    rpc: {
      call: async (method: string) => {
        if (method === "getaddressinfo") {
          return {
            scriptPubKey: "5120" + "11".repeat(32),
          };
        }
        throw new Error(`unexpected rpc method: ${method}`);
      },
    },
  } as any;

  const result = await buildPolicyOutputDescriptor(sdk, {
    nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextAmountSat: 6000,
    assetId: "22".repeat(32),
    outputForm: {
      amountForm: "confidential",
    },
    outputBindingMode: "descriptor-bound",
  });

  assert.equal(result.descriptor.outputBindingMode, "script-bound");
  assert.equal(result.supportedForm, "unsupported");
  assert.equal(result.reasonCode, "FALLBACK_UNSUPPORTED_OUTPUT_FORM");
  assert.match(result.fallbackReason ?? "", /outside the explicit-v1 support matrix/);
  assert.match(result.fallbackReason ?? "", /amountForm=confidential/);
});

test("buildPolicyOutputDescriptor falls back for incomplete raw-output-v1 inputs", async () => {
  const sdk = {
    rpc: {
      call: async (method: string) => {
        if (method === "getaddressinfo") {
          return {
            scriptPubKey: "5120" + "11".repeat(32),
          };
        }
        throw new Error(`unexpected rpc method: ${method}`);
      },
    },
  } as any;

  const result = await buildPolicyOutputDescriptor(sdk, {
    nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextAmountSat: 6000,
    assetId: "unsupported-asset-alias",
    rawOutput: {
      assetBytesHex: RAW_OUTPUT_V1.assetBytesHex,
      amountBytesHex: RAW_OUTPUT_V1.amountBytesHex,
    },
    outputBindingMode: "descriptor-bound",
  });

  assert.equal(result.descriptor.outputBindingMode, "script-bound");
  assert.equal(result.supportedForm, "unsupported");
  assert.equal(result.reasonCode, "FALLBACK_INCOMPLETE_RAW_OUTPUT");
  assert.match(result.fallbackReason ?? "", /missing nonceBytesHex, scriptPubKeyHex\|scriptPubKeyHashHex, rangeProofHex\|rangeProofHashHex/);
});

test("buildPolicyOutputDescriptor falls back for invalid raw-output-v1 inputs", async () => {
  const sdk = {
    rpc: {
      call: async (method: string) => {
        if (method === "getaddressinfo") {
          return {
            scriptPubKey: "5120" + "11".repeat(32),
          };
        }
        throw new Error(`unexpected rpc method: ${method}`);
      },
    },
  } as any;

  const result = await buildPolicyOutputDescriptor(sdk, {
    nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextAmountSat: 6000,
    assetId: "unsupported-asset-alias",
    rawOutput: {
      ...RAW_OUTPUT_V1,
      amountBytesHex: "01ff",
    },
    outputBindingMode: "descriptor-bound",
  });

  assert.equal(result.descriptor.outputBindingMode, "script-bound");
  assert.equal(result.supportedForm, "unsupported");
  assert.equal(result.reasonCode, "FALLBACK_INVALID_RAW_OUTPUT");
  assert.match(result.fallbackReason ?? "", /amountBytesHex/);
});

test("buildPolicyOutputDescriptor falls back for mismatched raw-output-v1 hash components", async () => {
  const sdk = {
    rpc: {
      call: async (method: string) => {
        if (method === "getaddressinfo") {
          return {
            scriptPubKey: "5120" + "11".repeat(32),
          };
        }
        throw new Error(`unexpected rpc method: ${method}`);
      },
    },
  } as any;

  const result = await buildPolicyOutputDescriptor(sdk, {
    nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextAmountSat: 6000,
    assetId: "unsupported-asset-alias",
    rawOutput: {
      ...RAW_OUTPUT_V1,
      scriptPubKeyHashHex: "ff".repeat(32),
    },
    outputBindingMode: "descriptor-bound",
  });

  assert.equal(result.descriptor.outputBindingMode, "script-bound");
  assert.equal(result.supportedForm, "unsupported");
  assert.equal(result.reasonCode, "FALLBACK_INVALID_RAW_OUTPUT");
  assert.match(result.fallbackReason ?? "", /scriptPubKeyHashHex=mismatch/);
});

test("describePolicyBindingSupport returns the documented matrix", () => {
  const support = describeOutputBindingSupport();

  assert.deepEqual(
    support.supportedForms.map((entry: { form: string }) => entry.form),
    ["explicit-v1", "raw-output-v1", "unsupported"],
  );
  assert.equal(support.outputBindingModes["descriptor-bound"].runtimeBinding, "output-hash");
  assert.equal(support.fallbackBehavior.defaultMode, "script-bound");
  assert.deepEqual(support.autoDeriveConditions.rawOutputFields, [
    "assetBytesHex",
    "amountBytesHex",
    "nonceBytesHex",
    "scriptPubKeyHex",
    "scriptPubKeyHashHex",
    "rangeProofHex",
    "rangeProofHashHex",
  ]);
  assert.deepEqual(support.autoDeriveConditions.rawOutputFieldAlternatives, {
    scriptComponent: ["scriptPubKeyHex", "scriptPubKeyHashHex"],
    rangeProofComponent: ["rangeProofHex", "rangeProofHashHex"],
  });
  assert.deepEqual(support.autoDeriveConditions.outputHashExclusions, [
    "surjectionProofHex",
    "surjectionProofHashHex",
  ]);
  assert.ok(
    support.unsupportedOutputFeatures.some(
      (entry: { feature: string }) => entry.feature === "amountForm=confidential",
    ),
  );
  assert.deepEqual(support.publicValidationMatrix.testnet, [
    "required + script-bound",
    "required + descriptor-bound",
  ]);
  assert.ok(support.nonGoals.some((goal: string) => /Wallet\/RPC-backed confidential output reconstruction/.test(goal)));
});

test("evaluateOutputBindingSupport reports unsupported confidential forms deterministically", () => {
  const result = evaluateOutputBindingSupport({
    assetId: "bitcoin",
    requestedBindingMode: "descriptor-bound",
    outputForm: {
      amountForm: "confidential",
      nonceForm: "confidential",
    },
  });

  assert.equal(result.requestedBindingMode, "descriptor-bound");
  assert.equal(result.resolvedBindingMode, "script-bound");
  assert.equal(result.supportedForm, "unsupported");
  assert.equal(result.reasonCode, "FALLBACK_UNSUPPORTED_OUTPUT_FORM");
  assert.match(result.fallbackReason ?? "", /amountForm=confidential/);
  assert.match(result.fallbackReason ?? "", /nonceForm=confidential/);
  assert.deepEqual(result.unsupportedFeatures, ["amountForm=confidential", "nonceForm=confidential"]);
});

test("evaluateOutputBindingSupport reports manual hash path explicitly", () => {
  const result = evaluateOutputBindingSupport({
    assetId: "unsupported-asset-alias",
    requestedBindingMode: "descriptor-bound",
    nextOutputHash: "33".repeat(32),
  });

  assert.equal(result.resolvedBindingMode, "descriptor-bound");
  assert.equal(result.reasonCode, "OK_MANUAL_HASH");
  assert.equal(result.manualHashSupplied, true);
  assert.deepEqual(result.unsupportedFeatures, ["assetInput=non-bitcoin-nonhex"]);
});

test("evaluateOutputBindingSupport reports raw-output-v1 explicitly", () => {
  const result = evaluateOutputBindingSupport({
    assetId: "unsupported-asset-alias",
    requestedBindingMode: "descriptor-bound",
    rawOutput: RAW_OUTPUT_V1,
    outputForm: {
      amountForm: "confidential",
      nonceForm: "confidential",
    },
  });

  assert.equal(result.resolvedBindingMode, "descriptor-bound");
  assert.equal(result.supportedForm, "raw-output-v1");
  assert.equal(result.reasonCode, "OK_RAW_OUTPUT");
  assert.equal(result.autoDerived, true);
  assert.equal(result.rawOutputProvided, true);
  assert.equal(result.rawOutputComponents?.scriptPubKey, "raw-bytes");
  assert.equal(result.rawOutputComponents?.rangeProof, "raw-bytes");
  assert.deepEqual(result.unsupportedFeatures, []);
});

test("evaluateOutputBindingSupport reports hash-backed raw-output-v1 explicitly", () => {
  const result = evaluateOutputBindingSupport({
    assetId: "unsupported-asset-alias",
    requestedBindingMode: "descriptor-bound",
    rawOutput: RAW_OUTPUT_V1_HASHED,
  });

  assert.equal(result.resolvedBindingMode, "descriptor-bound");
  assert.equal(result.supportedForm, "raw-output-v1");
  assert.equal(result.reasonCode, "OK_RAW_OUTPUT");
  assert.equal(result.autoDerived, true);
  assert.equal(result.rawOutputProvided, true);
  assert.equal(result.rawOutputComponents?.scriptPubKey, "hash");
  assert.equal(result.rawOutputComponents?.rangeProof, "hash");
  assert.deepEqual(result.unsupportedFeatures, []);
});

test("describePolicyTemplate returns the required template manifest", () => {
  const manifest = describePolicyTemplate({
    templateId: "recursive-delay",
    propagationMode: "required",
  });

  assert.equal(manifest.templateId, "recursive-delay-required");
  assert.equal(manifest.manifestVersion, "policy-template-manifest/v1");
  assert.equal(manifest.supportsPlainExit, false);
  assert.deepEqual(manifest.parameterSchema, { lockDistanceBlocks: "number" });
  assert.ok(manifest.stateSimfPath.endsWith("recursive-delay-required.simf"));
});

test("listPolicyTemplates returns built-in manifests", () => {
  const manifests = listPolicyTemplates();
  assert.deepEqual(
    manifests.map((manifest) => manifest.templateId),
    ["recursive-delay-required", "recursive-delay-optional"],
  );
  assert.ok(manifests.every((manifest) => manifest.manifestVersion === "policy-template-manifest/v1"));
});

test("validatePolicyTemplateManifest accepts a valid external manifest", () => {
  const result = validatePolicyTemplateManifest({
    manifestValue: {
      templateId: "custom-delay-required",
      manifestVersion: "policy-template-manifest/v1",
      title: "Custom Delay (Required)",
      description: "Custom recursive delay manifest for tests.",
      stateSimfPath: "/tmp/custom-delay-required.simf",
      directStateSimfPath: "/tmp/custom-delay-required.simf",
      parameterSchema: { lockDistanceBlocks: "number" },
      supportedBindingModes: ["script-bound", "descriptor-bound"],
      supportsPlainExit: false,
      defaultPropagationMode: "required",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reasonCode, "OK");
  assert.equal(result.manifest?.templateId, "custom-delay-required");
});

test("loadPolicyTemplateManifest supports external manifest paths", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "simplicity-policy-manifest-"));
  const manifestPath = path.join(dir, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      templateId: "custom-delay-optional",
      manifestVersion: "policy-template-manifest/v1",
      title: "Custom Delay (Optional)",
      description: "Custom optional manifest for tests.",
      stateSimfPath: "/tmp/custom-delay-optional.simf",
      directStateSimfPath: "/tmp/custom-delay-required.simf",
      parameterSchema: { lockDistanceBlocks: "number" },
      supportedBindingModes: ["none", "script-bound"],
      supportsPlainExit: true,
      defaultPropagationMode: "optional",
    }),
    "utf8",
  );

  const manifest = await loadPolicyTemplateManifest({ manifestPath });
  assert.equal(manifest.templateId, "custom-delay-optional");
  assert.equal(manifest.supportsPlainExit, true);
  assert.deepEqual(manifest.supportedBindingModes, ["none", "script-bound"]);
});

test("validatePolicyTemplateParams enforces manifest schema", () => {
  const params = validatePolicyTemplateParams({
    templateId: "recursive-delay",
    propagationMode: "required",
    params: { lockDistanceBlocks: 2 },
  });

  assert.deepEqual(params, { lockDistanceBlocks: 2 });
  assert.throws(
    () =>
      validatePolicyTemplateParams({
        templateId: "recursive-delay",
        propagationMode: "required",
        params: { lockDistanceBlocks: "2" as unknown as number },
      }),
    /must be a number/,
  );
});

test("public policy client smoke follows the quickstart path", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  sdk.rpc.call = (async (method: string) => {
    if (method === "getaddressinfo") {
      return {
        scriptPubKey: "5120" + "11".repeat(32),
      };
    }
    if (method === "getsidechaininfo") {
      return {
        pegged_asset: "22".repeat(32),
      };
    }
    throw new Error(`unexpected rpc method: ${method}`);
  }) as typeof sdk.rpc.call;

  const manifest = sdk.policies.describeTemplate({
    templateId: "recursive-delay",
    propagationMode: "required",
  });
  const bindingSupport = sdk.outputBinding.describeSupport();
  const params = sdk.policies.validateTemplateParams({
    templateId: manifest.templateId,
    propagationMode: "required",
    params: { lockDistanceBlocks: 2 },
  });
  const descriptor = await sdk.policies.buildOutputDescriptor({
    nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
    nextAmountSat: 6000,
    assetId: "bitcoin",
    outputBindingMode: "descriptor-bound",
  });

  assert.equal(manifest.templateId, "recursive-delay-required");
  assert.equal(bindingSupport.outputBindingModes["descriptor-bound"].runtimeBinding, "output-hash");
  assert.deepEqual(params, { lockDistanceBlocks: 2 });
  assert.equal(descriptor.descriptor.outputBindingMode, "descriptor-bound");
  assert.equal(descriptor.autoDerivedNextOutputHash, true);
  assert.equal(descriptor.supportedForm, "explicit-v1");
  assert.equal(descriptor.reasonCode, "OK_EXPLICIT");
  assert.equal(
    descriptor.descriptor.nextOutputHash,
    "0b9a6db5cb4e214391603c17323233667ed0c2b431b1e5cfc0d1f2145adfbbc5",
  );
});

test("public client exposes binding support via sdk.outputBinding", () => {
  const sdk = createSimplicityClient(TEST_CONFIG) as unknown as {
    outputBinding: { describeSupport: () => unknown; evaluateSupport: () => unknown };
    policies: Record<string, unknown>;
  };

  assert.equal(typeof sdk.outputBinding.describeSupport, "function");
  assert.equal(typeof sdk.outputBinding.evaluateSupport, "function");
  assert.equal("describeBindingSupport" in sdk.policies, false);
});

test("required propagation rejects plain exit", async (t) => {
  if (!(await hasToolchain()) || !(await hasLocalElementsRpc())) {
    t.skip("simc/hal-simplicity or local Elements RPC are not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const issued = await issue(sdk, {
    recipient: {
      mode: "policy",
      recipientXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    template: {
      templateId: "recursive-delay",
      value: { policyTemplateId: "recursive-delay" },
    },
    params: { lockDistanceBlocks: 100 },
    amountSat: 6000,
    assetId: "bitcoin",
    propagationMode: "required",
  });

  await assert.rejects(
    () =>
      prepareTransfer(sdk, {
        currentArtifact: issued.compiled.artifact,
        template: { templateId: "recursive-delay", value: { policyTemplateId: "recursive-delay" } },
        currentStateValue: issued.state,
        nextReceiver: { mode: "plain", address: "ert1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7kz4n" },
        nextAmountSat: 6000,
      }),
  );
});

test("optional propagation allows plain exit", async (t) => {
  if (!(await hasToolchain()) || !(await hasLocalElementsRpc())) {
    t.skip("simc/hal-simplicity or local Elements RPC are not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const issued = await issue(sdk, {
    recipient: {
      mode: "policy",
      recipientXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    template: {
      templateId: "recursive-delay",
      value: { policyTemplateId: "recursive-delay" },
    },
    params: { lockDistanceBlocks: 100 },
    amountSat: 6000,
    assetId: "bitcoin",
    propagationMode: "optional",
  });

  const result = await prepareTransfer(sdk, {
    currentArtifact: issued.compiled.artifact,
    template: { templateId: "recursive-delay", value: { policyTemplateId: "recursive-delay" } },
    currentStateValue: issued.state,
    nextReceiver: { mode: "plain", address: "ert1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7kz4n" },
    nextAmountSat: 6000,
  });

  assert.equal(result.machineArtifact, null);
  assert.equal(result.nextState, null);
  assert.equal(result.verificationReport.plainExitAllowed, true);
  assert.equal(result.verificationReport.enforcement, "conditional-hop");
});

test("optional propagation can still prepare a machine hop", async (t) => {
  if (!(await hasToolchain()) || !(await hasLocalElementsRpc())) {
    t.skip("simc/hal-simplicity or local Elements RPC are not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const issued = await issue(sdk, {
    recipient: {
      mode: "policy",
      recipientXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    template: {
      templateId: "recursive-delay",
      value: { policyTemplateId: "recursive-delay" },
      stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
      directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
    },
    params: { lockDistanceBlocks: 100 },
    amountSat: 6000,
    assetId: "bitcoin",
    propagationMode: "optional",
  });

  const result = await prepareTransfer(sdk, {
    currentArtifact: issued.compiled.artifact,
    template: {
      templateId: "recursive-delay",
      value: { policyTemplateId: "recursive-delay" },
      stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
      directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
    },
    currentStateValue: issued.state,
    nextReceiver: {
      mode: "policy",
      recipientXonly: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    },
    nextAmountSat: 6000,
    nextParams: { lockDistanceBlocks: 100 },
    outputBindingMode: "script-bound",
  });

  assert.equal(result.machineArtifact, null);
  assert.ok(result.nextState);
  assert.equal(result.verificationReport.enforcement, "conditional-hop");
  assert.equal(result.verificationReport.nextPolicyPresent, true);
});

test("prepareTransfer creates next constrained output in required mode", async (t) => {
  if (!(await hasToolchain()) || !(await hasLocalElementsRpc())) {
    t.skip("simc/hal-simplicity or local Elements RPC are not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const issued = await issue(sdk, {
    recipient: {
      mode: "policy",
      recipientXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    template: {
      templateId: "recursive-delay",
      value: { policyTemplateId: "recursive-delay" },
      stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
      directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
    },
    params: { lockDistanceBlocks: 100 },
    amountSat: 6000,
    assetId: "bitcoin",
    propagationMode: "required",
  });

  const result = await prepareTransfer(sdk, {
    currentArtifact: issued.compiled.artifact,
    template: {
      templateId: "recursive-delay",
      value: { policyTemplateId: "recursive-delay" },
      stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
      directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
    },
    currentStateValue: issued.state,
    nextReceiver: {
      mode: "policy",
      recipientXonly: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    },
    nextAmountSat: 6000,
    nextParams: { lockDistanceBlocks: 100 },
    outputBindingMode: "script-bound",
  });

  assert.ok(result.nextState);
  assert.ok(result.nextCompiled);
  assert.equal(result.machineArtifact, null);
  assert.equal(result.transferDescriptor.propagationMode, "required");
  assert.equal(result.verificationReport.nextPolicyPresent, true);
  assert.equal(result.verificationReport.enforcement, "direct-hop");
  assert.ok(result.nextCompiled?.contractAddress);
});

test("prepareDirectTransfer creates next constrained output in required mode", async (t) => {
  if (!(await hasToolchain()) || !(await hasLocalElementsRpc())) {
    t.skip("simc/hal-simplicity or local Elements RPC are not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const issued = await issue(sdk, {
    recipient: {
      mode: "policy",
      recipientXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    template: {
      templateId: "recursive-delay",
      value: { policyTemplateId: "recursive-delay" },
      stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
      directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
    },
    params: { lockDistanceBlocks: 100 },
    amountSat: 6000,
    assetId: "bitcoin",
    propagationMode: "required",
  });

  const result = await prepareDirectTransfer(sdk, {
    currentArtifact: issued.compiled.artifact,
    template: {
      templateId: "recursive-delay",
      value: { policyTemplateId: "recursive-delay" },
      stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
      directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
    },
    currentStateValue: issued.state,
    nextReceiver: {
      mode: "policy",
      recipientXonly: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    },
    nextAmountSat: 6000,
    nextParams: { lockDistanceBlocks: 100 },
    outputBindingMode: "script-bound",
  });

  assert.ok(result.nextState);
  assert.ok(result.nextCompiled);
  assert.equal(result.transferDescriptor.propagationMode, "required");
  assert.equal(result.verificationReport.enforcement, "direct-hop");
  assert.equal(result.verificationReport.plainExitAllowed, false);
  assert.equal(result.verificationReport.outputBinding?.runtimeBound, true);
  assert.equal(result.verificationReport.outputBinding?.nextOutputScriptRuntimeBound, true);
  assert.equal(result.verificationReport.outputBinding?.nextOutputHashRuntimeBound, false);
  assert.deepEqual(result.verificationReport.outputBinding?.bindingInputs, {
    assetId: "bitcoin",
    nextAmountSat: 6000,
    nextOutputIndex: 0,
    feeIndex: 1,
    maxFeeSat: 100,
  });
});

test("verifyDirectTransfer reports direct-hop enforcement", async (t) => {
  if (!(await hasToolchain()) || !(await hasLocalElementsRpc())) {
    t.skip("simc/hal-simplicity or local Elements RPC are not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const issued = await issue(sdk, {
    recipient: {
      mode: "policy",
      recipientXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    template: {
      templateId: "recursive-delay",
      value: { policyTemplateId: "recursive-delay" },
      stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
      directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
    },
    params: { lockDistanceBlocks: 100 },
    amountSat: 6000,
    assetId: "bitcoin",
    propagationMode: "required",
  });

  const prepared = await prepareDirectTransfer(sdk, {
    currentArtifact: issued.compiled.artifact,
    template: {
      templateId: "recursive-delay",
      value: { policyTemplateId: "recursive-delay" },
      stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
      directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
    },
    currentStateValue: issued.state,
    nextReceiver: {
      mode: "policy",
      recipientXonly: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    },
    nextAmountSat: 6000,
    nextParams: { lockDistanceBlocks: 100 },
    outputBindingMode: "script-bound",
  });

  const result = await verifyDirectTransfer(sdk, {
    template: {
      templateId: "recursive-delay",
      value: { policyTemplateId: "recursive-delay" },
      stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
      directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
    },
    currentArtifact: issued.compiled.artifact,
    currentStateValue: issued.state,
    transferDescriptorValue: prepared.transferDescriptor,
    nextStateValue: prepared.nextState,
  });

  assert.equal(result.ok, true);
  assert.equal(result.verificationReport.enforcement, "direct-hop");
  assert.equal(result.verificationReport.outputBinding?.runtimeBound, true);
});

test("verifyTransfer includes descriptor-bound hash details", async (t) => {
  if (!(await hasToolchain()) || !(await hasLocalElementsRpc())) {
    t.skip("simc/hal-simplicity or local Elements RPC are not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const template = {
    templateId: "recursive-delay",
    value: { policyTemplateId: "recursive-delay" },
    stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
    directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
  };
  const issued = await issue(sdk, {
    recipient: {
      mode: "policy",
      recipientXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    template,
    params: { lockDistanceBlocks: 100 },
    amountSat: 6000,
    assetId: "bitcoin",
    propagationMode: "required",
  });

  const prepared = await prepareTransfer(sdk, {
    currentArtifact: issued.compiled.artifact,
    template,
    currentStateValue: issued.state,
    nextReceiver: {
      mode: "policy",
      recipientXonly: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    },
    nextAmountSat: 6000,
    nextParams: { lockDistanceBlocks: 100 },
    outputBindingMode: "descriptor-bound",
  });

  const result = await verifyTransfer(sdk, {
    template,
    currentArtifact: issued.compiled.artifact,
    currentStateValue: issued.state,
    transferDescriptorValue: prepared.transferDescriptor,
    nextStateValue: prepared.nextState ?? undefined,
  });

  assert.equal(result.ok, true);
  assert.equal(result.verificationReport.schemaVersion, "policy-verification-report/v1");
  assert.equal(result.verificationReport.outputBinding?.mode, "descriptor-bound");
  assert.equal(result.verificationReport.outputBinding?.supportedForm, "explicit-v1");
  assert.equal(result.verificationReport.outputBinding?.reasonCode, "OK_EXPLICIT");
  assert.equal(result.verificationReport.outputBinding?.autoDerived, true);
  assert.equal(result.verificationReport.outputBinding?.nextOutputHashRuntimeBound, true);
  assert.equal(result.verificationReport.outputBinding?.nextOutputHash, prepared.transferDescriptor.outputDescriptor?.nextOutputHash);
});

test("verifyTransfer includes raw-output-v1 hash details", async (t) => {
  if (!(await hasToolchain()) || !(await hasLocalElementsRpc())) {
    t.skip("simc/hal-simplicity or local Elements RPC are not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const template = {
    templateId: "recursive-delay",
    value: { policyTemplateId: "recursive-delay" },
    stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
    directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
  };
  const issued = await issue(sdk, {
    recipient: {
      mode: "policy",
      recipientXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    template,
    params: { lockDistanceBlocks: 100 },
    amountSat: 6000,
    assetId: "unsupported-asset-alias",
    propagationMode: "required",
  });

  const prepared = await prepareTransfer(sdk, {
    currentArtifact: issued.compiled.artifact,
    template,
    currentStateValue: issued.state,
    nextReceiver: {
      mode: "policy",
      recipientXonly: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    },
    nextAmountSat: 6000,
    nextParams: { lockDistanceBlocks: 100 },
    nextRawOutput: RAW_OUTPUT_V1,
    nextOutputForm: {
      assetForm: "confidential",
      amountForm: "confidential",
      nonceForm: "confidential",
      rangeProofForm: "non-empty",
    },
    outputBindingMode: "descriptor-bound",
  });

  const result = await verifyTransfer(sdk, {
    template,
    currentArtifact: issued.compiled.artifact,
    currentStateValue: issued.state,
    transferDescriptorValue: prepared.transferDescriptor,
    nextStateValue: prepared.nextState ?? undefined,
  });

  assert.equal(result.ok, true);
  assert.equal(result.verificationReport.outputBinding?.mode, "descriptor-bound");
  assert.equal(result.verificationReport.outputBinding?.supportedForm, "raw-output-v1");
  assert.equal(result.verificationReport.outputBinding?.reasonCode, "OK_RAW_OUTPUT");
  assert.equal(result.verificationReport.outputBinding?.autoDerived, true);
});

test("exportEvidence carries transfer-aware verification report", async (t) => {
  if (!(await hasToolchain()) || !(await hasLocalElementsRpc())) {
    t.skip("simc/hal-simplicity or local Elements RPC are not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const template = {
    templateId: "recursive-delay",
    value: { policyTemplateId: "recursive-delay" },
    stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
    directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
  };
  const issued = await issue(sdk, {
    recipient: {
      mode: "policy",
      recipientXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    template,
    params: { lockDistanceBlocks: 100 },
    amountSat: 6000,
    assetId: "bitcoin",
    propagationMode: "required",
  });

  const prepared = await prepareTransfer(sdk, {
    currentArtifact: issued.compiled.artifact,
    template,
    currentStateValue: issued.state,
    nextReceiver: {
      mode: "policy",
      recipientXonly: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    },
    nextAmountSat: 6000,
    nextParams: { lockDistanceBlocks: 100 },
    outputBindingMode: "descriptor-bound",
  });

  const evidence = await exportEvidence(sdk, {
    artifact: issued.compiled.artifact,
    template,
    stateValue: issued.state,
    transferDescriptorValue: prepared.transferDescriptor,
  });

  assert.equal(evidence.schemaVersion, "policy-evidence-bundle/v1");
  assert.equal(evidence.report.enforcement, "direct-hop");
  assert.equal(evidence.report.schemaVersion, "policy-verification-report/v1");
  assert.equal(evidence.report.outputBinding?.mode, "descriptor-bound");
  assert.equal(evidence.report.outputBinding?.reasonCode, "OK_EXPLICIT");
  assert.equal(evidence.report.outputBinding?.autoDerived, true);
  assert.equal(evidence.trustSummary.bindingMode, "descriptor-bound");
  assert.equal(evidence.transfer?.hash, prepared.transferSummary.hash);
});

test("exportEvidence preserves raw-output-v1 verification metadata", async (t) => {
  if (!(await hasToolchain()) || !(await hasLocalElementsRpc())) {
    t.skip("simc/hal-simplicity or local Elements RPC are not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const template = {
    templateId: "recursive-delay",
    value: { policyTemplateId: "recursive-delay" },
    stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
    directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
  };
  const issued = await issue(sdk, {
    recipient: {
      mode: "policy",
      recipientXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    template,
    params: { lockDistanceBlocks: 100 },
    amountSat: 6000,
    assetId: "unsupported-asset-alias",
    propagationMode: "required",
  });

  const prepared = await prepareTransfer(sdk, {
    currentArtifact: issued.compiled.artifact,
    template,
    currentStateValue: issued.state,
    nextReceiver: {
      mode: "policy",
      recipientXonly: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    },
    nextAmountSat: 6000,
    nextParams: { lockDistanceBlocks: 100 },
    nextRawOutput: RAW_OUTPUT_V1,
    outputBindingMode: "descriptor-bound",
  });

  const evidence = await exportEvidence(sdk, {
    artifact: issued.compiled.artifact,
    template,
    stateValue: issued.state,
    transferDescriptorValue: prepared.transferDescriptor,
  });

  assert.equal(evidence.report.outputBinding?.supportedForm, "raw-output-v1");
  assert.equal(evidence.report.outputBinding?.reasonCode, "OK_RAW_OUTPUT");
  assert.equal(evidence.report.outputBinding?.autoDerived, true);
});

test("restricted OTC scenario keeps transfer constrained to the approved next custodian", async (t) => {
  if (!(await hasToolchain()) || !(await hasLocalElementsRpc())) {
    t.skip("simc/hal-simplicity or local Elements RPC are not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const template = {
    templateId: "recursive-delay",
    value: { policyTemplateId: "recursive-delay" },
    stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
    directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
  };
  const sellerCustodianXonly = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
  const approvedBuyerCustodianXonly = "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
  const issued = await issue(sdk, {
    recipient: {
      mode: "policy",
      recipientXonly: sellerCustodianXonly,
    },
    template,
    params: { lockDistanceBlocks: 6 },
    amountSat: 6000,
    assetId: "unsupported-asset-alias",
    propagationMode: "required",
  });

  const prepared = await prepareTransfer(sdk, {
    currentArtifact: issued.compiled.artifact,
    template,
    currentStateValue: issued.state,
    nextReceiver: {
      mode: "policy",
      recipientXonly: approvedBuyerCustodianXonly,
    },
    nextAmountSat: 6000,
    nextParams: { lockDistanceBlocks: 6 },
    nextRawOutput: RAW_OUTPUT_V1,
    nextOutputForm: {
      assetForm: "confidential",
      amountForm: "confidential",
      nonceForm: "confidential",
      rangeProofForm: "non-empty",
    },
    outputBindingMode: "descriptor-bound",
  });
  const verified = await verifyTransfer(sdk, {
    template,
    currentArtifact: issued.compiled.artifact,
    currentStateValue: issued.state,
    transferDescriptorValue: prepared.transferDescriptor,
    nextStateValue: prepared.nextState ?? undefined,
  });
  const evidence = await exportEvidence(sdk, {
    artifact: issued.compiled.artifact,
    template,
    stateValue: issued.state,
    transferDescriptorValue: prepared.transferDescriptor,
  });

  assert.equal(prepared.transferDescriptor.propagationMode, "required");
  assert.equal(prepared.nextState?.recipient, approvedBuyerCustodianXonly);
  assert.equal(verified.verificationReport.enforcement, "direct-hop");
  assert.equal(verified.verificationReport.outputBinding?.mode, "descriptor-bound");
  assert.equal(verified.verificationReport.outputBinding?.supportedForm, "raw-output-v1");
  assert.equal(verified.verificationReport.outputBinding?.reasonCode, "OK_RAW_OUTPUT");
  assert.equal(evidence.trustSummary.bindingMode, "descriptor-bound");
});

test("required direct path rejects plain exit", async (t) => {
  if (!(await hasToolchain()) || !(await hasLocalElementsRpc())) {
    t.skip("simc/hal-simplicity or local Elements RPC are not available");
    return;
  }
  const sdk = createSimplicityClient(TEST_CONFIG);
  const issued = await issue(sdk, {
    recipient: {
      mode: "policy",
      recipientXonly: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    template: {
      templateId: "recursive-delay",
      value: { policyTemplateId: "recursive-delay" },
      stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
      directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
    },
    params: { lockDistanceBlocks: 100 },
    amountSat: 6000,
    assetId: "bitcoin",
    propagationMode: "required",
  });

  await assert.rejects(
    () =>
      prepareDirectTransfer(sdk, {
        currentArtifact: issued.compiled.artifact,
        template: {
          templateId: "recursive-delay",
          value: { policyTemplateId: "recursive-delay" },
          stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
          directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
        },
        currentStateValue: issued.state,
        nextReceiver: { mode: "plain", address: "ert1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7kz4n" },
        nextAmountSat: 6000,
      }),
  );
});
