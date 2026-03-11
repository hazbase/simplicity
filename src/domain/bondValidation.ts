import { ValidationError } from "../core/errors";
import { BondDefinition, BondIssuanceState } from "../core/types";

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
  if (issuance.status !== "ISSUED" && issuance.status !== "REDEEMED") {
    throw new ValidationError("status must be ISSUED or REDEEMED", { code: "BOND_STATUS_INVALID" });
  }
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
