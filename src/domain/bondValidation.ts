import { ValidationError } from "../core/errors";
import { verifyHashLinkedLineage } from "../core/lineage";
import { stableStringify, sha256HexUtf8 } from "../core/summary";
import {
  BondDefinition,
  BondIssuanceState,
  BondIssuanceStatus,
  BondStateTransition,
} from "../core/types";

function assertNonEmptyString(value: unknown, code: string, message: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(message, { code });
  }
}

function assertFiniteNumber(value: unknown, code: string, message: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(message, { code });
  }
}

function assertValidStatus(status: unknown): asserts status is BondIssuanceStatus {
  if (status !== "ISSUED" && status !== "PARTIALLY_REDEEMED" && status !== "REDEEMED" && status !== "CLOSED") {
    throw new ValidationError("status must be ISSUED, PARTIALLY_REDEEMED, REDEEMED, or CLOSED", {
      code: "BOND_STATUS_INVALID",
    });
  }
}

function validateBondTransition(value: unknown): BondStateTransition {
  const transition = value as BondStateTransition;
  if (transition.type !== "ISSUE" && transition.type !== "REDEEM") {
    throw new ValidationError("lastTransition.type must be ISSUE or REDEEM", {
      code: "BOND_TRANSITION_TYPE_INVALID",
    });
  }
  assertFiniteNumber(
    transition.amount,
    "BOND_TRANSITION_AMOUNT_INVALID",
    "lastTransition.amount must be a finite number"
  );
  if (transition.amount <= 0) {
    throw new ValidationError("lastTransition.amount must be greater than 0", {
      code: "BOND_TRANSITION_AMOUNT_INVALID",
    });
  }
  assertNonEmptyString(
    transition.at,
    "BOND_TRANSITION_AT_INVALID",
    "lastTransition.at must be a non-empty string"
  );
  if (Number.isNaN(Date.parse(transition.at))) {
    throw new ValidationError("lastTransition.at must be an ISO8601 string", {
      code: "BOND_TRANSITION_AT_INVALID",
    });
  }
  return transition;
}

export function summarizeBondIssuanceState(state: BondIssuanceState): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(state);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function validateBondDefinition(value: unknown): BondDefinition {
  const definition = value as BondDefinition;
  assertNonEmptyString(definition?.bondId, "BOND_ID_INVALID", "bondId must be a non-empty string");
  assertNonEmptyString(definition?.issuer, "BOND_ISSUER_INVALID", "issuer must be a non-empty string");
  assertFiniteNumber(definition?.faceValue, "BOND_FACE_VALUE_INVALID", "faceValue must be a finite number");
  assertFiniteNumber(definition?.couponBps, "BOND_COUPON_INVALID", "couponBps must be a finite number");
  assertNonEmptyString(definition?.issueDate, "BOND_ISSUE_DATE_INVALID", "issueDate must be a non-empty string");
  assertFiniteNumber(
    definition?.maturityDate,
    "BOND_MATURITY_DATE_INVALID",
    "maturityDate must be a finite number"
  );
  assertNonEmptyString(
    definition?.currencyAssetId,
    "BOND_CURRENCY_INVALID",
    "currencyAssetId must be a non-empty string"
  );
  assertNonEmptyString(
    definition?.controllerXonly,
    "BOND_CONTROLLER_INVALID",
    "controllerXonly must be a non-empty string"
  );
  return definition;
}

export function validateBondIssuanceState(value: unknown): BondIssuanceState {
  const issuance = value as BondIssuanceState;
  assertNonEmptyString(issuance?.issuanceId, "BOND_ISSUANCE_ID_INVALID", "issuanceId must be a non-empty string");
  assertNonEmptyString(issuance?.bondId, "BOND_ID_INVALID", "bondId must be a non-empty string");
  assertNonEmptyString(
    issuance?.issuerEntityId,
    "BOND_ISSUER_ENTITY_INVALID",
    "issuerEntityId must be a non-empty string"
  );
  assertFiniteNumber(
    issuance?.issuedPrincipal,
    "BOND_ISSUED_PRINCIPAL_INVALID",
    "issuedPrincipal must be a finite number"
  );
  assertFiniteNumber(
    issuance?.outstandingPrincipal,
    "BOND_OUTSTANDING_PRINCIPAL_INVALID",
    "outstandingPrincipal must be a finite number"
  );
  assertFiniteNumber(
    issuance?.redeemedPrincipal,
    "BOND_REDEEMED_PRINCIPAL_INVALID",
    "redeemedPrincipal must be a finite number"
  );
  assertNonEmptyString(
    issuance?.currencyAssetId,
    "BOND_CURRENCY_INVALID",
    "currencyAssetId must be a non-empty string"
  );
  assertNonEmptyString(
    issuance?.controllerXonly,
    "BOND_CONTROLLER_INVALID",
    "controllerXonly must be a non-empty string"
  );
  assertNonEmptyString(issuance?.issuedAt, "BOND_ISSUED_AT_INVALID", "issuedAt must be a non-empty string");
  assertValidStatus(issuance.status);
  if (issuance.issuedPrincipal <= 0) {
    throw new ValidationError("issuedPrincipal must be greater than 0", { code: "BOND_PRINCIPAL_INVARIANT_INVALID" });
  }
  if (issuance.outstandingPrincipal < 0 || issuance.redeemedPrincipal < 0) {
    throw new ValidationError("principal values must not be negative", { code: "BOND_PRINCIPAL_INVARIANT_INVALID" });
  }
  if (issuance.issuedPrincipal !== issuance.outstandingPrincipal + issuance.redeemedPrincipal) {
    throw new ValidationError("issuedPrincipal must equal outstandingPrincipal + redeemedPrincipal", {
      code: "BOND_PRINCIPAL_INVARIANT_INVALID",
    });
  }
  if (Number.isNaN(Date.parse(issuance.issuedAt))) {
    throw new ValidationError("issuedAt must be an ISO8601 string", { code: "BOND_ISSUED_AT_INVALID" });
  }
  if (issuance.previousStateHash !== undefined && issuance.previousStateHash !== null) {
    assertNonEmptyString(
      issuance.previousStateHash,
      "BOND_PREVIOUS_STATE_HASH_INVALID",
      "previousStateHash must be a non-empty string when provided"
    );
    if (!/^[0-9a-f]{64}$/i.test(issuance.previousStateHash)) {
      throw new ValidationError("previousStateHash must be a 64-character hex string", {
        code: "BOND_PREVIOUS_STATE_HASH_INVALID",
      });
    }
  }
  const transition = issuance.lastTransition ? validateBondTransition(issuance.lastTransition) : undefined;
  if (issuance.status === "ISSUED") {
    if (issuance.redeemedPrincipal !== 0 || issuance.outstandingPrincipal !== issuance.issuedPrincipal) {
      throw new ValidationError("ISSUED state must have full outstanding principal and zero redeemed principal", {
        code: "BOND_STATUS_TRANSITION_INVALID",
      });
    }
    if (issuance.previousStateHash) {
      throw new ValidationError("ISSUED state must not set previousStateHash", {
        code: "BOND_PREVIOUS_STATE_HASH_INVALID",
      });
    }
    if (transition && transition.type !== "ISSUE") {
      throw new ValidationError("ISSUED state may only carry an ISSUE transition", {
        code: "BOND_TRANSITION_TYPE_INVALID",
      });
    }
  }
  if (issuance.status === "PARTIALLY_REDEEMED") {
    if (issuance.redeemedPrincipal <= 0 || issuance.outstandingPrincipal <= 0) {
      throw new ValidationError("PARTIALLY_REDEEMED state must have both redeemed and outstanding principal", {
        code: "BOND_STATUS_TRANSITION_INVALID",
      });
    }
    if (!issuance.previousStateHash) {
      throw new ValidationError("PARTIALLY_REDEEMED state must set previousStateHash", {
        code: "BOND_PREVIOUS_STATE_HASH_INVALID",
      });
    }
    if (!transition || transition.type !== "REDEEM") {
      throw new ValidationError("PARTIALLY_REDEEMED state must carry a REDEEM transition", {
        code: "BOND_TRANSITION_TYPE_INVALID",
      });
    }
  }
  if (issuance.status === "REDEEMED") {
    if (issuance.outstandingPrincipal !== 0 || issuance.redeemedPrincipal !== issuance.issuedPrincipal) {
      throw new ValidationError("REDEEMED state must have zero outstanding principal and full redeemed principal", {
        code: "BOND_STATUS_TRANSITION_INVALID",
      });
    }
    if (issuance.redeemedPrincipal <= 0) {
      throw new ValidationError("REDEEMED state must have positive redeemed principal", {
        code: "BOND_STATUS_TRANSITION_INVALID",
      });
    }
    if (!issuance.previousStateHash) {
      throw new ValidationError("REDEEMED state must set previousStateHash", {
        code: "BOND_PREVIOUS_STATE_HASH_INVALID",
      });
    }
    if (!transition || transition.type !== "REDEEM") {
      throw new ValidationError("REDEEMED state must carry a REDEEM transition", {
        code: "BOND_TRANSITION_TYPE_INVALID",
      });
    }
  }
  if (issuance.status === "CLOSED") {
    if (issuance.outstandingPrincipal !== 0 || issuance.redeemedPrincipal !== issuance.issuedPrincipal) {
      throw new ValidationError("CLOSED state must have zero outstanding principal and full redeemed principal", {
        code: "BOND_STATUS_TRANSITION_INVALID",
      });
    }
    if (!issuance.previousStateHash) {
      throw new ValidationError("CLOSED state must set previousStateHash", {
        code: "BOND_PREVIOUS_STATE_HASH_INVALID",
      });
    }
    if (!issuance.closedAt || Number.isNaN(Date.parse(issuance.closedAt))) {
      throw new ValidationError("CLOSED state must set closedAt as an ISO8601 string", {
        code: "BOND_CLOSED_AT_INVALID",
      });
    }
    if (
      issuance.closingReason !== "REDEEMED"
      && issuance.closingReason !== "CANCELLED"
      && issuance.closingReason !== "MATURED_OUT"
    ) {
      throw new ValidationError("CLOSED state must set a valid closingReason", {
        code: "BOND_CLOSING_REASON_INVALID",
      });
    }
    if (!issuance.finalSettlementDescriptorHash || !/^[0-9a-f]{64}$/i.test(issuance.finalSettlementDescriptorHash)) {
      throw new ValidationError("CLOSED state must set finalSettlementDescriptorHash as a 64-character hex string", {
        code: "BOND_FINAL_SETTLEMENT_DESCRIPTOR_HASH_INVALID",
      });
    }
    if (!transition || transition.type !== "REDEEM") {
      throw new ValidationError("CLOSED state must carry a REDEEM transition", {
        code: "BOND_TRANSITION_TYPE_INVALID",
      });
    }
  }
  return issuance;
}

export function validateBondCrossChecks(definition: BondDefinition, issuance: BondIssuanceState): {
  bondIdMatch: boolean;
  currencyMatch: boolean;
  controllerMatch: boolean;
  principalInvariantValid: boolean;
} {
  const result = {
    bondIdMatch: definition.bondId === issuance.bondId,
    currencyMatch: definition.currencyAssetId === issuance.currencyAssetId,
    controllerMatch: definition.controllerXonly === issuance.controllerXonly,
    principalInvariantValid:
      issuance.issuedPrincipal > 0 &&
      issuance.outstandingPrincipal >= 0 &&
      issuance.redeemedPrincipal >= 0 &&
      issuance.issuedPrincipal === issuance.outstandingPrincipal + issuance.redeemedPrincipal,
  };
  if (!result.bondIdMatch) {
    throw new ValidationError("Bond definition and issuance state bondId do not match", {
      code: "BOND_ID_MISMATCH",
    });
  }
  if (!result.currencyMatch) {
    throw new ValidationError("Bond definition and issuance state currencyAssetId do not match", {
      code: "BOND_CURRENCY_MISMATCH",
    });
  }
  if (!result.controllerMatch) {
    throw new ValidationError("Bond definition and issuance state controllerXonly do not match", {
      code: "BOND_CONTROLLER_MISMATCH",
    });
  }
  if (!result.principalInvariantValid) {
    throw new ValidationError("Bond issuance principal invariants are invalid", {
      code: "BOND_PRINCIPAL_INVARIANT_INVALID",
    });
  }
  return result;
}

export function validateBondStateTransition(
  previous: BondIssuanceState,
  next: BondIssuanceState
): {
  issuanceIdMatch: boolean;
  bondIdMatch: boolean;
  currencyMatch: boolean;
  controllerMatch: boolean;
  issuerEntityMatch: boolean;
  issuedPrincipalMatch: boolean;
  previousStateHashMatch: boolean;
  redemptionArithmeticValid: boolean;
  statusProgressionValid: boolean;
} {
  const previousHash = summarizeBondIssuanceState(previous).hash;
  const result = {
    issuanceIdMatch: previous.issuanceId === next.issuanceId,
    bondIdMatch: previous.bondId === next.bondId,
    currencyMatch: previous.currencyAssetId === next.currencyAssetId,
    controllerMatch: previous.controllerXonly === next.controllerXonly,
    issuerEntityMatch: previous.issuerEntityId === next.issuerEntityId,
    issuedPrincipalMatch: previous.issuedPrincipal === next.issuedPrincipal,
    previousStateHashMatch: next.previousStateHash === previousHash,
    redemptionArithmeticValid: false,
    statusProgressionValid: false,
  };
  if (!result.issuanceIdMatch) {
    throw new ValidationError("Bond issuance transition issuanceId does not match", {
      code: "BOND_ISSUANCE_ID_MISMATCH",
    });
  }
  if (!result.bondIdMatch) {
    throw new ValidationError("Bond issuance transition bondId does not match", {
      code: "BOND_ID_MISMATCH",
    });
  }
  if (!result.currencyMatch) {
    throw new ValidationError("Bond issuance transition currencyAssetId does not match", {
      code: "BOND_CURRENCY_MISMATCH",
    });
  }
  if (!result.controllerMatch) {
    throw new ValidationError("Bond issuance transition controllerXonly does not match", {
      code: "BOND_CONTROLLER_MISMATCH",
    });
  }
  if (!result.issuerEntityMatch) {
    throw new ValidationError("Bond issuance transition issuerEntityId does not match", {
      code: "BOND_ISSUER_ENTITY_MISMATCH",
    });
  }
  if (!result.issuedPrincipalMatch) {
    throw new ValidationError("Bond issuance transition issuedPrincipal must remain constant", {
      code: "BOND_ISSUED_PRINCIPAL_MISMATCH",
    });
  }
  if (!result.previousStateHashMatch) {
    throw new ValidationError("Bond issuance transition previousStateHash does not match the prior state hash", {
      code: "BOND_PREVIOUS_STATE_HASH_MISMATCH",
    });
  }

  const transition = next.lastTransition;
  if (!transition || transition.type !== "REDEEM") {
    throw new ValidationError("Bond issuance transition must be a REDEEM transition", {
      code: "BOND_TRANSITION_TYPE_INVALID",
    });
  }

  if (previous.status === "REDEEMED" && next.status === "CLOSED") {
    result.redemptionArithmeticValid =
      next.outstandingPrincipal === previous.outstandingPrincipal &&
      next.redeemedPrincipal === previous.redeemedPrincipal;
  } else {
    const expectedOutstanding = previous.outstandingPrincipal - transition.amount;
    const expectedRedeemed = previous.redeemedPrincipal + transition.amount;
    result.redemptionArithmeticValid =
      expectedOutstanding >= 0 &&
      next.outstandingPrincipal === expectedOutstanding &&
      next.redeemedPrincipal === expectedRedeemed;
  }
  if (!result.redemptionArithmeticValid) {
    throw new ValidationError("Bond issuance redemption arithmetic is invalid", {
      code: "BOND_REDEMPTION_ARITHMETIC_INVALID",
    });
  }

  result.statusProgressionValid =
    (
      ((previous.status === "ISSUED" || previous.status === "PARTIALLY_REDEEMED") &&
        ((next.status === "PARTIALLY_REDEEMED" && next.outstandingPrincipal > 0) ||
          (next.status === "REDEEMED" && next.outstandingPrincipal === 0))) ||
      (previous.status === "REDEEMED" && next.status === "CLOSED" && next.outstandingPrincipal === 0)
    );
  if (!result.statusProgressionValid) {
    throw new ValidationError("Bond issuance status progression is invalid", {
      code: "BOND_STATUS_TRANSITION_INVALID",
    });
  }

  return result;
}

export function buildRedeemedBondIssuanceState(input: {
  previous: BondIssuanceState;
  amount: number;
  redeemedAt: string;
}): BondIssuanceState {
  assertFiniteNumber(input.amount, "BOND_TRANSITION_AMOUNT_INVALID", "amount must be a finite number");
  if (input.amount <= 0) {
    throw new ValidationError("amount must be greater than 0", { code: "BOND_TRANSITION_AMOUNT_INVALID" });
  }
  assertNonEmptyString(input.redeemedAt, "BOND_TRANSITION_AT_INVALID", "redeemedAt must be a non-empty string");
  if (Number.isNaN(Date.parse(input.redeemedAt))) {
    throw new ValidationError("redeemedAt must be an ISO8601 string", {
      code: "BOND_TRANSITION_AT_INVALID",
    });
  }
  const previous = validateBondIssuanceState(input.previous);
  if (previous.status === "REDEEMED") {
    throw new ValidationError("Cannot redeem an already redeemed bond issuance state", {
      code: "BOND_ALREADY_REDEEMED",
    });
  }
  if (input.amount > previous.outstandingPrincipal) {
    throw new ValidationError("Redeem amount must not exceed outstandingPrincipal", {
      code: "BOND_REDEEM_AMOUNT_EXCEEDS_OUTSTANDING",
    });
  }
  const nextOutstanding = previous.outstandingPrincipal - input.amount;
  const nextRedeemed = previous.redeemedPrincipal + input.amount;
  const next: BondIssuanceState = {
    ...previous,
    outstandingPrincipal: nextOutstanding,
    redeemedPrincipal: nextRedeemed,
    previousStateHash: summarizeBondIssuanceState(previous).hash,
    status: nextOutstanding === 0 ? "REDEEMED" : "PARTIALLY_REDEEMED",
    lastTransition: {
      type: "REDEEM",
      amount: input.amount,
      at: input.redeemedAt,
    },
  };
  return validateBondIssuanceState(next);
}

export function buildClosedBondIssuanceState(input: {
  previous: BondIssuanceState;
  closedAt: string;
  closingReason: "REDEEMED" | "CANCELLED" | "MATURED_OUT";
  finalSettlementDescriptorHash: string;
}): BondIssuanceState {
  const previous = validateBondIssuanceState(input.previous);
  if (previous.status !== "REDEEMED") {
    throw new ValidationError("Only a REDEEMED issuance state can be closed", {
      code: "BOND_CLOSING_PRECONDITION_INVALID",
    });
  }
  assertNonEmptyString(input.closedAt, "BOND_CLOSED_AT_INVALID", "closedAt must be a non-empty string");
  if (Number.isNaN(Date.parse(input.closedAt))) {
    throw new ValidationError("closedAt must be an ISO8601 string", {
      code: "BOND_CLOSED_AT_INVALID",
    });
  }
  if (!/^[0-9a-f]{64}$/i.test(input.finalSettlementDescriptorHash)) {
    throw new ValidationError("finalSettlementDescriptorHash must be a 64-character hex string", {
      code: "BOND_FINAL_SETTLEMENT_DESCRIPTOR_HASH_INVALID",
    });
  }
  return validateBondIssuanceState({
    ...previous,
    status: "CLOSED",
    previousStateHash: summarizeBondIssuanceState(previous).hash,
    closedAt: input.closedAt,
    closingReason: input.closingReason,
    finalSettlementDescriptorHash: input.finalSettlementDescriptorHash,
  });
}

export function verifyBondIssuanceHistory(input: {
  history: BondIssuanceState[];
}) {
  if (input.history.length === 0) {
    throw new ValidationError("bond issuance history must include at least one state", {
      code: "BOND_ISSUANCE_HISTORY_REQUIRED",
    });
  }

  const history = input.history.map((state) => validateBondIssuanceState(state));
  const lineage = verifyHashLinkedLineage({
    entries: history,
    summarize: summarizeBondIssuanceState,
    getPreviousHash: (state) => state.previousStateHash,
    isGenesis: (state) => state.status === "ISSUED" && !state.previousStateHash,
    consistencyChecks: {
      issuanceIdConsistent: (state, first) => state.issuanceId === first.issuanceId,
      bondIdConsistent: (state, first) => state.bondId === first.bondId,
      currencyConsistent: (state, first) => state.currencyAssetId === first.currencyAssetId,
      controllerConsistent: (state, first) => state.controllerXonly === first.controllerXonly,
      issuerEntityConsistent: (state, first) => state.issuerEntityId === first.issuerEntityId,
      issuedPrincipalConsistent: (state, first) => state.issuedPrincipal === first.issuedPrincipal,
    },
  });

  const transitionChecks = history.slice(1).map((state, index) => validateBondStateTransition(history[index]!, state));
  const allPreviousStateHashMatch = transitionChecks.every((check) => check.previousStateHashMatch);
  const allRedemptionArithmeticValid = transitionChecks.every((check) => check.redemptionArithmeticValid);
  const allStatusProgressionValid = transitionChecks.every((check) => check.statusProgressionValid);
  const allTransitionIdentitiesMatch = transitionChecks.every((check) => (
    check.issuanceIdMatch
    && check.bondIdMatch
    && check.currencyMatch
    && check.controllerMatch
    && check.issuerEntityMatch
    && check.issuedPrincipalMatch
  ));

  return {
    chainLength: history.length,
    latestStatus: history.at(-1)?.status,
    startsAtGenesis: lineage.startsAtGenesis,
    previousStateHashLinked: lineage.previousHashLinked,
    issuanceIdConsistent: lineage.consistency.issuanceIdConsistent,
    bondIdConsistent: lineage.consistency.bondIdConsistent,
    currencyConsistent: lineage.consistency.currencyConsistent,
    controllerConsistent: lineage.consistency.controllerConsistent,
    issuerEntityConsistent: lineage.consistency.issuerEntityConsistent,
    issuedPrincipalConsistent: lineage.consistency.issuedPrincipalConsistent,
    allPreviousStateHashMatch,
    allRedemptionArithmeticValid,
    allStatusProgressionValid,
    allTransitionIdentitiesMatch,
    fullHistoryVerified: lineage.fullLineageVerified
      && allPreviousStateHashMatch
      && allRedemptionArithmeticValid
      && allStatusProgressionValid
      && allTransitionIdentitiesMatch,
    transitionChecks,
  };
}
