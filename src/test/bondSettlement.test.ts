import test from "node:test";
import assert from "node:assert/strict";
import { summarizeBondSettlementDescriptor, validateBondSettlementDescriptor, validateBondSettlementMatchesExpected } from "../domain/bondSettlementValidation";
import type { BondSettlementDescriptor } from "../core/types";

function makeDescriptor(overrides: Partial<BondSettlementDescriptor> = {}): BondSettlementDescriptor {
  return {
    settlementId: "ISSUE-1-SETTLEMENT-PARTIALLY_REDEEMED",
    bondId: "BOND-1",
    issuanceId: "ISSUE-1",
    definitionHash: "a".repeat(64),
    previousStateHash: "b".repeat(64),
    nextStateHash: "c".repeat(64),
    previousStatus: "ISSUED",
    nextStatus: "PARTIALLY_REDEEMED",
    transitionKind: "REDEEM",
    redeemAmount: 250,
    transitionAt: "2027-03-10T00:00:00Z",
    assetId: "bitcoin",
    nextContractAddress: "tex1pexamplecontractaddress0000000000000000000000000000000000000000",
    nextAmountSat: 1900,
    maxFeeSat: 100,
    principal: {
      issued: 1000,
      previousOutstanding: 1000,
      nextOutstanding: 750,
      previousRedeemed: 0,
      nextRedeemed: 250,
    },
    ...overrides,
  };
}

test("bond settlement descriptor hash is stable", () => {
  const descriptor = makeDescriptor();
  const left = summarizeBondSettlementDescriptor(descriptor);
  const right = summarizeBondSettlementDescriptor(JSON.parse(JSON.stringify(descriptor)));
  assert.equal(left.canonicalJson, right.canonicalJson);
  assert.equal(left.hash, right.hash);
});

test("changing nextAmountSat changes settlement descriptor hash", () => {
  const left = summarizeBondSettlementDescriptor(makeDescriptor({ nextAmountSat: 1900 }));
  const right = summarizeBondSettlementDescriptor(makeDescriptor({ nextAmountSat: 1800 }));
  assert.notEqual(left.hash, right.hash);
});

test("changing nextContractAddress changes settlement descriptor hash", () => {
  const left = summarizeBondSettlementDescriptor(makeDescriptor());
  const right = summarizeBondSettlementDescriptor(
    makeDescriptor({ nextContractAddress: "tex1palternatecontractaddress0000000000000000000000000000000000" }),
  );
  assert.notEqual(left.hash, right.hash);
});

test("validateBondSettlementDescriptor rejects invalid redeem amount", () => {
  assert.throws(() => validateBondSettlementDescriptor(makeDescriptor({ redeemAmount: 0 })));
});

test("validateBondSettlementMatchesExpected detects tampered redeem amount", () => {
  const expected = makeDescriptor();
  const actual = makeDescriptor({ redeemAmount: 300 });
  assert.throws(() => validateBondSettlementMatchesExpected(actual, expected));
});

test("validateBondSettlementMatchesExpected detects tampered previousStateHash", () => {
  const expected = makeDescriptor();
  const actual = makeDescriptor({ previousStateHash: "d".repeat(64) });
  assert.throws(() => validateBondSettlementMatchesExpected(actual, expected));
});
