import {
  CapitalCallState,
  DistributionDescriptor,
  FundClosingDescriptor,
  FundDefinition,
  FundFinalityPayload,
  LPPositionReceipt,
  LPPositionReceiptEnvelope,
  LPPositionReceiptStatus,
} from "../core/types";
import { ValidationError } from "../core/errors";
import { sha256HexUtf8, stableStringify } from "../core/summary";
import { schnorrPublicKeyFromPrivkeyHex, schnorrSignHex, schnorrVerifyHex } from "../core/schnorr";

function assertNonEmptyString(value: unknown, code: string, message: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(message, { code });
  }
}

function assertFinitePositiveNumber(value: unknown, code: string, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ValidationError(message, { code });
  }
}

function assertFiniteNonNegativeNumber(value: unknown, code: string, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(message, { code });
  }
}

function assertArrayOfHashes(value: unknown, code: string, message: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !/^[0-9a-f]{64}$/i.test(entry))) {
    throw new ValidationError(message, { code });
  }
}

function assertIsoDateLike(value: unknown, code: string, message: string): asserts value is string {
  assertNonEmptyString(value, code, message);
  if (Number.isNaN(Date.parse(value))) {
    throw new ValidationError(message, { code });
  }
}

function assertCapitalCallStatus(status: unknown): asserts status is CapitalCallState["status"] {
  if (status !== "OPEN" && status !== "CLAIMED" && status !== "REFUND_ONLY" && status !== "REFUNDED") {
    throw new ValidationError("capital call status must be OPEN, CLAIMED, REFUND_ONLY, or REFUNDED", {
      code: "FUND_CAPITAL_CALL_STATUS_INVALID",
    });
  }
}

function assertReceiptStatus(status: unknown): asserts status is LPPositionReceiptStatus {
  if (
    status !== "ACTIVE"
    && status !== "PARTIALLY_DISTRIBUTED"
    && status !== "FULLY_DISTRIBUTED"
    && status !== "CLOSED"
  ) {
    throw new ValidationError(
      "LP position receipt status must be ACTIVE, PARTIALLY_DISTRIBUTED, FULLY_DISTRIBUTED, or CLOSED",
      { code: "FUND_POSITION_STATUS_INVALID" },
    );
  }
}

function assertClosingReason(reason: unknown): asserts reason is FundClosingDescriptor["closingReason"] {
  if (reason !== "LIQUIDATED" && reason !== "CANCELLED" && reason !== "WRITTEN_OFF") {
    throw new ValidationError("closingReason must be LIQUIDATED, CANCELLED, or WRITTEN_OFF", {
      code: "FUND_CLOSING_REASON_INVALID",
    });
  }
}

function assertHashHex(value: unknown, code: string, message: string): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new ValidationError(message, { code });
  }
}

function assertXonlyPubkey(value: unknown, code: string, message: string): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new ValidationError(message, { code });
  }
}

export function summarizeFundDefinition(definition: FundDefinition): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(definition);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function summarizeCapitalCallState(state: CapitalCallState): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(state);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function summarizeLPPositionReceipt(receipt: LPPositionReceipt): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(receipt);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function summarizeDistributionDescriptor(
  descriptor: DistributionDescriptor,
): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(descriptor);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function summarizeFundClosingDescriptor(
  descriptor: FundClosingDescriptor,
): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(descriptor);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function summarizeFundFinalityPayload(payload: FundFinalityPayload): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(payload);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function buildPositionReceiptAttestationMessageHash(input: {
  fundId: string;
  positionId: string;
  positionReceiptHash: string;
  sequence: number;
}): string {
  assertNonEmptyString(input.fundId, "FUND_POSITION_ATTESTATION_FUND_ID_INVALID", "fundId must be a non-empty string");
  assertNonEmptyString(input.positionId, "FUND_POSITION_ATTESTATION_POSITION_ID_INVALID", "positionId must be a non-empty string");
  assertHashHex(
    input.positionReceiptHash,
    "FUND_POSITION_ATTESTATION_RECEIPT_HASH_INVALID",
    "positionReceiptHash must be a 64-character hex string",
  );
  if (!Number.isInteger(input.sequence) || input.sequence < 0) {
    throw new ValidationError("sequence must be a non-negative integer", {
      code: "FUND_POSITION_ATTESTATION_SEQUENCE_INVALID",
    });
  }
  return sha256HexUtf8(
    `fund-position-attestation/v1:${input.fundId}:${input.positionId}:${input.positionReceiptHash}:${input.sequence}`,
  );
}

export function summarizeLPPositionReceiptEnvelope(
  envelope: LPPositionReceiptEnvelope,
): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(envelope);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function validateFundDefinition(value: unknown): FundDefinition {
  const definition = value as Partial<FundDefinition>;
  assertNonEmptyString(definition?.fundId, "FUND_ID_INVALID", "fundId must be a non-empty string");
  assertNonEmptyString(
    definition?.managerEntityId,
    "FUND_MANAGER_ENTITY_INVALID",
    "managerEntityId must be a non-empty string",
  );
  assertXonlyPubkey(
    definition?.managerXonly,
    "FUND_MANAGER_XONLY_INVALID",
    "managerXonly must be a 32-byte xonly public key",
  );
  assertNonEmptyString(definition?.currencyAssetId, "FUND_CURRENCY_ASSET_INVALID", "currencyAssetId must be a non-empty string");
  if (definition?.jurisdiction !== undefined) {
    assertNonEmptyString(definition.jurisdiction, "FUND_JURISDICTION_INVALID", "jurisdiction must be a non-empty string");
  }
  if (definition?.vintage !== undefined) {
    assertNonEmptyString(definition.vintage, "FUND_VINTAGE_INVALID", "vintage must be a non-empty string");
  }
  return {
    fundId: definition.fundId,
    managerEntityId: definition.managerEntityId,
    managerXonly: definition.managerXonly,
    currencyAssetId: definition.currencyAssetId,
    ...(definition.jurisdiction ? { jurisdiction: definition.jurisdiction } : {}),
    ...(definition.vintage ? { vintage: definition.vintage } : {}),
  };
}

export function validateCapitalCallState(value: unknown): CapitalCallState {
  const state = value as Partial<CapitalCallState>;
  assertNonEmptyString(state?.callId, "FUND_CALL_ID_INVALID", "callId must be a non-empty string");
  assertNonEmptyString(state?.fundId, "FUND_CALL_FUND_ID_INVALID", "fundId must be a non-empty string");
  assertNonEmptyString(state?.lpId, "FUND_CALL_LP_ID_INVALID", "lpId must be a non-empty string");
  assertNonEmptyString(
    state?.currencyAssetId,
    "FUND_CALL_CURRENCY_INVALID",
    "currencyAssetId must be a non-empty string",
  );
  assertFinitePositiveNumber(state?.amount, "FUND_CALL_AMOUNT_INVALID", "amount must be a positive finite number");
  assertXonlyPubkey(state?.lpXonly, "FUND_CALL_LP_XONLY_INVALID", "lpXonly must be a 32-byte xonly public key");
  assertXonlyPubkey(
    state?.managerXonly,
    "FUND_CALL_MANAGER_XONLY_INVALID",
    "managerXonly must be a 32-byte xonly public key",
  );
  assertCapitalCallStatus(state?.status);
  assertFinitePositiveNumber(
    state?.claimCutoffHeight,
    "FUND_CALL_CUTOFF_INVALID",
    "claimCutoffHeight must be a positive finite number",
  );
  if (state.fundedAt !== undefined) {
    assertIsoDateLike(state.fundedAt, "FUND_CALL_FUNDED_AT_INVALID", "fundedAt must be an ISO timestamp");
  }
  if (state.status === "CLAIMED") {
    assertIsoDateLike(state.claimedAt, "FUND_CALL_CLAIMED_AT_INVALID", "claimedAt must be an ISO timestamp");
    assertHashHex(
      state.previousStateHash,
      "FUND_CALL_PREVIOUS_HASH_REQUIRED",
      "CLAIMED capital call state must set previousStateHash",
    );
  }
  if (state.status === "REFUND_ONLY") {
    assertHashHex(
      state.previousStateHash,
      "FUND_CALL_PREVIOUS_HASH_REQUIRED",
      "REFUND_ONLY capital call state must set previousStateHash",
    );
  }
  if (state.status === "REFUNDED") {
    assertIsoDateLike(state.refundedAt, "FUND_CALL_REFUNDED_AT_INVALID", "refundedAt must be an ISO timestamp");
    assertHashHex(
      state.previousStateHash,
      "FUND_CALL_PREVIOUS_HASH_REQUIRED",
      "REFUNDED capital call state must set previousStateHash",
    );
  }
  return {
    callId: state.callId,
    fundId: state.fundId,
    lpId: state.lpId,
    currencyAssetId: state.currencyAssetId,
    amount: state.amount,
    lpXonly: state.lpXonly,
    managerXonly: state.managerXonly,
    status: state.status,
    claimCutoffHeight: state.claimCutoffHeight,
    ...(state.fundedAt ? { fundedAt: state.fundedAt } : {}),
    ...(state.claimedAt ? { claimedAt: state.claimedAt } : {}),
    ...(state.refundedAt ? { refundedAt: state.refundedAt } : {}),
    ...(state.previousStateHash !== undefined ? { previousStateHash: state.previousStateHash } : {}),
  };
}

export function validateLPPositionReceipt(value: unknown): LPPositionReceipt {
  const receipt = value as Partial<LPPositionReceipt>;
  if (receipt?.schemaVersion !== "lp-position-receipt/v2") {
    throw new ValidationError("LP position receipt schemaVersion must be lp-position-receipt/v2", {
      code: "FUND_POSITION_SCHEMA_VERSION_INVALID",
    });
  }
  assertNonEmptyString(receipt?.positionId, "FUND_POSITION_ID_INVALID", "positionId must be a non-empty string");
  assertNonEmptyString(receipt?.fundId, "FUND_POSITION_FUND_ID_INVALID", "fundId must be a non-empty string");
  assertNonEmptyString(receipt?.lpId, "FUND_POSITION_LP_ID_INVALID", "lpId must be a non-empty string");
  assertNonEmptyString(receipt?.callId, "FUND_POSITION_CALL_ID_INVALID", "callId must be a non-empty string");
  assertNonEmptyString(
    receipt?.currencyAssetId,
    "FUND_POSITION_CURRENCY_INVALID",
    "currencyAssetId must be a non-empty string",
  );
  assertXonlyPubkey(receipt?.lpXonly, "FUND_POSITION_LP_XONLY_INVALID", "lpXonly must be a 32-byte xonly public key");
  if (!Number.isInteger(receipt?.sequence) || (receipt?.sequence ?? -1) < 0) {
    throw new ValidationError("sequence must be a non-negative integer", {
      code: "FUND_POSITION_SEQUENCE_INVALID",
    });
  }
  assertFinitePositiveNumber(
    receipt?.committedAmount,
    "FUND_POSITION_COMMITTED_INVALID",
    "committedAmount must be a positive finite number",
  );
  assertFinitePositiveNumber(
    receipt?.fundedAmount,
    "FUND_POSITION_FUNDED_INVALID",
    "fundedAmount must be a positive finite number",
  );
  assertFiniteNonNegativeNumber(
    receipt?.distributedAmount,
    "FUND_POSITION_DISTRIBUTED_INVALID",
    "distributedAmount must be a non-negative finite number",
  );
  if (!Number.isInteger(receipt?.distributionCount) || (receipt?.distributionCount ?? -1) < 0) {
    throw new ValidationError("distributionCount must be a non-negative integer", {
      code: "FUND_POSITION_DISTRIBUTION_COUNT_INVALID",
    });
  }
  assertIsoDateLike(receipt?.effectiveAt, "FUND_POSITION_EFFECTIVE_AT_INVALID", "effectiveAt must be an ISO timestamp");
  if (receipt?.lastDistributedAt !== undefined) {
    assertIsoDateLike(
      receipt.lastDistributedAt,
      "FUND_POSITION_LAST_DISTRIBUTED_AT_INVALID",
      "lastDistributedAt must be an ISO timestamp",
    );
  }
  assertReceiptStatus(receipt?.status);
  if (receipt.previousReceiptHash !== undefined && receipt.previousReceiptHash !== null) {
    assertHashHex(
      receipt.previousReceiptHash,
      "FUND_POSITION_PREVIOUS_HASH_INVALID",
      "previousReceiptHash must be a 64-character hex string when provided",
    );
  }
  if (receipt.sequence === 0 && receipt.previousReceiptHash) {
    throw new ValidationError("sequence=0 receipts cannot set previousReceiptHash", {
      code: "FUND_POSITION_SEQUENCE_ZERO_PREVIOUS_HASH",
    });
  }
  if ((receipt.sequence ?? 0) > 0 && !receipt.previousReceiptHash) {
    throw new ValidationError("sequence>0 receipts must set previousReceiptHash", {
      code: "FUND_POSITION_PREVIOUS_HASH_REQUIRED",
    });
  }
  if ((receipt.distributedAmount ?? 0) > (receipt.fundedAmount ?? 0)) {
    throw new ValidationError("distributedAmount cannot exceed fundedAmount", {
      code: "FUND_POSITION_DISTRIBUTED_EXCEEDS_FUNDED",
    });
  }
  return {
    schemaVersion: receipt.schemaVersion,
    positionId: receipt.positionId,
    fundId: receipt.fundId,
    lpId: receipt.lpId,
    callId: receipt.callId,
    currencyAssetId: receipt.currencyAssetId,
    lpXonly: receipt.lpXonly,
    sequence: receipt.sequence as number,
    committedAmount: receipt.committedAmount,
    fundedAmount: receipt.fundedAmount,
    distributedAmount: receipt.distributedAmount,
    distributionCount: receipt.distributionCount as number,
    effectiveAt: receipt.effectiveAt,
    ...(receipt.lastDistributedAt !== undefined ? { lastDistributedAt: receipt.lastDistributedAt } : {}),
    status: receipt.status,
    ...(receipt.previousReceiptHash !== undefined ? { previousReceiptHash: receipt.previousReceiptHash } : {}),
  };
}

export function validateLPPositionReceiptEnvelope(value: unknown): LPPositionReceiptEnvelope {
  const envelope = value as Partial<LPPositionReceiptEnvelope>;
  const receipt = validateLPPositionReceipt(envelope?.receipt);
  const attestation = envelope?.attestation as Partial<LPPositionReceiptEnvelope["attestation"]>;
  assertHashHex(
    attestation?.positionReceiptHash,
    "FUND_POSITION_ATTESTATION_RECEIPT_HASH_INVALID",
    "positionReceiptHash must be a 64-character hex string",
  );
  if (!Number.isInteger(attestation?.sequence) || (attestation?.sequence ?? -1) < 0) {
    throw new ValidationError("attestation sequence must be a non-negative integer", {
      code: "FUND_POSITION_ATTESTATION_SEQUENCE_INVALID",
    });
  }
  assertXonlyPubkey(
    attestation?.managerXonly,
    "FUND_POSITION_ATTESTATION_MANAGER_XONLY_INVALID",
    "managerXonly must be a 32-byte xonly public key",
  );
  assertIsoDateLike(attestation?.signedAt, "FUND_POSITION_ATTESTATION_SIGNED_AT_INVALID", "signedAt must be an ISO timestamp");
  if (attestation?.scheme !== "bip340-sha256") {
    throw new ValidationError("attestation scheme must be bip340-sha256", {
      code: "FUND_POSITION_ATTESTATION_SCHEME_INVALID",
    });
  }
  if (typeof attestation?.signature !== "string" || !/^[0-9a-f]{128}$/i.test(attestation.signature)) {
    throw new ValidationError("signature must be a 64-byte hex string", {
      code: "FUND_POSITION_ATTESTATION_SIGNATURE_INVALID",
    });
  }
  return {
    receipt,
    attestation: {
      positionReceiptHash: attestation.positionReceiptHash,
      sequence: attestation.sequence as number,
      managerXonly: attestation.managerXonly,
      signedAt: attestation.signedAt,
      signature: attestation.signature.toLowerCase(),
      scheme: attestation.scheme,
    },
  };
}

export function validateDistributionDescriptor(value: unknown): DistributionDescriptor {
  const descriptor = value as Partial<DistributionDescriptor>;
  assertNonEmptyString(
    descriptor?.distributionId,
    "FUND_DISTRIBUTION_ID_INVALID",
    "distributionId must be a non-empty string",
  );
  assertNonEmptyString(
    descriptor?.positionId,
    "FUND_DISTRIBUTION_POSITION_ID_INVALID",
    "positionId must be a non-empty string",
  );
  assertNonEmptyString(descriptor?.fundId, "FUND_DISTRIBUTION_FUND_ID_INVALID", "fundId must be a non-empty string");
  assertNonEmptyString(descriptor?.lpId, "FUND_DISTRIBUTION_LP_ID_INVALID", "lpId must be a non-empty string");
  assertNonEmptyString(descriptor?.assetId, "FUND_DISTRIBUTION_ASSET_INVALID", "assetId must be a non-empty string");
  assertFinitePositiveNumber(
    descriptor?.amountSat,
    "FUND_DISTRIBUTION_AMOUNT_INVALID",
    "amountSat must be a positive finite number",
  );
  assertIsoDateLike(descriptor?.approvedAt, "FUND_DISTRIBUTION_APPROVED_AT_INVALID", "approvedAt must be an ISO timestamp");
  assertHashHex(
    descriptor?.positionReceiptHash,
    "FUND_DISTRIBUTION_RECEIPT_HASH_INVALID",
    "positionReceiptHash must be a 64-character hex string",
  );
  return {
    distributionId: descriptor.distributionId,
    positionId: descriptor.positionId,
    fundId: descriptor.fundId,
    lpId: descriptor.lpId,
    assetId: descriptor.assetId,
    amountSat: descriptor.amountSat,
    approvedAt: descriptor.approvedAt,
    positionReceiptHash: descriptor.positionReceiptHash,
  };
}

export function validateFundClosingDescriptor(value: unknown): FundClosingDescriptor {
  const descriptor = value as Partial<FundClosingDescriptor>;
  assertNonEmptyString(descriptor?.closingId, "FUND_CLOSING_ID_INVALID", "closingId must be a non-empty string");
  assertNonEmptyString(descriptor?.fundId, "FUND_CLOSING_FUND_ID_INVALID", "fundId must be a non-empty string");
  assertNonEmptyString(descriptor?.lpId, "FUND_CLOSING_LP_ID_INVALID", "lpId must be a non-empty string");
  assertNonEmptyString(
    descriptor?.positionId,
    "FUND_CLOSING_POSITION_ID_INVALID",
    "positionId must be a non-empty string",
  );
  assertHashHex(
    descriptor?.positionReceiptHash,
    "FUND_CLOSING_RECEIPT_HASH_INVALID",
    "positionReceiptHash must be a 64-character hex string",
  );
  assertArrayOfHashes(
    descriptor?.finalDistributionHashes,
    "FUND_CLOSING_DISTRIBUTION_HASHES_INVALID",
    "finalDistributionHashes must be an array of 64-character hex strings",
  );
  assertIsoDateLike(descriptor?.closedAt, "FUND_CLOSING_CLOSED_AT_INVALID", "closedAt must be an ISO timestamp");
  assertClosingReason(descriptor?.closingReason);
  return {
    closingId: descriptor.closingId,
    fundId: descriptor.fundId,
    lpId: descriptor.lpId,
    positionId: descriptor.positionId,
    positionReceiptHash: descriptor.positionReceiptHash,
    finalDistributionHashes: descriptor.finalDistributionHashes,
    closedAt: descriptor.closedAt,
    closingReason: descriptor.closingReason,
  };
}

export function validateFundCrossChecks(
  definition: FundDefinition,
  capitalCall: CapitalCallState,
): {
  fundIdMatch: boolean;
  currencyMatch: boolean;
  managerMatch: boolean;
} {
  const result = {
    fundIdMatch: definition.fundId === capitalCall.fundId,
    currencyMatch: definition.currencyAssetId === capitalCall.currencyAssetId,
    managerMatch: definition.managerXonly.toLowerCase() === capitalCall.managerXonly.toLowerCase(),
  };
  if (!result.fundIdMatch) {
    throw new ValidationError("Fund definition and capital call fundId do not match", { code: "FUND_ID_MISMATCH" });
  }
  if (!result.currencyMatch) {
    throw new ValidationError("Fund definition and capital call currencyAssetId do not match", {
      code: "FUND_CURRENCY_MISMATCH",
    });
  }
  if (!result.managerMatch) {
    throw new ValidationError("Fund definition and capital call managerXonly do not match", {
      code: "FUND_MANAGER_MISMATCH",
    });
  }
  return result;
}

export function verifyLPPositionReceiptEnvelope(input: {
  envelope: LPPositionReceiptEnvelope;
  expectedManagerXonly?: string;
}): {
  positionReceiptHashMatch: boolean;
  sequenceMatch: boolean;
  sequenceMonotonic: boolean;
  attestingSignerMatch: boolean;
  attestationVerified: boolean;
} {
  const envelope = validateLPPositionReceiptEnvelope(input.envelope);
  const receiptSummary = summarizeLPPositionReceipt(envelope.receipt);
  const digestHex = buildPositionReceiptAttestationMessageHash({
    fundId: envelope.receipt.fundId,
    positionId: envelope.receipt.positionId,
    positionReceiptHash: receiptSummary.hash,
    sequence: envelope.receipt.sequence,
  });
  const positionReceiptHashMatch = envelope.attestation.positionReceiptHash === receiptSummary.hash;
  const sequenceMatch = envelope.attestation.sequence === envelope.receipt.sequence;
  const sequenceMonotonic = envelope.receipt.sequence === 0
    ? !envelope.receipt.previousReceiptHash
    : Boolean(envelope.receipt.previousReceiptHash);
  const attestingSignerMatch = input.expectedManagerXonly
    ? envelope.attestation.managerXonly.toLowerCase() === input.expectedManagerXonly.toLowerCase()
    : true;
  const attestationVerified = positionReceiptHashMatch
    && sequenceMatch
    && schnorrVerifyHex(envelope.attestation.signature, digestHex, envelope.attestation.managerXonly);
  return {
    positionReceiptHashMatch,
    sequenceMatch,
    sequenceMonotonic,
    attestingSignerMatch,
    attestationVerified,
  };
}

export function signLPPositionReceipt(input: {
  receipt: LPPositionReceipt;
  managerXonly: string;
  signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
  signedAt?: string;
}): LPPositionReceiptEnvelope {
  const receipt = validateLPPositionReceipt(input.receipt);
  if (input.signer.type !== "schnorrPrivkeyHex") {
    throw new ValidationError("position receipt attestation signer must be schnorrPrivkeyHex", {
      code: "FUND_POSITION_ATTESTATION_SIGNER_TYPE_INVALID",
    });
  }
  const derivedManagerXonly = schnorrPublicKeyFromPrivkeyHex(input.signer.privkeyHex);
  if (derivedManagerXonly !== input.managerXonly.toLowerCase()) {
    throw new ValidationError("position receipt attestation signer does not match managerXonly", {
      code: "FUND_POSITION_ATTESTATION_SIGNER_MISMATCH",
      managerXonly: input.managerXonly,
      derivedManagerXonly,
    });
  }
  const receiptSummary = summarizeLPPositionReceipt(receipt);
  const digestHex = buildPositionReceiptAttestationMessageHash({
    fundId: receipt.fundId,
    positionId: receipt.positionId,
    positionReceiptHash: receiptSummary.hash,
    sequence: receipt.sequence,
  });
  const signedAt = input.signedAt ?? new Date().toISOString();
  assertIsoDateLike(signedAt, "FUND_POSITION_ATTESTATION_SIGNED_AT_INVALID", "signedAt must be an ISO timestamp");
  return validateLPPositionReceiptEnvelope({
    receipt,
    attestation: {
      positionReceiptHash: receiptSummary.hash,
      sequence: receipt.sequence,
      managerXonly: derivedManagerXonly,
      signedAt,
      signature: schnorrSignHex(digestHex, input.signer.privkeyHex),
      scheme: "bip340-sha256",
    },
  });
}

export function validateDistributionAgainstReceipt(
  receipt: LPPositionReceipt,
  distribution: DistributionDescriptor,
): {
  fundIdMatch: boolean;
  lpIdMatch: boolean;
  positionIdMatch: boolean;
  positionReceiptHashMatch: boolean;
  positionStatusEligible: boolean;
} {
  const receiptHash = summarizeLPPositionReceipt(receipt).hash;
  const result = {
    fundIdMatch: receipt.fundId === distribution.fundId,
    lpIdMatch: receipt.lpId === distribution.lpId,
    positionIdMatch: receipt.positionId === distribution.positionId,
    positionReceiptHashMatch: receiptHash === distribution.positionReceiptHash,
    positionStatusEligible: receipt.status !== "CLOSED",
  };
  if (!result.fundIdMatch) {
    throw new ValidationError("Distribution fundId does not match LP position receipt", {
      code: "FUND_DISTRIBUTION_FUND_ID_MISMATCH",
    });
  }
  if (!result.lpIdMatch) {
    throw new ValidationError("Distribution lpId does not match LP position receipt", {
      code: "FUND_DISTRIBUTION_LP_ID_MISMATCH",
    });
  }
  if (!result.positionIdMatch) {
    throw new ValidationError("Distribution positionId does not match LP position receipt", {
      code: "FUND_DISTRIBUTION_POSITION_ID_MISMATCH",
    });
  }
  if (!result.positionReceiptHashMatch) {
    throw new ValidationError("Distribution positionReceiptHash does not match LP position receipt", {
      code: "FUND_DISTRIBUTION_RECEIPT_HASH_MISMATCH",
    });
  }
  if (!result.positionStatusEligible) {
    throw new ValidationError("CLOSED LP position receipt cannot produce a new distribution descriptor", {
      code: "FUND_DISTRIBUTION_POSITION_CLOSED",
    });
  }
  if (receipt.distributedAmount + distribution.amountSat > receipt.fundedAmount) {
    throw new ValidationError("Distribution amount would exceed fundedAmount for the LP position receipt", {
      code: "FUND_DISTRIBUTION_EXCEEDS_POSITION",
    });
  }
  return result;
}

export function validateClosingAgainstReceipt(
  receipt: LPPositionReceipt,
  closing: FundClosingDescriptor,
): {
  positionReceiptHashMatch: boolean;
  finalDistributionHashesPresent: boolean;
  positionStatusEligible: boolean;
} {
  const receiptHash = summarizeLPPositionReceipt(receipt).hash;
  const result = {
    positionReceiptHashMatch: receiptHash === closing.positionReceiptHash,
    finalDistributionHashesPresent: closing.finalDistributionHashes.length > 0,
    positionStatusEligible:
      (receipt.status === "FULLY_DISTRIBUTED" || receipt.status === "CLOSED")
      && receipt.distributedAmount === receipt.fundedAmount,
  };
  if (!result.positionReceiptHashMatch) {
    throw new ValidationError("Fund closing positionReceiptHash does not match LP position receipt", {
      code: "FUND_CLOSING_RECEIPT_HASH_MISMATCH",
    });
  }
  if (!result.finalDistributionHashesPresent) {
    throw new ValidationError("Fund closing must include at least one finalDistributionHash", {
      code: "FUND_CLOSING_DISTRIBUTION_HASHES_REQUIRED",
    });
  }
  if (!result.positionStatusEligible) {
    throw new ValidationError("Fund closing requires a FULLY_DISTRIBUTED or CLOSED LP position receipt", {
      code: "FUND_CLOSING_POSITION_STATUS_INVALID",
    });
  }
  return result;
}

export function buildClaimedCapitalCallState(input: {
  previous: CapitalCallState;
  claimedAt: string;
}): CapitalCallState {
  const previous = validateCapitalCallState(input.previous);
  if (previous.status !== "OPEN") {
    throw new ValidationError("Only OPEN capital call states can be claimed", {
      code: "FUND_CAPITAL_CALL_CLAIM_STAGE_INVALID",
    });
  }
  assertIsoDateLike(input.claimedAt, "FUND_CALL_CLAIMED_AT_INVALID", "claimedAt must be an ISO timestamp");
  return validateCapitalCallState({
    ...previous,
    status: "CLAIMED",
    claimedAt: input.claimedAt,
    previousStateHash: summarizeCapitalCallState(previous).hash,
  });
}

export function buildRefundOnlyCapitalCallState(input: {
  previous: CapitalCallState;
}): CapitalCallState {
  const previous = validateCapitalCallState(input.previous);
  if (previous.status !== "OPEN") {
    throw new ValidationError("Only OPEN capital call states can roll over to REFUND_ONLY", {
      code: "FUND_CAPITAL_CALL_ROLLOVER_STAGE_INVALID",
    });
  }
  return validateCapitalCallState({
    ...previous,
    status: "REFUND_ONLY",
    previousStateHash: summarizeCapitalCallState(previous).hash,
  });
}

export function buildRefundedCapitalCallState(input: {
  previous: CapitalCallState;
  refundedAt: string;
}): CapitalCallState {
  const previous = validateCapitalCallState(input.previous);
  if (previous.status !== "REFUND_ONLY") {
    throw new ValidationError("Only REFUND_ONLY capital call states can be refunded", {
      code: "FUND_CAPITAL_CALL_REFUND_STAGE_INVALID",
    });
  }
  assertIsoDateLike(input.refundedAt, "FUND_CALL_REFUNDED_AT_INVALID", "refundedAt must be an ISO timestamp");
  return validateCapitalCallState({
    ...previous,
    status: "REFUNDED",
    refundedAt: input.refundedAt,
    previousStateHash: summarizeCapitalCallState(previous).hash,
  });
}

export function buildLPPositionReceipt(input: {
  positionId: string;
  capitalCall: CapitalCallState;
  effectiveAt: string;
  status?: LPPositionReceiptStatus;
}): LPPositionReceipt {
  const capitalCall = validateCapitalCallState(input.capitalCall);
  assertIsoDateLike(input.effectiveAt, "FUND_POSITION_EFFECTIVE_AT_INVALID", "effectiveAt must be an ISO timestamp");
  assertNonEmptyString(input.positionId, "FUND_POSITION_ID_INVALID", "positionId must be a non-empty string");
  const status = input.status ?? "ACTIVE";
  assertReceiptStatus(status);
  return validateLPPositionReceipt({
    schemaVersion: "lp-position-receipt/v2",
    positionId: input.positionId,
    fundId: capitalCall.fundId,
    lpId: capitalCall.lpId,
    callId: capitalCall.callId,
    currencyAssetId: capitalCall.currencyAssetId,
    lpXonly: capitalCall.lpXonly,
    sequence: 0,
    committedAmount: capitalCall.amount,
    fundedAmount: capitalCall.amount,
    distributedAmount: 0,
    distributionCount: 0,
    effectiveAt: input.effectiveAt,
    status,
  });
}

export function applyDistributionToReceipt(input: {
  receipt: LPPositionReceipt;
  distribution: DistributionDescriptor;
  effectiveAt?: string;
  status?: LPPositionReceiptStatus;
}): LPPositionReceipt {
  const receipt = validateLPPositionReceipt(input.receipt);
  const distribution = validateDistributionDescriptor(input.distribution);
  validateDistributionAgainstReceipt(receipt, distribution);
  const nextDistributedAmount = receipt.distributedAmount + distribution.amountSat;
  const effectiveAt = input.effectiveAt ?? distribution.approvedAt;
  assertIsoDateLike(effectiveAt, "FUND_POSITION_EFFECTIVE_AT_INVALID", "effectiveAt must be an ISO timestamp");
  const status = input.status
    ?? (nextDistributedAmount === receipt.fundedAmount ? "FULLY_DISTRIBUTED" : "PARTIALLY_DISTRIBUTED");
  assertReceiptStatus(status);
  return validateLPPositionReceipt({
    ...receipt,
    distributedAmount: nextDistributedAmount,
    distributionCount: receipt.distributionCount + 1,
    effectiveAt,
    lastDistributedAt: effectiveAt,
    status,
  });
}

export function applyDistributionsToReceipt(input: {
  receipt: LPPositionReceipt;
  distributions: DistributionDescriptor[];
}): LPPositionReceipt {
  if (!Array.isArray(input.distributions) || input.distributions.length === 0) {
    throw new ValidationError("distributions must be a non-empty array", {
      code: "FUND_DISTRIBUTIONS_REQUIRED",
    });
  }
  return input.distributions.reduce<LPPositionReceipt>(
    (current, distribution) => applyDistributionToReceipt({ receipt: current, distribution }),
    validateLPPositionReceipt(input.receipt),
  );
}

export function reconcileLPPositionReceipt(input: {
  previousEnvelope: LPPositionReceiptEnvelope;
  distributions: DistributionDescriptor[];
}): LPPositionReceipt {
  const previousEnvelope = validateLPPositionReceiptEnvelope(input.previousEnvelope);
  if (!Array.isArray(input.distributions) || input.distributions.length === 0) {
    throw new ValidationError("distributions must be a non-empty array", {
      code: "FUND_DISTRIBUTIONS_REQUIRED",
    });
  }
  let workingReceipt = previousEnvelope.receipt;
  for (const distribution of input.distributions) {
    workingReceipt = applyDistributionToReceipt({
      receipt: workingReceipt,
      distribution: validateDistributionDescriptor(distribution),
    });
  }
  return validateLPPositionReceipt({
    ...workingReceipt,
    sequence: previousEnvelope.receipt.sequence + 1,
    previousReceiptHash: summarizeLPPositionReceipt(previousEnvelope.receipt).hash,
  });
}

export function buildDistributionDescriptor(input: {
  distributionId: string;
  receipt: LPPositionReceipt;
  assetId: string;
  amountSat: number;
  approvedAt: string;
}): DistributionDescriptor {
  const receipt = validateLPPositionReceipt(input.receipt);
  assertNonEmptyString(input.distributionId, "FUND_DISTRIBUTION_ID_INVALID", "distributionId must be a non-empty string");
  assertNonEmptyString(input.assetId, "FUND_DISTRIBUTION_ASSET_INVALID", "assetId must be a non-empty string");
  assertFinitePositiveNumber(input.amountSat, "FUND_DISTRIBUTION_AMOUNT_INVALID", "amountSat must be a positive finite number");
  assertIsoDateLike(input.approvedAt, "FUND_DISTRIBUTION_APPROVED_AT_INVALID", "approvedAt must be an ISO timestamp");
  return validateDistributionDescriptor({
    distributionId: input.distributionId,
    positionId: receipt.positionId,
    fundId: receipt.fundId,
    lpId: receipt.lpId,
    assetId: input.assetId,
    amountSat: input.amountSat,
    approvedAt: input.approvedAt,
    positionReceiptHash: summarizeLPPositionReceipt(receipt).hash,
  });
}

export function buildFundClosingDescriptor(input: {
  receipt: LPPositionReceipt;
  closingId: string;
  finalDistributionHashes: string[];
  closedAt: string;
  closingReason?: FundClosingDescriptor["closingReason"];
}): FundClosingDescriptor {
  const receipt = validateLPPositionReceipt(input.receipt);
  assertNonEmptyString(input.closingId, "FUND_CLOSING_ID_INVALID", "closingId must be a non-empty string");
  assertArrayOfHashes(
    input.finalDistributionHashes,
    "FUND_CLOSING_DISTRIBUTION_HASHES_INVALID",
    "finalDistributionHashes must be an array of 64-character hex strings",
  );
  assertIsoDateLike(input.closedAt, "FUND_CLOSING_CLOSED_AT_INVALID", "closedAt must be an ISO timestamp");
  const closingReason = input.closingReason ?? "LIQUIDATED";
  assertClosingReason(closingReason);
  return validateFundClosingDescriptor({
    closingId: input.closingId,
    fundId: receipt.fundId,
    lpId: receipt.lpId,
    positionId: receipt.positionId,
    positionReceiptHash: summarizeLPPositionReceipt(receipt).hash,
    finalDistributionHashes: input.finalDistributionHashes,
    closedAt: input.closedAt,
    closingReason,
  });
}
