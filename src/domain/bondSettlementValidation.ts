import { stableStringify, sha256HexUtf8 } from "../core/summary";
import { ValidationError } from "../core/errors";
import { BondSettlementDescriptor } from "../core/types";

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

export function summarizeBondSettlementDescriptor(descriptor: BondSettlementDescriptor): {
  canonicalJson: string;
  hash: string;
} {
  const canonicalJson = stableStringify(descriptor);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function validateBondSettlementDescriptor(value: unknown): BondSettlementDescriptor {
  const descriptor = value as BondSettlementDescriptor;
  assertNonEmptyString(
    descriptor?.settlementId,
    "BOND_SETTLEMENT_ID_INVALID",
    "settlementId must be a non-empty string",
  );
  assertNonEmptyString(descriptor?.bondId, "BOND_SETTLEMENT_BOND_ID_INVALID", "bondId must be a non-empty string");
  assertNonEmptyString(
    descriptor?.issuanceId,
    "BOND_SETTLEMENT_ISSUANCE_ID_INVALID",
    "issuanceId must be a non-empty string",
  );
  assertNonEmptyString(
    descriptor?.definitionHash,
    "BOND_SETTLEMENT_DEFINITION_HASH_INVALID",
    "definitionHash must be a non-empty string",
  );
  assertNonEmptyString(
    descriptor?.previousStateHash,
    "BOND_SETTLEMENT_PREVIOUS_STATE_HASH_INVALID",
    "previousStateHash must be a non-empty string",
  );
  assertNonEmptyString(
    descriptor?.nextStateHash,
    "BOND_SETTLEMENT_NEXT_STATE_HASH_INVALID",
    "nextStateHash must be a non-empty string",
  );
  assertNonEmptyString(
    descriptor?.transitionAt,
    "BOND_SETTLEMENT_TRANSITION_AT_INVALID",
    "transitionAt must be a non-empty string",
  );
  assertNonEmptyString(
    descriptor?.assetId,
    "BOND_SETTLEMENT_ASSET_INVALID",
    "assetId must be a non-empty string",
  );
  assertNonEmptyString(
    descriptor?.nextContractAddress,
    "BOND_SETTLEMENT_NEXT_CONTRACT_INVALID",
    "nextContractAddress must be a non-empty string",
  );
  assertFiniteNumber(
    descriptor?.redeemAmount,
    "BOND_SETTLEMENT_REDEEM_AMOUNT_INVALID",
    "redeemAmount must be a finite number",
  );
  assertFiniteNumber(
    descriptor?.nextAmountSat,
    "BOND_SETTLEMENT_AMOUNT_INVALID",
    "nextAmountSat must be a finite number",
  );
  assertFiniteNumber(
    descriptor?.maxFeeSat,
    "BOND_SETTLEMENT_MAX_FEE_INVALID",
    "maxFeeSat must be a finite number",
  );
  if (descriptor.expectedOutputDescriptorHash !== undefined && descriptor.expectedOutputDescriptorHash !== null) {
    assertNonEmptyString(
      descriptor.expectedOutputDescriptorHash,
      "BOND_SETTLEMENT_EXPECTED_OUTPUT_DESCRIPTOR_HASH_INVALID",
      "expectedOutputDescriptorHash must be a non-empty string",
    );
  }
  if (
    descriptor.outputBindingMode !== undefined
    && descriptor.outputBindingMode !== "none"
    && descriptor.outputBindingMode !== "script-bound"
    && descriptor.outputBindingMode !== "descriptor-bound"
  ) {
    throw new ValidationError("outputBindingMode must be none, script-bound, or descriptor-bound", {
      code: "BOND_SETTLEMENT_OUTPUT_BINDING_MODE_INVALID",
    });
  }
  assertFiniteNumber(
    descriptor?.principal?.issued,
    "BOND_SETTLEMENT_PRINCIPAL_INVALID",
    "principal.issued must be a finite number",
  );
  assertFiniteNumber(
    descriptor?.principal?.previousOutstanding,
    "BOND_SETTLEMENT_PRINCIPAL_INVALID",
    "principal.previousOutstanding must be a finite number",
  );
  assertFiniteNumber(
    descriptor?.principal?.nextOutstanding,
    "BOND_SETTLEMENT_PRINCIPAL_INVALID",
    "principal.nextOutstanding must be a finite number",
  );
  assertFiniteNumber(
    descriptor?.principal?.previousRedeemed,
    "BOND_SETTLEMENT_PRINCIPAL_INVALID",
    "principal.previousRedeemed must be a finite number",
  );
  assertFiniteNumber(
    descriptor?.principal?.nextRedeemed,
    "BOND_SETTLEMENT_PRINCIPAL_INVALID",
    "principal.nextRedeemed must be a finite number",
  );
  if (descriptor.transitionKind !== "REDEEM") {
    throw new ValidationError("transitionKind must be REDEEM", {
      code: "BOND_SETTLEMENT_TRANSITION_KIND_INVALID",
    });
  }
  if (descriptor.redeemAmount <= 0) {
    throw new ValidationError("redeemAmount must be greater than 0", {
      code: "BOND_SETTLEMENT_REDEEM_AMOUNT_INVALID",
    });
  }
  if (descriptor.nextAmountSat <= 0) {
    throw new ValidationError("nextAmountSat must be greater than 0", {
      code: "BOND_SETTLEMENT_AMOUNT_INVALID",
    });
  }
  if (descriptor.maxFeeSat < 0) {
    throw new ValidationError("maxFeeSat must not be negative", {
      code: "BOND_SETTLEMENT_MAX_FEE_INVALID",
    });
  }
  if (descriptor.expectedOutputDescriptorHash && !/^[0-9a-f]{64}$/i.test(descriptor.expectedOutputDescriptorHash)) {
    throw new ValidationError("expectedOutputDescriptorHash must be a 64-character hex string", {
      code: "BOND_SETTLEMENT_EXPECTED_OUTPUT_DESCRIPTOR_HASH_INVALID",
    });
  }
  if (Number.isNaN(Date.parse(descriptor.transitionAt))) {
    throw new ValidationError("transitionAt must be an ISO8601 string", {
      code: "BOND_SETTLEMENT_TRANSITION_AT_INVALID",
    });
  }
  return descriptor;
}

export function validateBondSettlementMatchesExpected(
  actual: BondSettlementDescriptor,
  expected: BondSettlementDescriptor,
): {
  bondIdMatch: boolean;
  issuanceIdMatch: boolean;
  definitionHashMatch: boolean;
  previousStateHashMatch: boolean;
  nextStateHashMatch: boolean;
  nextContractAddressMatch: boolean;
  redeemAmountMatch: boolean;
  assetIdMatch: boolean;
  nextAmountSatMatch: boolean;
  maxFeeSatMatch: boolean;
  expectedOutputDescriptorHashMatch: boolean;
  outputBindingModeMatch: boolean;
} {
  const result = {
    bondIdMatch: actual.bondId === expected.bondId,
    issuanceIdMatch: actual.issuanceId === expected.issuanceId,
    definitionHashMatch: actual.definitionHash === expected.definitionHash,
    previousStateHashMatch: actual.previousStateHash === expected.previousStateHash,
    nextStateHashMatch: actual.nextStateHash === expected.nextStateHash,
    nextContractAddressMatch: actual.nextContractAddress === expected.nextContractAddress,
    redeemAmountMatch: actual.redeemAmount === expected.redeemAmount,
    assetIdMatch: actual.assetId === expected.assetId,
    nextAmountSatMatch: actual.nextAmountSat === expected.nextAmountSat,
    maxFeeSatMatch: actual.maxFeeSat === expected.maxFeeSat,
    expectedOutputDescriptorHashMatch:
      (actual.expectedOutputDescriptorHash ?? null) === (expected.expectedOutputDescriptorHash ?? null),
    outputBindingModeMatch:
      (actual.outputBindingMode ?? "none") === (expected.outputBindingMode ?? "none"),
  };
  if (!result.bondIdMatch) {
    throw new ValidationError("Bond settlement bondId does not match expected value", {
      code: "BOND_SETTLEMENT_BOND_ID_MISMATCH",
    });
  }
  if (!result.issuanceIdMatch) {
    throw new ValidationError("Bond settlement issuanceId does not match expected value", {
      code: "BOND_SETTLEMENT_ISSUANCE_ID_MISMATCH",
    });
  }
  if (!result.definitionHashMatch) {
    throw new ValidationError("Bond settlement definitionHash does not match expected value", {
      code: "BOND_SETTLEMENT_DEFINITION_HASH_MISMATCH",
    });
  }
  if (!result.previousStateHashMatch || !result.nextStateHashMatch) {
    throw new ValidationError("Bond settlement state hashes do not match expected values", {
      code: "BOND_SETTLEMENT_STATE_HASH_MISMATCH",
    });
  }
  if (!result.nextContractAddressMatch) {
    throw new ValidationError("Bond settlement nextContractAddress does not match expected value", {
      code: "BOND_SETTLEMENT_NEXT_CONTRACT_MISMATCH",
    });
  }
  if (!result.redeemAmountMatch) {
    throw new ValidationError("Bond settlement redeemAmount does not match expected value", {
      code: "BOND_SETTLEMENT_REDEEM_AMOUNT_MISMATCH",
    });
  }
  if (!result.assetIdMatch) {
    throw new ValidationError("Bond settlement assetId does not match expected value", {
      code: "BOND_SETTLEMENT_ASSET_MISMATCH",
    });
  }
  if (!result.nextAmountSatMatch || !result.maxFeeSatMatch) {
    throw new ValidationError("Bond settlement amount constraints do not match expected values", {
      code: "BOND_SETTLEMENT_AMOUNT_INVALID",
    });
  }
  if (!result.expectedOutputDescriptorHashMatch) {
    throw new ValidationError("Bond settlement expectedOutputDescriptorHash does not match expected value", {
      code: "BOND_SETTLEMENT_EXPECTED_OUTPUT_DESCRIPTOR_HASH_MISMATCH",
    });
  }
  if (!result.outputBindingModeMatch) {
    throw new ValidationError("Bond settlement outputBindingMode does not match expected value", {
      code: "BOND_SETTLEMENT_OUTPUT_BINDING_MODE_MISMATCH",
    });
  }
  return result;
}
