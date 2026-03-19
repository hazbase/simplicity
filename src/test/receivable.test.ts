import test from "node:test";
import assert from "node:assert/strict";
import { createSimplicityClient } from "../client/SimplicityClient";
import {
  exportEvidence,
  exportFinalityPayload,
  prepareClosing,
  prepareFundingClaim,
  prepareFunding,
  prepareRepaymentClaim,
  prepareRepayment,
  prepareWriteOff,
  verifyClosing,
  verifyFundingClaim,
  verifyFunding,
  verifyRepaymentClaim,
  verifyRepayment,
  verifyWriteOff,
  verifyStateHistory,
} from "../domain/receivable";
import {
  applyReceivableRepayment,
  buildDefaultedReceivableState,
  buildFundedReceivableState,
  buildReceivableClosingDescriptor,
  buildReceivableFundingClaimDescriptor,
  buildReceivableRepaymentClaimDescriptor,
  summarizeReceivableClosingDescriptor,
  summarizeReceivableFundingClaimDescriptor,
  summarizeReceivableRepaymentClaimDescriptor,
  summarizeReceivableState,
  validateReceivableClosingAgainstState,
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
} from "../domain/receivableValidation";

const TEST_CONFIG = {
  network: "liquidtestnet" as const,
  rpc: {
    url: "http://127.0.0.1:18884",
    username: "user",
    password: "pass",
    wallet: "simplicity-test",
  },
  toolchain: {
    simcPath: "simc",
    halSimplicityPath: "hal-simplicity",
    elementsCliPath: "eltc",
  },
};

function makeDefinition() {
  return validateReceivableDefinition({
    receivableId: "REC-001",
    originatorEntityId: "originator-1",
    debtorEntityId: "debtor-1",
    currencyAssetId: "bitcoin",
    faceValue: 10000,
    dueDate: "2027-12-31T00:00:00Z",
    controllerXonly: "11".repeat(32),
  });
}

function makeOriginatedState() {
  return validateReceivableState({
    stateId: "REC-001-S0",
    receivableId: "REC-001",
    originatorEntityId: "originator-1",
    debtorEntityId: "debtor-1",
    holderEntityId: "originator-1",
    currencyAssetId: "bitcoin",
    controllerXonly: "11".repeat(32),
    faceValue: 10000,
    outstandingAmount: 10000,
    repaidAmount: 0,
    status: "ORIGINATED",
    createdAt: "2027-01-01T00:00:00Z",
    lastTransition: {
      type: "ORIGINATE",
      amount: 10000,
      at: "2027-01-01T00:00:00Z",
    },
  });
}

function makeFundedState(previousHash: string) {
  return validateReceivableState({
    stateId: "REC-001-S1",
    receivableId: "REC-001",
    originatorEntityId: "originator-1",
    debtorEntityId: "debtor-1",
    holderEntityId: "fund-1",
    currencyAssetId: "bitcoin",
    controllerXonly: "11".repeat(32),
    faceValue: 10000,
    outstandingAmount: 10000,
    repaidAmount: 0,
    status: "FUNDED",
    createdAt: "2027-01-02T00:00:00Z",
    previousStateHash: previousHash,
    lastTransition: {
      type: "FUND",
      amount: 10000,
      at: "2027-01-02T00:00:00Z",
    },
  });
}

function makeRepaidState(previousHash: string) {
  return validateReceivableState({
    stateId: "REC-001-S2",
    receivableId: "REC-001",
    originatorEntityId: "originator-1",
    debtorEntityId: "debtor-1",
    holderEntityId: "fund-1",
    currencyAssetId: "bitcoin",
    controllerXonly: "11".repeat(32),
    faceValue: 10000,
    outstandingAmount: 0,
    repaidAmount: 10000,
    status: "REPAID",
    createdAt: "2027-02-01T00:00:00Z",
    previousStateHash: previousHash,
    lastTransition: {
      type: "REPAY",
      amount: 10000,
      at: "2027-02-01T00:00:00Z",
    },
  });
}

test("valid ReceivableDefinition and ReceivableState pass cross-checks", () => {
  const definition = makeDefinition();
  const state = makeOriginatedState();
  const checks = validateReceivableCrossChecks(definition, state);
  assert.equal(checks.receivableIdMatch, true);
  assert.equal(checks.currencyMatch, true);
  assert.equal(checks.controllerMatch, true);
  assert.equal(checks.arithmeticValid, true);
});

test("verifyReceivableStateHistory validates contiguous receivable lineage", () => {
  const originated = makeOriginatedState();
  const funded = makeFundedState(summarizeReceivableState(originated).hash);
  const repaid = makeRepaidState(summarizeReceivableState(funded).hash);
  const checks = verifyReceivableStateHistory({
    history: [originated, funded, repaid],
  });
  assert.equal(checks.startsAtGenesis, true);
  assert.equal(checks.allPreviousStateHashMatch, true);
  assert.equal(checks.allStatusProgressionValid, true);
  assert.equal(checks.fullHistoryVerified, true);
});

test("sdk exposes receivables lineage skeleton", () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  assert.equal(typeof sdk.receivables.define, "function");
  assert.equal(typeof sdk.receivables.verify, "function");
  assert.equal(typeof sdk.receivables.load, "function");
  assert.equal(typeof sdk.receivables.prepareFunding, "function");
  assert.equal(typeof sdk.receivables.verifyFunding, "function");
  assert.equal(typeof sdk.receivables.prepareFundingClaim, "function");
  assert.equal(typeof sdk.receivables.inspectFundingClaim, "function");
  assert.equal(typeof sdk.receivables.executeFundingClaim, "function");
  assert.equal(typeof sdk.receivables.verifyFundingClaim, "function");
  assert.equal(typeof sdk.receivables.prepareRepayment, "function");
  assert.equal(typeof sdk.receivables.verifyRepayment, "function");
  assert.equal(typeof sdk.receivables.prepareRepaymentClaim, "function");
  assert.equal(typeof sdk.receivables.inspectRepaymentClaim, "function");
  assert.equal(typeof sdk.receivables.executeRepaymentClaim, "function");
  assert.equal(typeof sdk.receivables.verifyRepaymentClaim, "function");
  assert.equal(typeof sdk.receivables.prepareWriteOff, "function");
  assert.equal(typeof sdk.receivables.verifyWriteOff, "function");
  assert.equal(typeof sdk.receivables.prepareClosing, "function");
  assert.equal(typeof sdk.receivables.verifyClosing, "function");
  assert.equal(typeof sdk.receivables.verifyStateHistory, "function");
  assert.equal(typeof sdk.receivables.exportEvidence, "function");
  assert.equal(typeof sdk.receivables.exportFinalityPayload, "function");
});

test("receivable funding transition builder and verifier produce a FUNDED state", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const originated = makeOriginatedState();

  const built = buildFundedReceivableState({
    previous: originated,
    stateId: "REC-001-S1",
    holderEntityId: "fund-1",
    fundedAt: "2027-01-02T00:00:00Z",
  });
  const checks = validateReceivableFundingTransition(originated, built);
  const prepared = await prepareFunding(sdk, {
    definitionValue: definition,
    previousStateValue: originated,
    nextStateValue: built,
  });
  const verified = await verifyFunding(sdk, {
    definitionValue: definition,
    previousStateValue: originated,
    nextStateValue: built,
  });

  assert.equal(built.status, "FUNDED");
  assert.equal(checks.fullTransitionVerified, true);
  assert.equal(prepared.report.transitionTrust?.transitionType, "FUND");
  assert.equal(verified.verified, true);
});

test("receivable repayment helpers handle partial and full repayment", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const originated = makeOriginatedState();
  const funded = makeFundedState(summarizeReceivableState(originated).hash);
  const partial = applyReceivableRepayment({
    previous: funded,
    stateId: "REC-001-S2",
    amount: 4000,
    repaidAt: "2027-02-01T00:00:00Z",
  });
  const repaid = applyReceivableRepayment({
    previous: partial,
    stateId: "REC-001-S3",
    amount: 6000,
    repaidAt: "2027-03-01T00:00:00Z",
  });
  const partialChecks = validateReceivableRepaymentTransition(funded, partial);
  const fullChecks = validateReceivableRepaymentTransition(partial, repaid);
  const prepared = await prepareRepayment(sdk, {
    definitionValue: definition,
    previousStateValue: funded,
    nextStateValue: partial,
  });
  const verified = await verifyRepayment(sdk, {
    definitionValue: definition,
    previousStateValue: partial,
    nextStateValue: repaid,
  });

  assert.equal(partial.status, "PARTIALLY_REPAID");
  assert.equal(repaid.status, "REPAID");
  assert.equal(partialChecks.fullTransitionVerified, true);
  assert.equal(fullChecks.fullTransitionVerified, true);
  assert.equal(prepared.report.transitionTrust?.transitionType, "REPAY");
  assert.equal(verified.verified, true);
});

test("receivable funding claim helpers build, prepare, and verify a runtime claim descriptor", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const originated = makeOriginatedState();
  const funded = makeFundedState(summarizeReceivableState(originated).hash);
  const claim = buildReceivableFundingClaimDescriptor({
    claimId: "REC-001-FUNDING-CLAIM",
    currentState: funded,
  });
  const checks = validateReceivableFundingClaimAgainstState({
    currentState: funded,
    claim,
  });
  const prepared = await prepareFundingClaim(sdk, {
    definitionValue: definition,
    currentStateValue: funded,
    stateHistoryValues: [originated, funded],
    fundingClaimValue: claim,
  });
  const verified = await verifyFundingClaim(sdk, {
    artifact: prepared.compiled.artifact,
    definitionValue: definition,
    currentStateValue: funded,
    stateHistoryValues: [originated, funded],
    fundingClaimValue: claim,
  });

  assert.equal(validateReceivableFundingClaimDescriptor(claim).claimKind, "FUNDING");
  assert.equal(summarizeReceivableFundingClaimDescriptor(claim).hash.length, 64);
  assert.equal(checks.fullClaimVerified, true);
  assert.equal(prepared.report.fundingClaimTrust?.fullClaimVerified, true);
  assert.equal(verified.verified, true);
});

test("receivable repayment claim helpers build, prepare, and verify a runtime claim descriptor", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const originated = makeOriginatedState();
  const funded = makeFundedState(summarizeReceivableState(originated).hash);
  const repaid = makeRepaidState(summarizeReceivableState(funded).hash);
  const claim = buildReceivableRepaymentClaimDescriptor({
    claimId: "REC-001-REPAYMENT-CLAIM",
    currentState: repaid,
  });
  const checks = validateReceivableRepaymentClaimAgainstState({
    currentState: repaid,
    claim,
  });
  const prepared = await prepareRepaymentClaim(sdk, {
    definitionValue: definition,
    currentStateValue: repaid,
    stateHistoryValues: [originated, funded, repaid],
    repaymentClaimValue: claim,
  });
  const verified = await verifyRepaymentClaim(sdk, {
    artifact: prepared.compiled.artifact,
    definitionValue: definition,
    currentStateValue: repaid,
    stateHistoryValues: [originated, funded, repaid],
    repaymentClaimValue: claim,
  });

  assert.equal(validateReceivableRepaymentClaimDescriptor(claim).claimKind, "REPAYMENT");
  assert.equal(summarizeReceivableRepaymentClaimDescriptor(claim).hash.length, 64);
  assert.equal(checks.fullClaimVerified, true);
  assert.equal(prepared.report.repaymentClaimTrust?.fullClaimVerified, true);
  assert.equal(verified.verified, true);
});

test("receivable write-off helper builds a DEFAULTED state", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const originated = makeOriginatedState();
  const funded = makeFundedState(summarizeReceivableState(originated).hash);
  const defaulted = buildDefaultedReceivableState({
    previous: funded,
    stateId: "REC-001-S2",
    defaultedAt: "2027-04-01T00:00:00Z",
  });
  const checks = validateReceivableWriteOffTransition(funded, defaulted);
  const prepared = await prepareWriteOff(sdk, {
    definitionValue: definition,
    previousStateValue: funded,
    nextStateValue: defaulted,
  });
  const verified = await verifyWriteOff(sdk, {
    definitionValue: definition,
    previousStateValue: funded,
    nextStateValue: defaulted,
  });

  assert.equal(defaulted.status, "DEFAULTED");
  assert.equal(checks.fullTransitionVerified, true);
  assert.equal(prepared.report.transitionTrust?.transitionType, "WRITE_OFF");
  assert.equal(verified.verified, true);
});

test("receivable closing builder and verifier require a terminal state", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const originated = makeOriginatedState();
  const funded = makeFundedState(summarizeReceivableState(originated).hash);
  const repaid = makeRepaidState(summarizeReceivableState(funded).hash);
  const closing = buildReceivableClosingDescriptor({
    closingId: "REC-CLOSE-001",
    latestState: repaid,
    closedAt: "2027-03-02T00:00:00Z",
  });
  const closingChecks = validateReceivableClosingAgainstState({
    latestState: repaid,
    closing,
    history: [originated, funded, repaid],
  });
  const prepared = await prepareClosing(sdk, {
    definitionValue: definition,
    latestStateValue: repaid,
    stateHistoryValues: [originated, funded, repaid],
    closingValue: closing,
  });
  const verified = await verifyClosing(sdk, {
    definitionValue: definition,
    latestStateValue: repaid,
    stateHistoryValues: [originated, funded, repaid],
    closingValue: closing,
  });

  assert.equal(summarizeReceivableClosingDescriptor(closing).hash.length, 64);
  assert.equal(closingChecks.fullClosingVerified, true);
  assert.equal(prepared.report.closingTrust?.fullClosingVerified, true);
  assert.equal(verified.verified, true);
});

test("receivable evidence and finality export carry shared lineage trust summary", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const originated = makeOriginatedState();
  const funded = makeFundedState(summarizeReceivableState(originated).hash);
  const repaid = makeRepaidState(summarizeReceivableState(funded).hash);
  const closing = buildReceivableClosingDescriptor({
    closingId: "REC-CLOSE-001",
    latestState: repaid,
    closedAt: "2027-03-02T00:00:00Z",
  });

  const verification = await verifyStateHistory(sdk, {
    definitionValue: definition,
    stateHistoryValues: [originated, funded, repaid],
  });
  const evidence = await exportEvidence(sdk, {
    definitionValue: definition,
    stateHistoryValues: [originated, funded, repaid],
    fundingClaimValue: buildReceivableFundingClaimDescriptor({
      claimId: "REC-001-FUNDING-CLAIM",
      currentState: funded,
    }),
    repaymentClaimValue: buildReceivableRepaymentClaimDescriptor({
      claimId: "REC-001-REPAYMENT-CLAIM",
      currentState: repaid,
    }),
    closingValue: closing,
  });
  const finality = await exportFinalityPayload(sdk, {
    definitionValue: definition,
    stateHistoryValues: [originated, funded, repaid],
    fundingClaimValue: buildReceivableFundingClaimDescriptor({
      claimId: "REC-001-FUNDING-CLAIM",
      currentState: funded,
    }),
    repaymentClaimValue: buildReceivableRepaymentClaimDescriptor({
      claimId: "REC-001-REPAYMENT-CLAIM",
      currentState: repaid,
    }),
    closingValue: closing,
  });

  assert.equal(verification.report.stateLineageTrust?.lineageKind, "state-history");
  assert.equal(verification.report.stateLineageTrust?.fullLineageVerified, true);
  assert.equal(evidence.trustSummary.lineage?.lineageKind, "state-history");
  assert.equal(evidence.trustSummary.lineage?.fullLineageVerified, true);
  assert.match(evidence.fundingClaim?.hash ?? "", /^[0-9a-f]{64}$/);
  assert.match(evidence.repaymentClaim?.hash ?? "", /^[0-9a-f]{64}$/);
  assert.equal(finality.trustSummary.lineage?.lineageKind, "state-history");
  assert.equal(finality.trustSummary.lineage?.fullLineageVerified, true);
  assert.match(finality.fundingClaimHash ?? "", /^[0-9a-f]{64}$/);
  assert.match(finality.repaymentClaimHash ?? "", /^[0-9a-f]{64}$/);
  assert.equal(finality.latestStateHash, summarizeReceivableState(repaid).hash);
  assert.equal(finality.closingHash, summarizeReceivableClosingDescriptor(closing).hash);
  assert.equal(finality.closingReason, "REPAID");
});

test("receivable evidence rejects latest state values that do not match the history tip", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const originated = makeOriginatedState();
  const funded = makeFundedState(summarizeReceivableState(originated).hash);
  const repaid = makeRepaidState(summarizeReceivableState(funded).hash);

  await assert.rejects(
    () =>
      exportEvidence(sdk, {
        definitionValue: definition,
        stateValue: funded,
        stateHistoryValues: [originated, funded, repaid],
      }),
    /latest receivable state must match the tip of the provided state history/i,
  );
});
