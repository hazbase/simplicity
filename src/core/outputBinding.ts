import { createHash } from "node:crypto";
import type { SimplicityClient } from "../client/SimplicityClient";
import type {
  BondOutputBindingMode,
  OutputBindingSupportEvaluation,
  OutputBindingSupportMatrix,
  OutputBindingReasonCode,
  OutputBindingSupportedForm,
  OutputForm,
  OutputRawFields,
} from "./types";

const EMPTY_BUFFER_SHA256 = createHash("sha256").update(Buffer.alloc(0)).digest();

export const OUTPUT_BINDING_SUPPORT_MATRIX: OutputBindingSupportMatrix = {
  supportedForms: [
    {
      form: "explicit-v1",
      description:
        "Explicit asset + explicit amount + null nonce + empty range proof, with asset input supplied as bitcoin or 64-hex asset id.",
      autoDerived: true,
    },
    {
      form: "raw-output-v1",
      description:
        "Caller supplies asset/amount/nonce bytes plus scriptPubKey and range-proof components as raw bytes or pre-hashed values, and the SDK derives output_hash deterministically.",
      autoDerived: true,
    },
    {
      form: "unsupported",
      description:
        "Any output form outside explicit-v1/raw-output-v1. descriptor-bound falls back to script-bound unless a manual nextOutputHash is supplied.",
      autoDerived: false,
    },
  ],
  unsupportedOutputFeatures: [
    {
      feature: "assetInput=non-bitcoin-nonhex",
      description:
        "Asset inputs outside bitcoin or a 64-hex asset id cannot be resolved into the explicit-v1 hash derivation path.",
      fallbackReasonCode: "FALLBACK_UNSUPPORTED_ASSET",
      manualHashSupported: true,
    },
    {
      feature: "assetForm=confidential",
      description:
        "Confidential asset commitments are outside the current explicit-v1 auto-derive path. Use raw-output-v1 or manual nextOutputHash.",
      fallbackReasonCode: "FALLBACK_UNSUPPORTED_OUTPUT_FORM",
      manualHashSupported: true,
    },
    {
      feature: "amountForm=confidential",
      description:
        "Confidential amounts are outside the current explicit-v1 auto-derive path. Use raw-output-v1 or manual nextOutputHash.",
      fallbackReasonCode: "FALLBACK_UNSUPPORTED_OUTPUT_FORM",
      manualHashSupported: true,
    },
    {
      feature: "nonceForm=confidential",
      description:
        "Confidential nonces are outside the current explicit-v1 auto-derive path. Use raw-output-v1 or manual nextOutputHash.",
      fallbackReasonCode: "FALLBACK_UNSUPPORTED_OUTPUT_FORM",
      manualHashSupported: true,
    },
    {
      feature: "rangeProofForm=non-empty",
      description:
        "Non-empty range proofs are outside the current explicit-v1 auto-derive path. Use raw-output-v1 or manual nextOutputHash.",
      fallbackReasonCode: "FALLBACK_UNSUPPORTED_OUTPUT_FORM",
      manualHashSupported: true,
    },
  ],
  outputBindingModes: {
    none: {
      description: "No runtime output binding. The transfer remains SDK-verified only.",
      runtimeBinding: "none",
      fallbackBehavior: "No fallback is needed because runtime output binding is disabled.",
    },
    "script-bound": {
      description: "Runtime binds the next output script hash and fee shape.",
      runtimeBinding: "script-hash",
      fallbackBehavior: "Acts as the default downgrade path when descriptor-bound cannot be supported safely.",
    },
    "descriptor-bound": {
      description: "Runtime binds output_hash(0) for the next constrained output.",
      runtimeBinding: "output-hash",
      fallbackBehavior:
        "If the output form cannot be derived safely and no manual nextOutputHash is supplied, the SDK falls back to script-bound with an explicit reason code.",
    },
  },
  autoDeriveConditions: {
    assetInput: ["bitcoin", "64-hex asset id"],
    amountForm: "explicit amount",
    nonceForm: "null nonce",
    rangeProofForm: "empty range proof",
    rawOutputFields: [
      "assetBytesHex",
      "amountBytesHex",
      "nonceBytesHex",
      "scriptPubKeyHex",
      "scriptPubKeyHashHex",
      "rangeProofHex",
      "rangeProofHashHex",
    ],
    rawOutputFieldAlternatives: {
      scriptComponent: ["scriptPubKeyHex", "scriptPubKeyHashHex"],
      rangeProofComponent: ["rangeProofHex", "rangeProofHashHex"],
    },
    outputHashExclusions: ["surjectionProofHex", "surjectionProofHashHex"],
  },
  manualHashPath: {
    supported: true,
    description:
      "Callers may supply nextOutputHash manually to keep descriptor-bound runtime binding even when explicit-v1/raw-output-v1 auto-derivation is unavailable or intentionally bypassed.",
  },
  fallbackBehavior: {
    defaultMode: "script-bound",
    reasonCodes: [
      "OK_EXPLICIT",
      "OK_RAW_OUTPUT",
      "OK_MANUAL_HASH",
      "OK_SCRIPT_BOUND",
      "OK_NONE",
      "FALLBACK_UNSUPPORTED_ASSET",
      "FALLBACK_UNSUPPORTED_OUTPUT_FORM",
      "FALLBACK_MISSING_HASH_INPUT",
      "FALLBACK_INCOMPLETE_RAW_OUTPUT",
      "FALLBACK_INVALID_RAW_OUTPUT",
    ],
  },
  publicValidationMatrix: {
    local: [
      "required + script-bound",
      "required + descriptor-bound",
      "optional + plain",
      "optional + recursive",
    ],
    testnet: [
      "required + script-bound",
      "required + descriptor-bound",
    ],
  },
  nonGoals: [
    "Wallet/RPC-backed confidential output reconstruction from chain data.",
    "Including surjection proofs in output_hash derivation (Elements excludes them from output_hash semantics).",
    "Policy generalized binding beyond Policy Core.",
  ],
};

export function describeOutputBindingSupport(): OutputBindingSupportMatrix {
  return JSON.parse(JSON.stringify(OUTPUT_BINDING_SUPPORT_MATRIX)) as OutputBindingSupportMatrix;
}

export function normalizeOutputForm(input?: Partial<OutputForm>): OutputForm {
  return {
    assetForm: input?.assetForm ?? "explicit",
    amountForm: input?.amountForm ?? "explicit",
    nonceForm: input?.nonceForm ?? "null",
    rangeProofForm: input?.rangeProofForm ?? "empty",
  };
}

function normalizeHexValue(value: string): string {
  return value.trim().toLowerCase();
}

function isEvenHex(value: string): boolean {
  return /^[0-9a-f]*$/i.test(value) && value.length % 2 === 0;
}

function isFixedHexBytes(value: string, bytes: number): boolean {
  return isEvenHex(value) && value.length === bytes * 2;
}

interface ResolvedOutputRawFields {
  assetBytesHex: string;
  amountBytesHex: string;
  nonceBytesHex: string;
  scriptPubKeyHashHex: string;
  rangeProofHashHex: string;
  scriptComponentSource: "raw-bytes" | "hash";
  rangeProofComponentSource: "raw-bytes" | "hash";
}

export function normalizeOutputRawFields(
  input?: Partial<OutputRawFields>,
): Partial<OutputRawFields> | undefined {
  if (!input) return undefined;
  const normalized: Partial<OutputRawFields> = {};
  if (input.assetBytesHex !== undefined) normalized.assetBytesHex = normalizeHexValue(input.assetBytesHex);
  if (input.amountBytesHex !== undefined) normalized.amountBytesHex = normalizeHexValue(input.amountBytesHex);
  if (input.nonceBytesHex !== undefined) normalized.nonceBytesHex = normalizeHexValue(input.nonceBytesHex);
  if (input.scriptPubKeyHex !== undefined) normalized.scriptPubKeyHex = normalizeHexValue(input.scriptPubKeyHex);
  if (input.scriptPubKeyHashHex !== undefined) {
    normalized.scriptPubKeyHashHex = normalizeHexValue(input.scriptPubKeyHashHex);
  }
  if (input.rangeProofHex !== undefined) normalized.rangeProofHex = normalizeHexValue(input.rangeProofHex);
  if (input.rangeProofHashHex !== undefined) {
    normalized.rangeProofHashHex = normalizeHexValue(input.rangeProofHashHex);
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function analyzeOutputRawFields(input?: Partial<OutputRawFields>): {
  provided: boolean;
  complete: boolean;
  valid: boolean;
  normalized?: ResolvedOutputRawFields;
  missingFields: string[];
  invalidFields: string[];
} {
  const normalized = normalizeOutputRawFields(input);
  if (!normalized) {
    return {
      provided: false,
      complete: false,
      valid: false,
      missingFields: [],
      invalidFields: [],
    };
  }
  const missingFields: string[] = [];
  if (normalized.assetBytesHex === undefined) missingFields.push("assetBytesHex");
  if (normalized.amountBytesHex === undefined) missingFields.push("amountBytesHex");
  if (normalized.nonceBytesHex === undefined) missingFields.push("nonceBytesHex");
  if (normalized.scriptPubKeyHex === undefined && normalized.scriptPubKeyHashHex === undefined) {
    missingFields.push("scriptPubKeyHex|scriptPubKeyHashHex");
  }
  if (normalized.rangeProofHex === undefined && normalized.rangeProofHashHex === undefined) {
    missingFields.push("rangeProofHex|rangeProofHashHex");
  }
  if (missingFields.length > 0) {
    return {
      provided: true,
      complete: false,
      valid: false,
      missingFields,
      invalidFields: [],
    };
  }

  const completed = normalized as OutputRawFields;
  const invalidFields: string[] = [];
  if (!isFixedHexBytes(completed.assetBytesHex, 33)) {
    invalidFields.push("assetBytesHex");
  }
  if (!(isFixedHexBytes(completed.amountBytesHex, 9) || isFixedHexBytes(completed.amountBytesHex, 33))) {
    invalidFields.push("amountBytesHex");
  }
  if (!(isFixedHexBytes(completed.nonceBytesHex, 1) || isFixedHexBytes(completed.nonceBytesHex, 33))) {
    invalidFields.push("nonceBytesHex");
  }
  if (
    completed.scriptPubKeyHex !== undefined
    && !isEvenHex(completed.scriptPubKeyHex)
  ) {
    invalidFields.push("scriptPubKeyHex");
  }
  if (
    completed.scriptPubKeyHashHex !== undefined
    && !isFixedHexBytes(completed.scriptPubKeyHashHex, 32)
  ) {
    invalidFields.push("scriptPubKeyHashHex");
  }
  if (completed.rangeProofHex !== undefined && !isEvenHex(completed.rangeProofHex)) {
    invalidFields.push("rangeProofHex");
  }
  if (
    completed.rangeProofHashHex !== undefined
    && !isFixedHexBytes(completed.rangeProofHashHex, 32)
  ) {
    invalidFields.push("rangeProofHashHex");
  }

  if (
    completed.scriptPubKeyHex !== undefined
    && completed.scriptPubKeyHashHex !== undefined
    && isEvenHex(completed.scriptPubKeyHex)
    && isFixedHexBytes(completed.scriptPubKeyHashHex, 32)
    && hashHexBytes(completed.scriptPubKeyHex) !== completed.scriptPubKeyHashHex
  ) {
    invalidFields.push("scriptPubKeyHashHex=mismatch");
  }
  if (
    completed.rangeProofHex !== undefined
    && completed.rangeProofHashHex !== undefined
    && isEvenHex(completed.rangeProofHex)
    && isFixedHexBytes(completed.rangeProofHashHex, 32)
    && hashHexBytes(completed.rangeProofHex) !== completed.rangeProofHashHex
  ) {
    invalidFields.push("rangeProofHashHex=mismatch");
  }

  return {
    provided: true,
    complete: true,
    valid: invalidFields.length === 0,
    normalized: invalidFields.length === 0
      ? {
          assetBytesHex: completed.assetBytesHex,
          amountBytesHex: completed.amountBytesHex,
          nonceBytesHex: completed.nonceBytesHex,
          scriptPubKeyHashHex: completed.scriptPubKeyHashHex ?? hashHexBytes(completed.scriptPubKeyHex ?? ""),
          rangeProofHashHex: completed.rangeProofHashHex ?? hashHexBytes(completed.rangeProofHex ?? ""),
          scriptComponentSource: completed.scriptPubKeyHashHex ? "hash" : "raw-bytes",
          rangeProofComponentSource: completed.rangeProofHashHex ? "hash" : "raw-bytes",
        }
      : undefined,
    missingFields: [],
    invalidFields,
  };
}

export function isExplicitV1OutputForm(input: OutputForm): boolean {
  return input.assetForm === "explicit"
    && input.amountForm === "explicit"
    && input.nonceForm === "null"
    && input.rangeProofForm === "empty";
}

function listUnsupportedOutputFeatures(input: OutputForm): string[] {
  const features: string[] = [];
  if (input.assetForm !== "explicit") features.push(`assetForm=${input.assetForm}`);
  if (input.amountForm !== "explicit") features.push(`amountForm=${input.amountForm}`);
  if (input.nonceForm !== "null") features.push(`nonceForm=${input.nonceForm}`);
  if (input.rangeProofForm !== "empty") features.push(`rangeProofForm=${input.rangeProofForm}`);
  return features;
}

export function isExplicitAssetInputSupported(assetId: string): boolean {
  return assetId.toLowerCase() === "bitcoin" || /^[0-9a-f]{64}$/i.test(assetId);
}

export function resolveOutputBindingMode(
  requested: BondOutputBindingMode | undefined,
  nextOutputHash: string | undefined,
  nextOutputScriptHash: string | undefined,
): BondOutputBindingMode {
  if (requested === "descriptor-bound" && nextOutputHash) {
    return "descriptor-bound";
  }
  if ((requested === "descriptor-bound" || requested === "script-bound") && nextOutputScriptHash) {
    return "script-bound";
  }
  return "none";
}

export function hashHexBytes(hex: string): string {
  return createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
}

function reverseHexBytes(hex: string): string {
  return hex.match(/../g)?.reverse().join("") ?? hex;
}

function encodeExplicitAsset(assetHex: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from(reverseHexBytes(assetHex), "hex"),
  ]);
}

function encodeExplicitAmount(amountSat: number): Buffer {
  const amount = Buffer.alloc(9);
  amount[0] = 0x01;
  amount.writeBigUInt64BE(BigInt(amountSat), 1);
  return amount;
}

function encodeNullNonce(): Buffer {
  return Buffer.from([0x00]);
}

export function computeExplicitV1OutputHash(input: {
  assetHex: string;
  nextAmountSat: number;
  nextOutputScriptHash: string;
}): string {
  return createHash("sha256")
    .update(encodeExplicitAsset(input.assetHex))
    .update(encodeExplicitAmount(input.nextAmountSat))
    .update(encodeNullNonce())
    .update(Buffer.from(input.nextOutputScriptHash, "hex"))
    .update(EMPTY_BUFFER_SHA256)
    .digest("hex");
}

export function computeRawOutputV1Hash(input: Partial<OutputRawFields>): string {
  const analysis = analyzeOutputRawFields(input);
  if (!analysis.valid || !analysis.normalized) {
    const reason = analysis.complete
      ? `invalid raw-output-v1 input (${analysis.invalidFields.join(", ")})`
      : `incomplete raw-output-v1 input (missing ${analysis.missingFields.join(", ")})`;
    throw new Error(reason);
  }
  return createHash("sha256")
    .update(Buffer.from(analysis.normalized.assetBytesHex, "hex"))
    .update(Buffer.from(analysis.normalized.amountBytesHex, "hex"))
    .update(Buffer.from(analysis.normalized.nonceBytesHex, "hex"))
    .update(Buffer.from(analysis.normalized.scriptPubKeyHashHex, "hex"))
    .update(Buffer.from(analysis.normalized.rangeProofHashHex, "hex"))
    .digest("hex");
}

export async function getScriptPubKeyHexViaRpc(sdk: SimplicityClient, address: string): Promise<string> {
  const result = await sdk.rpc.call<{ scriptPubKey?: string }>("getaddressinfo", [address]);
  const scriptPubKey = result.scriptPubKey?.toLowerCase();
  if (!scriptPubKey) {
    throw new Error(`Could not derive scriptPubKey for address: ${address}`);
  }
  return scriptPubKey;
}

export async function resolveExplicitAssetHex(
  sdk: SimplicityClient,
  assetId: string,
): Promise<string | undefined> {
  if (/^[0-9a-f]{64}$/i.test(assetId)) {
    return assetId.toLowerCase();
  }
  if (assetId.toLowerCase() === "bitcoin") {
    const sidechain = await sdk.rpc.call<{ pegged_asset?: string }>("getsidechaininfo", []);
    if (sidechain.pegged_asset && /^[0-9a-f]{64}$/i.test(sidechain.pegged_asset)) {
      return sidechain.pegged_asset.toLowerCase();
    }
  }
  return undefined;
}

export function resolveOutputBindingDecision(input: {
  requestedBindingMode?: BondOutputBindingMode;
  nextOutputHash?: string;
  nextOutputScriptHash?: string;
  autoDerivedNextOutputHash?: boolean;
  explicitAssetSupported: boolean;
  outputForm?: Partial<OutputForm>;
  rawOutput?: Partial<OutputRawFields>;
}): {
  requestedBindingMode: BondOutputBindingMode;
  outputBindingMode: BondOutputBindingMode;
  supportedForm: OutputBindingSupportedForm;
  reasonCode: OutputBindingReasonCode;
  autoDerived: boolean;
  fallbackReason?: string;
  outputForm: OutputForm;
} {
  const requestedBindingMode = input.requestedBindingMode ?? "none";
  const outputForm = normalizeOutputForm(input.outputForm);
  const rawOutputAnalysis = analyzeOutputRawFields(input.rawOutput);
  const explicitFormSupported = isExplicitV1OutputForm(outputForm);
  const supportedForm: OutputBindingSupportedForm = rawOutputAnalysis.valid
    ? "raw-output-v1"
    : explicitFormSupported && input.explicitAssetSupported
      ? "explicit-v1"
      : "unsupported";
  const outputBindingMode = resolveOutputBindingMode(
    requestedBindingMode,
    input.nextOutputHash,
    input.nextOutputScriptHash,
  );
  const autoDerived = Boolean(input.autoDerivedNextOutputHash);
  const unsupportedFeatures = rawOutputAnalysis.valid
    ? []
    : [
        ...listUnsupportedOutputFeatures(outputForm),
        ...(rawOutputAnalysis.complete && !rawOutputAnalysis.valid
          ? rawOutputAnalysis.invalidFields.map((field) => `${field}=invalid`)
          : []),
      ];

  const buildFallbackForDescriptorBound = (): {
    reasonCode: OutputBindingReasonCode;
    fallbackReason: string;
  } => {
    if (rawOutputAnalysis.valid) {
      return {
        reasonCode: "FALLBACK_MISSING_HASH_INPUT",
        fallbackReason:
          "descriptor-bound requested and raw-output-v1 inputs are valid, but nextOutputHash was not available after derivation",
      };
    }
    if (rawOutputAnalysis.provided && !rawOutputAnalysis.complete) {
      return {
        reasonCode: "FALLBACK_INCOMPLETE_RAW_OUTPUT",
        fallbackReason:
          `descriptor-bound requested but raw-output-v1 is incomplete (missing ${rawOutputAnalysis.missingFields.join(", ")})`,
      };
    }
    if (rawOutputAnalysis.provided && rawOutputAnalysis.complete && !rawOutputAnalysis.valid) {
      return {
        reasonCode: "FALLBACK_INVALID_RAW_OUTPUT",
        fallbackReason:
          `descriptor-bound requested but raw-output-v1 is invalid (${rawOutputAnalysis.invalidFields.join(", ")})`,
      };
    }
    if (!explicitFormSupported) {
      return {
        reasonCode: "FALLBACK_UNSUPPORTED_OUTPUT_FORM",
        fallbackReason:
          `descriptor-bound requested but the current output form is outside the explicit-v1 support matrix (${unsupportedFeatures.join(", ")})`,
      };
    }
    if (!input.explicitAssetSupported) {
      return {
        reasonCode: "FALLBACK_UNSUPPORTED_ASSET",
        fallbackReason:
          "descriptor-bound requested but assetId could not be resolved into an explicit 64-hex asset id (expected bitcoin or a 64-hex asset id)",
      };
    }
    return {
      reasonCode: "FALLBACK_MISSING_HASH_INPUT",
      fallbackReason: "descriptor-bound requested but nextOutputHash was not provided",
    };
  };

  if (requestedBindingMode === "none") {
    return {
      requestedBindingMode,
      outputBindingMode,
      supportedForm,
      reasonCode: "OK_NONE",
      autoDerived: false,
      outputForm,
    };
  }

  if (outputBindingMode === "descriptor-bound") {
    return {
      requestedBindingMode,
      outputBindingMode,
      supportedForm,
      reasonCode: autoDerived
        ? supportedForm === "raw-output-v1"
          ? "OK_RAW_OUTPUT"
          : "OK_EXPLICIT"
        : "OK_MANUAL_HASH",
      autoDerived,
      outputForm,
    };
  }

  if (requestedBindingMode === "descriptor-bound") {
    if (!input.nextOutputHash) {
      const { reasonCode, fallbackReason } = buildFallbackForDescriptorBound();
      return {
        requestedBindingMode,
        outputBindingMode,
        supportedForm,
        reasonCode,
        autoDerived: false,
        fallbackReason,
        outputForm,
      };
    }
  }

  if (requestedBindingMode === "script-bound") {
    if (outputBindingMode === "script-bound") {
      return {
        requestedBindingMode,
        outputBindingMode,
        supportedForm,
        reasonCode: "OK_SCRIPT_BOUND",
        autoDerived: false,
        outputForm,
      };
    }
    return {
      requestedBindingMode,
      outputBindingMode,
      supportedForm,
      reasonCode: "FALLBACK_MISSING_HASH_INPUT",
      autoDerived: false,
      fallbackReason: "script-bound requested but nextOutputScriptHash was not available",
      outputForm,
    };
  }

  return {
    requestedBindingMode,
    outputBindingMode,
    supportedForm,
    reasonCode: "OK_SCRIPT_BOUND",
    autoDerived: false,
    outputForm,
  };
}

export function evaluateOutputBindingSupport(input: {
  assetId: string;
  requestedBindingMode?: BondOutputBindingMode;
  outputForm?: Partial<OutputForm>;
  rawOutput?: Partial<OutputRawFields>;
  nextOutputHash?: string;
  nextOutputScriptAvailable?: boolean;
}): OutputBindingSupportEvaluation {
  const outputForm = normalizeOutputForm(input.outputForm);
  const rawOutputAnalysis = analyzeOutputRawFields(input.rawOutput);
  const explicitAssetInputSupported = isExplicitAssetInputSupported(input.assetId);
  const autoDerivedNextOutputHash =
    (input.requestedBindingMode ?? "none") === "descriptor-bound"
    && !input.nextOutputHash
    && rawOutputAnalysis.valid
    && rawOutputAnalysis.normalized
      ? computeRawOutputV1Hash(rawOutputAnalysis.normalized)
      : undefined;
  const unsupportedFeatures = rawOutputAnalysis.valid
    ? []
    : [
        ...(explicitAssetInputSupported ? [] : ["assetInput=non-bitcoin-nonhex"]),
        ...listUnsupportedOutputFeatures(outputForm),
        ...(rawOutputAnalysis.provided && !rawOutputAnalysis.complete
          ? rawOutputAnalysis.missingFields.map((field) => `${field}=missing`)
          : []),
        ...(rawOutputAnalysis.complete && !rawOutputAnalysis.valid
          ? rawOutputAnalysis.invalidFields.map((field) => `${field}=invalid`)
          : []),
      ];
  const decision = resolveOutputBindingDecision({
    requestedBindingMode: input.requestedBindingMode,
    nextOutputHash: input.nextOutputHash ?? autoDerivedNextOutputHash,
    nextOutputScriptHash: input.nextOutputScriptAvailable === false ? undefined : "available",
    autoDerivedNextOutputHash: Boolean(autoDerivedNextOutputHash && !input.nextOutputHash),
    explicitAssetSupported: explicitAssetInputSupported,
    outputForm,
    rawOutput: input.rawOutput,
  });
  return {
    requestedBindingMode: decision.requestedBindingMode,
    resolvedBindingMode: decision.outputBindingMode,
    supportedForm: decision.supportedForm,
    reasonCode: decision.reasonCode,
    autoDerived: decision.autoDerived,
    fallbackReason: decision.fallbackReason,
    assetId: input.assetId,
    outputForm,
    unsupportedFeatures,
    explicitAssetInputSupported,
    manualHashSupplied: Boolean(input.nextOutputHash),
    nextOutputScriptAvailable: input.nextOutputScriptAvailable !== false,
    rawOutputProvided: rawOutputAnalysis.provided,
    ...(rawOutputAnalysis.valid && rawOutputAnalysis.normalized
      ? {
          rawOutputComponents: {
            scriptPubKey: rawOutputAnalysis.normalized.scriptComponentSource,
            rangeProof: rawOutputAnalysis.normalized.rangeProofComponentSource,
          },
        }
      : {}),
  };
}
