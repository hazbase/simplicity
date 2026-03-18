import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SimplicityClient } from "../client/SimplicityClient";
import type {
  BondOutputBindingMode,
  CapitalCallState,
  DistributionDescriptor,
  FundClosingDescriptor,
  FundDefinition,
  FundEvidenceBundle,
  FundEvidenceBundleSchemaVersion,
  FundFinalityPayload,
  FundFinalityPayloadSchemaVersion,
  FundPayoutDescriptor,
  FundVerificationReport,
  FundVerificationReportSchemaVersion,
  LPPositionReceipt,
  LPPositionReceiptEnvelope,
  OutputAmountForm,
  OutputAssetForm,
  OutputBindingInputs,
  OutputBindingReasonCode,
  OutputBindingSupportedForm,
  OutputNonceForm,
  OutputRawFields,
  OutputRangeProofForm,
  SimplicityArtifact,
} from "../core/types";
import { ValidationError } from "../core/errors";
import { sha256HexUtf8, stableStringify } from "../core/summary";
import {
  analyzeOutputRawFields,
  computeExplicitV1OutputHash,
  computeRawOutputV1Hash,
  getScriptPubKeyHexViaRpc,
  hashHexBytes,
  isExplicitV1OutputForm,
  normalizeOutputForm,
  normalizeOutputRawFields,
  resolveExplicitAssetHex,
  resolveOutputBindingDecision,
} from "../core/outputBinding";
import {
  buildClaimedCapitalCallState,
  buildDistributionDescriptor,
  buildFundClosingDescriptor,
  buildLPPositionReceipt,
  buildRefundOnlyCapitalCallState,
  buildRefundedCapitalCallState,
  reconcileLPPositionReceipt,
  signLPPositionReceipt,
  summarizeCapitalCallState,
  summarizeDistributionDescriptor,
  summarizeFundClosingDescriptor,
  summarizeFundDefinition,
  summarizeLPPositionReceipt,
  summarizeLPPositionReceiptEnvelope,
  validateCapitalCallState,
  validateClosingAgainstReceipt,
  validateDistributionAgainstReceipt,
  validateDistributionDescriptor,
  validateFundClosingDescriptor,
  validateFundCrossChecks,
  validateFundDefinition,
  validateLPPositionReceipt,
  validateLPPositionReceiptEnvelope,
  verifyLPPositionReceiptEnvelope,
} from "./fundValidation";

const FUND_VERIFICATION_REPORT_SCHEMA_VERSION: FundVerificationReportSchemaVersion = "fund-verification-report/v1";
const FUND_EVIDENCE_BUNDLE_SCHEMA_VERSION: FundEvidenceBundleSchemaVersion = "fund-evidence-bundle/v1";
const FUND_FINALITY_PAYLOAD_SCHEMA_VERSION: FundFinalityPayloadSchemaVersion = "fund-finality-payload/v1";

function resolveValueOrPath<T>(options: { pathValue?: string; objectValue?: T }): { jsonPath?: string; value?: T } {
  if (options.pathValue) return { jsonPath: options.pathValue };
  if (options.objectValue !== undefined) return { value: options.objectValue };
  return {};
}

function resolveFundDocsAsset(filename: string): string {
  const cwdCandidate = path.resolve(process.cwd(), "docs/definitions", filename);
  if (existsSync(cwdCandidate)) return cwdCandidate;
  const bundledCandidate = path.resolve(__dirname, "../docs/definitions", filename);
  if (existsSync(bundledCandidate)) return bundledCandidate;
  return cwdCandidate;
}

function satToBtcAmount(sat: number): number {
  return Number((sat / 1e8).toFixed(8));
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultPositionId(capitalCall: CapitalCallState): string {
  return `${capitalCall.fundId}:${capitalCall.lpId}:${capitalCall.callId}`;
}

function assertOpenCapitalCall(state: CapitalCallState): void {
  if (state.status !== "OPEN") {
    throw new ValidationError("Capital call must be OPEN for claim or rollover execution", {
      code: "FUND_CAPITAL_CALL_NOT_OPEN",
    });
  }
}

function assertRefundOnlyCapitalCall(state: CapitalCallState): void {
  if (state.status !== "REFUND_ONLY") {
    throw new ValidationError("Capital call must be REFUND_ONLY for refund execution", {
      code: "FUND_CAPITAL_CALL_NOT_REFUND_ONLY",
    });
  }
}

function deriveCapitalCallStage(state: CapitalCallState): "open" | "claimed" | "refund-only" | "refunded" {
  if (state.status === "CLAIMED") return "claimed";
  if (state.status === "REFUND_ONLY") return "refund-only";
  if (state.status === "REFUNDED") return "refunded";
  return "open";
}

function summarizeFundPayoutDescriptor(descriptor: FundPayoutDescriptor): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify({
    receiverAddress: descriptor.receiverAddress,
    nextOutputHash: descriptor.nextOutputHash ?? null,
    nextOutputScriptHash: descriptor.nextOutputScriptHash ?? null,
    amountSat: descriptor.amountSat,
    assetId: descriptor.assetId,
    requestedOutputBindingMode: descriptor.requestedOutputBindingMode ?? descriptor.outputBindingMode,
    outputForm: normalizeOutputForm(descriptor.outputForm),
    rawOutput: normalizeOutputRawFields(descriptor.rawOutput) ?? null,
    feeIndex: descriptor.feeIndex,
    nextOutputIndex: descriptor.nextOutputIndex,
    maxFeeSat: descriptor.maxFeeSat,
    outputBindingMode: descriptor.outputBindingMode,
  });
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

function validateFundPayoutDescriptor(descriptor: FundPayoutDescriptor): FundPayoutDescriptor {
  if (!descriptor.receiverAddress || descriptor.receiverAddress.trim().length === 0) {
    throw new ValidationError("receiverAddress must be a non-empty string", {
      code: "FUND_PAYOUT_RECEIVER_REQUIRED",
    });
  }
  if (!Number.isInteger(descriptor.amountSat) || descriptor.amountSat <= 0) {
    throw new ValidationError("amountSat must be a positive integer", {
      code: "FUND_PAYOUT_AMOUNT_INVALID",
    });
  }
  if (!descriptor.assetId || descriptor.assetId.trim().length === 0) {
    throw new ValidationError("assetId must be a non-empty string", {
      code: "FUND_PAYOUT_ASSET_REQUIRED",
    });
  }
  if (!Number.isInteger(descriptor.feeIndex) || descriptor.feeIndex < 0) {
    throw new ValidationError("feeIndex must be a non-negative integer", {
      code: "FUND_PAYOUT_FEE_INDEX_INVALID",
    });
  }
  if (!Number.isInteger(descriptor.nextOutputIndex) || descriptor.nextOutputIndex < 0) {
    throw new ValidationError("nextOutputIndex must be a non-negative integer", {
      code: "FUND_PAYOUT_NEXT_OUTPUT_INDEX_INVALID",
    });
  }
  if (!Number.isInteger(descriptor.maxFeeSat) || descriptor.maxFeeSat < 0) {
    throw new ValidationError("maxFeeSat must be a non-negative integer", {
      code: "FUND_PAYOUT_MAX_FEE_INVALID",
    });
  }
  if (!( ["none", "script-bound", "descriptor-bound"] as string[]).includes(descriptor.outputBindingMode)) {
    throw new ValidationError("outputBindingMode must be none, script-bound, or descriptor-bound", {
      code: "FUND_PAYOUT_BINDING_MODE_INVALID",
    });
  }
  if (
    descriptor.requestedOutputBindingMode
    && !(["none", "script-bound", "descriptor-bound"] as string[]).includes(descriptor.requestedOutputBindingMode)
  ) {
    throw new ValidationError("requestedOutputBindingMode must be none, script-bound, or descriptor-bound", {
      code: "FUND_PAYOUT_REQUESTED_BINDING_MODE_INVALID",
    });
  }
  if (descriptor.nextOutputHash && !/^[0-9a-f]{64}$/i.test(descriptor.nextOutputHash)) {
    throw new ValidationError("nextOutputHash must be a 64-character hex string", {
      code: "FUND_PAYOUT_OUTPUT_HASH_INVALID",
    });
  }
  if (descriptor.nextOutputScriptHash && !/^[0-9a-f]{64}$/i.test(descriptor.nextOutputScriptHash)) {
    throw new ValidationError("nextOutputScriptHash must be a 64-character hex string", {
      code: "FUND_PAYOUT_OUTPUT_SCRIPT_HASH_INVALID",
    });
  }
  descriptor.rawOutput = normalizeOutputRawFields(descriptor.rawOutput);
  descriptor.outputForm = normalizeOutputForm(descriptor.outputForm);
  descriptor.requestedOutputBindingMode = descriptor.requestedOutputBindingMode ?? descriptor.outputBindingMode;
  return descriptor;
}

function buildFundOutputBindingReport(input: {
  descriptor?: FundPayoutDescriptor;
  supportedForm?: OutputBindingSupportedForm;
  reasonCode?: OutputBindingReasonCode;
  autoDerived?: boolean;
  fallbackReason?: string;
  bindingInputs?: OutputBindingInputs;
}): FundVerificationReport["outputBindingTrust"] | undefined {
  if (!input.descriptor) return undefined;
  const runtimeBound = input.descriptor.outputBindingMode !== "none";
  return {
    mode: input.descriptor.outputBindingMode,
    requestedMode: input.descriptor.requestedOutputBindingMode,
    supportedForm: input.supportedForm ?? "unsupported",
    nextReceiverRuntimeCommitted: runtimeBound,
    outputCountRuntimeBound: runtimeBound,
    feeIndexRuntimeBound: runtimeBound,
    nextOutputHashRuntimeBound: input.descriptor.outputBindingMode === "descriptor-bound",
    nextOutputScriptRuntimeBound: input.descriptor.outputBindingMode === "script-bound",
    amountRuntimeBound: input.descriptor.outputBindingMode === "descriptor-bound",
    reasonCode:
      input.reasonCode
      ?? (input.descriptor.outputBindingMode === "descriptor-bound"
        ? "OK_MANUAL_HASH"
        : input.descriptor.outputBindingMode === "script-bound"
          ? "OK_SCRIPT_BOUND"
          : "OK_NONE"),
    autoDerived: input.autoDerived,
    fallbackReason: input.fallbackReason,
    bindingInputs:
      input.bindingInputs
      ?? {
        assetId: input.descriptor.assetId,
        assetForm: input.descriptor.outputForm?.assetForm ?? "explicit",
        amountForm: input.descriptor.outputForm?.amountForm ?? "explicit",
        nonceForm: input.descriptor.outputForm?.nonceForm ?? "null",
        rangeProofForm: input.descriptor.outputForm?.rangeProofForm ?? "empty",
        nextAmountSat: input.descriptor.amountSat,
        nextOutputIndex: input.descriptor.nextOutputIndex,
        feeIndex: input.descriptor.feeIndex,
        maxFeeSat: input.descriptor.maxFeeSat,
      },
  };
}

async function buildFundPayoutDescriptor(
  sdk: SimplicityClient,
  input: {
    receiverAddress: string;
    amountSat: number;
    assetId: string;
    maxFeeSat?: number;
    nextOutputIndex?: number;
    feeIndex?: number;
    nextOutputHash?: string;
    outputForm?: {
      assetForm?: OutputAssetForm;
      amountForm?: OutputAmountForm;
      nonceForm?: OutputNonceForm;
      rangeProofForm?: OutputRangeProofForm;
    };
    rawOutput?: Partial<OutputRawFields>;
    outputBindingMode?: BondOutputBindingMode;
  },
) {
  const nextScriptPubKeyHex = await getScriptPubKeyHexViaRpc(sdk, input.receiverAddress);
  const nextOutputScriptHash = hashHexBytes(nextScriptPubKeyHex);
  const requestedBindingMode = input.outputBindingMode ?? "descriptor-bound";
  const outputForm = normalizeOutputForm(input.outputForm);
  const rawOutput = normalizeOutputRawFields(input.rawOutput);
  const rawOutputAnalysis = analyzeOutputRawFields(rawOutput);
  const explicitAssetHex = requestedBindingMode !== "none" && isExplicitV1OutputForm(outputForm)
    ? await resolveExplicitAssetHex(sdk, input.assetId)
    : undefined;
  const autoDerivedNextOutputHash = requestedBindingMode === "descriptor-bound" && !input.nextOutputHash
    ? rawOutputAnalysis.valid && rawOutputAnalysis.normalized
      ? computeRawOutputV1Hash(rawOutputAnalysis.normalized)
      : explicitAssetHex
        ? computeExplicitV1OutputHash({
            assetHex: explicitAssetHex,
            nextAmountSat: input.amountSat,
            nextOutputScriptHash,
          })
        : undefined
    : undefined;
  const nextOutputHash = input.nextOutputHash ?? autoDerivedNextOutputHash;
  const bindingResolution = resolveOutputBindingDecision({
    requestedBindingMode,
    nextOutputHash,
    nextOutputScriptHash,
    autoDerivedNextOutputHash: Boolean(autoDerivedNextOutputHash && !input.nextOutputHash),
    explicitAssetSupported: Boolean(explicitAssetHex),
    outputForm,
    rawOutput,
  });
  const descriptor = validateFundPayoutDescriptor({
    receiverAddress: input.receiverAddress,
    nextOutputHash: bindingResolution.outputBindingMode === "descriptor-bound" ? nextOutputHash : undefined,
    nextOutputScriptHash: bindingResolution.outputBindingMode !== "none" ? nextOutputScriptHash : undefined,
    amountSat: input.amountSat,
    assetId: input.assetId,
    requestedOutputBindingMode: requestedBindingMode,
    outputForm,
    rawOutput,
    feeIndex: input.feeIndex ?? 1,
    nextOutputIndex: input.nextOutputIndex ?? 0,
    maxFeeSat: input.maxFeeSat ?? 100,
    outputBindingMode: bindingResolution.outputBindingMode,
  });
  const bindingInputs: OutputBindingInputs = {
    assetId: descriptor.assetId,
    assetForm: descriptor.outputForm?.assetForm ?? "explicit",
    amountForm: descriptor.outputForm?.amountForm ?? "explicit",
    nonceForm: descriptor.outputForm?.nonceForm ?? "null",
    rangeProofForm: descriptor.outputForm?.rangeProofForm ?? "empty",
    nextAmountSat: descriptor.amountSat,
    nextOutputIndex: descriptor.nextOutputIndex,
    feeIndex: descriptor.feeIndex,
    maxFeeSat: descriptor.maxFeeSat,
    ...(rawOutputAnalysis.valid && rawOutputAnalysis.normalized
      ? {
          rawOutputComponents: {
            scriptPubKey: rawOutputAnalysis.normalized.scriptComponentSource,
            rangeProof: rawOutputAnalysis.normalized.rangeProofComponentSource,
          },
        }
      : {}),
  };
  return {
    descriptor,
    summary: summarizeFundPayoutDescriptor(descriptor),
    supportedForm: bindingResolution.supportedForm,
    autoDerivedNextOutputHash: bindingResolution.autoDerived,
    reasonCode: bindingResolution.reasonCode,
    fallbackReason: bindingResolution.fallbackReason,
    bindingInputs,
  };
}

function buildBindingModeWitnessValue(mode: BondOutputBindingMode): string {
  return mode === "descriptor-bound" ? "0x01" : mode === "script-bound" ? "0x02" : "0x03";
}

function buildClaimWitness(descriptor: FundPayoutDescriptor) {
  return {
    values: {
      ACTION_8: { type: "u8", value: "0x01" },
      EXPECTED_PAYOUT_OUTPUT_HASH: {
        type: "u256",
        value: `0x${descriptor.nextOutputHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      EXPECTED_PAYOUT_OUTPUT_SCRIPT_HASH: {
        type: "u256",
        value: `0x${descriptor.nextOutputScriptHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      OUTPUT_BINDING_MODE: {
        type: "u8",
        value: buildBindingModeWitnessValue(descriptor.outputBindingMode),
      },
    },
  };
}

function buildRolloverWitness() {
  return {
    values: {
      ACTION_8: { type: "u8", value: "0x02" },
      EXPECTED_PAYOUT_OUTPUT_HASH: {
        type: "u256",
        value: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
      EXPECTED_PAYOUT_OUTPUT_SCRIPT_HASH: {
        type: "u256",
        value: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
      OUTPUT_BINDING_MODE: { type: "u8", value: "0x00" },
    },
  };
}

function buildRefundWitness() {
  return { values: {} };
}

function buildDistributionWitness(descriptor: FundPayoutDescriptor) {
  return {
    values: {
      EXPECTED_PAYOUT_OUTPUT_HASH: {
        type: "u256",
        value: `0x${descriptor.nextOutputHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      EXPECTED_PAYOUT_OUTPUT_SCRIPT_HASH: {
        type: "u256",
        value: `0x${descriptor.nextOutputScriptHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      OUTPUT_BINDING_MODE: {
        type: "u8",
        value: buildBindingModeWitnessValue(descriptor.outputBindingMode),
      },
    },
  };
}

async function loadFundDefinitionDocument(
  sdk: SimplicityClient,
  input: { definitionPath?: string; definitionValue?: FundDefinition },
) {
  const source = resolveValueOrPath({ pathValue: input.definitionPath, objectValue: input.definitionValue });
  const initial = await sdk.loadDefinition({
    type: "fund-definition",
    id: input.definitionValue?.fundId ?? "FUND-001",
    ...source,
  });
  const value = validateFundDefinition(JSON.parse(initial.canonicalJson));
  const descriptor = await sdk.loadDefinition({
    type: "fund-definition",
    id: value.fundId,
    ...(source.jsonPath ? { jsonPath: source.jsonPath } : { value }),
  });
  return { descriptor, value, summary: summarizeFundDefinition(value) };
}

async function loadCapitalCallDocument(
  sdk: SimplicityClient,
  input: { capitalCallPath?: string; capitalCallValue?: CapitalCallState },
) {
  const source = resolveValueOrPath({ pathValue: input.capitalCallPath, objectValue: input.capitalCallValue });
  const initial = await sdk.loadStateDocument({
    type: "fund-capital-call",
    id: input.capitalCallValue?.callId ?? "CALL-001",
    ...source,
  });
  const value = validateCapitalCallState(JSON.parse(initial.canonicalJson));
  const descriptor = await sdk.loadStateDocument({
    type: "fund-capital-call",
    id: value.callId,
    ...(source.jsonPath ? { jsonPath: source.jsonPath } : { value }),
  });
  return { descriptor, value, summary: summarizeCapitalCallState(value) };
}

async function loadBarePositionReceiptDocument(
  sdk: SimplicityClient,
  input: { positionReceiptPath?: string; positionReceiptValue?: LPPositionReceipt },
) {
  const source = resolveValueOrPath({ pathValue: input.positionReceiptPath, objectValue: input.positionReceiptValue });
  const initial = await sdk.loadStateDocument({
    type: "fund-position-receipt",
    id: input.positionReceiptValue?.positionId ?? "POSITION-001",
    ...source,
  });
  const value = validateLPPositionReceipt(JSON.parse(initial.canonicalJson));
  const descriptor = await sdk.loadStateDocument({
    type: "fund-position-receipt",
    id: value.positionId,
    ...(source.jsonPath ? { jsonPath: source.jsonPath } : { value }),
  });
  return { descriptor, value, summary: summarizeLPPositionReceipt(value) };
}

async function loadPositionReceiptEnvelopeDocument(
  sdk: SimplicityClient,
  input: { positionReceiptPath?: string; positionReceiptValue?: LPPositionReceiptEnvelope },
) {
  const source = resolveValueOrPath({ pathValue: input.positionReceiptPath, objectValue: input.positionReceiptValue });
  const initial = await sdk.loadStateDocument({
    type: "fund-position-receipt-envelope",
    id: input.positionReceiptValue?.receipt.positionId ?? "POSITION-001",
    ...source,
  });
  const value = validateLPPositionReceiptEnvelope(JSON.parse(initial.canonicalJson));
  const descriptor = await sdk.loadStateDocument({
    type: "fund-position-receipt-envelope",
    id: value.receipt.positionId,
    ...(source.jsonPath ? { jsonPath: source.jsonPath } : { value }),
  });
  return {
    descriptor,
    value,
    receiptSummary: summarizeLPPositionReceipt(value.receipt),
    envelopeSummary: summarizeLPPositionReceiptEnvelope(value),
  };
}

async function loadDistributionDocument(
  sdk: SimplicityClient,
  input: {
    distributionPath?: string;
    distributionValue?: DistributionDescriptor;
    positionReceipt?: LPPositionReceipt;
    distributionId?: string;
    assetId?: string;
    amountSat?: number;
    approvedAt?: string;
  },
) {
  const source = resolveValueOrPath({ pathValue: input.distributionPath, objectValue: input.distributionValue });
  let value: DistributionDescriptor;
  if (source.jsonPath || source.value) {
    const initial = await sdk.loadStateDocument({
      type: "fund-distribution",
      id: input.distributionValue?.distributionId ?? input.distributionId ?? "DIST-001",
      ...source,
    });
    value = validateDistributionDescriptor(JSON.parse(initial.canonicalJson));
  } else {
    if (!input.positionReceipt || !input.distributionId || !input.assetId || input.amountSat === undefined || !input.approvedAt) {
      throw new ValidationError(
        "distributionPath/distributionValue or positionReceipt + distributionId + assetId + amountSat + approvedAt is required",
        { code: "FUND_DISTRIBUTION_INPUT_REQUIRED" },
      );
    }
    value = buildDistributionDescriptor({
      distributionId: input.distributionId,
      receipt: input.positionReceipt,
      assetId: input.assetId,
      amountSat: input.amountSat,
      approvedAt: input.approvedAt,
    });
  }
  const descriptor = await sdk.loadStateDocument({
    type: "fund-distribution",
    id: value.distributionId,
    ...(source.jsonPath ? { jsonPath: source.jsonPath } : { value }),
  });
  return { descriptor, value, summary: summarizeDistributionDescriptor(value) };
}

async function loadDistributionDocuments(
  sdk: SimplicityClient,
  input: {
    distributionPath?: string;
    distributionValue?: DistributionDescriptor;
    distributionPaths?: string[];
    distributionValues?: DistributionDescriptor[];
  },
) {
  const combinedPaths = [...(input.distributionPaths ?? []), ...(input.distributionPath ? [input.distributionPath] : [])];
  const combinedValues = [...(input.distributionValues ?? []), ...(input.distributionValue ? [input.distributionValue] : [])];
  const results = [];
  for (const distributionPath of combinedPaths) results.push(await loadDistributionDocument(sdk, { distributionPath }));
  for (const distributionValue of combinedValues) results.push(await loadDistributionDocument(sdk, { distributionValue }));
  return results;
}

async function loadClosingDocument(
  sdk: SimplicityClient,
  input: {
    closingPath?: string;
    closingValue?: FundClosingDescriptor;
    positionReceipt?: LPPositionReceipt;
    closingId?: string;
    finalDistributionHashes?: string[];
    closedAt?: string;
    closingReason?: FundClosingDescriptor["closingReason"];
  },
) {
  const source = resolveValueOrPath({ pathValue: input.closingPath, objectValue: input.closingValue });
  let value: FundClosingDescriptor;
  if (source.jsonPath || source.value) {
    const initial = await sdk.loadStateDocument({
      type: "fund-closing",
      id: input.closingValue?.closingId ?? input.closingId ?? "CLOSE-001",
      ...source,
    });
    value = validateFundClosingDescriptor(JSON.parse(initial.canonicalJson));
  } else {
    if (!input.positionReceipt || !input.closingId || !input.finalDistributionHashes || !input.closedAt) {
      throw new ValidationError(
        "closingPath/closingValue or positionReceipt + closingId + finalDistributionHashes + closedAt is required",
        { code: "FUND_CLOSING_INPUT_REQUIRED" },
      );
    }
    value = buildFundClosingDescriptor({
      receipt: input.positionReceipt,
      closingId: input.closingId,
      finalDistributionHashes: input.finalDistributionHashes,
      closedAt: input.closedAt,
      closingReason: input.closingReason,
    });
  }
  const descriptor = await sdk.loadStateDocument({
    type: "fund-closing",
    id: value.closingId,
    ...(source.jsonPath ? { jsonPath: source.jsonPath } : { value }),
  });
  return { descriptor, value, summary: summarizeFundClosingDescriptor(value) };
}

function buildBaseFundReport(): FundVerificationReport {
  return { schemaVersion: FUND_VERIFICATION_REPORT_SCHEMA_VERSION };
}

async function compileOpenCapitalCallContract(
  sdk: SimplicityClient,
  input: {
    definition: FundDefinition;
    capitalCall: CapitalCallState;
    refundOnlyScriptHash: string;
    simfPath?: string;
    artifactPath?: string;
  },
) {
  return sdk.compileFromFile({
    simfPath: input.simfPath ?? resolveFundDocsAsset("fund-capital-call-open.simf"),
    templateVars: {
      MANAGER_XONLY: input.definition.managerXonly,
      LP_XONLY: input.capitalCall.lpXonly,
      CLAIM_CUTOFF_HEIGHT: input.capitalCall.claimCutoffHeight,
      REFUND_ONLY_SCRIPT_HASH: input.refundOnlyScriptHash,
      CAPITAL_CALL_STAGE: "OPEN",
    },
    definition: {
      type: "fund-definition",
      id: input.definition.fundId,
      value: input.definition,
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: "fund-capital-call",
      id: input.capitalCall.callId,
      value: input.capitalCall,
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });
}

async function compileRefundOnlyCapitalCallContract(
  sdk: SimplicityClient,
  input: {
    definition: FundDefinition;
    capitalCall: CapitalCallState;
    simfPath?: string;
    artifactPath?: string;
  },
) {
  return sdk.compileFromFile({
    simfPath: input.simfPath ?? resolveFundDocsAsset("fund-capital-call-refund-only.simf"),
    templateVars: {
      LP_XONLY: input.capitalCall.lpXonly,
      CAPITAL_CALL_STAGE: "REFUND_ONLY",
    },
    definition: {
      type: "fund-definition",
      id: input.definition.fundId,
      value: input.definition,
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: "fund-capital-call",
      id: input.capitalCall.callId,
      value: input.capitalCall,
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });
}

async function compileDistributionClaimContract(
  sdk: SimplicityClient,
  input: {
    definition: FundDefinition;
    distribution: DistributionDescriptor;
    receipt: LPPositionReceipt;
    simfPath?: string;
    artifactPath?: string;
  },
) {
  return sdk.compileFromFile({
    simfPath: input.simfPath ?? resolveFundDocsAsset("fund-distribution-claim.simf"),
    templateVars: {
      LP_XONLY: input.receipt.lpXonly,
    },
    definition: {
      type: "fund-definition",
      id: input.definition.fundId,
      value: input.definition,
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: "fund-distribution",
      id: input.distribution.distributionId,
      value: input.distribution,
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });
}

async function requireFundArtifact(
  sdk: SimplicityClient,
  input: { artifactPath?: string; artifact?: SimplicityArtifact },
): Promise<SimplicityArtifact> {
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  if (!artifact) {
    throw new ValidationError("artifactPath or artifact is required", { code: "FUND_ARTIFACT_REQUIRED" });
  }
  return artifact;
}

async function requireRefundOnlyArtifact(
  sdk: SimplicityClient,
  input: { refundOnlyArtifactPath?: string; refundOnlyArtifact?: SimplicityArtifact },
): Promise<SimplicityArtifact> {
  const artifact = input.refundOnlyArtifact
    ?? (input.refundOnlyArtifactPath ? (await sdk.loadArtifact(input.refundOnlyArtifactPath)).artifact : undefined);
  if (!artifact) {
    throw new ValidationError("refundOnlyArtifactPath or refundOnlyArtifact is required", {
      code: "FUND_REFUND_ONLY_ARTIFACT_REQUIRED",
    });
  }
  return artifact;
}

function ensureVerifiedEnvelope(definition: FundDefinition, envelope: LPPositionReceiptEnvelope) {
  const checks = verifyLPPositionReceiptEnvelope({
    envelope,
    expectedManagerXonly: definition.managerXonly,
  });
  if (
    !checks.positionReceiptHashMatch
    || !checks.sequenceMatch
    || !checks.sequenceMonotonic
    || !checks.attestingSignerMatch
    || !checks.attestationVerified
  ) {
    throw new ValidationError("Position receipt envelope must be attested and internally consistent", {
      code: "FUND_POSITION_ENVELOPE_VERIFY_FAILED",
      checks,
    });
  }
  return checks;
}

function buildReceiptTrust(input: {
  generated: boolean;
  envelope: LPPositionReceiptEnvelope;
  checks: ReturnType<typeof verifyLPPositionReceiptEnvelope>;
}): FundVerificationReport["receiptTrust"] {
  return {
    generated: input.generated,
    positionReceiptHash: summarizeLPPositionReceipt(input.envelope.receipt).hash,
    positionStatus: input.envelope.receipt.status,
    attested: true,
    attestationVerified: input.checks.attestationVerified,
    sequence: input.envelope.receipt.sequence,
    sequenceMonotonic: input.checks.sequenceMonotonic && input.checks.sequenceMatch,
    attestingSignerMatch: input.checks.attestingSignerMatch,
  };
}

export async function define(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: FundDefinition;
  },
) {
  const definition = await loadFundDefinitionDocument(sdk, input);
  return {
    ok: true,
    definition: definition.descriptor,
    definitionValue: definition.value,
    summary: definition.summary,
  };
}

export async function verify(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: FundDefinition;
  },
) {
  return define(sdk, input);
}

export async function load(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: FundDefinition;
  },
) {
  const result = await define(sdk, input);
  return {
    definition: result.definition,
    definitionValue: result.definitionValue,
    summary: result.summary,
  };
}

export async function prepareCapitalCall(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: FundDefinition;
    capitalCallPath?: string;
    capitalCallValue?: CapitalCallState;
    openSimfPath?: string;
    refundOnlySimfPath?: string;
    openArtifactPath?: string;
    refundOnlyArtifactPath?: string;
  },
) {
  const definition = await loadFundDefinitionDocument(sdk, input);
  const capitalCall = await loadCapitalCallDocument(sdk, input);
  assertOpenCapitalCall(capitalCall.value);
  const crossChecks = validateFundCrossChecks(definition.value, capitalCall.value);
  const refundOnlyCapitalCallValue = buildRefundOnlyCapitalCallState({ previous: capitalCall.value });
  const refundOnlyCompiled = await compileRefundOnlyCapitalCallContract(sdk, {
    definition: definition.value,
    capitalCall: refundOnlyCapitalCallValue,
    simfPath: input.refundOnlySimfPath,
    artifactPath: input.refundOnlyArtifactPath,
  });
  const refundOnlyScriptPubKeyHex = await getScriptPubKeyHexViaRpc(sdk, refundOnlyCompiled.deployment().contractAddress);
  const openCompiled = await compileOpenCapitalCallContract(sdk, {
    definition: definition.value,
    capitalCall: capitalCall.value,
    refundOnlyScriptHash: hashHexBytes(refundOnlyScriptPubKeyHex),
    simfPath: input.openSimfPath,
    artifactPath: input.openArtifactPath,
  });
  return {
    definition: definition.descriptor,
    definitionValue: definition.value,
    definitionSummary: definition.summary,
    capitalCall: capitalCall.descriptor,
    capitalCallValue: capitalCall.value,
    capitalCallSummary: capitalCall.summary,
    refundOnlyCapitalCallValue,
    refundOnlyCapitalCallSummary: summarizeCapitalCallState(refundOnlyCapitalCallValue),
    crossChecks,
    openCompiled,
    refundOnlyCompiled,
    report: {
      ...buildBaseFundReport(),
      capitalCallTrust: {
        capitalCallStage: deriveCapitalCallStage(capitalCall.value),
        cutoffMode: "rollover-window",
        fundIdMatch: crossChecks.fundIdMatch,
        currencyMatch: crossChecks.currencyMatch,
        managerMatch: crossChecks.managerMatch,
        claimCutoffCommitted: true,
        lpCommitted: true,
        managerCommitted: true,
        claimPathRuntimeAvailable: true,
        refundPathRuntimeAvailable: false,
        statusValid: true,
      },
    } satisfies FundVerificationReport,
  };
}

export async function verifyCapitalCall(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: FundDefinition;
    capitalCallPath?: string;
    capitalCallValue?: CapitalCallState;
  },
) {
  const definition = await loadFundDefinitionDocument(sdk, input);
  const capitalCall = await loadCapitalCallDocument(sdk, input);
  const crossChecks = validateFundCrossChecks(definition.value, capitalCall.value);
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  const definitionVerification = artifact
    ? await sdk.verifyDefinitionAgainstArtifact({
        artifact,
        type: "fund-definition",
        id: definition.value.fundId,
        value: definition.value,
      })
    : undefined;
  const stateVerification = artifact
    ? await sdk.verifyStateAgainstArtifact({
        artifact,
        type: "fund-capital-call",
        id: capitalCall.value.callId,
        value: capitalCall.value,
      })
    : undefined;
  const artifactVars = artifact?.source.templateVars ?? {};
  const artifactStage = artifact ? String(artifactVars.CAPITAL_CALL_STAGE ?? "").toUpperCase() : "";
  const claimCutoffCommitted = artifact
    ? Number(artifactVars.CLAIM_CUTOFF_HEIGHT ?? capitalCall.value.claimCutoffHeight) === capitalCall.value.claimCutoffHeight
    : true;
  const lpCommitted = artifact
    ? String(artifactVars.LP_XONLY ?? "").toLowerCase() === capitalCall.value.lpXonly.toLowerCase()
    : true;
  const managerCommitted = artifact
    ? artifactStage === "REFUND_ONLY"
      ? true
      : String(artifactVars.MANAGER_XONLY ?? "").toLowerCase() === definition.value.managerXonly.toLowerCase()
    : true;
  const stageValid = artifact
    ? (capitalCall.value.status === "OPEN" && artifactStage === "OPEN")
      || (capitalCall.value.status === "REFUND_ONLY" && artifactStage === "REFUND_ONLY")
    : true;
  const claimPathRuntimeAvailable = capitalCall.value.status === "OPEN";
  const refundPathRuntimeAvailable = capitalCall.value.status === "REFUND_ONLY";
  const statusValid = true;
  const ok = (!definitionVerification || definitionVerification.ok)
    && (!stateVerification || stateVerification.ok)
    && crossChecks.fundIdMatch
    && crossChecks.currencyMatch
    && crossChecks.managerMatch
    && claimCutoffCommitted
    && lpCommitted
    && managerCommitted
    && stageValid
    && statusValid;
  return {
    ok,
    reason: ok ? undefined : "Fund capital call verification failed",
    artifact,
    definition: definition.descriptor,
    definitionValue: definition.value,
    capitalCall: capitalCall.descriptor,
    capitalCallValue: capitalCall.value,
    definitionSummary: definition.summary,
    capitalCallSummary: capitalCall.summary,
    artifactVerification:
      artifact && definitionVerification && stateVerification
        ? { definition: definitionVerification, state: stateVerification }
        : undefined,
    report: {
      ...buildBaseFundReport(),
      ...(definitionVerification && stateVerification
        ? {
            artifactTrust: {
              definition: definitionVerification.trust,
              state: stateVerification.trust,
            },
            stateTrust: stateVerification.trust,
          }
        : {}),
      capitalCallTrust: {
        capitalCallStage: deriveCapitalCallStage(capitalCall.value),
        cutoffMode: "rollover-window",
        fundIdMatch: crossChecks.fundIdMatch,
        currencyMatch: crossChecks.currencyMatch,
        managerMatch: crossChecks.managerMatch,
        claimCutoffCommitted,
        lpCommitted,
        managerCommitted,
        claimPathRuntimeAvailable,
        refundPathRuntimeAvailable,
        statusValid,
      },
    } satisfies FundVerificationReport,
  };
}

export async function signPositionReceipt(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: FundDefinition;
    positionReceiptPath?: string;
    positionReceiptValue?: LPPositionReceipt;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    signedAt?: string;
  },
) {
  const definition = await loadFundDefinitionDocument(sdk, input);
  const receipt = await loadBarePositionReceiptDocument(sdk, input);
  const positionReceiptEnvelope = signLPPositionReceipt({
    receipt: receipt.value,
    managerXonly: definition.value.managerXonly,
    signer: input.signer,
    signedAt: input.signedAt,
  });
  return {
    definition: definition.descriptor,
    definitionValue: definition.value,
    definitionSummary: definition.summary,
    positionReceipt: receipt.descriptor,
    positionReceiptValue: receipt.value,
    positionReceiptSummary: receipt.summary,
    positionReceiptEnvelope,
    positionReceiptEnvelopeSummary: summarizeLPPositionReceiptEnvelope(positionReceiptEnvelope),
  };
}

export async function verifyPositionReceipt(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: FundDefinition;
    positionReceiptPath?: string;
    positionReceiptValue?: LPPositionReceiptEnvelope;
  },
) {
  const definition = await loadFundDefinitionDocument(sdk, input);
  const envelope = await loadPositionReceiptEnvelopeDocument(sdk, input);
  const receiptChecks = ensureVerifiedEnvelope(definition.value, envelope.value);
  return {
    verified: true,
    definition: definition.descriptor,
    definitionValue: definition.value,
    definitionSummary: definition.summary,
    positionReceipt: envelope.descriptor,
    positionReceiptValue: envelope.value,
    positionReceiptSummary: envelope.receiptSummary,
    positionReceiptEnvelopeSummary: envelope.envelopeSummary,
    receiptChecks,
    report: {
      ...buildBaseFundReport(),
      receiptTrust: buildReceiptTrust({ generated: false, envelope: envelope.value, checks: receiptChecks }),
    } satisfies FundVerificationReport,
  };
}

export async function inspectCapitalCallClaim(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: FundDefinition;
    capitalCallPath?: string;
    capitalCallValue?: CapitalCallState;
    payoutAddress: string;
    positionId?: string;
    claimedAt?: string;
    nextOutputHash?: string;
    outputForm?: {
      assetForm?: OutputAssetForm;
      amountForm?: OutputAmountForm;
      nonceForm?: OutputNonceForm;
      rangeProofForm?: OutputRangeProofForm;
    };
    rawOutput?: Partial<OutputRawFields>;
    outputBindingMode?: BondOutputBindingMode;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  },
) {
  const verified = await verifyCapitalCall(sdk, input);
  if (!verified.ok) {
    throw new ValidationError(verified.reason ?? "Fund capital call verification failed", {
      code: "FUND_CAPITAL_CALL_VERIFY_FAILED",
    });
  }
  assertOpenCapitalCall(verified.capitalCallValue);
  const definition = await loadFundDefinitionDocument(sdk, input);
  const artifact = await requireFundArtifact(sdk, input);
  const payout = await buildFundPayoutDescriptor(sdk, {
    receiverAddress: input.payoutAddress,
    amountSat: verified.capitalCallValue.amount,
    assetId: verified.capitalCallValue.currencyAssetId,
    nextOutputHash: input.nextOutputHash,
    outputForm: input.outputForm,
    rawOutput: input.rawOutput,
    outputBindingMode: input.outputBindingMode,
  });
  const claimedAt = input.claimedAt ?? nowIso();
  const claimedCapitalCall = buildClaimedCapitalCallState({ previous: verified.capitalCallValue, claimedAt });
  const positionReceipt = buildLPPositionReceipt({
    positionId: input.positionId ?? defaultPositionId(verified.capitalCallValue),
    capitalCall: verified.capitalCallValue,
    effectiveAt: claimedAt,
  });
  const positionReceiptEnvelope = signLPPositionReceipt({
    receipt: positionReceipt,
    managerXonly: definition.value.managerXonly,
    signer: input.signer,
    signedAt: claimedAt,
  });
  const receiptChecks = ensureVerifiedEnvelope(definition.value, positionReceiptEnvelope);
  const contract = sdk.fromArtifact(artifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: payout.descriptor.receiverAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(payout.descriptor.amountSat),
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    witness: buildClaimWitness(payout.descriptor),
  });
  return {
    mode: "claim" as const,
    verified,
    payoutDescriptor: payout.descriptor,
    payoutSummary: payout.summary,
    claimedCapitalCall,
    positionReceipt,
    positionReceiptEnvelope,
    positionReceiptEnvelopeSummary: summarizeLPPositionReceiptEnvelope(positionReceiptEnvelope),
    inspect,
    report: {
      ...verified.report,
      outputBindingTrust: buildFundOutputBindingReport({
        descriptor: payout.descriptor,
        supportedForm: payout.supportedForm,
        reasonCode: payout.reasonCode,
        autoDerived: payout.autoDerivedNextOutputHash,
        fallbackReason: payout.fallbackReason,
        bindingInputs: payout.bindingInputs,
      }),
      receiptTrust: buildReceiptTrust({ generated: true, envelope: positionReceiptEnvelope, checks: receiptChecks }),
    } satisfies FundVerificationReport,
  };
}

export async function executeCapitalCallClaim(
  sdk: SimplicityClient,
  input: Parameters<typeof inspectCapitalCallClaim>[1] & { broadcast?: boolean },
) {
  const inspected = await inspectCapitalCallClaim(sdk, input);
  const artifact = await requireFundArtifact(sdk, input);
  const contract = sdk.fromArtifact(artifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: inspected.payoutDescriptor.receiverAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(inspected.payoutDescriptor.amountSat),
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
    witness: buildClaimWitness(inspected.payoutDescriptor),
  });
  return {
    ...inspected,
    mode: "claim" as const,
    execution,
  };
}

export async function inspectCapitalCallRollover(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    refundOnlyArtifactPath?: string;
    refundOnlyArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: FundDefinition;
    capitalCallPath?: string;
    capitalCallValue?: CapitalCallState;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  },
) {
  const verified = await verifyCapitalCall(sdk, input);
  if (!verified.ok) {
    throw new ValidationError(verified.reason ?? "Fund capital call verification failed", {
      code: "FUND_CAPITAL_CALL_VERIFY_FAILED",
    });
  }
  assertOpenCapitalCall(verified.capitalCallValue);
  const artifact = await requireFundArtifact(sdk, input);
  const refundOnlyArtifact = await requireRefundOnlyArtifact(sdk, input);
  const rolledOverCapitalCall = buildRefundOnlyCapitalCallState({ previous: verified.capitalCallValue });
  const contract = sdk.fromArtifact(artifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: refundOnlyArtifact.compiled.contractAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(verified.capitalCallValue.amount),
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    locktimeHeight: verified.capitalCallValue.claimCutoffHeight,
    witness: buildRolloverWitness(),
  });
  return {
    mode: "rollover" as const,
    verified,
    refundOnlyArtifact,
    rolledOverCapitalCall,
    inspect,
    report: verified.report,
  };
}

export async function executeCapitalCallRollover(
  sdk: SimplicityClient,
  input: Parameters<typeof inspectCapitalCallRollover>[1] & { broadcast?: boolean },
) {
  const inspected = await inspectCapitalCallRollover(sdk, input);
  const artifact = await requireFundArtifact(sdk, input);
  const contract = sdk.fromArtifact(artifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: inspected.refundOnlyArtifact.compiled.contractAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(inspected.verified.capitalCallValue.amount),
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    locktimeHeight: inspected.verified.capitalCallValue.claimCutoffHeight,
    broadcast: input.broadcast,
    witness: buildRolloverWitness(),
  });
  return {
    ...inspected,
    mode: "rollover" as const,
    execution,
  };
}

export async function inspectCapitalCallRefund(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: FundDefinition;
    capitalCallPath?: string;
    capitalCallValue?: CapitalCallState;
    refundAddress: string;
    refundedAt?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  },
) {
  const verified = await verifyCapitalCall(sdk, input);
  if (!verified.ok) {
    throw new ValidationError(verified.reason ?? "Fund capital call verification failed", {
      code: "FUND_CAPITAL_CALL_VERIFY_FAILED",
    });
  }
  assertRefundOnlyCapitalCall(verified.capitalCallValue);
  const artifact = await requireFundArtifact(sdk, input);
  const refundedAt = input.refundedAt ?? nowIso();
  const refundedCapitalCall = buildRefundedCapitalCallState({ previous: verified.capitalCallValue, refundedAt });
  const feeSat = input.feeSat ?? 100;
  const refundAmountSat = verified.capitalCallValue.amount - feeSat;
  if (refundAmountSat <= 0) {
    throw new ValidationError("Refund amount must remain positive after fee deduction", {
      code: "FUND_REFUND_AMOUNT_INVALID",
      details: {
        amount: verified.capitalCallValue.amount,
        feeSat,
      },
    });
  }
  const contract = sdk.fromArtifact(artifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: input.refundAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(refundAmountSat),
    feeSat,
    utxoPolicy: input.utxoPolicy,
    witness: buildRefundWitness(),
  });
  return {
    mode: "refund" as const,
    verified,
    refundedCapitalCall,
    inspect,
    report: verified.report,
  };
}

export async function executeCapitalCallRefund(
  sdk: SimplicityClient,
  input: Parameters<typeof inspectCapitalCallRefund>[1] & { broadcast?: boolean },
) {
  const inspected = await inspectCapitalCallRefund(sdk, input);
  const artifact = await requireFundArtifact(sdk, input);
  const contract = sdk.fromArtifact(artifact);
  const feeSat = input.feeSat ?? 100;
  const refundAmountSat = inspected.verified.capitalCallValue.amount - feeSat;
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: input.refundAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(refundAmountSat),
    feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
    witness: buildRefundWitness(),
  });
  return {
    ...inspected,
    mode: "refund" as const,
    execution,
  };
}

export async function prepareDistribution(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: FundDefinition;
    positionReceiptPath?: string;
    positionReceiptValue?: LPPositionReceiptEnvelope;
    distributionPath?: string;
    distributionValue?: DistributionDescriptor;
    distributionId?: string;
    assetId?: string;
    amountSat?: number;
    approvedAt?: string;
    simfPath?: string;
    artifactPath?: string;
  },
) {
  const definition = await loadFundDefinitionDocument(sdk, input);
  const receipt = await loadPositionReceiptEnvelopeDocument(sdk, input);
  const receiptChecks = ensureVerifiedEnvelope(definition.value, receipt.value);
  const distribution = await loadDistributionDocument(sdk, {
    distributionPath: input.distributionPath,
    distributionValue: input.distributionValue,
    positionReceipt: receipt.value.receipt,
    distributionId: input.distributionId,
    assetId: input.assetId,
    amountSat: input.amountSat,
    approvedAt: input.approvedAt,
  });
  const crossChecks = validateDistributionAgainstReceipt(receipt.value.receipt, distribution.value);
  const compiled = await compileDistributionClaimContract(sdk, {
    definition: definition.value,
    distribution: distribution.value,
    receipt: receipt.value.receipt,
    simfPath: input.simfPath,
    artifactPath: input.artifactPath,
  });
  return {
    definition: definition.descriptor,
    definitionValue: definition.value,
    definitionSummary: definition.summary,
    positionReceipt: receipt.descriptor,
    positionReceiptValue: receipt.value,
    positionReceiptSummary: receipt.receiptSummary,
    positionReceiptEnvelopeSummary: receipt.envelopeSummary,
    distribution: distribution.descriptor,
    distributionValue: distribution.value,
    distributionSummary: distribution.summary,
    crossChecks,
    compiled,
    report: {
      ...buildBaseFundReport(),
      distributionTrust: crossChecks,
      receiptTrust: buildReceiptTrust({ generated: false, envelope: receipt.value, checks: receiptChecks }),
    } satisfies FundVerificationReport,
  };
}

export async function reconcilePosition(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: FundDefinition;
    positionReceiptPath?: string;
    positionReceiptValue?: LPPositionReceiptEnvelope;
    distributionPath?: string;
    distributionValue?: DistributionDescriptor;
    distributionPaths?: string[];
    distributionValues?: DistributionDescriptor[];
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    signedAt?: string;
  },
) {
  const definition = await loadFundDefinitionDocument(sdk, input);
  const receipt = await loadPositionReceiptEnvelopeDocument(sdk, input);
  ensureVerifiedEnvelope(definition.value, receipt.value);
  const distributions = await loadDistributionDocuments(sdk, input);
  const reconciledReceiptValue = reconcileLPPositionReceipt({
    previousEnvelope: receipt.value,
    distributions: distributions.map((entry) => entry.value),
  });
  const reconciledReceiptEnvelope = signLPPositionReceipt({
    receipt: reconciledReceiptValue,
    managerXonly: definition.value.managerXonly,
    signer: input.signer,
    signedAt: input.signedAt,
  });
  return {
    definition: definition.descriptor,
    definitionValue: definition.value,
    definitionSummary: definition.summary,
    positionReceipt: receipt.descriptor,
    positionReceiptValue: receipt.value,
    positionReceiptSummary: receipt.receiptSummary,
    positionReceiptEnvelopeSummary: receipt.envelopeSummary,
    distributions: distributions.map((distribution) => distribution.descriptor),
    distributionValues: distributions.map((distribution) => distribution.value),
    distributionSummaries: distributions.map((distribution) => distribution.summary),
    reconciledReceiptValue,
    reconciledReceiptSummary: summarizeLPPositionReceipt(reconciledReceiptValue),
    reconciledReceiptEnvelope,
    reconciledReceiptEnvelopeSummary: summarizeLPPositionReceiptEnvelope(reconciledReceiptEnvelope),
    totalDistributedAmount: reconciledReceiptValue.distributedAmount,
    distributionCount: reconciledReceiptValue.distributionCount,
  };
}

export async function verifyDistribution(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: FundDefinition;
    positionReceiptPath?: string;
    positionReceiptValue?: LPPositionReceiptEnvelope;
    distributionPath?: string;
    distributionValue?: DistributionDescriptor;
  },
) {
  const definition = await loadFundDefinitionDocument(sdk, input);
  const receipt = await loadPositionReceiptEnvelopeDocument(sdk, input);
  const receiptChecks = ensureVerifiedEnvelope(definition.value, receipt.value);
  const distribution = await loadDistributionDocument(sdk, {
    distributionPath: input.distributionPath,
    distributionValue: input.distributionValue,
  });
  const crossChecks = validateDistributionAgainstReceipt(receipt.value.receipt, distribution.value);
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  const definitionVerification = artifact
    ? await sdk.verifyDefinitionAgainstArtifact({
        artifact,
        type: "fund-definition",
        id: definition.value.fundId,
        value: definition.value,
      })
    : undefined;
  const stateVerification = artifact
    ? await sdk.verifyStateAgainstArtifact({
        artifact,
        type: "fund-distribution",
        id: distribution.value.distributionId,
        value: distribution.value,
      })
    : undefined;
  const artifactVars = artifact?.source.templateVars ?? {};
  const lpCommitted = artifact
    ? String(artifactVars.LP_XONLY ?? "").toLowerCase() === receipt.value.receipt.lpXonly.toLowerCase()
    : true;
  const ok = (!definitionVerification || definitionVerification.ok)
    && (!stateVerification || stateVerification.ok)
    && crossChecks.fundIdMatch
    && crossChecks.lpIdMatch
    && crossChecks.positionIdMatch
    && crossChecks.positionReceiptHashMatch
    && crossChecks.positionStatusEligible
    && lpCommitted;
  return {
    ok,
    reason: ok ? undefined : "Fund distribution verification failed",
    artifact,
    definition: definition.descriptor,
    definitionValue: definition.value,
    positionReceipt: receipt.descriptor,
    positionReceiptValue: receipt.value,
    distribution: distribution.descriptor,
    distributionValue: distribution.value,
    definitionSummary: definition.summary,
    positionReceiptSummary: receipt.receiptSummary,
    positionReceiptEnvelopeSummary: receipt.envelopeSummary,
    distributionSummary: distribution.summary,
    artifactVerification:
      artifact && definitionVerification && stateVerification
        ? { definition: definitionVerification, state: stateVerification }
        : undefined,
    report: {
      ...buildBaseFundReport(),
      ...(definitionVerification && stateVerification
        ? {
            artifactTrust: {
              definition: definitionVerification.trust,
              state: stateVerification.trust,
            },
            stateTrust: stateVerification.trust,
          }
        : {}),
      distributionTrust: {
        ...crossChecks,
        positionStatusEligible: crossChecks.positionStatusEligible && lpCommitted,
      },
      receiptTrust: buildReceiptTrust({ generated: false, envelope: receipt.value, checks: receiptChecks }),
    } satisfies FundVerificationReport,
  };
}

export async function inspectDistributionClaim(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: FundDefinition;
    positionReceiptPath?: string;
    positionReceiptValue?: LPPositionReceiptEnvelope;
    distributionPath?: string;
    distributionValue?: DistributionDescriptor;
    payoutAddress: string;
    nextOutputHash?: string;
    outputForm?: {
      assetForm?: OutputAssetForm;
      amountForm?: OutputAmountForm;
      nonceForm?: OutputNonceForm;
      rangeProofForm?: OutputRangeProofForm;
    };
    rawOutput?: Partial<OutputRawFields>;
    outputBindingMode?: BondOutputBindingMode;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  },
) {
  const verified = await verifyDistribution(sdk, input);
  if (!verified.ok) {
    throw new ValidationError(verified.reason ?? "Fund distribution verification failed", {
      code: "FUND_DISTRIBUTION_VERIFY_FAILED",
    });
  }
  const artifact = await requireFundArtifact(sdk, input);
  const payout = await buildFundPayoutDescriptor(sdk, {
    receiverAddress: input.payoutAddress,
    amountSat: verified.distributionValue.amountSat,
    assetId: verified.distributionValue.assetId,
    nextOutputHash: input.nextOutputHash,
    outputForm: input.outputForm,
    rawOutput: input.rawOutput,
    outputBindingMode: input.outputBindingMode,
  });
  const contract = sdk.fromArtifact(artifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: payout.descriptor.receiverAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(payout.descriptor.amountSat),
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    witness: buildDistributionWitness(payout.descriptor),
  });
  return {
    mode: "distribution-claim" as const,
    verified,
    payoutDescriptor: payout.descriptor,
    payoutSummary: payout.summary,
    inspect,
    report: {
      ...verified.report,
      outputBindingTrust: buildFundOutputBindingReport({
        descriptor: payout.descriptor,
        supportedForm: payout.supportedForm,
        reasonCode: payout.reasonCode,
        autoDerived: payout.autoDerivedNextOutputHash,
        fallbackReason: payout.fallbackReason,
        bindingInputs: payout.bindingInputs,
      }),
    } satisfies FundVerificationReport,
  };
}

export async function executeDistributionClaim(
  sdk: SimplicityClient,
  input: Parameters<typeof inspectDistributionClaim>[1] & { broadcast?: boolean },
) {
  const inspected = await inspectDistributionClaim(sdk, input);
  const artifact = await requireFundArtifact(sdk, input);
  const contract = sdk.fromArtifact(artifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: inspected.payoutDescriptor.receiverAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(inspected.payoutDescriptor.amountSat),
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
    witness: buildDistributionWitness(inspected.payoutDescriptor),
  });
  return {
    ...inspected,
    mode: "distribution-claim" as const,
    execution,
  };
}

export async function prepareClosing(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: FundDefinition;
    positionReceiptPath?: string;
    positionReceiptValue?: LPPositionReceiptEnvelope;
    closingPath?: string;
    closingValue?: FundClosingDescriptor;
    closingId?: string;
    finalDistributionHashes?: string[];
    closedAt?: string;
    closingReason?: FundClosingDescriptor["closingReason"];
  },
) {
  const definition = input.definitionPath || input.definitionValue
    ? await loadFundDefinitionDocument(sdk, input)
    : undefined;
  const receipt = await loadPositionReceiptEnvelopeDocument(sdk, input);
  const receiptChecks = definition ? ensureVerifiedEnvelope(definition.value, receipt.value) : verifyLPPositionReceiptEnvelope({ envelope: receipt.value });
  const closing = await loadClosingDocument(sdk, {
    closingPath: input.closingPath,
    closingValue: input.closingValue,
    positionReceipt: receipt.value.receipt,
    closingId: input.closingId,
    finalDistributionHashes: input.finalDistributionHashes,
    closedAt: input.closedAt,
    closingReason: input.closingReason,
  });
  const checks = validateClosingAgainstReceipt(receipt.value.receipt, closing.value);
  return {
    positionReceipt: receipt.descriptor,
    positionReceiptValue: receipt.value,
    positionReceiptSummary: receipt.receiptSummary,
    positionReceiptEnvelopeSummary: receipt.envelopeSummary,
    closing: closing.descriptor,
    closingValue: closing.value,
    closingSummary: closing.summary,
    closingHash: closing.summary.hash,
    checks,
    report: {
      ...buildBaseFundReport(),
      closingTrust: checks,
      receiptTrust: buildReceiptTrust({
        generated: false,
        envelope: receipt.value,
        checks: receiptChecks,
      }),
    } satisfies FundVerificationReport,
  };
}

export async function verifyClosing(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: FundDefinition;
    positionReceiptPath?: string;
    positionReceiptValue?: LPPositionReceiptEnvelope;
    closingPath?: string;
    closingValue?: FundClosingDescriptor;
  },
) {
  const definition = input.definitionPath || input.definitionValue
    ? await loadFundDefinitionDocument(sdk, input)
    : undefined;
  const receipt = await loadPositionReceiptEnvelopeDocument(sdk, input);
  const receiptChecks = definition ? ensureVerifiedEnvelope(definition.value, receipt.value) : verifyLPPositionReceiptEnvelope({ envelope: receipt.value });
  const closing = await loadClosingDocument(sdk, { closingPath: input.closingPath, closingValue: input.closingValue });
  const checks = validateClosingAgainstReceipt(receipt.value.receipt, closing.value);
  return {
    verified: true,
    positionReceipt: receipt.descriptor,
    positionReceiptValue: receipt.value,
    positionReceiptSummary: receipt.receiptSummary,
    positionReceiptEnvelopeSummary: receipt.envelopeSummary,
    closing: closing.descriptor,
    closingValue: closing.value,
    closingSummary: closing.summary,
    checks,
    report: {
      ...buildBaseFundReport(),
      closingTrust: checks,
      receiptTrust: buildReceiptTrust({ generated: false, envelope: receipt.value, checks: receiptChecks }),
    } satisfies FundVerificationReport,
  };
}

export async function exportEvidence(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: FundDefinition;
    capitalCallPath?: string;
    capitalCallValue?: CapitalCallState;
    positionReceiptPath?: string;
    positionReceiptValue?: LPPositionReceiptEnvelope;
    distributionPath?: string;
    distributionValue?: DistributionDescriptor;
    distributionPaths?: string[];
    distributionValues?: DistributionDescriptor[];
    closingPath?: string;
    closingValue?: FundClosingDescriptor;
    verificationReportValue?: FundVerificationReport;
  },
): Promise<FundEvidenceBundle> {
  const definition = await loadFundDefinitionDocument(sdk, input);
  const capitalCall = input.capitalCallPath || input.capitalCallValue ? await loadCapitalCallDocument(sdk, input) : undefined;
  const receipt = input.positionReceiptPath || input.positionReceiptValue
    ? await loadPositionReceiptEnvelopeDocument(sdk, input)
    : undefined;
  const distributions = input.distributionPath || input.distributionValue || input.distributionPaths || input.distributionValues
    ? await loadDistributionDocuments(sdk, {
        distributionPath: input.distributionPath,
        distributionValue: input.distributionValue,
        distributionPaths: input.distributionPaths,
        distributionValues: input.distributionValues,
      })
    : [];
  const distribution = distributions.at(-1);
  const closing = input.closingPath || input.closingValue
    ? await loadClosingDocument(sdk, { closingPath: input.closingPath, closingValue: input.closingValue })
    : undefined;
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  const trust = input.verificationReportValue
    ?? (distribution && receipt && artifact
      ? (await verifyDistribution(sdk, {
          artifact,
          definitionValue: definition.value,
          positionReceiptValue: receipt.value,
          distributionValue: distribution.value,
        })).report
      : capitalCall && artifact
        ? (await verifyCapitalCall(sdk, {
            artifact,
            definitionValue: definition.value,
            capitalCallValue: capitalCall.value,
          })).report
        : closing && receipt
          ? (await verifyClosing(sdk, {
              definitionValue: definition.value,
              positionReceiptValue: receipt.value,
              closingValue: closing.value,
            })).report
          : receipt
            ? (await verifyPositionReceipt(sdk, {
                definitionValue: definition.value,
                positionReceiptValue: receipt.value,
              })).report
            : buildBaseFundReport());
  const renderedSourceHash = artifact?.source.simfPath && existsSync(artifact.source.simfPath)
    ? sha256HexUtf8(await readFile(artifact.source.simfPath, "utf8"))
    : undefined;
  return {
    schemaVersion: FUND_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    ...(artifact ? { artifact } : {}),
    definition: definition.summary,
    ...(capitalCall ? { capitalCall: capitalCall.summary } : {}),
    ...(receipt
      ? {
          positionReceipt: receipt.receiptSummary,
          positionReceiptEnvelope: receipt.envelopeSummary,
        }
      : {}),
    ...(distribution ? { distribution: distribution.summary } : {}),
    ...(distributions.length > 1 ? { distributions: distributions.map((entry) => entry.summary) } : {}),
    ...(closing ? { closing: closing.summary } : {}),
    trust,
    renderedSourceHash,
    sourceVerificationMode: renderedSourceHash ? "source-reloaded" : "artifact-only",
    ...(artifact
      ? {
          compiled: {
            program: artifact.compiled.program,
            cmr: artifact.compiled.cmr,
            contractAddress: artifact.compiled.contractAddress,
          },
        }
      : {}),
  };
}

export async function exportFinalityPayload(
  sdk: SimplicityClient,
  input: Parameters<typeof exportEvidence>[1],
): Promise<FundFinalityPayload> {
  const evidence = await exportEvidence(sdk, input);
  const definition = await loadFundDefinitionDocument(sdk, input);
  const capitalCall = input.capitalCallPath || input.capitalCallValue ? await loadCapitalCallDocument(sdk, input) : undefined;
  const receipt = input.positionReceiptPath || input.positionReceiptValue
    ? await loadPositionReceiptEnvelopeDocument(sdk, input)
    : undefined;
  const distributions = input.distributionPath || input.distributionValue || input.distributionPaths || input.distributionValues
    ? await loadDistributionDocuments(sdk, {
        distributionPath: input.distributionPath,
        distributionValue: input.distributionValue,
        distributionPaths: input.distributionPaths,
        distributionValues: input.distributionValues,
      })
    : [];
  const distribution = distributions.at(-1);
  const closing = input.closingPath || input.closingValue
    ? await loadClosingDocument(sdk, { closingPath: input.closingPath, closingValue: input.closingValue })
    : undefined;
  const lpId = closing?.value.lpId ?? distribution?.value.lpId ?? receipt?.value.receipt.lpId ?? capitalCall?.value.lpId;
  if (!lpId) {
    throw new ValidationError("Finality payload requires at least one LP-linked document", {
      code: "FUND_FINALITY_LP_ID_REQUIRED",
    });
  }
  return {
    schemaVersion: FUND_FINALITY_PAYLOAD_SCHEMA_VERSION,
    fundId: definition.value.fundId,
    lpId,
    ...(capitalCall?.value.callId ? { callId: capitalCall.value.callId } : {}),
    ...(receipt?.value.receipt.positionId ?? distribution?.value.positionId ?? closing?.value.positionId
      ? { positionId: receipt?.value.receipt.positionId ?? distribution?.value.positionId ?? closing?.value.positionId }
      : {}),
    definitionHash: definition.summary.hash,
    capitalCallStateHash: capitalCall?.summary.hash ?? null,
    positionReceiptHash: receipt?.receiptSummary.hash ?? null,
    positionReceiptEnvelopeHash: receipt?.envelopeSummary.hash ?? null,
    distributionHash: distribution?.summary.hash ?? null,
    distributionHashes: distributions.length > 0 ? distributions.map((entry) => entry.summary.hash) : null,
    closingHash: closing?.summary.hash ?? null,
    bindingMode: evidence.trust.outputBindingTrust?.mode ?? "none",
    trust: evidence.trust,
    trustSummary: {
      definition: evidence.trust.artifactTrust?.definition,
      state: evidence.trust.stateTrust,
      bindingMode: evidence.trust.outputBindingTrust?.mode ?? "none",
    },
  };
}
