import { existsSync } from "node:fs";
import path from "node:path";
import type { SimplicityClient } from "../client/SimplicityClient";
import {
  BondDefinition,
  BondEvidenceBundle,
  BondExpectedOutputDescriptor,
  BondIssuanceState,
  BondClosingDescriptor,
  BondOutputBindingMode,
  BondSettlementDescriptor,
  BondVerificationReport,
  OutputRawFields,
  OutputAssetForm,
  OutputAmountForm,
  OutputNonceForm,
  OutputRangeProofForm,
  SimplicityArtifact,
} from "../core/types";
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
  summarizeBondSettlementDescriptor,
  validateBondSettlementDescriptor,
  validateBondSettlementMatchesExpected,
} from "./bondSettlementValidation";
import {
  validateBondCrossChecks,
  validateBondDefinition,
  validateBondIssuanceState,
  validateBondStateTransition,
  buildClosedBondIssuanceState,
  buildRedeemedBondIssuanceState,
  summarizeBondIssuanceState,
} from "./bondValidation";

function resolveValueOrPath<T>(options: {
  pathValue?: string;
  objectValue?: T;
  envName?: string;
}): { jsonPath?: string; value?: T } {
  if (options.pathValue) return { jsonPath: options.pathValue };
  if (options.objectValue !== undefined) return { value: options.objectValue };
  return {};
}

function resolveBondDocsAsset(filename: string): string {
  const cwdCandidate = path.resolve(process.cwd(), "docs/definitions", filename);
  if (existsSync(cwdCandidate)) {
    return cwdCandidate;
  }

  // In published packages we copy bond example contracts into dist/docs/definitions.
  const bundledCandidate = path.resolve(__dirname, "../docs/definitions", filename);
  if (existsSync(bundledCandidate)) {
    return bundledCandidate;
  }

  return cwdCandidate;
}

export async function defineBond(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    issuancePath?: string;
    issuanceValue?: BondIssuanceState;
    simfPath?: string;
    artifactPath?: string;
  }
) {
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const issuanceSource = resolveValueOrPath({
    pathValue: input.issuancePath,
    objectValue: input.issuanceValue,
  });
  const initialDefinitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: input.definitionValue?.bondId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const definition = validateBondDefinition(JSON.parse(initialDefinitionDescriptor.canonicalJson));
  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: definition.bondId,
    ...(definitionSource.jsonPath ? { jsonPath: definitionSource.jsonPath } : { value: definition }),
  });
  const initialStateDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.issuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...issuanceSource,
  });
  const issuance = validateBondIssuanceState(JSON.parse(initialStateDescriptor.canonicalJson));
  const stateDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: issuance.issuanceId,
    ...(issuanceSource.jsonPath ? { jsonPath: issuanceSource.jsonPath } : { value: issuance }),
  });
  validateBondCrossChecks(definition, issuance);
  const simfPath =
    input.simfPath ?? resolveBondDocsAsset("bond-issuance-anchor.simf");
  return sdk.compileFromFile({
    simfPath,
    templateVars: {
      MIN_HEIGHT: definition.maturityDate,
      SIGNER_XONLY: definition.controllerXonly,
    },
    definition: {
      type: definitionDescriptor.definitionType,
      id: definitionDescriptor.definitionId,
      schemaVersion: definitionDescriptor.schemaVersion,
      ...(definitionDescriptor.sourcePath ? { jsonPath: definitionDescriptor.sourcePath } : { value: definition }),
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: stateDescriptor.stateType,
      id: stateDescriptor.stateId,
      schemaVersion: stateDescriptor.schemaVersion,
      ...(stateDescriptor.sourcePath ? { jsonPath: stateDescriptor.sourcePath } : { value: issuance }),
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });
}

export async function verifyBond(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    issuancePath?: string;
    issuanceValue?: BondIssuanceState;
  }
) {
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  if (!artifact) {
    throw new Error("artifactPath or artifact is required");
  }
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const issuanceSource = resolveValueOrPath({
    pathValue: input.issuancePath,
    objectValue: input.issuanceValue,
  });
  const definition = await sdk.verifyDefinitionAgainstArtifact({
    artifact,
    type: "bond",
    id: artifact.definition?.definitionId,
    ...definitionSource,
  });
  const issuance = await sdk.verifyStateAgainstArtifact({
    artifact,
    type: "bond-issuance",
    id: artifact.state?.stateId,
    ...issuanceSource,
  });
  const definitionValue = validateBondDefinition(JSON.parse(definition.definition.canonicalJson));
  const issuanceValue = validateBondIssuanceState(JSON.parse(issuance.state.canonicalJson));
  const crossChecks = validateBondCrossChecks(definitionValue, issuanceValue);
  return {
    artifact,
    definition,
    issuance,
    crossChecks,
  };
}

export async function loadBond(
  sdk: SimplicityClient,
  input: {
    artifactPath: string;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    issuancePath?: string;
    issuanceValue?: BondIssuanceState;
  }
) {
  const compiled = await sdk.loadArtifact(input.artifactPath);
  const verification = await verifyBond(sdk, {
    artifact: compiled.artifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    issuancePath: input.issuancePath,
    issuanceValue: input.issuanceValue,
  });
  return {
    artifact: compiled.artifact,
    definition: verification.definition,
    issuance: verification.issuance,
    crossChecks: verification.crossChecks,
    trust: {
      definitionTrust: verification.definition.trust,
      issuanceTrust: verification.issuance.trust,
    },
  };
}

export async function buildBondPayload(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    issuancePath?: string;
    issuanceValue?: BondIssuanceState;
  }
) {
  const verification = await verifyBond(sdk, input);
  const definitionValue = validateBondDefinition(JSON.parse(verification.definition.definition.canonicalJson));
  const issuanceValue = validateBondIssuanceState(JSON.parse(verification.issuance.state.canonicalJson));
  const issuanceSummary = summarizeBondIssuanceState(issuanceValue);
  return {
    artifact: verification.artifact,
    payload: {
      bondId: definitionValue.bondId,
      issuanceId: issuanceValue.issuanceId,
      definitionHash: verification.definition.definition.hash,
      issuanceStateHash: issuanceSummary.hash,
      previousStateHash: issuanceValue.previousStateHash ?? null,
      contractAddress: verification.artifact.compiled.contractAddress,
      cmr: verification.artifact.compiled.cmr,
      anchorModes: {
        definition: verification.artifact.definition?.anchorMode ?? "none",
        state: verification.artifact.state?.anchorMode ?? "none",
      },
      status: issuanceValue.status,
      lastTransition: issuanceValue.lastTransition
        ? {
            type: issuanceValue.lastTransition.type,
            amount: issuanceValue.lastTransition.amount,
            at: issuanceValue.lastTransition.at,
          }
        : null,
      principal: {
        issued: issuanceValue.issuedPrincipal,
        outstanding: issuanceValue.outstandingPrincipal,
        redeemed: issuanceValue.redeemedPrincipal,
      },
      crossChecks: verification.crossChecks,
    },
    trust: {
      definitionTrust: verification.definition.trust,
      issuanceTrust: verification.issuance.trust,
    },
  };
}

function detectPreviousStateAnchor(simfSource: string): {
  sourceVerified: boolean;
  reason?: string;
} {
  const source = simfSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  if (!source.includes("{{PREVIOUS_STATE_HASH}}")) {
    return { sourceVerified: false, reason: "PREVIOUS_STATE_HASH placeholder is missing" };
  }
  if (!source.includes("fn require_previous_state_anchor()")) {
    return { sourceVerified: false, reason: "require_previous_state_anchor helper is missing" };
  }
  if (!source.includes("let previous_state_hash: u256 = 0x{{PREVIOUS_STATE_HASH}};")) {
    return { sourceVerified: false, reason: "previous_state_hash assignment is missing" };
  }
  if (!source.includes("require_previous_state_anchor();")) {
    return { sourceVerified: false, reason: "require_previous_state_anchor() is not called from main" };
  }
  if (!source.includes("require_distinct_transition_state();")) {
    return { sourceVerified: false, reason: "require_distinct_transition_state() is not called from main" };
  }
  return { sourceVerified: true };
}

function toUint256Hex(value: number): string {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`Expected a non-negative integer for uint256 conversion, got: ${value}`);
  }
  return value.toString(16).padStart(64, "0");
}

function toUint32Hex(value: number): string {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value) || value > 0xffffffff) {
    throw new Error(`Expected a u32-compatible non-negative integer, got: ${value}`);
  }
  return value.toString(16).padStart(8, "0");
}

function hashContractAddressToUint256Hex(address: string): string {
  return sha256HexUtf8(address);
}

function bondStatusToCode(status: BondIssuanceState["status"]): number {
  switch (status) {
    case "ISSUED":
      return 1;
    case "PARTIALLY_REDEEMED":
      return 2;
    case "REDEEMED":
      return 3;
    case "CLOSED":
      return 4;
    default: {
      const exhaustiveCheck: never = status;
      throw new Error(`Unsupported bond status: ${exhaustiveCheck}`);
    }
  }
}

function closingReasonToCode(reason: "REDEEMED" | "CANCELLED" | "MATURED_OUT"): number {
  switch (reason) {
    case "REDEEMED":
      return 1;
    case "CANCELLED":
      return 2;
    case "MATURED_OUT":
      return 3;
    default: {
      const exhaustiveCheck: never = reason;
      throw new Error(`Unsupported closing reason: ${exhaustiveCheck}`);
    }
  }
}

export function summarizeExpectedOutputDescriptor(descriptor: BondExpectedOutputDescriptor): {
  canonicalJson: string;
  hash: string;
} {
  const canonicalJson = stableStringify({
    assetId: descriptor.assetId,
    feeIndex: descriptor.feeIndex,
    maxFeeSat: descriptor.maxFeeSat,
    nextAmountSat: descriptor.nextAmountSat,
    nextContractAddress: descriptor.nextContractAddress,
    nextOutputHash: descriptor.nextOutputHash ?? null,
    nextOutputScriptHash: descriptor.nextOutputScriptHash ?? null,
    nextOutputIndex: descriptor.nextOutputIndex,
    requestedOutputBindingMode: descriptor.requestedOutputBindingMode ?? descriptor.outputBindingMode ?? "none",
    outputForm: descriptor.outputForm ?? normalizeOutputForm(),
    rawOutput: normalizeOutputRawFields(descriptor.rawOutput) ?? null,
    outputBindingMode: descriptor.outputBindingMode ?? "none",
  });
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function validateExpectedOutputDescriptor(descriptor: BondExpectedOutputDescriptor): BondExpectedOutputDescriptor {
  if (!descriptor.nextContractAddress || descriptor.nextContractAddress.trim().length === 0) {
    throw new Error("nextContractAddress must be a non-empty string");
  }
  if (!descriptor.assetId || descriptor.assetId.trim().length === 0) {
    throw new Error("assetId must be a non-empty string");
  }
  if (descriptor.nextOutputScriptHash !== undefined && descriptor.nextOutputScriptHash !== null) {
    if (!/^[0-9a-f]{64}$/i.test(descriptor.nextOutputScriptHash)) {
      throw new Error("nextOutputScriptHash must be a 64-character hex string");
    }
  }
  if (descriptor.nextOutputHash !== undefined && descriptor.nextOutputHash !== null) {
    if (!/^[0-9a-f]{64}$/i.test(descriptor.nextOutputHash)) {
      throw new Error("nextOutputHash must be a 64-character hex string");
    }
  }
  if (!Number.isInteger(descriptor.nextAmountSat) || descriptor.nextAmountSat <= 0) {
    throw new Error("nextAmountSat must be a positive integer");
  }
  if (!Number.isInteger(descriptor.maxFeeSat) || descriptor.maxFeeSat < 0) {
    throw new Error("maxFeeSat must be a non-negative integer");
  }
  if (!Number.isInteger(descriptor.nextOutputIndex) || descriptor.nextOutputIndex < 0) {
    throw new Error("nextOutputIndex must be a non-negative integer");
  }
  if (!Number.isInteger(descriptor.feeIndex) || descriptor.feeIndex < 0) {
    throw new Error("feeIndex must be a non-negative integer");
  }
  if (
    descriptor.requestedOutputBindingMode
    && descriptor.requestedOutputBindingMode !== "none"
    && descriptor.requestedOutputBindingMode !== "script-bound"
    && descriptor.requestedOutputBindingMode !== "descriptor-bound"
  ) {
    throw new Error("requestedOutputBindingMode must be none, script-bound, or descriptor-bound");
  }
  if (
    descriptor.outputBindingMode !== "none"
    && descriptor.outputBindingMode !== "script-bound"
    && descriptor.outputBindingMode !== "descriptor-bound"
  ) {
    throw new Error("outputBindingMode must be none, script-bound, or descriptor-bound");
  }
  descriptor.rawOutput = normalizeOutputRawFields(descriptor.rawOutput);
  descriptor.outputForm = normalizeOutputForm(descriptor.outputForm);
  descriptor.requestedOutputBindingMode = descriptor.requestedOutputBindingMode ?? descriptor.outputBindingMode ?? "none";
  return descriptor;
}

export async function buildExpectedOutputDescriptor(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat: number;
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
    outputBindingMode?: "none" | "script-bound" | "descriptor-bound";
  },
) {
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const nextSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });
  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: input.definitionValue?.bondId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const nextDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.nextIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...nextSource,
  });
  const definition = validateBondDefinition(JSON.parse(definitionDescriptor.canonicalJson));
  const next = validateBondIssuanceState(JSON.parse(nextDescriptor.canonicalJson));
  validateBondCrossChecks(definition, next);
  const nextStateCompiled = await defineBond(sdk, {
    definitionValue: definition,
    issuanceValue: next,
    simfPath: input.nextStateSimfPath,
  });
  const nextScriptPubKeyHex = await getScriptPubKeyHexViaRpc(
    sdk,
    nextStateCompiled.deployment().contractAddress,
  );
  const nextOutputScriptHash = hashHexBytes(nextScriptPubKeyHex);
  const requestedBindingMode = input.outputBindingMode ?? "script-bound";
  const outputForm = normalizeOutputForm(input.outputForm);
  const rawOutput = normalizeOutputRawFields(input.rawOutput);
  const rawOutputAnalysis = analyzeOutputRawFields(rawOutput);
  const explicitAssetHex = requestedBindingMode !== "none" && isExplicitV1OutputForm(outputForm)
    ? await resolveExplicitAssetHex(sdk, definition.currencyAssetId)
    : undefined;
  const autoDerivedNextOutputHash = requestedBindingMode === "descriptor-bound" && !input.nextOutputHash
    ? rawOutputAnalysis.valid && rawOutputAnalysis.normalized
      ? computeRawOutputV1Hash(rawOutputAnalysis.normalized)
      : explicitAssetHex
        ? computeExplicitV1OutputHash({
            assetHex: explicitAssetHex,
            nextAmountSat: input.nextAmountSat,
            nextOutputScriptHash,
          })
        : undefined
    : undefined;
  const nextOutputHash = input.nextOutputHash ?? autoDerivedNextOutputHash;
  const bindingDecision = resolveOutputBindingDecision({
    requestedBindingMode,
    nextOutputHash,
    nextOutputScriptHash,
    autoDerivedNextOutputHash: Boolean(autoDerivedNextOutputHash && !input.nextOutputHash),
    explicitAssetSupported: Boolean(explicitAssetHex),
    outputForm,
    rawOutput,
  });
  const descriptor = validateExpectedOutputDescriptor({
    nextContractAddress: nextStateCompiled.deployment().contractAddress,
    nextOutputHash: bindingDecision.outputBindingMode === "descriptor-bound" ? nextOutputHash : undefined,
    nextOutputScriptHash: bindingDecision.outputBindingMode !== "none" ? nextOutputScriptHash : undefined,
    nextAmountSat: input.nextAmountSat,
    assetId: definition.currencyAssetId,
    requestedOutputBindingMode: requestedBindingMode,
    outputForm,
    rawOutput,
    feeIndex: input.feeIndex ?? 1,
    nextOutputIndex: input.nextOutputIndex ?? 0,
    maxFeeSat: input.maxFeeSat ?? 100,
    outputBindingMode: bindingDecision.outputBindingMode,
  });
  const summary = summarizeExpectedOutputDescriptor(descriptor);
  return {
    descriptor,
    canonicalJson: summary.canonicalJson,
    hash: summary.hash,
    supportedForm: bindingDecision.supportedForm,
    reasonCode: bindingDecision.reasonCode,
    autoDerivedNextOutputHash: bindingDecision.autoDerived,
    fallbackReason: bindingDecision.fallbackReason,
    bindingInputs: {
      assetId: descriptor.assetId,
      assetForm: descriptor.outputForm?.assetForm ?? "explicit",
      amountForm: descriptor.outputForm?.amountForm ?? "explicit",
      nonceForm: descriptor.outputForm?.nonceForm ?? "null",
      rangeProofForm: descriptor.outputForm?.rangeProofForm ?? "empty",
      nextAmountSat: descriptor.nextAmountSat,
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
    },
  };
}

export async function verifyExpectedOutputDescriptor(
  sdk: SimplicityClient,
  input: {
    descriptorValue?: BondExpectedOutputDescriptor;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat?: number;
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
    outputBindingMode?: "none" | "script-bound" | "descriptor-bound";
  },
) {
  const actual = validateExpectedOutputDescriptor(input.descriptorValue!);
  const expected = await buildExpectedOutputDescriptor(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat ?? actual.nextAmountSat,
    maxFeeSat: input.maxFeeSat ?? actual.maxFeeSat,
    nextOutputIndex: input.nextOutputIndex ?? actual.nextOutputIndex,
    feeIndex: input.feeIndex ?? actual.feeIndex,
    nextOutputHash: input.nextOutputHash ?? actual.nextOutputHash,
    outputForm: input.outputForm ?? actual.outputForm,
    rawOutput: input.rawOutput ?? actual.rawOutput,
    outputBindingMode: input.outputBindingMode ?? actual.outputBindingMode,
  });
  const actualSummary = summarizeExpectedOutputDescriptor(actual);
  return {
    ok: actualSummary.hash === expected.hash,
    reason: actualSummary.hash === expected.hash ? undefined : "Expected output descriptor hash mismatch",
    descriptor: actual,
    expected: expected.descriptor,
    hash: actualSummary.hash,
    expectedHash: expected.hash,
    supportedForm: expected.supportedForm,
    reasonCode: expected.reasonCode,
    autoDerivedNextOutputHash: expected.autoDerivedNextOutputHash,
    fallbackReason: expected.fallbackReason,
    bindingInputs: expected.bindingInputs,
  };
}

export async function redeemBond(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    amount: number;
    redeemedAt: string;
    simfPath?: string;
    artifactPath?: string;
  }
) {
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const previousSource = resolveValueOrPath({
    pathValue: input.previousIssuancePath,
    objectValue: input.previousIssuanceValue,
  });

  const initialDefinitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: input.definitionValue?.bondId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const definition = validateBondDefinition(JSON.parse(initialDefinitionDescriptor.canonicalJson));
  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: definition.bondId,
    ...(definitionSource.jsonPath ? { jsonPath: definitionSource.jsonPath } : { value: definition }),
  });

  const initialPreviousStateDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.previousIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...previousSource,
  });
  const previousIssuance = validateBondIssuanceState(JSON.parse(initialPreviousStateDescriptor.canonicalJson));
  validateBondCrossChecks(definition, previousIssuance);

  const nextIssuance = buildRedeemedBondIssuanceState({
    previous: previousIssuance,
    amount: input.amount,
    redeemedAt: input.redeemedAt,
  });
  validateBondStateTransition(previousIssuance, nextIssuance);

  const stateDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: nextIssuance.issuanceId,
    value: nextIssuance,
  });

  const simfPath =
    input.simfPath ?? resolveBondDocsAsset("bond-issuance-anchor.simf");
  return sdk.compileFromFile({
    simfPath,
    templateVars: {
      MIN_HEIGHT: definition.maturityDate,
      SIGNER_XONLY: definition.controllerXonly,
    },
    definition: {
      type: definitionDescriptor.definitionType,
      id: definitionDescriptor.definitionId,
      schemaVersion: definitionDescriptor.schemaVersion,
      ...(definitionDescriptor.sourcePath ? { jsonPath: definitionDescriptor.sourcePath } : { value: definition }),
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: stateDescriptor.stateType,
      id: stateDescriptor.stateId,
      schemaVersion: stateDescriptor.schemaVersion,
      value: nextIssuance,
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });
}

export async function buildBondTransitionPayload(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
  }
) {
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const previousSource = resolveValueOrPath({
    pathValue: input.previousIssuancePath,
    objectValue: input.previousIssuanceValue,
  });
  const nextSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });

  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: input.definitionValue?.bondId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const previousDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.previousIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...previousSource,
  });
  const nextDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.nextIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...nextSource,
  });

  const definition = validateBondDefinition(JSON.parse(definitionDescriptor.canonicalJson));
  const previous = validateBondIssuanceState(JSON.parse(previousDescriptor.canonicalJson));
  const next = validateBondIssuanceState(JSON.parse(nextDescriptor.canonicalJson));
  const previousCrossChecks = validateBondCrossChecks(definition, previous);
  const nextCrossChecks = validateBondCrossChecks(definition, next);
  const transition = validateBondStateTransition(previous, next);

  return {
    definition,
    previous,
    next,
    payload: {
      bondId: definition.bondId,
      issuanceId: previous.issuanceId,
      definitionHash: definitionDescriptor.hash,
      previousStateHash: previousDescriptor.hash,
      nextStateHash: nextDescriptor.hash,
      previousStatus: previous.status,
      nextStatus: next.status,
      previousStatusCode: bondStatusToCode(previous.status),
      nextStatusCode: bondStatusToCode(next.status),
      transitionKind: next.lastTransition?.type ?? null,
      redeemAmount: next.lastTransition?.type === "REDEEM" ? next.lastTransition.amount : null,
      transitionAt: next.lastTransition?.at ?? null,
      principal: {
        issued: previous.issuedPrincipal,
        previousOutstanding: previous.outstandingPrincipal,
        nextOutstanding: next.outstandingPrincipal,
        previousRedeemed: previous.redeemedPrincipal,
        nextRedeemed: next.redeemedPrincipal,
        outstandingDelta: previous.outstandingPrincipal - next.outstandingPrincipal,
        redeemedDelta: next.redeemedPrincipal - previous.redeemedPrincipal,
      },
      crossChecks: {
        previous: previousCrossChecks,
        next: nextCrossChecks,
        transition,
      },
    },
  };
}

export async function buildBondSettlementDescriptor(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat: number;
    maxFeeSat?: number;
    nextOutputHash?: string;
    outputForm?: {
      assetForm?: OutputAssetForm;
      amountForm?: OutputAmountForm;
      nonceForm?: OutputNonceForm;
      rangeProofForm?: OutputRangeProofForm;
    };
    rawOutput?: Partial<OutputRawFields>;
    outputBindingMode?: "none" | "script-bound" | "descriptor-bound";
  }
) {
  const transition = await buildBondTransitionPayload(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
  });
  const nextStateCompiled = await defineBond(sdk, {
    definitionValue: transition.definition,
    issuanceValue: transition.next,
    simfPath: input.nextStateSimfPath,
  });
  const expectedOutputDescriptor = await buildExpectedOutputDescriptor(sdk, {
    definitionValue: transition.definition,
    nextIssuanceValue: transition.next,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat,
    maxFeeSat: input.maxFeeSat ?? 100,
    nextOutputHash: input.nextOutputHash,
    outputForm: input.outputForm,
    rawOutput: input.rawOutput,
    outputBindingMode: input.outputBindingMode,
  });
  const nextContractAddress = nextStateCompiled.deployment().contractAddress;
  const descriptor = validateBondSettlementDescriptor({
    settlementId: `${transition.previous.issuanceId}-SETTLEMENT-${transition.payload.nextStatus}`,
    bondId: transition.definition.bondId,
    issuanceId: transition.previous.issuanceId,
    definitionHash: transition.payload.definitionHash,
    previousStateHash: transition.payload.previousStateHash,
    nextStateHash: transition.payload.nextStateHash,
    previousStatus: transition.payload.previousStatus,
    nextStatus: transition.payload.nextStatus,
    transitionKind: "REDEEM",
    redeemAmount: transition.payload.redeemAmount ?? 0,
    transitionAt: transition.payload.transitionAt ?? transition.next.lastTransition?.at ?? transition.next.issuedAt,
    assetId: transition.definition.currencyAssetId,
    nextContractAddress,
    nextAmountSat: input.nextAmountSat,
    maxFeeSat: input.maxFeeSat ?? 100,
    expectedOutputDescriptorHash: expectedOutputDescriptor.hash,
    outputBindingMode: expectedOutputDescriptor.descriptor.outputBindingMode ?? "none",
    principal: {
      issued: transition.payload.principal.issued,
      previousOutstanding: transition.payload.principal.previousOutstanding,
      nextOutstanding: transition.payload.principal.nextOutstanding,
      previousRedeemed: transition.payload.principal.previousRedeemed,
      nextRedeemed: transition.payload.principal.nextRedeemed,
    },
  } satisfies BondSettlementDescriptor);
  const summary = summarizeBondSettlementDescriptor(descriptor);
  return {
    definition: transition.definition,
    previous: transition.previous,
    next: transition.next,
    transition: transition.payload.crossChecks.transition,
    nextContractAddress,
    descriptor,
    expectedOutputDescriptor: expectedOutputDescriptor.descriptor,
    expectedOutputDescriptorHash: expectedOutputDescriptor.hash,
    expectedOutputBindingSupportedForm: expectedOutputDescriptor.supportedForm,
    expectedOutputBindingReasonCode: expectedOutputDescriptor.reasonCode,
    expectedOutputBindingAutoDerived: expectedOutputDescriptor.autoDerivedNextOutputHash,
    expectedOutputBindingFallbackReason: expectedOutputDescriptor.fallbackReason,
    expectedOutputBindingInputs: expectedOutputDescriptor.bindingInputs,
    canonicalJson: summary.canonicalJson,
    hash: summary.hash,
  };
}

export async function verifyBondSettlementDescriptor(
  sdk: SimplicityClient,
  input: {
    descriptorPath?: string;
    descriptorValue?: BondSettlementDescriptor;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    nextOutputHash?: string;
    outputForm?: {
      assetForm?: OutputAssetForm;
      amountForm?: OutputAmountForm;
      nonceForm?: OutputNonceForm;
      rangeProofForm?: OutputRangeProofForm;
    };
    rawOutput?: Partial<OutputRawFields>;
  }
) {
  const descriptorSource = resolveValueOrPath({
    pathValue: input.descriptorPath,
    objectValue: input.descriptorValue,
  });
  const descriptor = validateBondSettlementDescriptor(
    descriptorSource.jsonPath
      ? JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(descriptorSource.jsonPath!, "utf8")))
      : descriptorSource.value
  );
  const expected = await buildBondSettlementDescriptor(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat ?? descriptor.nextAmountSat,
    maxFeeSat: input.maxFeeSat ?? descriptor.maxFeeSat,
    nextOutputHash: input.nextOutputHash,
    outputForm: input.outputForm,
    rawOutput: input.rawOutput,
    outputBindingMode: descriptor.outputBindingMode,
  });
  const actualSummary = summarizeBondSettlementDescriptor(descriptor);
  const matches = validateBondSettlementMatchesExpected(descriptor, expected.descriptor);
  return {
    ok: actualSummary.hash === expected.hash,
    reason: actualSummary.hash === expected.hash ? undefined : "Bond settlement descriptor hash mismatch",
    descriptor,
    expected: expected.descriptor,
    hash: actualSummary.hash,
    expectedHash: expected.hash,
    matches,
    supportedForm: expected.expectedOutputBindingSupportedForm,
    reasonCode: expected.expectedOutputBindingReasonCode,
    autoDerivedNextOutputHash: expected.expectedOutputBindingAutoDerived,
    fallbackReason: expected.expectedOutputBindingFallbackReason,
    bindingInputs: expected.expectedOutputBindingInputs,
  };
}

export async function buildBondSettlementPayload(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat: number;
    maxFeeSat?: number;
    nextOutputHash?: string;
    outputForm?: {
      assetForm?: OutputAssetForm;
      amountForm?: OutputAmountForm;
      nonceForm?: OutputNonceForm;
      rangeProofForm?: OutputRangeProofForm;
    };
    rawOutput?: Partial<OutputRawFields>;
    outputBindingMode?: "none" | "script-bound" | "descriptor-bound";
  }
) {
  const result = await buildBondSettlementDescriptor(sdk, input);
  return {
    descriptor: result.descriptor,
    descriptorHash: result.hash,
    expectedOutputDescriptor: result.expectedOutputDescriptor,
    expectedOutputDescriptorHash: result.expectedOutputDescriptorHash,
    supportedForm: result.expectedOutputBindingSupportedForm,
    reasonCode: result.expectedOutputBindingReasonCode,
    autoDerivedNextOutputHash: result.expectedOutputBindingAutoDerived,
    fallbackReason: result.expectedOutputBindingFallbackReason,
    bindingInputs: result.expectedOutputBindingInputs,
    previousStateHash: result.descriptor.previousStateHash,
    nextStateHash: result.descriptor.nextStateHash,
    nextContractAddress: result.descriptor.nextContractAddress,
    nextAmountSat: result.descriptor.nextAmountSat,
    maxFeeSat: result.descriptor.maxFeeSat,
  };
}

export async function buildBondClosing(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    redeemedIssuancePath?: string;
    redeemedIssuanceValue?: BondIssuanceState;
    settlementDescriptorPath?: string;
    settlementDescriptorValue?: BondSettlementDescriptor;
    closedAt: string;
    closingReason?: "REDEEMED" | "CANCELLED" | "MATURED_OUT";
  },
) {
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const issuanceSource = resolveValueOrPath({
    pathValue: input.redeemedIssuancePath,
    objectValue: input.redeemedIssuanceValue,
  });
  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: input.definitionValue?.bondId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const issuanceDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.redeemedIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...issuanceSource,
  });
  const definition = validateBondDefinition(JSON.parse(definitionDescriptor.canonicalJson));
  const redeemed = validateBondIssuanceState(JSON.parse(issuanceDescriptor.canonicalJson));
  validateBondCrossChecks(definition, redeemed);
  const settlementVerification = await verifyBondSettlementDescriptor(sdk, {
    descriptorPath: input.settlementDescriptorPath,
    descriptorValue: input.settlementDescriptorValue,
    definitionValue: definition,
    previousIssuanceValue: undefined,
    nextIssuanceValue: redeemed,
    nextAmountSat: input.settlementDescriptorValue?.nextAmountSat,
    maxFeeSat: input.settlementDescriptorValue?.maxFeeSat,
  }).catch(() => undefined);
  const finalSettlementDescriptorHash = settlementVerification?.hash
    ?? (input.settlementDescriptorValue
      ? summarizeBondSettlementDescriptor(input.settlementDescriptorValue).hash
      : undefined);
  if (!finalSettlementDescriptorHash) {
    throw new Error("A valid settlement descriptor is required to build a closing state");
  }
  const closed = buildClosedBondIssuanceState({
    previous: redeemed,
    closedAt: input.closedAt,
    closingReason: input.closingReason ?? "REDEEMED",
    finalSettlementDescriptorHash,
  });
  const closing: BondClosingDescriptor = {
    closingId: `${closed.issuanceId}-CLOSE`,
    bondId: definition.bondId,
    issuanceId: closed.issuanceId,
    finalStatus: "CLOSED",
    definitionHash: definitionDescriptor.hash,
    previousStateHash: summarizeBondIssuanceState(redeemed).hash,
    closedStateHash: summarizeBondIssuanceState(closed).hash,
    stateHash: summarizeBondIssuanceState(closed).hash,
    closedAt: input.closedAt,
    closingReason: input.closingReason ?? "REDEEMED",
    finalSettlementDescriptorHash,
  };
  return {
    definition,
    previous: redeemed,
    closed,
    closing,
    closingHash: sha256HexUtf8(stableStringify(closing)),
  };
}

export async function verifyBondClosing(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    redeemedIssuancePath?: string;
    redeemedIssuanceValue?: BondIssuanceState;
    closedIssuancePath?: string;
    closedIssuanceValue?: BondIssuanceState;
    settlementDescriptorPath?: string;
    settlementDescriptorValue?: BondSettlementDescriptor;
    closingDescriptorValue?: BondClosingDescriptor;
  },
) {
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const redeemedSource = resolveValueOrPath({
    pathValue: input.redeemedIssuancePath,
    objectValue: input.redeemedIssuanceValue,
  });
  const closedSource = resolveValueOrPath({
    pathValue: input.closedIssuancePath,
    objectValue: input.closedIssuanceValue,
  });
  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: input.definitionValue?.bondId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const redeemedDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.redeemedIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...redeemedSource,
  });
  const closedDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.closedIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...closedSource,
  });
  const definition = validateBondDefinition(JSON.parse(definitionDescriptor.canonicalJson));
  const redeemed = validateBondIssuanceState(JSON.parse(redeemedDescriptor.canonicalJson));
  const closed = validateBondIssuanceState(JSON.parse(closedDescriptor.canonicalJson));
  validateBondCrossChecks(definition, redeemed);
  validateBondCrossChecks(definition, closed);
  const settlementHash =
    input.settlementDescriptorValue
      ? summarizeBondSettlementDescriptor(input.settlementDescriptorValue).hash
      : input.settlementDescriptorPath
        ? summarizeBondSettlementDescriptor(
            JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(input.settlementDescriptorPath!, "utf8"))),
          ).hash
        : "";
  const checks = {
    redeemedStateMatch: redeemed.status === "REDEEMED",
    closedStateMatch: closed.status === "CLOSED",
    previousStateHashMatch: closed.previousStateHash === summarizeBondIssuanceState(redeemed).hash,
    finalSettlementDescriptorHashMatch: closed.finalSettlementDescriptorHash === settlementHash,
    closingReasonPresent: !!closed.closingReason,
    closedAtPresent: !!closed.closedAt,
  };
  return {
    definition,
    redeemed,
    closed,
    checks,
    verified: Object.values(checks).every(Boolean),
  };
}

export async function buildEvidenceBundle(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    issuancePath?: string;
    issuanceValue?: BondIssuanceState;
    settlementDescriptorValue?: BondSettlementDescriptor;
    closingDescriptorValue?: BondClosingDescriptor;
    transitionValue?: unknown;
  },
): Promise<BondEvidenceBundle> {
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  if (!artifact) throw new Error("artifactPath or artifact is required");
  const verification = await verifyBond(sdk, {
    artifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    issuancePath: input.issuancePath,
    issuanceValue: input.issuanceValue,
  });
  const definition = verification.definition.definition;
  const issuance = verification.issuance.state;
  const settlementCanonicalJson = input.settlementDescriptorValue
    ? summarizeBondSettlementDescriptor(input.settlementDescriptorValue).canonicalJson
    : null;
  const settlementHash = input.settlementDescriptorValue
    ? summarizeBondSettlementDescriptor(input.settlementDescriptorValue).hash
    : null;
  const closingCanonicalJson = input.closingDescriptorValue
    ? stableStringify(input.closingDescriptorValue)
    : null;
  const closingHash = closingCanonicalJson
    ? sha256HexUtf8(closingCanonicalJson)
    : null;
  const sourcePath = artifact.source.mode === "file" ? artifact.source.simfPath : undefined;
  const renderedSourceHash = sourcePath && existsSync(sourcePath)
    ? sha256HexUtf8(await import("node:fs/promises").then((fs) => fs.readFile(sourcePath, "utf8")))
    : null;
  return {
    artifact,
    definition: {
      canonicalJson: definition.canonicalJson,
      hash: definition.hash,
    },
    issuance: {
      canonicalJson: issuance.canonicalJson,
      hash: issuance.hash,
    },
    transition: input.transitionValue
      ? {
          canonicalJson: stableStringify(input.transitionValue),
          hash: sha256HexUtf8(stableStringify(input.transitionValue)),
        }
      : undefined,
    settlement: settlementCanonicalJson && settlementHash
      ? {
          canonicalJson: settlementCanonicalJson,
          hash: settlementHash,
        }
      : undefined,
    closing: closingCanonicalJson && closingHash
      ? {
          canonicalJson: closingCanonicalJson,
          hash: closingHash,
        }
      : undefined,
    trust: {
      artifactTrust: {
        definition: verification.definition.trust,
        state: verification.issuance.trust,
      },
      stateTrust: verification.issuance.trust,
      settlementTrust: input.settlementDescriptorValue
        ? {
            descriptorHashMatch: true,
            outputBindingMode: input.settlementDescriptorValue.outputBindingMode ?? "none",
          }
        : undefined,
    },
    renderedSourceHash: renderedSourceHash ?? undefined,
    sourceVerificationMode: renderedSourceHash ? "source-reloaded" : "artifact-only",
    compiled: {
      program: artifact.compiled.program,
      cmr: artifact.compiled.cmr,
      contractAddress: artifact.compiled.contractAddress,
    },
  };
}

export async function verifyEvidenceBundle(
  sdk: SimplicityClient,
  input: {
    bundleValue: BondEvidenceBundle;
    definitionPath?: string;
    issuancePath?: string;
    settlementDescriptorValue?: BondSettlementDescriptor;
    closingDescriptorValue?: BondClosingDescriptor;
  },
) {
  const expected = await buildEvidenceBundle(sdk, {
    artifact: input.bundleValue.artifact,
    definitionPath: input.definitionPath,
    issuancePath: input.issuancePath,
    settlementDescriptorValue: input.settlementDescriptorValue,
    closingDescriptorValue: input.closingDescriptorValue,
  });
  const checks = {
    definitionHashMatch: input.bundleValue.definition.hash === expected.definition.hash,
    issuanceHashMatch: input.bundleValue.issuance.hash === expected.issuance.hash,
    settlementHashMatch:
      (input.bundleValue.settlement?.hash ?? null) === (expected.settlement?.hash ?? null),
    closingHashMatch:
      (input.bundleValue.closing?.hash ?? null) === (expected.closing?.hash ?? null),
    renderedSourceHashMatch: input.bundleValue.renderedSourceHash === expected.renderedSourceHash,
    cmrMatch: input.bundleValue.compiled.cmr === expected.compiled.cmr,
    contractAddressMatch: input.bundleValue.compiled.contractAddress === expected.compiled.contractAddress,
  };
  return {
    expected,
    checks,
    verified: Object.values(checks).every(Boolean),
  };
}

export async function issueBond(
  sdk: SimplicityClient,
  input: Parameters<typeof defineBond>[1],
) {
  return defineBond(sdk, input);
}

export async function prepareRedemption(
  sdk: SimplicityClient,
  input: Parameters<typeof buildBondSettlementPayload>[1] & { amount: number; redeemedAt: string },
) {
  const preview = await buildBondRedemption(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    amount: input.amount,
    redeemedAt: input.redeemedAt,
  });
  const settlement = await buildBondSettlementPayload(sdk, {
    definitionValue: preview.definition,
    previousIssuanceValue: preview.previous,
    nextIssuanceValue: preview.next,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat,
    maxFeeSat: input.maxFeeSat,
    nextOutputHash: input.nextOutputHash,
    rawOutput: input.rawOutput,
    outputBindingMode: input.outputBindingMode,
  });
  return { preview, settlement };
}

export async function finalizeRedemption(
  sdk: SimplicityClient,
  input: Parameters<typeof buildBondMachineSettlementPlan>[1],
) {
  return buildBondMachineSettlementPlan(sdk, input);
}

export async function prepareClosing(
  sdk: SimplicityClient,
  input: Parameters<typeof buildBondClosing>[1],
) {
  return buildBondClosing(sdk, input);
}

export async function exportFinalityPayload(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    issuancePath?: string;
    issuanceValue?: BondIssuanceState;
    settlementDescriptorValue?: BondSettlementDescriptor;
    closingDescriptorValue?: BondClosingDescriptor;
  },
) {
  const bondPayload = await buildBondPayload(sdk, input);
  const evidence = await buildEvidenceBundle(sdk, input);
  return {
    payload: bondPayload.payload,
    bindingMode: input.settlementDescriptorValue?.outputBindingMode ?? "none",
    trust: bondPayload.trust,
    trustSummary: {
      definition: bondPayload.trust.definitionTrust,
      issuance: bondPayload.trust.issuanceTrust,
      bindingMode: input.settlementDescriptorValue?.outputBindingMode ?? "none",
    },
    evidenceSummary: {
      definitionHash: evidence.definition.hash,
      issuanceHash: evidence.issuance.hash,
      settlementHash: evidence.settlement?.hash ?? null,
      closingHash: evidence.closing?.hash ?? null,
      renderedSourceHash: evidence.renderedSourceHash,
      sourceVerificationMode: evidence.sourceVerificationMode,
    },
  };
}

export async function define(
  sdk: SimplicityClient,
  input: Parameters<typeof defineBond>[1],
) {
  return defineBond(sdk, input);
}

export async function verify(
  sdk: SimplicityClient,
  input: Parameters<typeof verifyBond>[1],
) {
  return verifyBond(sdk, input);
}

export async function load(
  sdk: SimplicityClient,
  input: Parameters<typeof loadBond>[1],
) {
  return loadBond(sdk, input);
}

export async function issue(
  sdk: SimplicityClient,
  input: Parameters<typeof issueBond>[1],
) {
  return issueBond(sdk, input);
}

export async function buildSettlement(
  sdk: SimplicityClient,
  input: Parameters<typeof buildBondSettlementPayload>[1],
) {
  return buildBondSettlementPayload(sdk, input);
}

export async function verifySettlement(
  sdk: SimplicityClient,
  input: Parameters<typeof verifyBondSettlementDescriptor>[1],
) {
  return verifyBondSettlementDescriptor(sdk, input);
}

function resolveRedemptionBindingMode(settlement: {
  descriptor?: { outputBindingMode?: BondOutputBindingMode };
}): BondOutputBindingMode {
  return settlement.descriptor?.outputBindingMode ?? "none";
}

export async function inspectRedemption(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    machineSimfPath?: string;
    machineArtifactPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
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
  const settlement = await buildBondSettlementPayload(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat ?? 1900,
    maxFeeSat: input.maxFeeSat,
    nextOutputHash: input.nextOutputHash,
    outputForm: input.outputForm,
    rawOutput: input.rawOutput,
    outputBindingMode: input.outputBindingMode,
  });
  const mode = resolveRedemptionBindingMode(settlement);
  if (mode === "descriptor-bound") {
    const result = await inspectBondDescriptorBoundMachineRollover(sdk, {
      ...input,
      nextAmountSat: input.nextAmountSat,
      maxFeeSat: input.maxFeeSat,
      nextOutputHash: input.nextOutputHash,
    });
    return { mode, settlement, ...result };
  }
  if (mode === "script-bound") {
    const result = await inspectBondScriptBoundMachineRollover(sdk, {
      ...input,
      nextAmountSat: input.nextAmountSat,
      maxFeeSat: input.maxFeeSat,
    });
    return { mode, settlement, ...result };
  }
  const result = await inspectBondMachineRollover(sdk, input);
  return { mode, settlement, ...result };
}

export async function executeRedemption(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    machineSimfPath?: string;
    machineArtifactPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
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
    broadcast?: boolean;
  },
) {
  const settlement = await buildBondSettlementPayload(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat ?? 1900,
    maxFeeSat: input.maxFeeSat,
    nextOutputHash: input.nextOutputHash,
    outputForm: input.outputForm,
    rawOutput: input.rawOutput,
    outputBindingMode: input.outputBindingMode,
  });
  const mode = resolveRedemptionBindingMode(settlement);
  if (mode === "descriptor-bound") {
    const result = await executeBondDescriptorBoundMachineRollover(sdk, {
      ...input,
      nextAmountSat: input.nextAmountSat,
      maxFeeSat: input.maxFeeSat,
      nextOutputHash: input.nextOutputHash,
    });
    return { mode, settlement, ...result };
  }
  if (mode === "script-bound") {
    const result = await executeBondScriptBoundMachineRollover(sdk, {
      ...input,
      nextAmountSat: input.nextAmountSat,
      maxFeeSat: input.maxFeeSat,
    });
    return { mode, settlement, ...result };
  }
  const result = await executeBondMachineRollover(sdk, input);
  return { mode, settlement, ...result };
}

export async function verifyRedemption(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
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
    const settlement = await buildBondSettlementPayload(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat ?? 1900,
    maxFeeSat: input.maxFeeSat,
    nextOutputHash: input.nextOutputHash,
    outputForm: input.outputForm,
    rawOutput: input.rawOutput,
    outputBindingMode: input.outputBindingMode,
  });
  const mode = resolveRedemptionBindingMode(settlement);
  if (mode === "descriptor-bound") {
    const result = await verifyBondDescriptorBoundSettlementMachineArtifact(sdk, {
      ...input,
      nextAmountSat: input.nextAmountSat,
      maxFeeSat: input.maxFeeSat,
      nextOutputHash: input.nextOutputHash,
      outputForm: input.outputForm,
    });
    return { mode, settlement, ...result };
  }
  if (mode === "script-bound") {
    const result = await verifyBondScriptBoundSettlementMachineArtifact(sdk, {
      ...input,
      nextAmountSat: input.nextAmountSat,
      maxFeeSat: input.maxFeeSat,
      outputForm: input.outputForm,
    });
    return { mode, settlement, ...result };
  }
  const result = await verifyBondRedemptionMachineArtifact(sdk, {
    ...input,
    outputForm: input.outputForm,
  });
  return { mode, settlement, ...result };
}

export async function inspectClosing(
  sdk: SimplicityClient,
  input: Parameters<typeof inspectBondClosing>[1],
) {
  return inspectBondClosing(sdk, input);
}

export async function executeClosing(
  sdk: SimplicityClient,
  input: Parameters<typeof executeBondClosing>[1],
) {
  return executeBondClosing(sdk, input);
}

export async function verifyClosing(
  sdk: SimplicityClient,
  input: Parameters<typeof verifyBondClosing>[1],
) {
  return verifyBondClosing(sdk, input);
}

export async function exportEvidence(
  sdk: SimplicityClient,
  input: Parameters<typeof buildEvidenceBundle>[1],
) {
  return buildEvidenceBundle(sdk, input);
}

export async function compileBondTransition(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    simfPath?: string;
    artifactPath?: string;
  }
) {
  const transitionPayload = await buildBondTransitionPayload(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
  });

  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const nextSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });
  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: transitionPayload.definition.bondId,
    ...definitionSource,
  });
  const nextDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: transitionPayload.next.issuanceId,
    ...nextSource,
  });

  const simfPath =
    input.simfPath ?? resolveBondDocsAsset("bond-redemption-transition.simf");
  const rawSource = await import("node:fs/promises").then((fs) => fs.readFile(simfPath, "utf8"));
  const previousAnchor = detectPreviousStateAnchor(rawSource);
  if (!previousAnchor.sourceVerified) {
    throw new Error(`Transition contract source is missing required previous-state anchor pattern: ${previousAnchor.reason}`);
  }

  const compiled = await sdk.compileFromFile({
    simfPath,
    templateVars: {
      MIN_HEIGHT: transitionPayload.definition.maturityDate,
      SIGNER_XONLY: transitionPayload.definition.controllerXonly,
      PREVIOUS_STATE_HASH: transitionPayload.payload.previousStateHash,
    },
    definition: {
      type: definitionDescriptor.definitionType,
      id: definitionDescriptor.definitionId,
      schemaVersion: definitionDescriptor.schemaVersion,
      ...(definitionDescriptor.sourcePath ? { jsonPath: definitionDescriptor.sourcePath } : { value: transitionPayload.definition }),
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: nextDescriptor.stateType,
      id: nextDescriptor.stateId,
      schemaVersion: nextDescriptor.schemaVersion,
      ...(nextDescriptor.sourcePath ? { jsonPath: nextDescriptor.sourcePath } : { value: transitionPayload.next }),
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });

  return {
    compiled,
    previousHash: transitionPayload.payload.previousStateHash,
    nextHash: transitionPayload.payload.nextStateHash,
    transition: transitionPayload.payload.crossChecks.transition,
    payload: transitionPayload.payload,
  };
}

export async function verifyBondRedemptionMachineArtifact(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    nextOutputHash?: string;
    outputForm?: {
      assetForm?: OutputAssetForm;
      amountForm?: OutputAmountForm;
      nonceForm?: OutputNonceForm;
      rangeProofForm?: OutputRangeProofForm;
    };
    rawOutput?: Partial<OutputRawFields>;
    outputBindingMode?: BondOutputBindingMode;
  }
) {
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  if (!artifact) {
    throw new Error("artifactPath or artifact is required");
  }

  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const nextSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });

  const definitionVerification = await sdk.verifyDefinitionAgainstArtifact({
    artifact,
    type: "bond",
    id: artifact.definition?.definitionId,
    ...definitionSource,
  });
  const nextStateVerification = await sdk.verifyStateAgainstArtifact({
    artifact,
    type: "bond-issuance",
    id: artifact.state?.stateId,
    ...nextSource,
  });

  const expected = await buildBondTransitionPayload(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
  });

  const expectedNextCompiled = await defineBond(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: expected.definition,
    issuanceValue: expected.next,
    simfPath: input.nextStateSimfPath,
  });
  const expectedNextContractAddress = expectedNextCompiled.deployment().contractAddress;
  const expectedNextContractAddressHash = hashContractAddressToUint256Hex(expectedNextContractAddress);
  const expectedSettlement = await buildBondSettlementDescriptor(sdk, {
    definitionValue: expected.definition,
    previousIssuanceValue: expected.previous,
    nextIssuanceValue: expected.next,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat ?? 1900,
    maxFeeSat: input.maxFeeSat ?? 100,
    nextOutputHash: input.nextOutputHash,
    outputForm: input.outputForm,
    rawOutput: input.rawOutput,
    outputBindingMode: input.outputBindingMode,
  });

  const templateVars = artifact.source.templateVars ?? {};
  const committed = {
    previousStateHash: String(templateVars.PREVIOUS_STATE_HASH ?? ""),
    redeemAmount256: String(templateVars.REDEEM_AMOUNT_256 ?? ""),
    transitionKind256: String(templateVars.TRANSITION_KIND_256 ?? ""),
    redeemAmount32: String(templateVars.REDEEM_AMOUNT_32 ?? ""),
    previousStatus32: String(templateVars.PREVIOUS_STATUS_32 ?? ""),
    nextStatus32: String(templateVars.NEXT_STATUS_32 ?? ""),
    previousOutstanding32: String(templateVars.PREVIOUS_OUTSTANDING_32 ?? ""),
    previousRedeemed32: String(templateVars.PREVIOUS_REDEEMED_32 ?? ""),
    nextOutstanding32: String(templateVars.NEXT_OUTSTANDING_32 ?? ""),
    nextRedeemed32: String(templateVars.NEXT_REDEEMED_32 ?? ""),
    nextContractAddressHash256: String(templateVars.NEXT_CONTRACT_ADDRESS_HASH_256 ?? ""),
    expectedNextOutputHash256: String(templateVars.EXPECTED_NEXT_OUTPUT_HASH_256 ?? ""),
    expectedNextOutputScriptHash256: String(templateVars.EXPECTED_NEXT_OUTPUT_SCRIPT_HASH_256 ?? ""),
    settlementDescriptorHash256: String(templateVars.SETTLEMENT_DESCRIPTOR_HASH ?? ""),
    expectedOutputDescriptorHash256: String(templateVars.EXPECTED_OUTPUT_DESCRIPTOR_HASH ?? ""),
  };

  const checks = {
    previousStateHashCommitted: committed.previousStateHash === expected.payload.previousStateHash,
    redeemAmountCommitted:
      committed.redeemAmount256 === toUint256Hex(expected.payload.redeemAmount ?? 0)
      && committed.redeemAmount32 === toUint32Hex(expected.payload.redeemAmount ?? 0),
    transitionKindCommitted: committed.transitionKind256 === toUint256Hex(expected.payload.transitionKind === "REDEEM" ? 1 : 0),
    statusCodesCommitted:
      committed.previousStatus32 === toUint32Hex(expected.payload.previousStatusCode)
      && committed.nextStatus32 === toUint32Hex(expected.payload.nextStatusCode),
    principalArithmeticCommitted:
      committed.previousOutstanding32 === toUint32Hex(expected.payload.principal.previousOutstanding)
      && committed.previousRedeemed32 === toUint32Hex(expected.payload.principal.previousRedeemed)
      && committed.nextOutstanding32 === toUint32Hex(expected.payload.principal.nextOutstanding)
      && committed.nextRedeemed32 === toUint32Hex(expected.payload.principal.nextRedeemed),
    nextContractAddressCommitted: committed.nextContractAddressHash256 === expectedNextContractAddressHash,
    nextOutputHashCommitted:
      !expectedSettlement.expectedOutputDescriptor?.nextOutputHash
      || committed.expectedNextOutputHash256 === expectedSettlement.expectedOutputDescriptor.nextOutputHash,
    nextOutputScriptCommitted:
      !expectedSettlement.expectedOutputDescriptor?.nextOutputScriptHash
      || committed.expectedNextOutputScriptHash256
        === expectedSettlement.expectedOutputDescriptor.nextOutputScriptHash,
    settlementDescriptorCommitted: committed.settlementDescriptorHash256 === expectedSettlement.hash,
    expectedOutputDescriptorCommitted:
      !expectedSettlement.expectedOutputDescriptorHash
      || committed.expectedOutputDescriptorHash256 === expectedSettlement.expectedOutputDescriptorHash,
  };
  const allChecks = Object.values(checks).every(Boolean);
  return {
    artifact,
    definition: definitionVerification,
    issuance: nextStateVerification,
    expectedPayload: {
      ...expected.payload,
      nextStateContractAddress: expectedNextContractAddress,
      nextStateContractAddressHash: expectedNextContractAddressHash,
    },
    expectedSettlementDescriptor: expectedSettlement.descriptor,
    expectedSettlementDescriptorHash: expectedSettlement.hash,
    outputBindingMetadata: {
      requestedMode:
        expectedSettlement.expectedOutputDescriptor?.requestedOutputBindingMode
        ?? expectedSettlement.descriptor.outputBindingMode
        ?? "none",
      supportedForm: expectedSettlement.expectedOutputBindingSupportedForm,
      reasonCode: expectedSettlement.expectedOutputBindingReasonCode,
      autoDerived: expectedSettlement.expectedOutputBindingAutoDerived,
      fallbackReason: expectedSettlement.expectedOutputBindingFallbackReason,
      bindingInputs: expectedSettlement.expectedOutputBindingInputs,
    },
    expectedNextContractAddress,
    expectedNextContractAddressHash,
    committed,
    checks,
    verified:
      definitionVerification.ok
      && nextStateVerification.ok
      && definitionVerification.trust.onChainAnchorVerified
      && nextStateVerification.trust.onChainAnchorVerified
      && allChecks,
  };
}

export async function compileBondRedemptionMachine(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    nextOutputHash?: string;
    outputForm?: {
      assetForm?: OutputAssetForm;
      amountForm?: OutputAmountForm;
      nonceForm?: OutputNonceForm;
      rangeProofForm?: OutputRangeProofForm;
    };
    rawOutput?: Partial<OutputRawFields>;
    outputBindingMode?: BondOutputBindingMode;
    expectedOutputDescriptorHash?: string;
    simfPath?: string;
    artifactPath?: string;
  }
) {
  const transitionResult = await compileBondTransition(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
  });

  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const nextSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });

  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: transitionResult.compiled.definition()?.definitionId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const nextDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: transitionResult.compiled.state()?.stateId ?? "BOND-2026-001-ISSUE-1",
    ...nextSource,
  });
  const definition = validateBondDefinition(JSON.parse(definitionDescriptor.canonicalJson));
  const next = validateBondIssuanceState(JSON.parse(nextDescriptor.canonicalJson));

  const nextStateCompiled = await defineBond(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: definition,
    issuanceValue: next,
    simfPath: input.nextStateSimfPath,
  });
  const nextStateContractAddress = nextStateCompiled.deployment().contractAddress;
  const nextStateContractAddressHash = hashContractAddressToUint256Hex(nextStateContractAddress);
  const settlementDescriptor = await buildBondSettlementDescriptor(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue ?? definition,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue ?? next,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat ?? 1900,
    maxFeeSat: input.maxFeeSat ?? 100,
    nextOutputHash: input.nextOutputHash,
    outputForm: input.outputForm,
    rawOutput: input.rawOutput,
    outputBindingMode: input.outputBindingMode,
  });

  const simfPath =
    input.simfPath ?? resolveBondDocsAsset("bond-redemption-state-machine.simf");

  const compiled = await sdk.compileFromFile({
    simfPath,
    templateVars: {
      MIN_HEIGHT: definition.maturityDate,
      SIGNER_XONLY: definition.controllerXonly,
      PREVIOUS_STATE_HASH: transitionResult.previousHash,
      REDEEM_AMOUNT_256: toUint256Hex(next.lastTransition?.amount ?? 0),
      TRANSITION_KIND_256: toUint256Hex(1),
      REDEEM_AMOUNT_32: toUint32Hex(next.lastTransition?.amount ?? 0),
      PREVIOUS_STATUS_32: toUint32Hex(bondStatusToCode(transitionResult.payload.previousStatus)),
      NEXT_STATUS_32: toUint32Hex(bondStatusToCode(transitionResult.payload.nextStatus)),
      PREVIOUS_OUTSTANDING_32: toUint32Hex(transitionResult.payload.principal.previousOutstanding),
      PREVIOUS_REDEEMED_32: toUint32Hex(transitionResult.payload.principal.previousRedeemed),
      NEXT_OUTSTANDING_32: toUint32Hex(transitionResult.payload.principal.nextOutstanding),
      NEXT_REDEEMED_32: toUint32Hex(transitionResult.payload.principal.nextRedeemed),
      NEXT_CONTRACT_ADDRESS_HASH_256: nextStateContractAddressHash,
      SETTLEMENT_DESCRIPTOR_HASH: settlementDescriptor.hash,
      ...(input.expectedOutputDescriptorHash
        ? { EXPECTED_OUTPUT_DESCRIPTOR_HASH: input.expectedOutputDescriptorHash }
        : {}),
      ...(settlementDescriptor.expectedOutputDescriptor?.nextOutputHash
        ? { EXPECTED_NEXT_OUTPUT_HASH_256: settlementDescriptor.expectedOutputDescriptor.nextOutputHash }
        : {}),
      ...(settlementDescriptor.expectedOutputDescriptor?.nextOutputScriptHash
        ? { EXPECTED_NEXT_OUTPUT_SCRIPT_HASH_256: settlementDescriptor.expectedOutputDescriptor.nextOutputScriptHash }
        : {}),
    },
    definition: {
      type: definitionDescriptor.definitionType,
      id: definitionDescriptor.definitionId,
      schemaVersion: definitionDescriptor.schemaVersion,
      ...(definitionDescriptor.sourcePath ? { jsonPath: definitionDescriptor.sourcePath } : { value: definition }),
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: nextDescriptor.stateType,
      id: nextDescriptor.stateId,
      schemaVersion: nextDescriptor.schemaVersion,
      ...(nextDescriptor.sourcePath ? { jsonPath: nextDescriptor.sourcePath } : { value: next }),
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });

  return {
    compiled,
    previousHash: transitionResult.previousHash,
    nextHash: transitionResult.nextHash,
    transition: transitionResult.transition,
    redeemAmount: next.lastTransition?.amount ?? 0,
    transitionKind: "REDEEM" as const,
    nextStateContractAddress,
    nextStateContractAddressHash,
    settlementDescriptor: settlementDescriptor.descriptor,
    settlementDescriptorHash: settlementDescriptor.hash,
    payload: {
      ...transitionResult.payload,
      transitionKind: "REDEEM" as const,
      redeemAmount: next.lastTransition?.amount ?? 0,
      previousStatusCode: bondStatusToCode(transitionResult.payload.previousStatus),
      nextStatusCode: bondStatusToCode(transitionResult.payload.nextStatus),
      contractAddress: compiled.artifact.compiled.contractAddress,
      cmr: compiled.artifact.compiled.cmr,
      anchorModes: {
        definition: compiled.artifact.definition?.anchorMode ?? "none",
        state: compiled.artifact.state?.anchorMode ?? "none",
      },
      nextStateContractAddress,
      nextStateContractAddressHash,
      settlementDescriptor: settlementDescriptor.descriptor,
      settlementDescriptorHash: settlementDescriptor.hash,
      outputBindingMode: settlementDescriptor.descriptor.outputBindingMode ?? "none",
    },
  };
}

export async function compileBondScriptBoundSettlementMachine(
  sdk: SimplicityClient,
  input: Parameters<typeof compileBondRedemptionMachine>[1],
) {
  const settlement = await buildBondSettlementDescriptor(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat ?? 1900,
    maxFeeSat: input.maxFeeSat ?? 100,
    rawOutput: input.rawOutput,
    outputBindingMode: "script-bound",
  });
  const base = await compileBondRedemptionMachine(sdk, {
    ...input,
    outputBindingMode: "script-bound",
    expectedOutputDescriptorHash: settlement.expectedOutputDescriptorHash,
    simfPath: input.simfPath ?? resolveBondDocsAsset("bond-script-bound-settlement-machine.simf"),
  });
  return {
    ...base,
    expectedOutputDescriptor: settlement.expectedOutputDescriptor,
    expectedOutputDescriptorHash: settlement.expectedOutputDescriptorHash,
    outputBindingMode: "script-bound" as const,
  };
}

export async function verifyBondScriptBoundSettlementMachineArtifact(
  sdk: SimplicityClient,
  input: Parameters<typeof verifyBondRedemptionMachineArtifact>[1],
) {
  const base = await verifyBondRedemptionMachineArtifact(sdk, {
    ...input,
    outputBindingMode: "script-bound",
  });
  return {
    ...base,
    outputBindingTrust: {
      mode: "script-bound" as const,
      requestedMode: base.outputBindingMetadata.requestedMode,
      supportedForm: base.outputBindingMetadata.supportedForm,
      outputCountRuntimeBound: true,
      feeIndexRuntimeBound: true,
      settlementDescriptorCommitted: base.checks.settlementDescriptorCommitted,
      nextContractAddressCommitted: base.checks.nextContractAddressCommitted,
      nextOutputHashRuntimeBound: false,
      nextOutputScriptRuntimeBound: true,
      amountRuntimeBound: false,
      reasonCode: base.outputBindingMetadata.reasonCode,
      autoDerived: base.outputBindingMetadata.autoDerived,
      fallbackReason: base.outputBindingMetadata.fallbackReason,
      bindingInputs: base.outputBindingMetadata.bindingInputs,
    },
  };
}

export async function compileBondDescriptorBoundSettlementMachine(
  sdk: SimplicityClient,
  input: Parameters<typeof compileBondRedemptionMachine>[1],
) {
  const settlement = await buildBondSettlementDescriptor(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat ?? 1900,
    maxFeeSat: input.maxFeeSat ?? 100,
    nextOutputHash: input.nextOutputHash,
    rawOutput: input.rawOutput,
    outputBindingMode: "descriptor-bound",
  });
  if (settlement.descriptor.outputBindingMode !== "descriptor-bound") {
    const fallback = await compileBondScriptBoundSettlementMachine(sdk, input);
    return {
      ...fallback,
      requestedOutputBindingMode: "descriptor-bound" as const,
      outputBindingMode: fallback.outputBindingMode,
    };
  }
  const base = await compileBondRedemptionMachine(sdk, {
    ...input,
    nextOutputHash: settlement.expectedOutputDescriptor?.nextOutputHash,
    outputBindingMode: "descriptor-bound",
    expectedOutputDescriptorHash: settlement.expectedOutputDescriptorHash,
    simfPath: input.simfPath ?? resolveBondDocsAsset("bond-descriptor-bound-settlement-machine.simf"),
  });
  return {
    ...base,
    expectedOutputDescriptor: settlement.expectedOutputDescriptor,
    expectedOutputDescriptorHash: settlement.expectedOutputDescriptorHash,
    requestedOutputBindingMode: "descriptor-bound" as const,
    outputBindingMode: "descriptor-bound" as const,
  };
}

export async function verifyBondDescriptorBoundSettlementMachineArtifact(
  sdk: SimplicityClient,
  input: Parameters<typeof verifyBondRedemptionMachineArtifact>[1],
) {
  const base = await verifyBondRedemptionMachineArtifact(sdk, {
    ...input,
    outputBindingMode: "descriptor-bound",
  });
  const mode =
    base.expectedSettlementDescriptor.outputBindingMode === "descriptor-bound" && base.checks.nextOutputHashCommitted
      ? "descriptor-bound"
      : "script-bound";
  return {
    ...base,
    outputBindingTrust: {
      mode,
      requestedMode: base.outputBindingMetadata.requestedMode,
      supportedForm: base.outputBindingMetadata.supportedForm,
      outputCountRuntimeBound: true,
      feeIndexRuntimeBound: true,
      settlementDescriptorCommitted: base.checks.settlementDescriptorCommitted,
      nextContractAddressCommitted: base.checks.nextContractAddressCommitted,
      nextOutputHashRuntimeBound: mode === "descriptor-bound",
      nextOutputScriptRuntimeBound: mode !== "descriptor-bound",
      amountRuntimeBound: false,
      reasonCode: base.outputBindingMetadata.reasonCode,
      autoDerived: base.outputBindingMetadata.autoDerived,
      fallbackReason: base.outputBindingMetadata.fallbackReason,
      bindingInputs: base.outputBindingMetadata.bindingInputs,
    },
  };
}

export async function compileBondClosingMachine(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    redeemedIssuancePath?: string;
    redeemedIssuanceValue?: BondIssuanceState;
    settlementDescriptorPath?: string;
    settlementDescriptorValue?: BondSettlementDescriptor;
    closedAt: string;
    closingReason?: "REDEEMED" | "CANCELLED" | "MATURED_OUT";
    simfPath?: string;
    artifactPath?: string;
  },
) {
  const closing = await buildBondClosing(sdk, input);
  const result = await defineBond(sdk, {
    definitionValue: closing.definition,
    issuanceValue: closing.closed,
    simfPath: input.simfPath ?? resolveBondDocsAsset("bond-issuance-anchor.simf"),
    artifactPath: input.artifactPath,
  });
  return {
    compiled: result,
    closing: closing.closing,
    closingHash: closing.closingHash,
    closedState: closing.closed,
  };
}

export async function buildBondRedemption(
  sdk: SimplicityClient,
  input: {
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    amount: number;
    redeemedAt: string;
  }
) {
  const definitionSource = resolveValueOrPath({
    pathValue: input.definitionPath,
    objectValue: input.definitionValue,
  });
  const previousSource = resolveValueOrPath({
    pathValue: input.previousIssuancePath,
    objectValue: input.previousIssuanceValue,
  });

  const definitionDescriptor = await sdk.loadDefinition({
    type: "bond",
    id: input.definitionValue?.bondId ?? "BOND-2026-001",
    ...definitionSource,
  });
  const previousDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.previousIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...previousSource,
  });
  const definition = validateBondDefinition(JSON.parse(definitionDescriptor.canonicalJson));
  const previous = validateBondIssuanceState(JSON.parse(previousDescriptor.canonicalJson));
  validateBondCrossChecks(definition, previous);
  const next = buildRedeemedBondIssuanceState({
    previous,
    amount: input.amount,
    redeemedAt: input.redeemedAt,
  });
  const transition = validateBondStateTransition(previous, next);
  return {
    definition,
    previous,
    next,
    previousHash: previousDescriptor.hash,
    nextHash: summarizeBondIssuanceState(next).hash,
    transition,
  };
}

export async function verifyBondTransition(
  sdk: SimplicityClient,
  input: {
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
  }
) {
  const previousSource = resolveValueOrPath({
    pathValue: input.previousIssuancePath,
    objectValue: input.previousIssuanceValue,
  });
  const nextSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });
  const previousDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.previousIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...previousSource,
  });
  const nextDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.nextIssuanceValue?.issuanceId ?? "BOND-2026-001-ISSUE-1",
    ...nextSource,
  });
  const previous = validateBondIssuanceState(JSON.parse(previousDescriptor.canonicalJson));
  const next = validateBondIssuanceState(JSON.parse(nextDescriptor.canonicalJson));
  const transition = validateBondStateTransition(previous, next);
  return {
    previous,
    next,
    previousHash: previousDescriptor.hash,
    nextHash: nextDescriptor.hash,
    transition,
  };
}

export async function buildBondRolloverPlan(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
  }
) {
  const currentArtifact =
    input.currentArtifact
    ?? (input.currentArtifactPath ? (await sdk.loadArtifact(input.currentArtifactPath)).artifact : undefined);
  if (!currentArtifact) {
    throw new Error("currentArtifactPath or currentArtifact is required");
  }

  const currentVerification = await verifyBond(sdk, {
    artifact: currentArtifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    issuancePath: input.previousIssuancePath,
    issuanceValue: input.previousIssuanceValue,
  });

  const definitionValue = validateBondDefinition(JSON.parse(currentVerification.definition.definition.canonicalJson));
  const nextIssuanceSource = resolveValueOrPath({
    pathValue: input.nextIssuancePath,
    objectValue: input.nextIssuanceValue,
  });
  const nextInitialStateDescriptor = await sdk.loadStateDocument({
    type: "bond-issuance",
    id: input.nextIssuanceValue?.issuanceId ?? currentArtifact.state?.stateId ?? "BOND-2026-001-ISSUE-1",
    ...nextIssuanceSource,
  });
  const nextIssuance = validateBondIssuanceState(JSON.parse(nextInitialStateDescriptor.canonicalJson));
  validateBondCrossChecks(definitionValue, nextIssuance);

  const transitionPayload = await buildBondTransitionPayload(sdk, {
    definitionPath: input.definitionPath,
    definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: currentVerification.issuance
      ? validateBondIssuanceState(JSON.parse(currentVerification.issuance.state.canonicalJson))
      : input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: nextIssuance,
  });

  const nextCompiled = await defineBond(sdk, {
    definitionPath: input.definitionPath,
    definitionValue,
    issuanceValue: nextIssuance,
    simfPath: input.nextSimfPath,
    artifactPath: input.nextArtifactPath,
  });

  return {
    currentArtifact,
    currentVerification,
    nextCompiled,
    nextContractAddress: nextCompiled.deployment().contractAddress,
    transitionPayload: transitionPayload.payload,
  };
}

export async function buildBondMachineRolloverPlan(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    machineSimfPath?: string;
    machineArtifactPath?: string;
  }
) {
  const currentArtifact =
    input.currentArtifact
    ?? (input.currentArtifactPath ? (await sdk.loadArtifact(input.currentArtifactPath)).artifact : undefined);
  if (!currentArtifact) {
    throw new Error("currentArtifactPath or currentArtifact is required");
  }

  const currentVerification = await verifyBond(sdk, {
    artifact: currentArtifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    issuancePath: input.previousIssuancePath,
    issuanceValue: input.previousIssuanceValue,
  });

  const machineCompiled = await compileBondRedemptionMachine(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    simfPath: input.machineSimfPath,
    artifactPath: input.machineArtifactPath,
  });

  const machineVerification = await verifyBondRedemptionMachineArtifact(sdk, {
    artifact: machineCompiled.compiled.artifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
  });

  return {
    currentArtifact,
    currentVerification,
    machineCompiled,
    machineVerification,
    nextContractAddress: machineCompiled.compiled.deployment().contractAddress,
    transitionPayload: machineCompiled.payload,
  };
}

export async function buildBondScriptBoundMachineRolloverPlan(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    machineSimfPath?: string;
    machineArtifactPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
  }
) {
  const currentArtifact =
    input.currentArtifact
    ?? (input.currentArtifactPath ? (await sdk.loadArtifact(input.currentArtifactPath)).artifact : undefined);
  if (!currentArtifact) {
    throw new Error("currentArtifactPath or currentArtifact is required");
  }

  const currentVerification = await verifyBond(sdk, {
    artifact: currentArtifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    issuancePath: input.previousIssuancePath,
    issuanceValue: input.previousIssuanceValue,
  });

  const machineCompiled = await compileBondScriptBoundSettlementMachine(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat,
    maxFeeSat: input.maxFeeSat,
    simfPath: input.machineSimfPath,
    artifactPath: input.machineArtifactPath,
  });

  const machineVerification = await verifyBondScriptBoundSettlementMachineArtifact(sdk, {
    artifact: machineCompiled.compiled.artifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat,
    maxFeeSat: input.maxFeeSat,
  });

  return {
    currentArtifact,
    currentVerification,
    machineCompiled,
    machineVerification,
    nextContractAddress: machineCompiled.compiled.deployment().contractAddress,
    transitionPayload: machineCompiled.payload,
  };
}

export async function buildBondDescriptorBoundMachineRolloverPlan(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextStateSimfPath?: string;
    machineSimfPath?: string;
    machineArtifactPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    nextOutputHash?: string;
  }
) {
  const currentArtifact =
    input.currentArtifact
    ?? (input.currentArtifactPath ? (await sdk.loadArtifact(input.currentArtifactPath)).artifact : undefined);
  if (!currentArtifact) {
    throw new Error("currentArtifactPath or currentArtifact is required");
  }

  const currentVerification = await verifyBond(sdk, {
    artifact: currentArtifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    issuancePath: input.previousIssuancePath,
    issuanceValue: input.previousIssuanceValue,
  });

  const machineCompiled = await compileBondDescriptorBoundSettlementMachine(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat,
    maxFeeSat: input.maxFeeSat,
    nextOutputHash: input.nextOutputHash,
    simfPath: input.machineSimfPath,
    artifactPath: input.machineArtifactPath,
  });

  const machineVerification = await verifyBondDescriptorBoundSettlementMachineArtifact(sdk, {
    artifact: machineCompiled.compiled.artifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextStateSimfPath,
    nextAmountSat: input.nextAmountSat,
    maxFeeSat: input.maxFeeSat,
    nextOutputHash: input.nextOutputHash,
  });

  return {
    currentArtifact,
    currentVerification,
    machineCompiled,
    machineVerification,
    nextContractAddress: machineCompiled.compiled.deployment().contractAddress,
    transitionPayload: machineCompiled.payload,
  };
}

export async function buildBondMachineSettlementPlan(
  sdk: SimplicityClient,
  input: {
    currentMachineArtifactPath?: string;
    currentMachineArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
  }
) {
  const currentMachineArtifact =
    input.currentMachineArtifact
    ?? (input.currentMachineArtifactPath ? (await sdk.loadArtifact(input.currentMachineArtifactPath)).artifact : undefined);
  if (!currentMachineArtifact) {
    throw new Error("currentMachineArtifactPath or currentMachineArtifact is required");
  }

  const machineVerification = await verifyBondRedemptionMachineArtifact(sdk, {
    artifact: currentMachineArtifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextSimfPath,
  });

  const definitionValue = validateBondDefinition(JSON.parse(machineVerification.definition.definition.canonicalJson));
  const nextStateValue = validateBondIssuanceState(JSON.parse(machineVerification.issuance.state.canonicalJson));

  const nextCompiled = await defineBond(sdk, {
    definitionPath: input.definitionPath,
    definitionValue,
    issuanceValue: nextStateValue,
    simfPath: input.nextSimfPath,
    artifactPath: input.nextArtifactPath,
  });

  return {
    currentMachineArtifact,
    machineVerification,
    nextCompiled,
    nextContractAddress: nextCompiled.deployment().contractAddress,
    transitionPayload: machineVerification.expectedPayload,
    nextContractAddressMatchesMachineCommitment:
      nextCompiled.deployment().contractAddress === machineVerification.expectedNextContractAddress,
  };
}

export async function buildBondScriptBoundMachineSettlementPlan(
  sdk: SimplicityClient,
  input: {
    currentMachineArtifactPath?: string;
    currentMachineArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
  }
) {
  const currentMachineArtifact =
    input.currentMachineArtifact
    ?? (input.currentMachineArtifactPath ? (await sdk.loadArtifact(input.currentMachineArtifactPath)).artifact : undefined);
  if (!currentMachineArtifact) {
    throw new Error("currentMachineArtifactPath or currentMachineArtifact is required");
  }

  const machineVerification = await verifyBondScriptBoundSettlementMachineArtifact(sdk, {
    artifact: currentMachineArtifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextSimfPath,
    nextAmountSat: input.nextAmountSat,
    maxFeeSat: input.maxFeeSat,
  });

  const definitionValue = validateBondDefinition(JSON.parse(machineVerification.definition.definition.canonicalJson));
  const nextStateValue = validateBondIssuanceState(JSON.parse(machineVerification.issuance.state.canonicalJson));

  const nextCompiled = await defineBond(sdk, {
    definitionPath: input.definitionPath,
    definitionValue,
    issuanceValue: nextStateValue,
    simfPath: input.nextSimfPath,
    artifactPath: input.nextArtifactPath,
  });

  return {
    currentMachineArtifact,
    machineVerification,
    nextCompiled,
    nextContractAddress: nextCompiled.deployment().contractAddress,
    transitionPayload: machineVerification.expectedPayload,
    nextContractAddressMatchesMachineCommitment:
      nextCompiled.deployment().contractAddress === machineVerification.expectedNextContractAddress,
  };
}

export async function buildBondDescriptorBoundMachineSettlementPlan(
  sdk: SimplicityClient,
  input: {
    currentMachineArtifactPath?: string;
    currentMachineArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    nextOutputHash?: string;
  }
) {
  const currentMachineArtifact =
    input.currentMachineArtifact
    ?? (input.currentMachineArtifactPath ? (await sdk.loadArtifact(input.currentMachineArtifactPath)).artifact : undefined);
  if (!currentMachineArtifact) {
    throw new Error("currentMachineArtifactPath or currentMachineArtifact is required");
  }

  const machineVerification = await verifyBondDescriptorBoundSettlementMachineArtifact(sdk, {
    artifact: currentMachineArtifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    previousIssuancePath: input.previousIssuancePath,
    previousIssuanceValue: input.previousIssuanceValue,
    nextIssuancePath: input.nextIssuancePath,
    nextIssuanceValue: input.nextIssuanceValue,
    nextStateSimfPath: input.nextSimfPath,
    nextAmountSat: input.nextAmountSat,
    maxFeeSat: input.maxFeeSat,
    nextOutputHash: input.nextOutputHash,
  });

  const definitionValue = validateBondDefinition(JSON.parse(machineVerification.definition.definition.canonicalJson));
  const nextStateValue = validateBondIssuanceState(JSON.parse(machineVerification.issuance.state.canonicalJson));

  const nextCompiled = await defineBond(sdk, {
    definitionPath: input.definitionPath,
    definitionValue,
    issuanceValue: nextStateValue,
    simfPath: input.nextSimfPath,
    artifactPath: input.nextArtifactPath,
  });

  return {
    currentMachineArtifact,
    machineVerification,
    nextCompiled,
    nextContractAddress: nextCompiled.deployment().contractAddress,
    transitionPayload: machineVerification.expectedPayload,
    nextContractAddressMatchesMachineCommitment:
      nextCompiled.deployment().contractAddress === machineVerification.expectedNextContractAddress,
  };
}

export async function inspectBondStateRollover(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  }
) {
  const plan = await buildBondRolloverPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
  });
  return { plan, inspect };
}

export async function inspectBondMachineRollover(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    machineSimfPath?: string;
    machineArtifactPath?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  }
) {
  const plan = await buildBondMachineRolloverPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
  });
  return { plan, inspect };
}

export async function inspectBondScriptBoundMachineRollover(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    machineSimfPath?: string;
    machineArtifactPath?: string;
    nextStateSimfPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  }
) {
  const plan = await buildBondScriptBoundMachineRolloverPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
  });
  return { plan, inspect };
}

export async function inspectBondDescriptorBoundMachineRollover(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    machineSimfPath?: string;
    machineArtifactPath?: string;
    nextStateSimfPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    nextOutputHash?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  }
) {
  const plan = await buildBondDescriptorBoundMachineRolloverPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
  });
  return { plan, inspect };
}

export async function inspectBondMachineSettlement(
  sdk: SimplicityClient,
  input: {
    currentMachineArtifactPath?: string;
    currentMachineArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  }
) {
  const plan = await buildBondMachineSettlementPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentMachineArtifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
  });
  return { plan, inspect };
}

export async function inspectBondScriptBoundMachineSettlement(
  sdk: SimplicityClient,
  input: {
    currentMachineArtifactPath?: string;
    currentMachineArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  }
) {
  const plan = await buildBondScriptBoundMachineSettlementPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentMachineArtifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
  });
  return { plan, inspect };
}

export async function inspectBondDescriptorBoundMachineSettlement(
  sdk: SimplicityClient,
  input: {
    currentMachineArtifactPath?: string;
    currentMachineArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    nextOutputHash?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  }
) {
  const plan = await buildBondDescriptorBoundMachineSettlementPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentMachineArtifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
  });
  return { plan, inspect };
}

export async function buildBondClosingPlan(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    redeemedIssuancePath?: string;
    redeemedIssuanceValue?: BondIssuanceState;
    settlementDescriptorPath?: string;
    settlementDescriptorValue?: BondSettlementDescriptor;
    closedIssuanceSimfPath?: string;
    closingArtifactPath?: string;
    closedAt: string;
    closingReason?: "REDEEMED" | "CANCELLED" | "MATURED_OUT";
  }
) {
  const currentArtifact =
    input.currentArtifact
    ?? (input.currentArtifactPath ? (await sdk.loadArtifact(input.currentArtifactPath)).artifact : undefined);
  if (!currentArtifact) {
    throw new Error("currentArtifactPath or currentArtifact is required");
  }

  const currentVerification = await verifyBond(sdk, {
    artifact: currentArtifact,
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    issuancePath: input.redeemedIssuancePath,
    issuanceValue: input.redeemedIssuanceValue,
  });

  const closingCompiled = await compileBondClosingMachine(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    redeemedIssuancePath: input.redeemedIssuancePath,
    redeemedIssuanceValue: input.redeemedIssuanceValue,
    settlementDescriptorPath: input.settlementDescriptorPath,
    settlementDescriptorValue: input.settlementDescriptorValue,
    closedAt: input.closedAt,
    closingReason: input.closingReason,
    simfPath: input.closedIssuanceSimfPath,
    artifactPath: input.closingArtifactPath,
  });

  const closingVerification = await verifyBondClosing(sdk, {
    definitionPath: input.definitionPath,
    definitionValue: input.definitionValue,
    redeemedIssuancePath: input.redeemedIssuancePath,
    redeemedIssuanceValue: input.redeemedIssuanceValue,
    closedIssuanceValue: closingCompiled.closedState,
    settlementDescriptorPath: input.settlementDescriptorPath,
    settlementDescriptorValue: input.settlementDescriptorValue,
    closingDescriptorValue: closingCompiled.closing,
  });

  return {
    currentArtifact,
    currentVerification,
    closingCompiled,
    closingVerification,
    nextContractAddress: closingCompiled.compiled.deployment().contractAddress,
    closingDescriptor: closingCompiled.closing,
    closingHash: closingCompiled.closingHash,
    closedState: closingCompiled.closedState,
  };
}

export async function executeBondStateRollover(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
    broadcast?: boolean;
  }
) {
  const plan = await buildBondRolloverPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
  });
  return { plan, execution };
}

export async function executeBondMachineRollover(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    machineSimfPath?: string;
    machineArtifactPath?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
    broadcast?: boolean;
  }
) {
  const plan = await buildBondMachineRolloverPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
  });
  return { plan, execution };
}

export async function executeBondScriptBoundMachineRollover(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    machineSimfPath?: string;
    machineArtifactPath?: string;
    nextStateSimfPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
    broadcast?: boolean;
  }
) {
  const plan = await buildBondScriptBoundMachineRolloverPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
  });
  return { plan, execution };
}

export async function executeBondDescriptorBoundMachineRollover(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    machineSimfPath?: string;
    machineArtifactPath?: string;
    nextStateSimfPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    nextOutputHash?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
    broadcast?: boolean;
  }
) {
  const plan = await buildBondDescriptorBoundMachineRolloverPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
  });
  return { plan, execution };
}

export async function executeBondMachineSettlement(
  sdk: SimplicityClient,
  input: {
    currentMachineArtifactPath?: string;
    currentMachineArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
    broadcast?: boolean;
  }
) {
  const plan = await buildBondMachineSettlementPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentMachineArtifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
  });
  return { plan, execution };
}

export async function executeBondScriptBoundMachineSettlement(
  sdk: SimplicityClient,
  input: {
    currentMachineArtifactPath?: string;
    currentMachineArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
    broadcast?: boolean;
  }
) {
  const plan = await buildBondScriptBoundMachineSettlementPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentMachineArtifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
  });
  return { plan, execution };
}

export async function executeBondDescriptorBoundMachineSettlement(
  sdk: SimplicityClient,
  input: {
    currentMachineArtifactPath?: string;
    currentMachineArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    previousIssuancePath?: string;
    previousIssuanceValue?: BondIssuanceState;
    nextIssuancePath?: string;
    nextIssuanceValue?: BondIssuanceState;
    nextSimfPath?: string;
    nextArtifactPath?: string;
    nextAmountSat?: number;
    maxFeeSat?: number;
    nextOutputHash?: string;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
    broadcast?: boolean;
  }
) {
  const plan = await buildBondDescriptorBoundMachineSettlementPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentMachineArtifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
  });
  return { plan, execution };
}

export async function inspectBondClosing(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    redeemedIssuancePath?: string;
    redeemedIssuanceValue?: BondIssuanceState;
    settlementDescriptorPath?: string;
    settlementDescriptorValue?: BondSettlementDescriptor;
    closedIssuanceSimfPath?: string;
    closingArtifactPath?: string;
    closedAt: string;
    closingReason?: "REDEEMED" | "CANCELLED" | "MATURED_OUT";
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  }
) {
  const plan = await buildBondClosingPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const inspect = await contract.inspectCall({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
  });
  return { plan, inspect };
}

export async function executeBondClosing(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    definitionPath?: string;
    definitionValue?: BondDefinition;
    redeemedIssuancePath?: string;
    redeemedIssuanceValue?: BondIssuanceState;
    settlementDescriptorPath?: string;
    settlementDescriptorValue?: BondSettlementDescriptor;
    closedIssuanceSimfPath?: string;
    closingArtifactPath?: string;
    closedAt: string;
    closingReason?: "REDEEMED" | "CANCELLED" | "MATURED_OUT";
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
    broadcast?: boolean;
  }
) {
  const plan = await buildBondClosingPlan(sdk, input);
  const contract = sdk.fromArtifact(plan.currentArtifact);
  const execution = await contract.execute({
    wallet: input.wallet,
    toAddress: plan.nextContractAddress,
    signer: input.signer,
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    broadcast: input.broadcast,
  });
  return { plan, execution };
}
