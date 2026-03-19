import { ValidationError } from "../core/errors";
import { verifyHashLinkedLineage } from "../core/lineage";
import { sha256HexUtf8, stableStringify } from "../core/summary";
import {
  ReceivableClosingDescriptor,
  ReceivableClosingReason,
  ReceivableClaimTrust,
  ReceivableDefinition,
  ReceivableFundingClaimDescriptor,
  ReceivableRepaymentClaimDescriptor,
  ReceivableState,
  ReceivableClaimKind,
  ReceivableStatus,
  ReceivableStateTransition,
} from "../core/types";

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

function assertPositiveInteger(value: unknown, code: string, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(message, { code });
  }
}

function assertFiniteNonNegativeNumber(value: unknown, code: string, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(message, { code });
  }
}

function assertIsoDateLike(value: unknown, code: string, message: string): asserts value is string {
  assertNonEmptyString(value, code, message);
  if (Number.isNaN(Date.parse(value))) {
    throw new ValidationError(message, { code });
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

function assertReceivableStatus(value: unknown): asserts value is ReceivableStatus {
  if (
    value !== "ORIGINATED"
    && value !== "FUNDED"
    && value !== "PARTIALLY_REPAID"
    && value !== "REPAID"
    && value !== "DEFAULTED"
  ) {
    throw new ValidationError(
      "receivable status must be ORIGINATED, FUNDED, PARTIALLY_REPAID, REPAID, or DEFAULTED",
      { code: "RECEIVABLE_STATUS_INVALID" },
    );
  }
}

function validateReceivableTransition(value: unknown): ReceivableStateTransition {
  const transition = value as Partial<ReceivableStateTransition>;
  if (
    transition?.type !== "ORIGINATE"
    && transition?.type !== "FUND"
    && transition?.type !== "REPAY"
    && transition?.type !== "WRITE_OFF"
  ) {
    throw new ValidationError("lastTransition.type must be ORIGINATE, FUND, REPAY, or WRITE_OFF", {
      code: "RECEIVABLE_TRANSITION_TYPE_INVALID",
    });
  }
  assertFinitePositiveNumber(
    transition.amount,
    "RECEIVABLE_TRANSITION_AMOUNT_INVALID",
    "lastTransition.amount must be a positive finite number",
  );
  assertIsoDateLike(
    transition.at,
    "RECEIVABLE_TRANSITION_AT_INVALID",
    "lastTransition.at must be an ISO8601 string",
  );
  return {
    type: transition.type,
    amount: transition.amount,
    at: transition.at,
  };
}

export function summarizeReceivableDefinition(
  definition: ReceivableDefinition,
): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(definition);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function summarizeReceivableState(state: ReceivableState): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(state);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function summarizeReceivableClosingDescriptor(
  closing: ReceivableClosingDescriptor,
): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(closing);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function summarizeReceivableFundingClaimDescriptor(
  claim: ReceivableFundingClaimDescriptor,
): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(claim);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function summarizeReceivableRepaymentClaimDescriptor(
  claim: ReceivableRepaymentClaimDescriptor,
): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(claim);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function validateReceivableDefinition(value: unknown): ReceivableDefinition {
  const definition = value as Partial<ReceivableDefinition>;
  assertNonEmptyString(definition?.receivableId, "RECEIVABLE_ID_INVALID", "receivableId must be a non-empty string");
  assertNonEmptyString(
    definition?.originatorEntityId,
    "RECEIVABLE_ORIGINATOR_INVALID",
    "originatorEntityId must be a non-empty string",
  );
  assertNonEmptyString(
    definition?.debtorEntityId,
    "RECEIVABLE_DEBTOR_INVALID",
    "debtorEntityId must be a non-empty string",
  );
  assertNonEmptyString(
    definition?.currencyAssetId,
    "RECEIVABLE_CURRENCY_INVALID",
    "currencyAssetId must be a non-empty string",
  );
  assertFinitePositiveNumber(
    definition?.faceValue,
    "RECEIVABLE_FACE_VALUE_INVALID",
    "faceValue must be a positive finite number",
  );
  assertIsoDateLike(definition?.dueDate, "RECEIVABLE_DUE_DATE_INVALID", "dueDate must be an ISO8601 string");
  assertXonlyPubkey(
    definition?.controllerXonly,
    "RECEIVABLE_CONTROLLER_INVALID",
    "controllerXonly must be a 32-byte xonly public key",
  );
  return {
    receivableId: definition.receivableId,
    originatorEntityId: definition.originatorEntityId,
    debtorEntityId: definition.debtorEntityId,
    currencyAssetId: definition.currencyAssetId,
    faceValue: definition.faceValue,
    dueDate: definition.dueDate,
    controllerXonly: definition.controllerXonly,
  };
}

export function validateReceivableState(value: unknown): ReceivableState {
  const state = value as Partial<ReceivableState>;
  assertNonEmptyString(state?.stateId, "RECEIVABLE_STATE_ID_INVALID", "stateId must be a non-empty string");
  assertNonEmptyString(state?.receivableId, "RECEIVABLE_ID_INVALID", "receivableId must be a non-empty string");
  assertNonEmptyString(
    state?.originatorEntityId,
    "RECEIVABLE_ORIGINATOR_INVALID",
    "originatorEntityId must be a non-empty string",
  );
  assertNonEmptyString(state?.debtorEntityId, "RECEIVABLE_DEBTOR_INVALID", "debtorEntityId must be a non-empty string");
  assertNonEmptyString(state?.holderEntityId, "RECEIVABLE_HOLDER_INVALID", "holderEntityId must be a non-empty string");
  assertNonEmptyString(
    state?.currencyAssetId,
    "RECEIVABLE_CURRENCY_INVALID",
    "currencyAssetId must be a non-empty string",
  );
  assertXonlyPubkey(
    state?.controllerXonly,
    "RECEIVABLE_CONTROLLER_INVALID",
    "controllerXonly must be a 32-byte xonly public key",
  );
  assertFinitePositiveNumber(
    state?.faceValue,
    "RECEIVABLE_FACE_VALUE_INVALID",
    "faceValue must be a positive finite number",
  );
  assertFiniteNonNegativeNumber(
    state?.outstandingAmount,
    "RECEIVABLE_OUTSTANDING_INVALID",
    "outstandingAmount must be a non-negative finite number",
  );
  assertFiniteNonNegativeNumber(
    state?.repaidAmount,
    "RECEIVABLE_REPAID_INVALID",
    "repaidAmount must be a non-negative finite number",
  );
  assertReceivableStatus(state?.status);
  assertIsoDateLike(state?.createdAt, "RECEIVABLE_CREATED_AT_INVALID", "createdAt must be an ISO8601 string");
  if (state.previousStateHash !== undefined && state.previousStateHash !== null) {
    assertHashHex(
      state.previousStateHash,
      "RECEIVABLE_PREVIOUS_STATE_HASH_INVALID",
      "previousStateHash must be a 64-character hex string when provided",
    );
  }
  const transition = state.lastTransition ? validateReceivableTransition(state.lastTransition) : undefined;
  if (state.faceValue !== state.outstandingAmount + state.repaidAmount) {
    throw new ValidationError("faceValue must equal outstandingAmount + repaidAmount", {
      code: "RECEIVABLE_ARITHMETIC_INVALID",
    });
  }
  if (state.status === "ORIGINATED") {
    if (state.repaidAmount !== 0 || state.outstandingAmount !== state.faceValue) {
      throw new ValidationError("ORIGINATED state must have zero repaidAmount and full outstandingAmount", {
        code: "RECEIVABLE_STATUS_INVALID",
      });
    }
    if (state.previousStateHash) {
      throw new ValidationError("ORIGINATED state must not set previousStateHash", {
        code: "RECEIVABLE_PREVIOUS_STATE_HASH_INVALID",
      });
    }
    if (transition && transition.type !== "ORIGINATE") {
      throw new ValidationError("ORIGINATED state may only carry an ORIGINATE transition", {
        code: "RECEIVABLE_TRANSITION_TYPE_INVALID",
      });
    }
  }
  if (state.status === "FUNDED") {
    if (!state.previousStateHash) {
      throw new ValidationError("FUNDED state must set previousStateHash", {
        code: "RECEIVABLE_PREVIOUS_STATE_HASH_INVALID",
      });
    }
    if (!transition || transition.type !== "FUND") {
      throw new ValidationError("FUNDED state must carry a FUND transition", {
        code: "RECEIVABLE_TRANSITION_TYPE_INVALID",
      });
    }
  }
  if (state.status === "PARTIALLY_REPAID") {
    if (state.repaidAmount <= 0 || state.outstandingAmount <= 0) {
      throw new ValidationError("PARTIALLY_REPAID state must have both positive repaid and outstanding amounts", {
        code: "RECEIVABLE_STATUS_INVALID",
      });
    }
    if (!state.previousStateHash) {
      throw new ValidationError("PARTIALLY_REPAID state must set previousStateHash", {
        code: "RECEIVABLE_PREVIOUS_STATE_HASH_INVALID",
      });
    }
    if (!transition || transition.type !== "REPAY") {
      throw new ValidationError("PARTIALLY_REPAID state must carry a REPAY transition", {
        code: "RECEIVABLE_TRANSITION_TYPE_INVALID",
      });
    }
  }
  if (state.status === "REPAID") {
    if (state.outstandingAmount !== 0 || state.repaidAmount !== state.faceValue) {
      throw new ValidationError("REPAID state must have zero outstandingAmount and full repaidAmount", {
        code: "RECEIVABLE_STATUS_INVALID",
      });
    }
    if (!state.previousStateHash) {
      throw new ValidationError("REPAID state must set previousStateHash", {
        code: "RECEIVABLE_PREVIOUS_STATE_HASH_INVALID",
      });
    }
    if (!transition || transition.type !== "REPAY") {
      throw new ValidationError("REPAID state must carry a REPAY transition", {
        code: "RECEIVABLE_TRANSITION_TYPE_INVALID",
      });
    }
  }
  if (state.status === "DEFAULTED") {
    if (state.outstandingAmount <= 0 || state.repaidAmount >= state.faceValue) {
      throw new ValidationError("DEFAULTED state must keep a positive outstandingAmount below faceValue", {
        code: "RECEIVABLE_STATUS_INVALID",
      });
    }
    if (!state.previousStateHash) {
      throw new ValidationError("DEFAULTED state must set previousStateHash", {
        code: "RECEIVABLE_PREVIOUS_STATE_HASH_INVALID",
      });
    }
    if (!transition || transition.type !== "WRITE_OFF") {
      throw new ValidationError("DEFAULTED state must carry a WRITE_OFF transition", {
        code: "RECEIVABLE_TRANSITION_TYPE_INVALID",
      });
    }
  }
  return {
    stateId: state.stateId,
    receivableId: state.receivableId,
    originatorEntityId: state.originatorEntityId,
    debtorEntityId: state.debtorEntityId,
    holderEntityId: state.holderEntityId,
    currencyAssetId: state.currencyAssetId,
    controllerXonly: state.controllerXonly,
    faceValue: state.faceValue,
    outstandingAmount: state.outstandingAmount,
    repaidAmount: state.repaidAmount,
    status: state.status,
    createdAt: state.createdAt,
    ...(state.previousStateHash !== undefined ? { previousStateHash: state.previousStateHash } : {}),
    ...(transition ? { lastTransition: transition } : {}),
  };
}

export function validateReceivableClosingDescriptor(value: unknown): ReceivableClosingDescriptor {
  const closing = value as Partial<ReceivableClosingDescriptor>;
  assertNonEmptyString(closing?.closingId, "RECEIVABLE_CLOSING_ID_INVALID", "closingId must be a non-empty string");
  assertNonEmptyString(closing?.receivableId, "RECEIVABLE_ID_INVALID", "receivableId must be a non-empty string");
  assertHashHex(
    closing?.latestStateHash,
    "RECEIVABLE_LATEST_STATE_HASH_INVALID",
    "latestStateHash must be a 64-character hex string",
  );
  assertReceivableStatus(closing?.latestStatus);
  assertNonEmptyString(
    closing?.holderEntityId,
    "RECEIVABLE_HOLDER_INVALID",
    "holderEntityId must be a non-empty string",
  );
  assertIsoDateLike(closing?.closedAt, "RECEIVABLE_CLOSED_AT_INVALID", "closedAt must be an ISO8601 string");
  if (
    closing?.closingReason !== "REPAID"
    && closing?.closingReason !== "DEFAULTED"
    && closing?.closingReason !== "CANCELLED"
  ) {
    throw new ValidationError("closingReason must be REPAID, DEFAULTED, or CANCELLED", {
      code: "RECEIVABLE_CLOSING_REASON_INVALID",
    });
  }
  return {
    closingId: closing.closingId,
    receivableId: closing.receivableId,
    latestStateHash: closing.latestStateHash,
    latestStatus: closing.latestStatus,
    holderEntityId: closing.holderEntityId,
    closedAt: closing.closedAt,
    closingReason: closing.closingReason,
  };
}

function validateReceivableClaimKind(value: unknown): ReceivableClaimKind {
  if (value !== "FUNDING" && value !== "REPAYMENT") {
    throw new ValidationError("claimKind must be FUNDING or REPAYMENT", {
      code: "RECEIVABLE_CLAIM_KIND_INVALID",
    });
  }
  return value;
}

function validateReceivableClaimDescriptorBase(value: unknown): {
  claimId: string;
  claimKind: ReceivableClaimKind;
  receivableId: string;
  currentStateHash: string;
  currentStatus: ReceivableStatus;
  payerEntityId: string;
  payeeEntityId: string;
  claimantXonly: string;
  currencyAssetId: string;
  amountSat: number;
  eventTimestamp: string;
} {
  const claim = value as Partial<{
    claimId: string;
    claimKind: ReceivableClaimKind;
    receivableId: string;
    currentStateHash: string;
    currentStatus: ReceivableStatus;
    payerEntityId: string;
    payeeEntityId: string;
    claimantXonly: string;
    currencyAssetId: string;
    amountSat: number;
    eventTimestamp: string;
  }>;
  assertNonEmptyString(claim?.claimId, "RECEIVABLE_CLAIM_ID_INVALID", "claimId must be a non-empty string");
  const claimKind = validateReceivableClaimKind(claim?.claimKind);
  assertNonEmptyString(claim?.receivableId, "RECEIVABLE_ID_INVALID", "receivableId must be a non-empty string");
  assertHashHex(
    claim?.currentStateHash,
    "RECEIVABLE_CURRENT_STATE_HASH_INVALID",
    "currentStateHash must be a 64-character hex string",
  );
  assertReceivableStatus(claim?.currentStatus);
  assertNonEmptyString(claim?.payerEntityId, "RECEIVABLE_PAYER_INVALID", "payerEntityId must be a non-empty string");
  assertNonEmptyString(claim?.payeeEntityId, "RECEIVABLE_PAYEE_INVALID", "payeeEntityId must be a non-empty string");
  assertXonlyPubkey(
    claim?.claimantXonly,
    "RECEIVABLE_CLAIMANT_INVALID",
    "claimantXonly must be a 32-byte xonly public key",
  );
  assertNonEmptyString(
    claim?.currencyAssetId,
    "RECEIVABLE_CURRENCY_INVALID",
    "currencyAssetId must be a non-empty string",
  );
  assertPositiveInteger(claim?.amountSat, "RECEIVABLE_CLAIM_AMOUNT_INVALID", "amountSat must be a positive integer");
  assertIsoDateLike(
    claim?.eventTimestamp,
    "RECEIVABLE_EVENT_TIMESTAMP_INVALID",
    "eventTimestamp must be an ISO8601 string",
  );
  return {
    claimId: claim.claimId,
    claimKind,
    receivableId: claim.receivableId,
    currentStateHash: claim.currentStateHash,
    currentStatus: claim.currentStatus,
    payerEntityId: claim.payerEntityId,
    payeeEntityId: claim.payeeEntityId,
    claimantXonly: claim.claimantXonly,
    currencyAssetId: claim.currencyAssetId,
    amountSat: claim.amountSat,
    eventTimestamp: claim.eventTimestamp,
  };
}

export function validateReceivableFundingClaimDescriptor(value: unknown): ReceivableFundingClaimDescriptor {
  const claim = validateReceivableClaimDescriptorBase(value);
  if (claim.claimKind !== "FUNDING") {
    throw new ValidationError("funding claim descriptor must have claimKind=FUNDING", {
      code: "RECEIVABLE_CLAIM_KIND_INVALID",
    });
  }
  return {
    ...claim,
    claimKind: "FUNDING",
  };
}

export function validateReceivableRepaymentClaimDescriptor(value: unknown): ReceivableRepaymentClaimDescriptor {
  const claim = validateReceivableClaimDescriptorBase(value);
  if (claim.claimKind !== "REPAYMENT") {
    throw new ValidationError("repayment claim descriptor must have claimKind=REPAYMENT", {
      code: "RECEIVABLE_CLAIM_KIND_INVALID",
    });
  }
  return {
    ...claim,
    claimKind: "REPAYMENT",
  };
}

export function validateReceivableCrossChecks(definition: ReceivableDefinition, state: ReceivableState) {
  const result = {
    receivableIdMatch: definition.receivableId === state.receivableId,
    originatorMatch: definition.originatorEntityId === state.originatorEntityId,
    debtorMatch: definition.debtorEntityId === state.debtorEntityId,
    currencyMatch: definition.currencyAssetId === state.currencyAssetId,
    controllerMatch: definition.controllerXonly === state.controllerXonly,
    faceValueMatch: definition.faceValue === state.faceValue,
    arithmeticValid: state.faceValue === state.outstandingAmount + state.repaidAmount,
  };
  if (!result.receivableIdMatch) {
    throw new ValidationError("Receivable definition and state receivableId do not match", {
      code: "RECEIVABLE_ID_MISMATCH",
    });
  }
  if (!result.originatorMatch) {
    throw new ValidationError("Receivable definition and state originatorEntityId do not match", {
      code: "RECEIVABLE_ORIGINATOR_MISMATCH",
    });
  }
  if (!result.debtorMatch) {
    throw new ValidationError("Receivable definition and state debtorEntityId do not match", {
      code: "RECEIVABLE_DEBTOR_MISMATCH",
    });
  }
  if (!result.currencyMatch) {
    throw new ValidationError("Receivable definition and state currencyAssetId do not match", {
      code: "RECEIVABLE_CURRENCY_MISMATCH",
    });
  }
  if (!result.controllerMatch) {
    throw new ValidationError("Receivable definition and state controllerXonly do not match", {
      code: "RECEIVABLE_CONTROLLER_MISMATCH",
    });
  }
  if (!result.faceValueMatch) {
    throw new ValidationError("Receivable definition and state faceValue do not match", {
      code: "RECEIVABLE_FACE_VALUE_MISMATCH",
    });
  }
  if (!result.arithmeticValid) {
    throw new ValidationError("Receivable state faceValue must equal outstandingAmount + repaidAmount", {
      code: "RECEIVABLE_ARITHMETIC_INVALID",
    });
  }
  return result;
}

function assertSameReceivableIdentity(previous: ReceivableState, next: ReceivableState) {
  const participantConsistencyValid =
    previous.receivableId === next.receivableId
    && previous.originatorEntityId === next.originatorEntityId
    && previous.debtorEntityId === next.debtorEntityId
    && previous.currencyAssetId === next.currencyAssetId
    && previous.controllerXonly === next.controllerXonly
    && previous.faceValue === next.faceValue;
  if (!participantConsistencyValid) {
    throw new ValidationError("Receivable transition must preserve ids, currency, controller, and faceValue", {
      code: "RECEIVABLE_TRANSITION_IDENTITY_INVALID",
    });
  }
  return participantConsistencyValid;
}

function assertCreatedAtMonotonic(previous: ReceivableState, next: ReceivableState) {
  const createdAtMonotonic = Date.parse(next.createdAt) >= Date.parse(previous.createdAt);
  if (!createdAtMonotonic) {
    throw new ValidationError("Receivable transition must not move createdAt backwards", {
      code: "RECEIVABLE_TRANSITION_CREATED_AT_INVALID",
    });
  }
  return createdAtMonotonic;
}

function assertPreviousStateHashMatch(previous: ReceivableState, next: ReceivableState) {
  const previousStateHashMatch = next.previousStateHash === summarizeReceivableState(previous).hash;
  if (!previousStateHashMatch) {
    throw new ValidationError("Receivable transition previousStateHash does not match the previous state hash", {
      code: "RECEIVABLE_PREVIOUS_STATE_HASH_INVALID",
    });
  }
  return previousStateHashMatch;
}

function deriveClosingReasonFromStatus(status: ReceivableStatus): ReceivableClosingReason {
  if (status === "REPAID") return "REPAID";
  if (status === "DEFAULTED") return "DEFAULTED";
  throw new ValidationError("Only REPAID or DEFAULTED receivables can derive a closing reason automatically", {
    code: "RECEIVABLE_CLOSING_REASON_INVALID",
  });
}

export function buildFundedReceivableState(input: {
  previous: ReceivableState;
  stateId: string;
  holderEntityId: string;
  fundedAt: string;
}): ReceivableState {
  const previous = validateReceivableState(input.previous);
  if (previous.status !== "ORIGINATED") {
    throw new ValidationError("Only ORIGINATED receivables can move into FUNDED", {
      code: "RECEIVABLE_STATUS_INVALID",
    });
  }
  return validateReceivableState({
    ...previous,
    stateId: input.stateId,
    holderEntityId: input.holderEntityId,
    status: "FUNDED",
    createdAt: input.fundedAt,
    previousStateHash: summarizeReceivableState(previous).hash,
    lastTransition: {
      type: "FUND",
      amount: previous.outstandingAmount,
      at: input.fundedAt,
    },
  });
}

export function applyReceivableRepayment(input: {
  previous: ReceivableState;
  stateId: string;
  amount: number;
  repaidAt: string;
}): ReceivableState {
  const previous = validateReceivableState(input.previous);
  if (previous.status !== "FUNDED" && previous.status !== "PARTIALLY_REPAID") {
    throw new ValidationError("Only FUNDED or PARTIALLY_REPAID receivables can be repaid", {
      code: "RECEIVABLE_STATUS_INVALID",
    });
  }
  assertFinitePositiveNumber(
    input.amount,
    "RECEIVABLE_TRANSITION_AMOUNT_INVALID",
    "repayment amount must be a positive finite number",
  );
  if (input.amount > previous.outstandingAmount) {
    throw new ValidationError("repayment amount must not exceed outstandingAmount", {
      code: "RECEIVABLE_TRANSITION_AMOUNT_INVALID",
    });
  }
  const outstandingAmount = previous.outstandingAmount - input.amount;
  const repaidAmount = previous.repaidAmount + input.amount;
  return validateReceivableState({
    ...previous,
    stateId: input.stateId,
    outstandingAmount,
    repaidAmount,
    status: outstandingAmount === 0 ? "REPAID" : "PARTIALLY_REPAID",
    createdAt: input.repaidAt,
    previousStateHash: summarizeReceivableState(previous).hash,
    lastTransition: {
      type: "REPAY",
      amount: input.amount,
      at: input.repaidAt,
    },
  });
}

export function buildDefaultedReceivableState(input: {
  previous: ReceivableState;
  stateId: string;
  defaultedAt: string;
  writeOffAmount?: number;
}): ReceivableState {
  const previous = validateReceivableState(input.previous);
  if (previous.status !== "FUNDED" && previous.status !== "PARTIALLY_REPAID") {
    throw new ValidationError("Only FUNDED or PARTIALLY_REPAID receivables can be written off", {
      code: "RECEIVABLE_STATUS_INVALID",
    });
  }
  const writeOffAmount = input.writeOffAmount ?? previous.outstandingAmount;
  assertFinitePositiveNumber(
    writeOffAmount,
    "RECEIVABLE_TRANSITION_AMOUNT_INVALID",
    "writeOffAmount must be a positive finite number",
  );
  return validateReceivableState({
    ...previous,
    stateId: input.stateId,
    status: "DEFAULTED",
    createdAt: input.defaultedAt,
    previousStateHash: summarizeReceivableState(previous).hash,
    lastTransition: {
      type: "WRITE_OFF",
      amount: writeOffAmount,
      at: input.defaultedAt,
    },
  });
}

export function buildReceivableClosingDescriptor(input: {
  closingId: string;
  latestState: ReceivableState;
  closedAt: string;
  closingReason?: ReceivableClosingReason;
}): ReceivableClosingDescriptor {
  const latestState = validateReceivableState(input.latestState);
  const latestStateHash = summarizeReceivableState(latestState).hash;
  return validateReceivableClosingDescriptor({
    closingId: input.closingId,
    receivableId: latestState.receivableId,
    latestStateHash,
    latestStatus: latestState.status,
    holderEntityId: latestState.holderEntityId,
    closedAt: input.closedAt,
    closingReason: input.closingReason ?? deriveClosingReasonFromStatus(latestState.status),
  });
}

export function buildReceivableFundingClaimDescriptor(input: {
  claimId: string;
  currentState: ReceivableState;
  payerEntityId?: string;
  payeeEntityId?: string;
  claimantXonly?: string;
  amountSat?: number;
  eventTimestamp?: string;
}): ReceivableFundingClaimDescriptor {
  const currentState = validateReceivableState(input.currentState);
  const currentStateHash = summarizeReceivableState(currentState).hash;
  return validateReceivableFundingClaimDescriptor({
    claimId: input.claimId,
    claimKind: "FUNDING",
    receivableId: currentState.receivableId,
    currentStateHash,
    currentStatus: currentState.status,
    payerEntityId: input.payerEntityId ?? currentState.holderEntityId,
    payeeEntityId: input.payeeEntityId ?? currentState.originatorEntityId,
    claimantXonly: input.claimantXonly ?? currentState.controllerXonly,
    currencyAssetId: currentState.currencyAssetId,
    amountSat: input.amountSat ?? currentState.lastTransition?.amount ?? currentState.outstandingAmount,
    eventTimestamp: input.eventTimestamp ?? currentState.lastTransition?.at ?? currentState.createdAt,
  });
}

export function buildReceivableRepaymentClaimDescriptor(input: {
  claimId: string;
  currentState: ReceivableState;
  payerEntityId?: string;
  payeeEntityId?: string;
  claimantXonly?: string;
  amountSat?: number;
  eventTimestamp?: string;
}): ReceivableRepaymentClaimDescriptor {
  const currentState = validateReceivableState(input.currentState);
  const currentStateHash = summarizeReceivableState(currentState).hash;
  return validateReceivableRepaymentClaimDescriptor({
    claimId: input.claimId,
    claimKind: "REPAYMENT",
    receivableId: currentState.receivableId,
    currentStateHash,
    currentStatus: currentState.status,
    payerEntityId: input.payerEntityId ?? currentState.debtorEntityId,
    payeeEntityId: input.payeeEntityId ?? currentState.holderEntityId,
    claimantXonly: input.claimantXonly ?? currentState.controllerXonly,
    currencyAssetId: currentState.currencyAssetId,
    amountSat: input.amountSat ?? currentState.lastTransition?.amount ?? currentState.repaidAmount,
    eventTimestamp: input.eventTimestamp ?? currentState.lastTransition?.at ?? currentState.createdAt,
  });
}

export function validateReceivableFundingClaimAgainstState(input: {
  currentState: ReceivableState;
  claim: ReceivableFundingClaimDescriptor;
}): Omit<ReceivableClaimTrust, "generated" | "bindingMode" | "requestedMode" | "supportedForm" | "reasonCode" | "nextReceiverRuntimeCommitted" | "nextOutputHashRuntimeBound" | "nextOutputScriptRuntimeBound" | "amountRuntimeBound" | "autoDerived" | "fallbackReason" | "bindingInputs" | "claimantXonlyCommitted"> {
  const currentState = validateReceivableState(input.currentState);
  const claim = validateReceivableFundingClaimDescriptor(input.claim);
  const currentStateHash = summarizeReceivableState(currentState).hash;
  const stateStatusEligible = currentState.status === "FUNDED";
  const receivableIdMatch = claim.receivableId === currentState.receivableId;
  const currentStateHashMatch = claim.currentStateHash === currentStateHash;
  const currentStatusMatch = claim.currentStatus === currentState.status;
  const payerEntityMatch = claim.payerEntityId === currentState.holderEntityId;
  const payeeEntityMatch = claim.payeeEntityId === currentState.originatorEntityId;
  const claimantXonlyMatch = claim.claimantXonly === currentState.controllerXonly;
  const currencyAssetMatch = claim.currencyAssetId === currentState.currencyAssetId;
  const amountMatch = currentState.lastTransition?.type === "FUND" && claim.amountSat === currentState.lastTransition.amount;
  const eventTimestampMatch =
    currentState.lastTransition?.type === "FUND" && claim.eventTimestamp === currentState.lastTransition.at;
  return {
    claimKind: "FUNDING",
    stateStatusEligible,
    receivableIdMatch,
    currentStateHashMatch,
    currentStatusMatch,
    payerEntityMatch,
    payeeEntityMatch,
    claimantXonlyMatch,
    currencyAssetMatch,
    amountMatch,
    eventTimestampMatch,
    fullClaimVerified:
      stateStatusEligible
      && receivableIdMatch
      && currentStateHashMatch
      && currentStatusMatch
      && payerEntityMatch
      && payeeEntityMatch
      && claimantXonlyMatch
      && currencyAssetMatch
      && amountMatch
      && eventTimestampMatch,
  };
}

export function validateReceivableRepaymentClaimAgainstState(input: {
  currentState: ReceivableState;
  claim: ReceivableRepaymentClaimDescriptor;
}): Omit<ReceivableClaimTrust, "generated" | "bindingMode" | "requestedMode" | "supportedForm" | "reasonCode" | "nextReceiverRuntimeCommitted" | "nextOutputHashRuntimeBound" | "nextOutputScriptRuntimeBound" | "amountRuntimeBound" | "autoDerived" | "fallbackReason" | "bindingInputs" | "claimantXonlyCommitted"> {
  const currentState = validateReceivableState(input.currentState);
  const claim = validateReceivableRepaymentClaimDescriptor(input.claim);
  const currentStateHash = summarizeReceivableState(currentState).hash;
  const stateStatusEligible = currentState.status === "PARTIALLY_REPAID" || currentState.status === "REPAID";
  const receivableIdMatch = claim.receivableId === currentState.receivableId;
  const currentStateHashMatch = claim.currentStateHash === currentStateHash;
  const currentStatusMatch = claim.currentStatus === currentState.status;
  const payerEntityMatch = claim.payerEntityId === currentState.debtorEntityId;
  const payeeEntityMatch = claim.payeeEntityId === currentState.holderEntityId;
  const claimantXonlyMatch = claim.claimantXonly === currentState.controllerXonly;
  const currencyAssetMatch = claim.currencyAssetId === currentState.currencyAssetId;
  const amountMatch = currentState.lastTransition?.type === "REPAY" && claim.amountSat === currentState.lastTransition.amount;
  const eventTimestampMatch =
    currentState.lastTransition?.type === "REPAY" && claim.eventTimestamp === currentState.lastTransition.at;
  return {
    claimKind: "REPAYMENT",
    stateStatusEligible,
    receivableIdMatch,
    currentStateHashMatch,
    currentStatusMatch,
    payerEntityMatch,
    payeeEntityMatch,
    claimantXonlyMatch,
    currencyAssetMatch,
    amountMatch,
    eventTimestampMatch,
    fullClaimVerified:
      stateStatusEligible
      && receivableIdMatch
      && currentStateHashMatch
      && currentStatusMatch
      && payerEntityMatch
      && payeeEntityMatch
      && claimantXonlyMatch
      && currencyAssetMatch
      && amountMatch
      && eventTimestampMatch,
  };
}

export function validateReceivableFundingTransition(previousValue: ReceivableState, nextValue: ReceivableState) {
  const previous = validateReceivableState(previousValue);
  const next = validateReceivableState(nextValue);
  const previousStateHashMatch = assertPreviousStateHashMatch(previous, next);
  const participantConsistencyValid = assertSameReceivableIdentity(previous, next);
  const statusProgressionValid = previous.status === "ORIGINATED" && next.status === "FUNDED";
  if (!statusProgressionValid) {
    throw new ValidationError("Funding transition must move ORIGINATED to FUNDED", {
      code: "RECEIVABLE_STATUS_INVALID",
    });
  }
  const arithmeticDeltaValid =
    previous.outstandingAmount === next.outstandingAmount
    && previous.repaidAmount === next.repaidAmount;
  if (!arithmeticDeltaValid) {
    throw new ValidationError("Funding transition must preserve outstandingAmount and repaidAmount", {
      code: "RECEIVABLE_ARITHMETIC_INVALID",
    });
  }
  const createdAtMonotonic = assertCreatedAtMonotonic(previous, next);
  const transitionAmountValid = next.lastTransition?.type === "FUND"
    && next.lastTransition.amount === previous.outstandingAmount;
  if (!transitionAmountValid) {
    throw new ValidationError("Funding transition must carry a FUND transition for the previous outstandingAmount", {
      code: "RECEIVABLE_TRANSITION_AMOUNT_INVALID",
    });
  }
  return {
    transitionType: "FUND" as const,
    previousStateHashMatch,
    participantConsistencyValid,
    statusProgressionValid,
    arithmeticDeltaValid,
    createdAtMonotonic,
    transitionAmountValid,
    fullTransitionVerified: true,
  };
}

export function validateReceivableRepaymentTransition(previousValue: ReceivableState, nextValue: ReceivableState) {
  const previous = validateReceivableState(previousValue);
  const next = validateReceivableState(nextValue);
  const previousStateHashMatch = assertPreviousStateHashMatch(previous, next);
  const participantConsistencyValid = assertSameReceivableIdentity(previous, next) && previous.holderEntityId === next.holderEntityId;
  if (!participantConsistencyValid) {
    throw new ValidationError("Repayment transition must preserve the current holder and receivable identity", {
      code: "RECEIVABLE_TRANSITION_IDENTITY_INVALID",
    });
  }
  const statusProgressionValid =
    (previous.status === "FUNDED" || previous.status === "PARTIALLY_REPAID")
    && (next.status === "PARTIALLY_REPAID" || next.status === "REPAID");
  if (!statusProgressionValid) {
    throw new ValidationError("Repayment transition must move FUNDED/PARTIALLY_REPAID to PARTIALLY_REPAID or REPAID", {
      code: "RECEIVABLE_STATUS_INVALID",
    });
  }
  const delta = next.repaidAmount - previous.repaidAmount;
  const arithmeticDeltaValid =
    delta > 0
    && previous.outstandingAmount - next.outstandingAmount === delta
    && next.faceValue === next.outstandingAmount + next.repaidAmount;
  if (!arithmeticDeltaValid) {
    throw new ValidationError("Repayment transition must increase repaidAmount and reduce outstandingAmount by the same amount", {
      code: "RECEIVABLE_ARITHMETIC_INVALID",
    });
  }
  const createdAtMonotonic = assertCreatedAtMonotonic(previous, next);
  const transitionAmountValid = next.lastTransition?.type === "REPAY" && next.lastTransition.amount === delta;
  if (!transitionAmountValid) {
    throw new ValidationError("Repayment transition must carry a REPAY transition that matches the repayment delta", {
      code: "RECEIVABLE_TRANSITION_AMOUNT_INVALID",
    });
  }
  return {
    transitionType: "REPAY" as const,
    previousStateHashMatch,
    participantConsistencyValid,
    statusProgressionValid,
    arithmeticDeltaValid,
    createdAtMonotonic,
    transitionAmountValid,
    fullTransitionVerified: true,
  };
}

export function validateReceivableWriteOffTransition(previousValue: ReceivableState, nextValue: ReceivableState) {
  const previous = validateReceivableState(previousValue);
  const next = validateReceivableState(nextValue);
  const previousStateHashMatch = assertPreviousStateHashMatch(previous, next);
  const participantConsistencyValid = assertSameReceivableIdentity(previous, next) && previous.holderEntityId === next.holderEntityId;
  if (!participantConsistencyValid) {
    throw new ValidationError("Write-off transition must preserve the current holder and receivable identity", {
      code: "RECEIVABLE_TRANSITION_IDENTITY_INVALID",
    });
  }
  const statusProgressionValid =
    (previous.status === "FUNDED" || previous.status === "PARTIALLY_REPAID")
    && next.status === "DEFAULTED";
  if (!statusProgressionValid) {
    throw new ValidationError("Write-off transition must move FUNDED/PARTIALLY_REPAID to DEFAULTED", {
      code: "RECEIVABLE_STATUS_INVALID",
    });
  }
  const arithmeticDeltaValid =
    previous.outstandingAmount === next.outstandingAmount
    && previous.repaidAmount === next.repaidAmount;
  if (!arithmeticDeltaValid) {
    throw new ValidationError("Write-off transition must preserve outstandingAmount and repaidAmount", {
      code: "RECEIVABLE_ARITHMETIC_INVALID",
    });
  }
  const createdAtMonotonic = assertCreatedAtMonotonic(previous, next);
  const transitionAmountValid =
    next.lastTransition?.type === "WRITE_OFF" && next.lastTransition.amount > 0 && next.lastTransition.amount <= next.outstandingAmount;
  if (!transitionAmountValid) {
    throw new ValidationError("Write-off transition must carry a positive WRITE_OFF transition amount within the outstanding amount", {
      code: "RECEIVABLE_TRANSITION_AMOUNT_INVALID",
    });
  }
  return {
    transitionType: "WRITE_OFF" as const,
    previousStateHashMatch,
    participantConsistencyValid,
    statusProgressionValid,
    arithmeticDeltaValid,
    createdAtMonotonic,
    transitionAmountValid,
    fullTransitionVerified: true,
  };
}

export function validateReceivableClosingAgainstState(input: {
  latestState: ReceivableState;
  closing: ReceivableClosingDescriptor;
  history?: ReceivableState[];
}) {
  const latestState = validateReceivableState(input.latestState);
  const closing = validateReceivableClosingDescriptor(input.closing);
  const latestStateHash = summarizeReceivableState(latestState).hash;
  const terminalStatusEligible = latestState.status === "REPAID" || latestState.status === "DEFAULTED";
  if (!terminalStatusEligible) {
    throw new ValidationError("Only REPAID or DEFAULTED receivables can be closed", {
      code: "RECEIVABLE_STATUS_INVALID",
    });
  }
  const latestStateHashMatch = closing.latestStateHash === latestStateHash;
  if (!latestStateHashMatch) {
    throw new ValidationError("Receivable closing latestStateHash does not match the latest state hash", {
      code: "RECEIVABLE_LATEST_STATE_HASH_INVALID",
    });
  }
  const closingReasonMatchesStatus =
    (latestState.status === "REPAID" && closing.closingReason === "REPAID")
    || (latestState.status === "DEFAULTED" && closing.closingReason === "DEFAULTED")
    || closing.closingReason === "CANCELLED";
  if (!closingReasonMatchesStatus) {
    throw new ValidationError("Receivable closingReason must match the terminal state status", {
      code: "RECEIVABLE_CLOSING_REASON_INVALID",
    });
  }
  const historyTipMatches = !input.history || input.history.length === 0
    ? true
    : summarizeReceivableState(validateReceivableState(input.history.at(-1)!)).hash === latestStateHash;
  if (!historyTipMatches) {
    throw new ValidationError("Receivable closing latest state must match the tip of the provided state history", {
      code: "RECEIVABLE_HISTORY_TIP_MISMATCH",
    });
  }
  return {
    terminalStatusEligible,
    latestStateHashMatch,
    closingReasonMatchesStatus,
    historyTipMatches,
    lineageProvided: Boolean(input.history && input.history.length > 0),
    fullClosingVerified: true,
  };
}

function isStatusProgressionValid(previous: ReceivableState, current: ReceivableState): boolean {
  if (previous.status === "ORIGINATED") {
    return current.status === "FUNDED" || current.status === "PARTIALLY_REPAID" || current.status === "REPAID" || current.status === "DEFAULTED";
  }
  if (previous.status === "FUNDED") {
    return current.status === "PARTIALLY_REPAID" || current.status === "REPAID" || current.status === "DEFAULTED";
  }
  if (previous.status === "PARTIALLY_REPAID") {
    return current.status === "PARTIALLY_REPAID" || current.status === "REPAID" || current.status === "DEFAULTED";
  }
  return false;
}

export function verifyReceivableStateHistory(input: { history: ReceivableState[] }) {
  const history = input.history.map((entry) => validateReceivableState(entry));
  const lineage = verifyHashLinkedLineage({
    entries: history,
    summarize: summarizeReceivableState,
    getPreviousHash: (entry) => entry.previousStateHash,
    isGenesis: (entry) => !entry.previousStateHash,
    consistencyChecks: {
      receivableIdConsistent: (entry, first) => entry.receivableId === first.receivableId,
      originatorConsistent: (entry, first) => entry.originatorEntityId === first.originatorEntityId,
      debtorConsistent: (entry, first) => entry.debtorEntityId === first.debtorEntityId,
      currencyConsistent: (entry, first) => entry.currencyAssetId === first.currencyAssetId,
      controllerConsistent: (entry, first) => entry.controllerXonly === first.controllerXonly,
      faceValueConsistent: (entry, first) => entry.faceValue === first.faceValue,
    },
  });

  const allArithmeticValid = history.every((entry) => entry.faceValue === entry.outstandingAmount + entry.repaidAmount);
  const allStatusProgressionValid = history.every((entry, index) => (
    index === 0 ? entry.status === "ORIGINATED" : isStatusProgressionValid(history[index - 1]!, entry)
  ));
  const fullHistoryVerified = lineage.fullLineageVerified && allArithmeticValid && allStatusProgressionValid;

  return {
    chainLength: lineage.chainLength,
    startsAtGenesis: lineage.startsAtGenesis,
    latestStatus: history.at(-1)!.status,
    allPreviousStateHashMatch: lineage.previousHashLinked,
    receivableIdConsistent: lineage.consistency.receivableIdConsistent,
    originatorConsistent: lineage.consistency.originatorConsistent,
    debtorConsistent: lineage.consistency.debtorConsistent,
    currencyConsistent: lineage.consistency.currencyConsistent,
    controllerConsistent: lineage.consistency.controllerConsistent,
    faceValueConsistent: lineage.consistency.faceValueConsistent,
    allArithmeticValid,
    allStatusProgressionValid,
    fullHistoryVerified,
    summaries: lineage.summaries,
  };
}
