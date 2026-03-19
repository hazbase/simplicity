import { existsSync } from "node:fs";
import path from "node:path";
import type { SimplicityClient } from "../client/SimplicityClient";
import type {
  BondOutputBindingMode,
  OutputAmountForm,
  OutputAssetForm,
  OutputBindingInputs,
  OutputBindingReasonCode,
  OutputBindingSupportedForm,
  OutputNonceForm,
  OutputRawFields,
  OutputRangeProofForm,
  ReceivableClosingDescriptor,
  ReceivableDefinition,
  ReceivableEvidenceBundle,
  ReceivableEvidenceBundleSchemaVersion,
  ReceivableFinalityPayload,
  ReceivableFinalityPayloadSchemaVersion,
  ReceivableFundingClaimDescriptor,
  ReceivableRepaymentClaimDescriptor,
  ReceivableState,
  ReceivableVerificationReport,
  ReceivableVerificationReportSchemaVersion,
  SimplicityArtifact,
} from "../core/types";
import { ValidationError } from "../core/errors";
import { buildLineageTrustBase, buildVerificationTrustSummary } from "../core/reporting";
import {
  computeExplicitV1OutputHash,
  computeRawOutputV1Hash,
  getScriptPubKeyHexViaRpc,
  hashHexBytes,
  isExplicitV1OutputForm,
  normalizeOutputForm,
  normalizeOutputRawFields,
  analyzeOutputRawFields,
  resolveExplicitAssetHex,
  resolveOutputBindingDecision,
} from "../core/outputBinding";
import {
  applyReceivableRepayment,
  buildDefaultedReceivableState,
  buildFundedReceivableState,
  buildReceivableClosingDescriptor,
  buildReceivableFundingClaimDescriptor,
  buildReceivableRepaymentClaimDescriptor,
  summarizeReceivableDefinition,
  summarizeReceivableClosingDescriptor,
  summarizeReceivableFundingClaimDescriptor,
  summarizeReceivableRepaymentClaimDescriptor,
  summarizeReceivableState,
  validateReceivableClosingAgainstState,
  validateReceivableClosingDescriptor,
  validateReceivableCrossChecks,
  validateReceivableDefinition,
  validateReceivableFundingClaimAgainstState,
  validateReceivableFundingClaimDescriptor,
  validateReceivableRepaymentClaimAgainstState,
  validateReceivableRepaymentClaimDescriptor,
  validateReceivableState,
  validateReceivableFundingTransition,
  validateReceivableRepaymentTransition,
  validateReceivableWriteOffTransition,
  verifyReceivableStateHistory,
} from "./receivableValidation";

const RECEIVABLE_VERIFICATION_REPORT_SCHEMA_VERSION: ReceivableVerificationReportSchemaVersion =
  "receivable-verification-report/v1";
const RECEIVABLE_EVIDENCE_BUNDLE_SCHEMA_VERSION: ReceivableEvidenceBundleSchemaVersion =
  "receivable-evidence-bundle/v1";
const RECEIVABLE_FINALITY_PAYLOAD_SCHEMA_VERSION: ReceivableFinalityPayloadSchemaVersion =
  "receivable-finality-payload/v1";

function resolveReceivableDocsAsset(filename: string): string {
  const cwdCandidate = path.resolve(process.cwd(), "docs/definitions", filename);
  if (existsSync(cwdCandidate)) return cwdCandidate;
  const bundledCandidate = path.resolve(__dirname, "../docs/definitions", filename);
  if (existsSync(bundledCandidate)) return bundledCandidate;
  return cwdCandidate;
}

function satToBtcAmount(sat: number): number {
  return Number((sat / 1e8).toFixed(8));
}

function nowIso() {
  return new Date().toISOString();
}

function resolveValueOrPath<T>(options: { pathValue?: string; objectValue?: T }): { jsonPath?: string; value?: T } {
  if (options.pathValue) return { jsonPath: options.pathValue };
  if (options.objectValue !== undefined) return { value: options.objectValue };
  return {};
}

async function loadReceivableDefinitionDocument(
  sdk: SimplicityClient,
  input: { definitionPath?: string; definitionValue?: ReceivableDefinition },
) {
  const source = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  if (!source.jsonPath && source.value === undefined) {
    throw new ValidationError("definitionPath or definitionValue is required", {
      code: "RECEIVABLE_DEFINITION_REQUIRED",
    });
  }
  const descriptor = await sdk.loadDefinition({
    type: "receivable-definition",
    id: "RECEIVABLE-DEFINITION",
    ...source,
  });
  const value = validateReceivableDefinition(JSON.parse(descriptor.canonicalJson));
  return { descriptor, value, summary: summarizeReceivableDefinition(value) };
}

async function loadReceivableStateDocument(
  sdk: SimplicityClient,
  input: { statePath?: string; stateValue?: ReceivableState },
) {
  const source = resolveValueOrPath({
    pathValue: input.statePath,
    objectValue: input.stateValue,
  });
  if (!source.jsonPath && source.value === undefined) {
    throw new ValidationError("statePath or stateValue is required", {
      code: "RECEIVABLE_STATE_REQUIRED",
    });
  }
  const descriptor = await sdk.loadStateDocument({
    type: "receivable-state",
    id: "RECEIVABLE-STATE",
    ...source,
  });
  const value = validateReceivableState(JSON.parse(descriptor.canonicalJson));
  return { descriptor, value, summary: summarizeReceivableState(value) };
}

async function loadReceivableStateHistoryDocuments(
  sdk: SimplicityClient,
  input: { stateHistoryPaths?: string[]; stateHistoryValues?: ReceivableState[] },
) {
  const results: Array<{
    descriptor: Awaited<ReturnType<SimplicityClient["loadStateDocument"]>>;
    value: ReceivableState;
    summary: ReturnType<typeof summarizeReceivableState>;
  }> = [];

  for (const statePath of input.stateHistoryPaths ?? []) {
    const descriptor = await sdk.loadStateDocument({
      type: "receivable-state",
      id: "RECEIVABLE-STATE-HISTORY",
      jsonPath: statePath,
    });
    const value = validateReceivableState(JSON.parse(descriptor.canonicalJson));
    results.push({ descriptor, value, summary: summarizeReceivableState(value) });
  }

  for (const stateValue of input.stateHistoryValues ?? []) {
    const value = validateReceivableState(stateValue);
    const descriptor = await sdk.loadStateDocument({
      type: "receivable-state",
      id: value.stateId,
      value,
    });
    results.push({ descriptor, value, summary: summarizeReceivableState(value) });
  }

  return results;
}

async function loadReceivableClosingDocument(
  sdk: SimplicityClient,
  input: {
    closingPath?: string;
    closingValue?: ReceivableClosingDescriptor;
    closingId?: string;
    latestStateValue?: ReceivableState;
    closedAt?: string;
    closingReason?: ReceivableClosingDescriptor["closingReason"];
  },
) {
  const source = resolveValueOrPath({
    pathValue: input.closingPath,
    objectValue: input.closingValue,
  });
  if (source.jsonPath || source.value !== undefined) {
    const descriptor = await sdk.loadStateDocument({
      type: "receivable-closing",
      id: input.closingValue?.closingId ?? input.closingId ?? "REC-CLOSE-001",
      ...source,
    });
    const value = validateReceivableClosingDescriptor(JSON.parse(descriptor.canonicalJson));
    return { descriptor, value, summary: summarizeReceivableClosingDescriptor(value) };
  }
  if (!input.latestStateValue || !input.closingId || !input.closedAt) {
    throw new ValidationError(
      "closingPath/closingValue or latestState + closingId + closedAt is required",
      { code: "RECEIVABLE_CLOSING_REQUIRED" },
    );
  }
  const value = buildReceivableClosingDescriptor({
    closingId: input.closingId,
    latestState: input.latestStateValue,
    closedAt: input.closedAt,
    ...(input.closingReason ? { closingReason: input.closingReason } : {}),
  });
  const descriptor = await sdk.loadStateDocument({
    type: "receivable-closing",
    id: value.closingId,
    value,
  });
  return { descriptor, value, summary: summarizeReceivableClosingDescriptor(value) };
}

function assertLatestStateMatchesHistoryTip(input: {
  latestState?: { summary: { hash: string }; value: ReceivableState };
  history: Array<{ summary: { hash: string }; value: ReceivableState }>;
}) {
  if (!input.latestState || input.history.length === 0) return;
  const historyTip = input.history.at(-1);
  if (!historyTip) return;
  if (historyTip.summary.hash !== input.latestState.summary.hash) {
    throw new ValidationError("latest receivable state must match the tip of the provided state history", {
      code: "RECEIVABLE_HISTORY_TIP_MISMATCH",
    });
  }
}

type ReceivablePayoutDescriptor = {
  receiverAddress: string;
  nextOutputHash?: string;
  nextOutputScriptHash?: string;
  amountSat: number;
  assetId: string;
  requestedOutputBindingMode?: BondOutputBindingMode;
  outputForm?: {
    assetForm?: OutputAssetForm;
    amountForm?: OutputAmountForm;
    nonceForm?: OutputNonceForm;
    rangeProofForm?: OutputRangeProofForm;
  };
  rawOutput?: Partial<OutputRawFields>;
  feeIndex: number;
  nextOutputIndex: number;
  maxFeeSat: number;
  outputBindingMode: BondOutputBindingMode;
};

function validateReceivablePayoutDescriptor(descriptor: ReceivablePayoutDescriptor): ReceivablePayoutDescriptor {
  if (!descriptor.receiverAddress || descriptor.receiverAddress.trim().length === 0) {
    throw new ValidationError("receiverAddress must be a non-empty string", {
      code: "RECEIVABLE_PAYOUT_RECEIVER_REQUIRED",
    });
  }
  if (!Number.isInteger(descriptor.amountSat) || descriptor.amountSat <= 0) {
    throw new ValidationError("amountSat must be a positive integer", {
      code: "RECEIVABLE_PAYOUT_AMOUNT_INVALID",
    });
  }
  if (!descriptor.assetId || descriptor.assetId.trim().length === 0) {
    throw new ValidationError("assetId must be a non-empty string", {
      code: "RECEIVABLE_PAYOUT_ASSET_REQUIRED",
    });
  }
  if (!Number.isInteger(descriptor.feeIndex) || descriptor.feeIndex < 0) {
    throw new ValidationError("feeIndex must be a non-negative integer", {
      code: "RECEIVABLE_PAYOUT_FEE_INDEX_INVALID",
    });
  }
  if (!Number.isInteger(descriptor.nextOutputIndex) || descriptor.nextOutputIndex < 0) {
    throw new ValidationError("nextOutputIndex must be a non-negative integer", {
      code: "RECEIVABLE_PAYOUT_NEXT_OUTPUT_INDEX_INVALID",
    });
  }
  if (!Number.isInteger(descriptor.maxFeeSat) || descriptor.maxFeeSat < 0) {
    throw new ValidationError("maxFeeSat must be a non-negative integer", {
      code: "RECEIVABLE_PAYOUT_MAX_FEE_INVALID",
    });
  }
  if (!(["none", "script-bound", "descriptor-bound"] as string[]).includes(descriptor.outputBindingMode)) {
    throw new ValidationError("outputBindingMode must be none, script-bound, or descriptor-bound", {
      code: "RECEIVABLE_PAYOUT_BINDING_MODE_INVALID",
    });
  }
  if (
    descriptor.requestedOutputBindingMode
    && !(["none", "script-bound", "descriptor-bound"] as string[]).includes(descriptor.requestedOutputBindingMode)
  ) {
    throw new ValidationError("requestedOutputBindingMode must be none, script-bound, or descriptor-bound", {
      code: "RECEIVABLE_PAYOUT_REQUESTED_BINDING_MODE_INVALID",
    });
  }
  if (descriptor.nextOutputHash && !/^[0-9a-f]{64}$/i.test(descriptor.nextOutputHash)) {
    throw new ValidationError("nextOutputHash must be a 64-character hex string", {
      code: "RECEIVABLE_PAYOUT_OUTPUT_HASH_INVALID",
    });
  }
  if (descriptor.nextOutputScriptHash && !/^[0-9a-f]{64}$/i.test(descriptor.nextOutputScriptHash)) {
    throw new ValidationError("nextOutputScriptHash must be a 64-character hex string", {
      code: "RECEIVABLE_PAYOUT_OUTPUT_SCRIPT_HASH_INVALID",
    });
  }
  descriptor.rawOutput = normalizeOutputRawFields(descriptor.rawOutput);
  descriptor.outputForm = normalizeOutputForm(descriptor.outputForm);
  descriptor.requestedOutputBindingMode = descriptor.requestedOutputBindingMode ?? descriptor.outputBindingMode;
  return descriptor;
}

function buildBindingModeWitnessValue(mode: BondOutputBindingMode): string {
  return mode === "descriptor-bound" ? "0x01" : mode === "script-bound" ? "0x02" : "0x03";
}

function buildReceivableClaimWitness(descriptor: ReceivablePayoutDescriptor) {
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

async function buildReceivablePayoutDescriptor(
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
  const descriptor = validateReceivablePayoutDescriptor({
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
    supportedForm: bindingResolution.supportedForm,
    autoDerivedNextOutputHash: bindingResolution.autoDerived,
    reasonCode: bindingResolution.reasonCode,
    fallbackReason: bindingResolution.fallbackReason,
    bindingInputs,
  };
}

function buildReceivableStateLineageTrust(
  checks: ReturnType<typeof verifyReceivableStateHistory>,
): ReceivableVerificationReport["stateLineageTrust"] {
  const identityConsistent =
    checks.receivableIdConsistent
    && checks.originatorConsistent
    && checks.debtorConsistent
    && checks.currencyConsistent
    && checks.controllerConsistent
    && checks.faceValueConsistent;
  return {
    ...buildLineageTrustBase({
      lineageKind: "state-history",
      chainLength: checks.chainLength,
      latestOrdinal: Math.max(0, checks.chainLength - 1),
      allHashLinksVerified: checks.allPreviousStateHashMatch,
      identityConsistent,
      fullLineageVerified: checks.fullHistoryVerified,
    }),
    latestStatus: checks.latestStatus,
    startsAtGenesis: checks.startsAtGenesis,
    receivableIdConsistent: checks.receivableIdConsistent,
    originatorConsistent: checks.originatorConsistent,
    debtorConsistent: checks.debtorConsistent,
    currencyConsistent: checks.currencyConsistent,
    controllerConsistent: checks.controllerConsistent,
    faceValueConsistent: checks.faceValueConsistent,
    allPreviousStateHashMatch: checks.allPreviousStateHashMatch,
    allArithmeticValid: checks.allArithmeticValid,
    allStatusProgressionValid: checks.allStatusProgressionValid,
    fullHistoryVerified: checks.fullHistoryVerified,
  };
}

async function requireReceivableArtifact(
  sdk: SimplicityClient,
  input: { artifactPath?: string; artifact?: SimplicityArtifact },
): Promise<SimplicityArtifact> {
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  if (!artifact) {
    throw new ValidationError("artifactPath or artifact is required", {
      code: "RECEIVABLE_ARTIFACT_REQUIRED",
    });
  }
  return artifact;
}

function buildReceivableClaimTrust(input: {
  generated: boolean;
  claimantXonlyCommitted: boolean;
  checks: ReturnType<typeof validateReceivableFundingClaimAgainstState> | ReturnType<typeof validateReceivableRepaymentClaimAgainstState>;
  payout?: {
    descriptor: ReceivablePayoutDescriptor;
    supportedForm: OutputBindingSupportedForm;
    reasonCode: OutputBindingReasonCode;
    autoDerivedNextOutputHash?: boolean;
    fallbackReason?: string;
    bindingInputs: OutputBindingInputs;
  };
}): NonNullable<ReceivableVerificationReport["fundingClaimTrust"]> {
  const bindingMode = input.payout?.descriptor.outputBindingMode ?? "none";
  return {
    ...input.checks,
    generated: input.generated,
    claimantXonlyCommitted: input.claimantXonlyCommitted,
    bindingMode,
    requestedMode: input.payout?.descriptor.requestedOutputBindingMode,
    supportedForm: input.payout?.supportedForm ?? "unsupported",
    reasonCode:
      input.payout?.reasonCode
      ?? (bindingMode === "descriptor-bound"
        ? "OK_MANUAL_HASH"
        : bindingMode === "script-bound"
          ? "OK_SCRIPT_BOUND"
          : "OK_NONE"),
    nextReceiverRuntimeCommitted: bindingMode !== "none",
    nextOutputHashRuntimeBound: bindingMode === "descriptor-bound",
    nextOutputScriptRuntimeBound: bindingMode !== "none",
    amountRuntimeBound: bindingMode === "descriptor-bound",
    autoDerived: input.payout?.autoDerivedNextOutputHash,
    fallbackReason: input.payout?.fallbackReason,
    bindingInputs: input.payout?.bindingInputs,
    fullClaimVerified: input.checks.fullClaimVerified && input.claimantXonlyCommitted,
  };
}

function buildReceivableReport(input: {
  crossChecks: ReturnType<typeof validateReceivableCrossChecks>;
  lineageChecks?: ReturnType<typeof verifyReceivableStateHistory>;
  transitionTrust?: ReceivableVerificationReport["transitionTrust"];
  closingTrust?: ReceivableVerificationReport["closingTrust"];
  fundingClaimTrust?: ReceivableVerificationReport["fundingClaimTrust"];
  repaymentClaimTrust?: ReceivableVerificationReport["repaymentClaimTrust"];
}): ReceivableVerificationReport {
  return {
    schemaVersion: RECEIVABLE_VERIFICATION_REPORT_SCHEMA_VERSION,
    receivableTrust: {
      ...input.crossChecks,
      statusValid: true,
    },
    ...(input.transitionTrust ? { transitionTrust: input.transitionTrust } : {}),
    ...(input.closingTrust ? { closingTrust: input.closingTrust } : {}),
    ...(input.fundingClaimTrust ? { fundingClaimTrust: input.fundingClaimTrust } : {}),
    ...(input.repaymentClaimTrust ? { repaymentClaimTrust: input.repaymentClaimTrust } : {}),
    ...(input.lineageChecks ? { stateLineageTrust: buildReceivableStateLineageTrust(input.lineageChecks) } : {}),
  };
}

export async function define(
  sdk: SimplicityClient,
  input: { definitionPath?: string; definitionValue?: ReceivableDefinition },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
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
    definitionValue?: ReceivableDefinition;
    statePath?: string;
    stateValue?: ReceivableState;
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const state = await loadReceivableStateDocument(sdk, input);
  const crossChecks = validateReceivableCrossChecks(definition.value, state.value);
  const report = buildReceivableReport({ crossChecks });
  return {
    verified: Object.values(crossChecks).every(Boolean),
    definition: definition.descriptor,
    definitionValue: definition.value,
    definitionSummary: definition.summary,
    state: state.descriptor,
    stateValue: state.value,
    stateSummary: state.summary,
    crossChecks,
    report,
    trustSummary: buildVerificationTrustSummary({
      bindingMode: "none",
    }),
  };
}

export async function load(
  sdk: SimplicityClient,
  input: Parameters<typeof verify>[1],
) {
  const verification = await verify(sdk, input);
  return {
    definition: verification.definition,
    definitionValue: verification.definitionValue,
    definitionSummary: verification.definitionSummary,
    state: verification.state,
    stateValue: verification.stateValue,
    stateSummary: verification.stateSummary,
    crossChecks: verification.crossChecks,
    report: verification.report,
    trustSummary: verification.trustSummary,
  };
}

export async function verifyStateHistory(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    stateHistoryPaths?: string[];
    stateHistoryValues?: ReceivableState[];
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const stateHistory = await loadReceivableStateHistoryDocuments(sdk, input);
  const latest = stateHistory.at(-1);
  if (!latest) {
    throw new ValidationError("stateHistoryPaths or stateHistoryValues must contain at least one state", {
      code: "RECEIVABLE_STATE_HISTORY_REQUIRED",
    });
  }
  const crossChecks = validateReceivableCrossChecks(definition.value, latest.value);
  const checks = verifyReceivableStateHistory({
    history: stateHistory.map((entry) => entry.value),
  });
  const lineageTrust = buildReceivableStateLineageTrust(checks);
  const report = buildReceivableReport({
    crossChecks,
    lineageChecks: checks,
  });
  return {
    verified: checks.fullHistoryVerified && Object.values(crossChecks).every(Boolean),
    definition: definition.descriptor,
    definitionValue: definition.value,
    definitionSummary: definition.summary,
    latestState: latest.descriptor,
    latestStateValue: latest.value,
    latestStateSummary: latest.summary,
    stateHistory: stateHistory.map((entry) => entry.descriptor),
    stateHistoryValues: stateHistory.map((entry) => entry.value),
    stateHistorySummaries: stateHistory.map((entry) => entry.summary),
    checks,
    report,
    trustSummary: buildVerificationTrustSummary({
      bindingMode: "none",
      lineageTrust,
    }),
  };
}

async function loadPreviousAndNextReceivableStates(
  sdk: SimplicityClient,
  input: {
    previousStatePath?: string;
    previousStateValue?: ReceivableState;
    nextStatePath?: string;
    nextStateValue?: ReceivableState;
  },
) {
  const previous = await loadReceivableStateDocument(sdk, {
    statePath: input.previousStatePath,
    stateValue: input.previousStateValue,
  });
  const next = await loadReceivableStateDocument(sdk, {
    statePath: input.nextStatePath,
    stateValue: input.nextStateValue,
  });
  return { previous, next };
}

function buildTransitionVerificationResult(input: {
  definition: Awaited<ReturnType<typeof loadReceivableDefinitionDocument>>;
  previous: Awaited<ReturnType<typeof loadReceivableStateDocument>>;
  next: Awaited<ReturnType<typeof loadReceivableStateDocument>>;
  transitionTrust: NonNullable<ReceivableVerificationReport["transitionTrust"]>;
}) {
  const crossChecks = validateReceivableCrossChecks(input.definition.value, input.next.value);
  const report = buildReceivableReport({
    crossChecks,
    transitionTrust: input.transitionTrust,
  });
  return {
    verified: input.transitionTrust.fullTransitionVerified && Object.values(crossChecks).every(Boolean),
    definition: input.definition.descriptor,
    definitionValue: input.definition.value,
    definitionSummary: input.definition.summary,
    previousState: input.previous.descriptor,
    previousStateValue: input.previous.value,
    previousStateSummary: input.previous.summary,
    nextState: input.next.descriptor,
    nextStateValue: input.next.value,
    nextStateSummary: input.next.summary,
    report,
    trustSummary: buildVerificationTrustSummary({
      bindingMode: "none",
    }),
  };
}

export async function prepareFunding(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    previousStatePath?: string;
    previousStateValue?: ReceivableState;
    nextStatePath?: string;
    nextStateValue?: ReceivableState;
    stateId?: string;
    holderEntityId?: string;
    fundedAt?: string;
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const previous = await loadReceivableStateDocument(sdk, {
    statePath: input.previousStatePath,
    stateValue: input.previousStateValue,
  });
  const next = input.nextStatePath || input.nextStateValue
    ? await loadReceivableStateDocument(sdk, {
        statePath: input.nextStatePath,
        stateValue: input.nextStateValue,
      })
    : await loadReceivableStateDocument(sdk, {
        stateValue: buildFundedReceivableState({
          previous: previous.value,
          stateId: input.stateId ?? `${previous.value.receivableId}-FUNDED`,
          holderEntityId: input.holderEntityId ?? previous.value.holderEntityId,
          fundedAt: input.fundedAt ?? new Date().toISOString(),
        }),
      });
  const transitionTrust = validateReceivableFundingTransition(previous.value, next.value);
  return buildTransitionVerificationResult({
    definition,
    previous,
    next,
    transitionTrust,
  });
}

async function loadReceivableFundingClaimDocument(
  sdk: SimplicityClient,
  input: {
    fundingClaimPath?: string;
    fundingClaimValue?: ReceivableFundingClaimDescriptor;
    currentStateValue?: ReceivableState;
    claimId?: string;
    payerEntityId?: string;
    payeeEntityId?: string;
    claimantXonly?: string;
    amountSat?: number;
    eventTimestamp?: string;
  },
) {
  const source = resolveValueOrPath({
    pathValue: input.fundingClaimPath,
    objectValue: input.fundingClaimValue,
  });
  if (source.jsonPath || source.value !== undefined) {
    const descriptor = await sdk.loadStateDocument({
      type: "receivable-funding-claim",
      id: input.fundingClaimValue?.claimId ?? input.claimId ?? "REC-FUNDING-CLAIM-001",
      ...source,
    });
    const value = validateReceivableFundingClaimDescriptor(JSON.parse(descriptor.canonicalJson));
    return { descriptor, value, summary: summarizeReceivableFundingClaimDescriptor(value) };
  }
  if (!input.currentStateValue || !input.claimId) {
    throw new ValidationError(
      "fundingClaimPath/fundingClaimValue or currentStateValue + claimId is required",
      { code: "RECEIVABLE_FUNDING_CLAIM_REQUIRED" },
    );
  }
  const value = buildReceivableFundingClaimDescriptor({
    claimId: input.claimId,
    currentState: input.currentStateValue,
    payerEntityId: input.payerEntityId,
    payeeEntityId: input.payeeEntityId,
    claimantXonly: input.claimantXonly,
    amountSat: input.amountSat,
    eventTimestamp: input.eventTimestamp,
  });
  const descriptor = await sdk.loadStateDocument({
    type: "receivable-funding-claim",
    id: value.claimId,
    value,
  });
  return { descriptor, value, summary: summarizeReceivableFundingClaimDescriptor(value) };
}

async function loadReceivableRepaymentClaimDocument(
  sdk: SimplicityClient,
  input: {
    repaymentClaimPath?: string;
    repaymentClaimValue?: ReceivableRepaymentClaimDescriptor;
    currentStateValue?: ReceivableState;
    claimId?: string;
    payerEntityId?: string;
    payeeEntityId?: string;
    claimantXonly?: string;
    amountSat?: number;
    eventTimestamp?: string;
  },
) {
  const source = resolveValueOrPath({
    pathValue: input.repaymentClaimPath,
    objectValue: input.repaymentClaimValue,
  });
  if (source.jsonPath || source.value !== undefined) {
    const descriptor = await sdk.loadStateDocument({
      type: "receivable-repayment-claim",
      id: input.repaymentClaimValue?.claimId ?? input.claimId ?? "REC-REPAYMENT-CLAIM-001",
      ...source,
    });
    const value = validateReceivableRepaymentClaimDescriptor(JSON.parse(descriptor.canonicalJson));
    return { descriptor, value, summary: summarizeReceivableRepaymentClaimDescriptor(value) };
  }
  if (!input.currentStateValue || !input.claimId) {
    throw new ValidationError(
      "repaymentClaimPath/repaymentClaimValue or currentStateValue + claimId is required",
      { code: "RECEIVABLE_REPAYMENT_CLAIM_REQUIRED" },
    );
  }
  const value = buildReceivableRepaymentClaimDescriptor({
    claimId: input.claimId,
    currentState: input.currentStateValue,
    payerEntityId: input.payerEntityId,
    payeeEntityId: input.payeeEntityId,
    claimantXonly: input.claimantXonly,
    amountSat: input.amountSat,
    eventTimestamp: input.eventTimestamp,
  });
  const descriptor = await sdk.loadStateDocument({
    type: "receivable-repayment-claim",
    id: value.claimId,
    value,
  });
  return { descriptor, value, summary: summarizeReceivableRepaymentClaimDescriptor(value) };
}

async function compileFundingClaimContract(
  sdk: SimplicityClient,
  input: {
    definition: ReceivableDefinition;
    claim: ReceivableFundingClaimDescriptor;
    simfPath?: string;
    artifactPath?: string;
  },
) {
  return sdk.compileFromFile({
    simfPath: input.simfPath ?? resolveReceivableDocsAsset("receivable-funding-claim.simf"),
    templateVars: {
      CLAIMANT_XONLY: input.claim.claimantXonly,
    },
    definition: {
      type: "receivable-definition",
      id: input.definition.receivableId,
      value: input.definition,
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: "receivable-funding-claim",
      id: input.claim.claimId,
      value: input.claim,
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });
}

async function compileRepaymentClaimContract(
  sdk: SimplicityClient,
  input: {
    definition: ReceivableDefinition;
    claim: ReceivableRepaymentClaimDescriptor;
    simfPath?: string;
    artifactPath?: string;
  },
) {
  return sdk.compileFromFile({
    simfPath: input.simfPath ?? resolveReceivableDocsAsset("receivable-repayment-claim.simf"),
    templateVars: {
      CLAIMANT_XONLY: input.claim.claimantXonly,
    },
    definition: {
      type: "receivable-definition",
      id: input.definition.receivableId,
      value: input.definition,
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: "receivable-repayment-claim",
      id: input.claim.claimId,
      value: input.claim,
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });
}

export async function verifyFunding(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    previousStatePath?: string;
    previousStateValue?: ReceivableState;
    nextStatePath?: string;
    nextStateValue?: ReceivableState;
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const { previous, next } = await loadPreviousAndNextReceivableStates(sdk, input);
  const transitionTrust = validateReceivableFundingTransition(previous.value, next.value);
  return buildTransitionVerificationResult({
    definition,
    previous,
    next,
    transitionTrust,
  });
}

export async function prepareRepayment(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    previousStatePath?: string;
    previousStateValue?: ReceivableState;
    nextStatePath?: string;
    nextStateValue?: ReceivableState;
    stateId?: string;
    amount?: number;
    repaidAt?: string;
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const previous = await loadReceivableStateDocument(sdk, {
    statePath: input.previousStatePath,
    stateValue: input.previousStateValue,
  });
  const next = input.nextStatePath || input.nextStateValue
    ? await loadReceivableStateDocument(sdk, {
        statePath: input.nextStatePath,
        stateValue: input.nextStateValue,
      })
    : await loadReceivableStateDocument(sdk, {
        stateValue: applyReceivableRepayment({
          previous: previous.value,
          stateId: input.stateId ?? `${previous.value.receivableId}-REPAY-${previous.value.repaidAmount + (input.amount ?? 0)}`,
          amount: input.amount ?? previous.value.outstandingAmount,
          repaidAt: input.repaidAt ?? new Date().toISOString(),
        }),
      });
  const transitionTrust = validateReceivableRepaymentTransition(previous.value, next.value);
  return buildTransitionVerificationResult({
    definition,
    previous,
    next,
    transitionTrust,
  });
}

export async function verifyRepayment(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    previousStatePath?: string;
    previousStateValue?: ReceivableState;
    nextStatePath?: string;
    nextStateValue?: ReceivableState;
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const { previous, next } = await loadPreviousAndNextReceivableStates(sdk, input);
  const transitionTrust = validateReceivableRepaymentTransition(previous.value, next.value);
  return buildTransitionVerificationResult({
    definition,
    previous,
    next,
    transitionTrust,
  });
}

function buildClaimVerificationResult(input: {
  verified: boolean;
  definition: Awaited<ReturnType<typeof loadReceivableDefinitionDocument>>;
  currentState: Awaited<ReturnType<typeof loadReceivableStateDocument>>;
  stateHistory?: Awaited<ReturnType<typeof loadReceivableStateHistoryDocuments>>;
  claim:
    | Awaited<ReturnType<typeof loadReceivableFundingClaimDocument>>
    | Awaited<ReturnType<typeof loadReceivableRepaymentClaimDocument>>;
  artifact?: SimplicityArtifact;
  artifactVerification?: {
    definition?: Awaited<ReturnType<SimplicityClient["verifyDefinitionAgainstArtifact"]>>;
    state?: Awaited<ReturnType<SimplicityClient["verifyStateAgainstArtifact"]>>;
  };
  report: ReceivableVerificationReport;
}) {
  return {
    verified: input.verified,
    artifact: input.artifact,
    artifactVerification: input.artifactVerification,
    definition: input.definition.descriptor,
    definitionValue: input.definition.value,
    definitionSummary: input.definition.summary,
    currentState: input.currentState.descriptor,
    currentStateValue: input.currentState.value,
    currentStateSummary: input.currentState.summary,
    ...(input.stateHistory && input.stateHistory.length > 0
      ? {
          stateHistory: input.stateHistory.map((entry) => entry.descriptor),
          stateHistoryValues: input.stateHistory.map((entry) => entry.value),
          stateHistorySummaries: input.stateHistory.map((entry) => entry.summary),
        }
      : {}),
    claim: input.claim.descriptor,
    claimValue: input.claim.value,
    claimSummary: input.claim.summary,
    report: input.report,
    trustSummary: buildVerificationTrustSummary({
      bindingMode:
        input.report.fundingClaimTrust?.bindingMode
        ?? input.report.repaymentClaimTrust?.bindingMode
        ?? "none",
      ...(input.report.stateLineageTrust ? { lineageTrust: input.report.stateLineageTrust } : {}),
      ...(input.artifactVerification?.definition?.trust ? { definitionTrust: input.artifactVerification.definition.trust } : {}),
      ...(input.artifactVerification?.state?.trust ? { stateTrust: input.artifactVerification.state.trust } : {}),
    }),
  };
}

export async function prepareFundingClaim(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    currentStatePath?: string;
    currentStateValue?: ReceivableState;
    stateHistoryPaths?: string[];
    stateHistoryValues?: ReceivableState[];
    fundingClaimPath?: string;
    fundingClaimValue?: ReceivableFundingClaimDescriptor;
    claimId?: string;
    payerEntityId?: string;
    payeeEntityId?: string;
    claimantXonly?: string;
    amountSat?: number;
    eventTimestamp?: string;
    simfPath?: string;
    artifactPath?: string;
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const currentState = await loadReceivableStateDocument(sdk, {
    statePath: input.currentStatePath,
    stateValue: input.currentStateValue,
  });
  const history = input.stateHistoryPaths || input.stateHistoryValues
    ? await loadReceivableStateHistoryDocuments(sdk, input)
    : [];
  assertLatestStateMatchesHistoryTip({ latestState: currentState, history });
  const claim = await loadReceivableFundingClaimDocument(sdk, {
    fundingClaimPath: input.fundingClaimPath,
    fundingClaimValue: input.fundingClaimValue,
    currentStateValue: currentState.value,
    claimId: input.claimId ?? `${currentState.value.receivableId}-FUNDING-CLAIM`,
    payerEntityId: input.payerEntityId,
    payeeEntityId: input.payeeEntityId,
    claimantXonly: input.claimantXonly,
    amountSat: input.amountSat,
    eventTimestamp: input.eventTimestamp,
  });
  const crossChecks = validateReceivableCrossChecks(definition.value, currentState.value);
  const lineageChecks = history.length > 0
    ? verifyReceivableStateHistory({ history: history.map((entry) => entry.value) })
    : undefined;
  const claimChecks = validateReceivableFundingClaimAgainstState({
    currentState: currentState.value,
    claim: claim.value,
  });
  const report = buildReceivableReport({
    crossChecks,
    ...(lineageChecks ? { lineageChecks } : {}),
    fundingClaimTrust: buildReceivableClaimTrust({
      generated: !input.fundingClaimPath && !input.fundingClaimValue,
      claimantXonlyCommitted: true,
      checks: claimChecks,
    }),
  });
  const compiled = await compileFundingClaimContract(sdk, {
    definition: definition.value,
    claim: claim.value,
    simfPath: input.simfPath,
    artifactPath: input.artifactPath,
  });
  return {
    ...buildClaimVerificationResult({
      verified: report.fundingClaimTrust?.fullClaimVerified === true && Object.values(crossChecks).every(Boolean),
      definition,
      currentState,
      stateHistory: history,
      claim,
      report,
    }),
    compiled,
  };
}

export async function verifyFundingClaim(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    currentStatePath?: string;
    currentStateValue?: ReceivableState;
    stateHistoryPaths?: string[];
    stateHistoryValues?: ReceivableState[];
    fundingClaimPath?: string;
    fundingClaimValue?: ReceivableFundingClaimDescriptor;
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const currentState = await loadReceivableStateDocument(sdk, {
    statePath: input.currentStatePath,
    stateValue: input.currentStateValue,
  });
  const history = input.stateHistoryPaths || input.stateHistoryValues
    ? await loadReceivableStateHistoryDocuments(sdk, input)
    : [];
  assertLatestStateMatchesHistoryTip({ latestState: currentState, history });
  const claim = await loadReceivableFundingClaimDocument(sdk, {
    fundingClaimPath: input.fundingClaimPath,
    fundingClaimValue: input.fundingClaimValue,
  });
  const crossChecks = validateReceivableCrossChecks(definition.value, currentState.value);
  const lineageChecks = history.length > 0
    ? verifyReceivableStateHistory({ history: history.map((entry) => entry.value) })
    : undefined;
  const claimChecks = validateReceivableFundingClaimAgainstState({
    currentState: currentState.value,
    claim: claim.value,
  });
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  const definitionVerification = artifact
    ? await sdk.verifyDefinitionAgainstArtifact({
        artifact,
        type: "receivable-definition",
        id: definition.value.receivableId,
        value: definition.value,
      })
    : undefined;
  const stateVerification = artifact
    ? await sdk.verifyStateAgainstArtifact({
        artifact,
        type: "receivable-funding-claim",
        id: claim.value.claimId,
        value: claim.value,
      })
    : undefined;
  const claimantXonlyCommitted = artifact
    ? String(artifact.source.templateVars?.CLAIMANT_XONLY ?? "").toLowerCase() === claim.value.claimantXonly.toLowerCase()
    : true;
  const report = buildReceivableReport({
    crossChecks,
    ...(lineageChecks ? { lineageChecks } : {}),
    fundingClaimTrust: buildReceivableClaimTrust({
      generated: false,
      claimantXonlyCommitted,
      checks: claimChecks,
    }),
  });
  const verified = report.fundingClaimTrust?.fullClaimVerified === true
    && Object.values(crossChecks).every(Boolean)
    && (!definitionVerification || definitionVerification.ok)
    && (!stateVerification || stateVerification.ok);
  return buildClaimVerificationResult({
    verified,
    definition,
    currentState,
    stateHistory: history,
    claim,
    artifact,
    artifactVerification:
      artifact && (definitionVerification || stateVerification)
        ? {
            ...(definitionVerification ? { definition: definitionVerification } : {}),
            ...(stateVerification ? { state: stateVerification } : {}),
          }
        : undefined,
    report,
  });
}

export async function inspectFundingClaim(
  sdk: SimplicityClient,
  input: Parameters<typeof verifyFundingClaim>[1] & {
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
  const verified = await verifyFundingClaim(sdk, input);
  if (!verified.verified) {
    throw new ValidationError("Receivable funding claim verification failed", {
      code: "RECEIVABLE_FUNDING_CLAIM_VERIFY_FAILED",
    });
  }
  const artifact = await requireReceivableArtifact(sdk, input);
  const payout = await buildReceivablePayoutDescriptor(sdk, {
    receiverAddress: input.payoutAddress,
    amountSat: verified.claimValue.amountSat,
    assetId: verified.claimValue.currencyAssetId,
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
    witness: buildReceivableClaimWitness(payout.descriptor),
  });
  return {
    ...verified,
    payoutDescriptor: payout.descriptor,
    inspect,
    report: buildReceivableReport({
      crossChecks: verified.report.receivableTrust,
      ...(verified.report.stateLineageTrust
        ? {
            lineageChecks: verifyReceivableStateHistory({
              history: verified.stateHistoryValues ?? [verified.currentStateValue],
            }),
          }
        : {}),
      fundingClaimTrust: buildReceivableClaimTrust({
        generated: verified.report.fundingClaimTrust?.generated ?? false,
        claimantXonlyCommitted: verified.report.fundingClaimTrust?.claimantXonlyCommitted ?? true,
        checks: {
          claimKind: verified.report.fundingClaimTrust?.claimKind ?? "FUNDING",
          stateStatusEligible: verified.report.fundingClaimTrust?.stateStatusEligible ?? false,
          receivableIdMatch: verified.report.fundingClaimTrust?.receivableIdMatch ?? false,
          currentStateHashMatch: verified.report.fundingClaimTrust?.currentStateHashMatch ?? false,
          currentStatusMatch: verified.report.fundingClaimTrust?.currentStatusMatch ?? false,
          payerEntityMatch: verified.report.fundingClaimTrust?.payerEntityMatch ?? false,
          payeeEntityMatch: verified.report.fundingClaimTrust?.payeeEntityMatch ?? false,
          claimantXonlyMatch: verified.report.fundingClaimTrust?.claimantXonlyMatch ?? false,
          currencyAssetMatch: verified.report.fundingClaimTrust?.currencyAssetMatch ?? false,
          amountMatch: verified.report.fundingClaimTrust?.amountMatch ?? false,
          eventTimestampMatch: verified.report.fundingClaimTrust?.eventTimestampMatch ?? false,
          fullClaimVerified: verified.report.fundingClaimTrust?.fullClaimVerified ?? false,
        },
        payout,
      }),
    }),
    trustSummary: buildVerificationTrustSummary({
      bindingMode: payout.descriptor.outputBindingMode,
      ...(verified.report.stateLineageTrust ? { lineageTrust: verified.report.stateLineageTrust } : {}),
      ...(verified.artifactVerification?.definition?.trust ? { definitionTrust: verified.artifactVerification.definition.trust } : {}),
      ...(verified.artifactVerification?.state?.trust ? { stateTrust: verified.artifactVerification.state.trust } : {}),
    }),
  };
}

export async function executeFundingClaim(
  sdk: SimplicityClient,
  input: Parameters<typeof inspectFundingClaim>[1] & { broadcast?: boolean },
) {
  const inspected = await inspectFundingClaim(sdk, input);
  const artifact = await requireReceivableArtifact(sdk, input);
  const contract = sdk.fromArtifact(artifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: inspected.payoutDescriptor.receiverAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(inspected.payoutDescriptor.amountSat),
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
    witness: buildReceivableClaimWitness(inspected.payoutDescriptor),
  });
  return {
    ...inspected,
    execution,
  };
}

export async function prepareRepaymentClaim(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    currentStatePath?: string;
    currentStateValue?: ReceivableState;
    stateHistoryPaths?: string[];
    stateHistoryValues?: ReceivableState[];
    repaymentClaimPath?: string;
    repaymentClaimValue?: ReceivableRepaymentClaimDescriptor;
    claimId?: string;
    payerEntityId?: string;
    payeeEntityId?: string;
    claimantXonly?: string;
    amountSat?: number;
    eventTimestamp?: string;
    simfPath?: string;
    artifactPath?: string;
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const currentState = await loadReceivableStateDocument(sdk, {
    statePath: input.currentStatePath,
    stateValue: input.currentStateValue,
  });
  const history = input.stateHistoryPaths || input.stateHistoryValues
    ? await loadReceivableStateHistoryDocuments(sdk, input)
    : [];
  assertLatestStateMatchesHistoryTip({ latestState: currentState, history });
  const claim = await loadReceivableRepaymentClaimDocument(sdk, {
    repaymentClaimPath: input.repaymentClaimPath,
    repaymentClaimValue: input.repaymentClaimValue,
    currentStateValue: currentState.value,
    claimId: input.claimId ?? `${currentState.value.receivableId}-REPAYMENT-CLAIM`,
    payerEntityId: input.payerEntityId,
    payeeEntityId: input.payeeEntityId,
    claimantXonly: input.claimantXonly,
    amountSat: input.amountSat,
    eventTimestamp: input.eventTimestamp,
  });
  const crossChecks = validateReceivableCrossChecks(definition.value, currentState.value);
  const lineageChecks = history.length > 0
    ? verifyReceivableStateHistory({ history: history.map((entry) => entry.value) })
    : undefined;
  const claimChecks = validateReceivableRepaymentClaimAgainstState({
    currentState: currentState.value,
    claim: claim.value,
  });
  const report = buildReceivableReport({
    crossChecks,
    ...(lineageChecks ? { lineageChecks } : {}),
    repaymentClaimTrust: buildReceivableClaimTrust({
      generated: !input.repaymentClaimPath && !input.repaymentClaimValue,
      claimantXonlyCommitted: true,
      checks: claimChecks,
    }),
  });
  const compiled = await compileRepaymentClaimContract(sdk, {
    definition: definition.value,
    claim: claim.value,
    simfPath: input.simfPath,
    artifactPath: input.artifactPath,
  });
  return {
    ...buildClaimVerificationResult({
      verified: report.repaymentClaimTrust?.fullClaimVerified === true && Object.values(crossChecks).every(Boolean),
      definition,
      currentState,
      stateHistory: history,
      claim,
      report,
    }),
    compiled,
  };
}

export async function verifyRepaymentClaim(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    currentStatePath?: string;
    currentStateValue?: ReceivableState;
    stateHistoryPaths?: string[];
    stateHistoryValues?: ReceivableState[];
    repaymentClaimPath?: string;
    repaymentClaimValue?: ReceivableRepaymentClaimDescriptor;
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const currentState = await loadReceivableStateDocument(sdk, {
    statePath: input.currentStatePath,
    stateValue: input.currentStateValue,
  });
  const history = input.stateHistoryPaths || input.stateHistoryValues
    ? await loadReceivableStateHistoryDocuments(sdk, input)
    : [];
  assertLatestStateMatchesHistoryTip({ latestState: currentState, history });
  const claim = await loadReceivableRepaymentClaimDocument(sdk, {
    repaymentClaimPath: input.repaymentClaimPath,
    repaymentClaimValue: input.repaymentClaimValue,
  });
  const crossChecks = validateReceivableCrossChecks(definition.value, currentState.value);
  const lineageChecks = history.length > 0
    ? verifyReceivableStateHistory({ history: history.map((entry) => entry.value) })
    : undefined;
  const claimChecks = validateReceivableRepaymentClaimAgainstState({
    currentState: currentState.value,
    claim: claim.value,
  });
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  const definitionVerification = artifact
    ? await sdk.verifyDefinitionAgainstArtifact({
        artifact,
        type: "receivable-definition",
        id: definition.value.receivableId,
        value: definition.value,
      })
    : undefined;
  const stateVerification = artifact
    ? await sdk.verifyStateAgainstArtifact({
        artifact,
        type: "receivable-repayment-claim",
        id: claim.value.claimId,
        value: claim.value,
      })
    : undefined;
  const claimantXonlyCommitted = artifact
    ? String(artifact.source.templateVars?.CLAIMANT_XONLY ?? "").toLowerCase() === claim.value.claimantXonly.toLowerCase()
    : true;
  const report = buildReceivableReport({
    crossChecks,
    ...(lineageChecks ? { lineageChecks } : {}),
    repaymentClaimTrust: buildReceivableClaimTrust({
      generated: false,
      claimantXonlyCommitted,
      checks: claimChecks,
    }),
  });
  const verified = report.repaymentClaimTrust?.fullClaimVerified === true
    && Object.values(crossChecks).every(Boolean)
    && (!definitionVerification || definitionVerification.ok)
    && (!stateVerification || stateVerification.ok);
  return buildClaimVerificationResult({
    verified,
    definition,
    currentState,
    stateHistory: history,
    claim,
    artifact,
    artifactVerification:
      artifact && (definitionVerification || stateVerification)
        ? {
            ...(definitionVerification ? { definition: definitionVerification } : {}),
            ...(stateVerification ? { state: stateVerification } : {}),
          }
        : undefined,
    report,
  });
}

export async function inspectRepaymentClaim(
  sdk: SimplicityClient,
  input: Parameters<typeof verifyRepaymentClaim>[1] & {
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
  const verified = await verifyRepaymentClaim(sdk, input);
  if (!verified.verified) {
    throw new ValidationError("Receivable repayment claim verification failed", {
      code: "RECEIVABLE_REPAYMENT_CLAIM_VERIFY_FAILED",
    });
  }
  const artifact = await requireReceivableArtifact(sdk, input);
  const payout = await buildReceivablePayoutDescriptor(sdk, {
    receiverAddress: input.payoutAddress,
    amountSat: verified.claimValue.amountSat,
    assetId: verified.claimValue.currencyAssetId,
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
    witness: buildReceivableClaimWitness(payout.descriptor),
  });
  return {
    ...verified,
    payoutDescriptor: payout.descriptor,
    inspect,
    report: buildReceivableReport({
      crossChecks: verified.report.receivableTrust,
      ...(verified.report.stateLineageTrust
        ? {
            lineageChecks: verifyReceivableStateHistory({
              history: verified.stateHistoryValues ?? [verified.currentStateValue],
            }),
          }
        : {}),
      repaymentClaimTrust: buildReceivableClaimTrust({
        generated: verified.report.repaymentClaimTrust?.generated ?? false,
        claimantXonlyCommitted: verified.report.repaymentClaimTrust?.claimantXonlyCommitted ?? true,
        checks: {
          claimKind: verified.report.repaymentClaimTrust?.claimKind ?? "REPAYMENT",
          stateStatusEligible: verified.report.repaymentClaimTrust?.stateStatusEligible ?? false,
          receivableIdMatch: verified.report.repaymentClaimTrust?.receivableIdMatch ?? false,
          currentStateHashMatch: verified.report.repaymentClaimTrust?.currentStateHashMatch ?? false,
          currentStatusMatch: verified.report.repaymentClaimTrust?.currentStatusMatch ?? false,
          payerEntityMatch: verified.report.repaymentClaimTrust?.payerEntityMatch ?? false,
          payeeEntityMatch: verified.report.repaymentClaimTrust?.payeeEntityMatch ?? false,
          claimantXonlyMatch: verified.report.repaymentClaimTrust?.claimantXonlyMatch ?? false,
          currencyAssetMatch: verified.report.repaymentClaimTrust?.currencyAssetMatch ?? false,
          amountMatch: verified.report.repaymentClaimTrust?.amountMatch ?? false,
          eventTimestampMatch: verified.report.repaymentClaimTrust?.eventTimestampMatch ?? false,
          fullClaimVerified: verified.report.repaymentClaimTrust?.fullClaimVerified ?? false,
        },
        payout,
      }),
    }),
    trustSummary: buildVerificationTrustSummary({
      bindingMode: payout.descriptor.outputBindingMode,
      ...(verified.report.stateLineageTrust ? { lineageTrust: verified.report.stateLineageTrust } : {}),
      ...(verified.artifactVerification?.definition?.trust ? { definitionTrust: verified.artifactVerification.definition.trust } : {}),
      ...(verified.artifactVerification?.state?.trust ? { stateTrust: verified.artifactVerification.state.trust } : {}),
    }),
  };
}

export async function executeRepaymentClaim(
  sdk: SimplicityClient,
  input: Parameters<typeof inspectRepaymentClaim>[1] & { broadcast?: boolean },
) {
  const inspected = await inspectRepaymentClaim(sdk, input);
  const artifact = await requireReceivableArtifact(sdk, input);
  const contract = sdk.fromArtifact(artifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: inspected.payoutDescriptor.receiverAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(inspected.payoutDescriptor.amountSat),
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
    witness: buildReceivableClaimWitness(inspected.payoutDescriptor),
  });
  return {
    ...inspected,
    execution,
  };
}

export async function prepareWriteOff(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    previousStatePath?: string;
    previousStateValue?: ReceivableState;
    nextStatePath?: string;
    nextStateValue?: ReceivableState;
    stateId?: string;
    defaultedAt?: string;
    writeOffAmount?: number;
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const previous = await loadReceivableStateDocument(sdk, {
    statePath: input.previousStatePath,
    stateValue: input.previousStateValue,
  });
  const next = input.nextStatePath || input.nextStateValue
    ? await loadReceivableStateDocument(sdk, {
        statePath: input.nextStatePath,
        stateValue: input.nextStateValue,
      })
    : await loadReceivableStateDocument(sdk, {
        stateValue: buildDefaultedReceivableState({
          previous: previous.value,
          stateId: input.stateId ?? `${previous.value.receivableId}-DEFAULTED`,
          defaultedAt: input.defaultedAt ?? new Date().toISOString(),
          ...(input.writeOffAmount !== undefined ? { writeOffAmount: input.writeOffAmount } : {}),
        }),
      });
  const transitionTrust = validateReceivableWriteOffTransition(previous.value, next.value);
  return buildTransitionVerificationResult({
    definition,
    previous,
    next,
    transitionTrust,
  });
}

export async function verifyWriteOff(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    previousStatePath?: string;
    previousStateValue?: ReceivableState;
    nextStatePath?: string;
    nextStateValue?: ReceivableState;
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const { previous, next } = await loadPreviousAndNextReceivableStates(sdk, input);
  const transitionTrust = validateReceivableWriteOffTransition(previous.value, next.value);
  return buildTransitionVerificationResult({
    definition,
    previous,
    next,
    transitionTrust,
  });
}

export async function prepareClosing(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    latestStatePath?: string;
    latestStateValue?: ReceivableState;
    stateHistoryPaths?: string[];
    stateHistoryValues?: ReceivableState[];
    closingPath?: string;
    closingValue?: ReceivableClosingDescriptor;
    closingId?: string;
    closedAt?: string;
    closingReason?: ReceivableClosingDescriptor["closingReason"];
  },
) {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const latestState = await loadReceivableStateDocument(sdk, {
    statePath: input.latestStatePath,
    stateValue: input.latestStateValue,
  });
  const history = input.stateHistoryPaths || input.stateHistoryValues
    ? await loadReceivableStateHistoryDocuments(sdk, input)
    : [];
  assertLatestStateMatchesHistoryTip({ latestState, history });
  const closing = await loadReceivableClosingDocument(sdk, {
    closingPath: input.closingPath,
    closingValue: input.closingValue,
    closingId: input.closingId,
    latestStateValue: latestState.value,
    closedAt: input.closedAt,
    closingReason: input.closingReason,
  });
  const crossChecks = validateReceivableCrossChecks(definition.value, latestState.value);
  const lineageChecks = history.length > 0
    ? verifyReceivableStateHistory({ history: history.map((entry) => entry.value) })
    : undefined;
  const closingTrust = validateReceivableClosingAgainstState({
    latestState: latestState.value,
    closing: closing.value,
    ...(history.length > 0 ? { history: history.map((entry) => entry.value) } : {}),
  });
  const report = buildReceivableReport({
    crossChecks,
    ...(lineageChecks ? { lineageChecks } : {}),
    closingTrust,
  });
  return {
    verified: closingTrust.fullClosingVerified
      && Object.values(crossChecks).every(Boolean)
      && (lineageChecks ? lineageChecks.fullHistoryVerified : true),
    definition: definition.descriptor,
    definitionValue: definition.value,
    definitionSummary: definition.summary,
    latestState: latestState.descriptor,
    latestStateValue: latestState.value,
    latestStateSummary: latestState.summary,
    ...(history.length > 0
      ? {
          stateHistory: history.map((entry) => entry.descriptor),
          stateHistoryValues: history.map((entry) => entry.value),
          stateHistorySummaries: history.map((entry) => entry.summary),
        }
      : {}),
    closing: closing.descriptor,
    closingValue: closing.value,
    closingSummary: closing.summary,
    report,
    trustSummary: buildVerificationTrustSummary({
      bindingMode: "none",
      ...(report.stateLineageTrust ? { lineageTrust: report.stateLineageTrust } : {}),
    }),
  };
}

export async function verifyClosing(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    latestStatePath?: string;
    latestStateValue?: ReceivableState;
    stateHistoryPaths?: string[];
    stateHistoryValues?: ReceivableState[];
    closingPath?: string;
    closingValue?: ReceivableClosingDescriptor;
  },
) {
  if (!input.closingPath && !input.closingValue) {
    throw new ValidationError("closingPath or closingValue is required", {
      code: "RECEIVABLE_CLOSING_REQUIRED",
    });
  }
  return prepareClosing(sdk, input);
}

export async function exportEvidence(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: ReceivableDefinition;
    statePath?: string;
    stateValue?: ReceivableState;
    stateHistoryPaths?: string[];
    stateHistoryValues?: ReceivableState[];
    fundingClaimPath?: string;
    fundingClaimValue?: ReceivableFundingClaimDescriptor;
    repaymentClaimPath?: string;
    repaymentClaimValue?: ReceivableRepaymentClaimDescriptor;
    closingPath?: string;
    closingValue?: ReceivableClosingDescriptor;
    verificationReportValue?: ReceivableVerificationReport;
  },
): Promise<ReceivableEvidenceBundle> {
  const definition = await loadReceivableDefinitionDocument(sdk, input);
  const latestState = input.statePath || input.stateValue
    ? await loadReceivableStateDocument(sdk, input)
    : undefined;
  const history = input.stateHistoryPaths || input.stateHistoryValues
    ? await loadReceivableStateHistoryDocuments(sdk, input)
    : [];
  assertLatestStateMatchesHistoryTip({ latestState, history });
  const latest = latestState ?? history.at(-1);
  if (!latest) {
    throw new ValidationError("statePath/stateValue or stateHistoryPaths/stateHistoryValues is required", {
      code: "RECEIVABLE_STATE_REQUIRED",
    });
  }
  const closing = input.closingPath || input.closingValue
    ? await loadReceivableClosingDocument(sdk, {
        closingPath: input.closingPath,
        closingValue: input.closingValue,
      })
    : undefined;
  const fundingClaim = input.fundingClaimPath || input.fundingClaimValue
    ? await loadReceivableFundingClaimDocument(sdk, {
        fundingClaimPath: input.fundingClaimPath,
        fundingClaimValue: input.fundingClaimValue,
      })
    : undefined;
  const repaymentClaim = input.repaymentClaimPath || input.repaymentClaimValue
    ? await loadReceivableRepaymentClaimDocument(sdk, {
        repaymentClaimPath: input.repaymentClaimPath,
        repaymentClaimValue: input.repaymentClaimValue,
      })
    : undefined;
  const lineageChecks = history.length > 0
    ? verifyReceivableStateHistory({ history: history.map((entry) => entry.value) })
    : undefined;
  const trust = input.verificationReportValue
    ?? (lineageChecks
      ? buildReceivableReport({
          crossChecks: validateReceivableCrossChecks(definition.value, latest.value),
          lineageChecks,
          ...(closing
            ? {
                closingTrust: validateReceivableClosingAgainstState({
                  latestState: latest.value,
                  closing: closing.value,
                  history: history.map((entry) => entry.value),
                }),
              }
            : {}),
        })
      : buildReceivableReport({
          crossChecks: validateReceivableCrossChecks(definition.value, latest.value),
          ...(closing
            ? {
                closingTrust: validateReceivableClosingAgainstState({
                  latestState: latest.value,
                  closing: closing.value,
                }),
              }
            : {}),
        }));
  return {
    schemaVersion: RECEIVABLE_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    definition: definition.summary,
    state: latest.summary,
    ...(history.length > 1 ? { stateHistory: history.map((entry) => entry.summary) } : {}),
    ...(fundingClaim ? { fundingClaim: fundingClaim.summary } : {}),
    ...(repaymentClaim ? { repaymentClaim: repaymentClaim.summary } : {}),
    ...(closing ? { closing: closing.summary } : {}),
    trust,
    trustSummary: buildVerificationTrustSummary({
      bindingMode: "none",
      lineageTrust: trust.stateLineageTrust,
    }),
  };
}

export async function exportFinalityPayload(
  sdk: SimplicityClient,
  input: Parameters<typeof exportEvidence>[1],
): Promise<ReceivableFinalityPayload> {
  const evidence = await exportEvidence(sdk, input);
  const latestState = input.statePath || input.stateValue
    ? await loadReceivableStateDocument(sdk, input)
    : undefined;
  const history = input.stateHistoryPaths || input.stateHistoryValues
    ? await loadReceivableStateHistoryDocuments(sdk, input)
    : [];
  assertLatestStateMatchesHistoryTip({ latestState, history });
  const latest = latestState ?? history.at(-1);
  if (!latest) {
    throw new ValidationError("statePath/stateValue or stateHistoryPaths/stateHistoryValues is required", {
      code: "RECEIVABLE_STATE_REQUIRED",
    });
  }
  const closing = input.closingPath || input.closingValue
    ? await loadReceivableClosingDocument(sdk, {
        closingPath: input.closingPath,
        closingValue: input.closingValue,
      })
    : undefined;
  const fundingClaim = input.fundingClaimPath || input.fundingClaimValue
    ? await loadReceivableFundingClaimDocument(sdk, {
        fundingClaimPath: input.fundingClaimPath,
        fundingClaimValue: input.fundingClaimValue,
      })
    : undefined;
  const repaymentClaim = input.repaymentClaimPath || input.repaymentClaimValue
    ? await loadReceivableRepaymentClaimDocument(sdk, {
        repaymentClaimPath: input.repaymentClaimPath,
        repaymentClaimValue: input.repaymentClaimValue,
      })
    : undefined;
  return {
    schemaVersion: RECEIVABLE_FINALITY_PAYLOAD_SCHEMA_VERSION,
    receivableId: latest.value.receivableId,
    holderEntityId: latest.value.holderEntityId,
    definitionHash: evidence.definition.hash,
    latestStateHash: evidence.state.hash,
    stateHistoryHashes: history.length > 1 ? history.map((entry) => entry.summary.hash) : null,
    fundingClaimHash: fundingClaim?.summary.hash ?? null,
    repaymentClaimHash: repaymentClaim?.summary.hash ?? null,
    closingHash: closing?.summary.hash ?? null,
    closingReason: closing?.value.closingReason ?? null,
    trust: evidence.trust,
    trustSummary: evidence.trustSummary,
  };
}
