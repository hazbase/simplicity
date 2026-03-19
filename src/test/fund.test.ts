import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ValidationError } from "../core/errors";
import { createSimplicityClient } from "../client/SimplicityClient";
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
  validateClosingAgainstReceipt,
  validateDistributionAgainstReceipt,
  verifyLPPositionReceiptEnvelopeChain,
  verifyLPPositionReceiptEnvelope,
} from "../domain/fundValidation";
import {
  exportEvidence,
  exportFinalityPayload,
  prepareCapitalCall,
  prepareClosing,
  prepareDistribution,
  reconcilePosition,
  signPositionReceipt,
  verifyCapitalCall,
  verifyClosing,
  verifyDistribution,
  verifyPositionReceipt,
  verifyPositionReceiptChain,
} from "../domain/fund";
import type { CapitalCallState, FundDefinition, LPPositionReceipt, LPPositionReceiptEnvelope } from "../core/types";

const execFileAsync = promisify(execFile);

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

const MANAGER_PRIVKEY = "0000000000000000000000000000000000000000000000000000000000000001";
const MANAGER_XONLY = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

function makeDefinition(overrides: Partial<FundDefinition> = {}): FundDefinition {
  return {
    fundId: "FUND-2026-ALPHA",
    managerEntityId: "manager-a",
    managerXonly: MANAGER_XONLY,
    currencyAssetId: "bitcoin",
    jurisdiction: "JP",
    vintage: "2026",
    ...overrides,
  };
}

function makeCapitalCall(overrides: Partial<CapitalCallState> = {}): CapitalCallState {
  return {
    callId: "CALL-001",
    fundId: "FUND-2026-ALPHA",
    lpId: "lp-a",
    currencyAssetId: "bitcoin",
    amount: 6000,
    lpXonly: "f9308a019258c3106ac5d2d1c1d7d7f3c2e5f5b7a9e3d5f2c1a6b8c9d0e1f2a3",
    managerXonly: MANAGER_XONLY,
    status: "OPEN",
    claimCutoffHeight: 2345678,
    ...overrides,
  };
}

async function makeEnvelope(receipt: LPPositionReceipt): Promise<LPPositionReceiptEnvelope> {
  return signLPPositionReceipt({
    receipt,
    managerXonly: MANAGER_XONLY,
    signer: { type: "schnorrPrivkeyHex", privkeyHex: MANAGER_PRIVKEY },
    signedAt: "2026-03-18T00:00:00Z",
  });
}

async function makeReceiptChain() {
  const capitalCall = makeCapitalCall();
  const initialReceipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall,
    effectiveAt: "2026-03-18T00:00:00Z",
  });
  const initialEnvelope = await makeEnvelope(initialReceipt);
  const firstDistribution = buildDistributionDescriptor({
    distributionId: "DIST-001",
    receipt: initialReceipt,
    assetId: capitalCall.currencyAssetId,
    amountSat: 2000,
    approvedAt: "2027-03-18T00:00:00Z",
  });
  const afterFirstReceipt = reconcileLPPositionReceipt({
    previousEnvelope: initialEnvelope,
    distributions: [firstDistribution],
  });
  const afterFirstEnvelope = await makeEnvelope(afterFirstReceipt);
  const secondDistribution = buildDistributionDescriptor({
    distributionId: "DIST-002",
    receipt: afterFirstReceipt,
    assetId: capitalCall.currencyAssetId,
    amountSat: initialReceipt.fundedAmount - 2000,
    approvedAt: "2028-03-18T00:00:00Z",
  });
  const afterSecondReceipt = reconcileLPPositionReceipt({
    previousEnvelope: afterFirstEnvelope,
    distributions: [secondDistribution],
  });
  const afterSecondEnvelope = await makeEnvelope(afterSecondReceipt);
  return {
    capitalCall,
    initialReceipt,
    initialEnvelope,
    firstDistribution,
    afterFirstReceipt,
    afterFirstEnvelope,
    secondDistribution,
    afterSecondReceipt,
    afterSecondEnvelope,
    chain: [initialEnvelope, afterFirstEnvelope, afterSecondEnvelope],
  };
}

async function hasToolchain(): Promise<boolean> {
  try {
    await execFileAsync("simc", ["--version"]);
    await execFileAsync("hal-simplicity", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

test("fund definition hash is stable", () => {
  const left = summarizeFundDefinition(makeDefinition());
  const right = summarizeFundDefinition(JSON.parse(JSON.stringify(makeDefinition())));
  assert.equal(left.canonicalJson, right.canonicalJson);
  assert.equal(left.hash, right.hash);
});

test("capital call state hash changes when claim cutoff changes", () => {
  const left = summarizeCapitalCallState(makeCapitalCall({ claimCutoffHeight: 100 }));
  const right = summarizeCapitalCallState(makeCapitalCall({ claimCutoffHeight: 101 }));
  assert.notEqual(left.hash, right.hash);
});

test("claimed, refund-only, and refunded capital call states keep previous hash", () => {
  const previous = makeCapitalCall();
  const claimed = buildClaimedCapitalCallState({
    previous,
    claimedAt: "2026-03-18T00:00:00Z",
  });
  const refundOnly = buildRefundOnlyCapitalCallState({ previous });
  const refunded = buildRefundedCapitalCallState({
    previous: refundOnly,
    refundedAt: "2026-03-19T00:00:00Z",
  });
  assert.equal(claimed.status, "CLAIMED");
  assert.equal(refundOnly.status, "REFUND_ONLY");
  assert.equal(refunded.status, "REFUNDED");
  assert.equal(claimed.previousStateHash, summarizeCapitalCallState(previous).hash);
  assert.equal(refundOnly.previousStateHash, summarizeCapitalCallState(previous).hash);
  assert.equal(refunded.previousStateHash, summarizeCapitalCallState(refundOnly).hash);
});

test("LPPositionReceipt generation is stable and starts at sequence 0", () => {
  const receipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall: makeCapitalCall(),
    effectiveAt: "2026-03-18T00:00:00Z",
  });
  const summary = summarizeLPPositionReceipt(receipt);
  assert.equal(receipt.schemaVersion, "lp-position-receipt/v2");
  assert.equal(receipt.sequence, 0);
  assert.equal(receipt.distributedAmount, 0);
  assert.equal(receipt.distributionCount, 0);
  assert.equal(summary.hash.length, 64);
});

test("position receipt envelope signs and verifies against manager attestation", async () => {
  const receipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall: makeCapitalCall(),
    effectiveAt: "2026-03-18T00:00:00Z",
  });
  const envelope = await makeEnvelope(receipt);
  const checks = await verifyLPPositionReceiptEnvelope({
    envelope,
    expectedManagerXonly: MANAGER_XONLY,
  });
  assert.equal(checks.positionReceiptHashMatch, true);
  assert.equal(checks.sequenceMatch, true);
  assert.equal(checks.sequenceMonotonic, true);
  assert.equal(checks.attestingSignerMatch, true);
  assert.equal(checks.attestationVerified, true);
  assert.equal(summarizeLPPositionReceiptEnvelope(envelope).hash.length, 64);
});

test("position receipt envelope rejects signer mismatch", async () => {
  const receipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall: makeCapitalCall(),
    effectiveAt: "2026-03-18T00:00:00Z",
  });
  await assert.rejects(
    () => signLPPositionReceipt({
      receipt,
      managerXonly: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      signer: { type: "schnorrPrivkeyHex", privkeyHex: MANAGER_PRIVKEY },
      signedAt: "2026-03-18T00:00:00Z",
    }),
    (error: unknown) => error instanceof ValidationError,
  );
});

test("distribution descriptor is tied to receipt hash", () => {
  const receipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall: makeCapitalCall(),
    effectiveAt: "2026-03-18T00:00:00Z",
  });
  const distribution = buildDistributionDescriptor({
    distributionId: "DIST-001",
    receipt,
    assetId: "bitcoin",
    amountSat: 2500,
    approvedAt: "2027-03-18T00:00:00Z",
  });
  const checks = validateDistributionAgainstReceipt(receipt, distribution);
  assert.equal(checks.positionReceiptHashMatch, true);
  assert.equal(summarizeDistributionDescriptor(distribution).hash.length, 64);
});

test("reconcileLPPositionReceipt increments sequence and previousReceiptHash", async () => {
  const receipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall: makeCapitalCall(),
    effectiveAt: "2026-03-18T00:00:00Z",
  });
  const envelope = await makeEnvelope(receipt);
  const distribution = buildDistributionDescriptor({
    distributionId: "DIST-001",
    receipt,
    assetId: "bitcoin",
    amountSat: 2000,
    approvedAt: "2027-03-18T00:00:00Z",
  });
  const reconciled = reconcileLPPositionReceipt({
    previousEnvelope: envelope,
    distributions: [distribution],
  });
  assert.equal(reconciled.sequence, 1);
  assert.equal(reconciled.previousReceiptHash, summarizeLPPositionReceipt(receipt).hash);
  assert.equal(reconciled.distributedAmount, 2000);
  assert.equal(reconciled.status, "PARTIALLY_DISTRIBUTED");
});

test("position receipt continuity requires the immediate previous envelope", async () => {
  const receipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall: makeCapitalCall(),
    effectiveAt: "2026-03-18T00:00:00Z",
  });
  const envelope = await makeEnvelope(receipt);
  const distribution = buildDistributionDescriptor({
    distributionId: "DIST-001",
    receipt,
    assetId: "bitcoin",
    amountSat: 2000,
    approvedAt: "2027-03-18T00:00:00Z",
  });
  const reconciled = reconcileLPPositionReceipt({
    previousEnvelope: envelope,
    distributions: [distribution],
  });
  const reconciledEnvelope = await makeEnvelope(reconciled);
  const withoutPrevious = await verifyLPPositionReceiptEnvelope({
    envelope: reconciledEnvelope,
    expectedManagerXonly: MANAGER_XONLY,
  });
  const withPrevious = await verifyLPPositionReceiptEnvelope({
    envelope: reconciledEnvelope,
    expectedManagerXonly: MANAGER_XONLY,
    previousEnvelope: envelope,
  });
  assert.equal(withoutPrevious.continuityVerified, false);
  assert.equal(withoutPrevious.previousEnvelopeProvided, false);
  assert.equal(withPrevious.continuityVerified, true);
  assert.equal(withPrevious.previousReceiptHashMatch, true);
  assert.equal(withPrevious.previousSequenceMatch, true);
});

test("full receipt chain verification succeeds for contiguous attested envelopes", async () => {
  const { chain } = await makeReceiptChain();
  const checks = await verifyLPPositionReceiptEnvelopeChain({
    envelopes: chain,
    expectedManagerXonly: MANAGER_XONLY,
  });
  assert.equal(checks.chainLength, 3);
  assert.equal(checks.startsAtGenesis, true);
  assert.equal(checks.sequenceContiguous, true);
  assert.equal(checks.allContinuityVerified, true);
  assert.equal(checks.fullChainVerified, true);
});

test("full receipt chain verification detects partial history", async () => {
  const { afterFirstEnvelope, afterSecondEnvelope } = await makeReceiptChain();
  const checks = await verifyLPPositionReceiptEnvelopeChain({
    envelopes: [afterFirstEnvelope, afterSecondEnvelope],
    expectedManagerXonly: MANAGER_XONLY,
  });
  assert.equal(checks.startsAtGenesis, false);
  assert.equal(checks.latestSequenceCovered, false);
  assert.equal(checks.fullChainVerified, false);
});

test("closing requires fully distributed receipt", async () => {
  const receipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall: makeCapitalCall(),
    effectiveAt: "2026-03-18T00:00:00Z",
  });
  const fullDistribution = buildDistributionDescriptor({
    distributionId: "DIST-001",
    receipt,
    assetId: "bitcoin",
    amountSat: receipt.fundedAmount,
    approvedAt: "2027-03-18T00:00:00Z",
  });
  const reconciled = reconcileLPPositionReceipt({
    previousEnvelope: await makeEnvelope(receipt),
    distributions: [fullDistribution],
  });
  const closing = buildFundClosingDescriptor({
    receipt: reconciled,
    closingId: "CLOSE-001",
    finalDistributionHashes: ["a".repeat(64)],
    closedAt: "2028-03-18T00:00:00Z",
  });
  const checks = validateClosingAgainstReceipt(reconciled, closing);
  assert.equal(checks.positionStatusEligible, true);
  assert.equal(summarizeFundClosingDescriptor(closing).hash.length, 64);
});

test("sdk exposes funds security-first business layer", () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  assert.equal(typeof sdk.funds.prepareCapitalCall, "function");
  assert.equal(typeof sdk.funds.inspectCapitalCallRollover, "function");
  assert.equal(typeof sdk.funds.executeCapitalCallRefund, "function");
  assert.equal(typeof sdk.funds.signPositionReceipt, "function");
  assert.equal(typeof sdk.funds.verifyPositionReceipt, "function");
  assert.equal(typeof sdk.funds.verifyPositionReceiptChain, "function");
  assert.equal("compileSettlementMachine" in (sdk.funds as Record<string, unknown>), false);
});

test("signPositionReceipt and verifyPositionReceipt work through public API", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const receipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall: makeCapitalCall(),
    effectiveAt: "2026-03-18T00:00:00Z",
  });
  const signed = await signPositionReceipt(sdk, {
    definitionValue: definition,
    positionReceiptValue: receipt,
    signer: { type: "schnorrPrivkeyHex", privkeyHex: MANAGER_PRIVKEY },
    signedAt: "2026-03-18T00:00:00Z",
  });
  const verified = await verifyPositionReceipt(sdk, {
    definitionValue: definition,
    positionReceiptValue: signed.positionReceiptEnvelope,
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.report.receiptTrust?.attested, true);
  assert.equal(verified.report.receiptTrust?.attestationVerified, true);
});

test("verifyPositionReceipt requires previous envelope for sequence>0", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const receipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall: makeCapitalCall(),
    effectiveAt: "2026-03-18T00:00:00Z",
  });
  const envelope = await makeEnvelope(receipt);
  const distribution = buildDistributionDescriptor({
    distributionId: "DIST-001",
    receipt,
    assetId: "bitcoin",
    amountSat: 2000,
    approvedAt: "2027-03-18T00:00:00Z",
  });
  const reconciledReceipt = reconcileLPPositionReceipt({
    previousEnvelope: envelope,
    distributions: [distribution],
  });
  const reconciledEnvelope = await makeEnvelope(reconciledReceipt);
  await assert.rejects(
    () => verifyPositionReceipt(sdk, {
      definitionValue: definition,
      positionReceiptValue: reconciledEnvelope,
    }),
    (error: unknown) => error instanceof ValidationError
      && typeof error.details === "object"
      && error.details !== null
      && "code" in error.details
      && (error.details as { code?: string }).code === "FUND_PREVIOUS_POSITION_ENVELOPE_REQUIRED",
  );
  const verified = await verifyPositionReceipt(sdk, {
    definitionValue: definition,
    positionReceiptValue: reconciledEnvelope,
    previousPositionReceiptValue: envelope,
  });
  assert.equal(verified.report.receiptTrust?.continuityVerified, true);
  assert.equal(verified.report.receiptChainTrust?.chainLength, 2);
  assert.equal(verified.report.receiptChainTrust?.fullChainVerified, true);
});

test("verifyPositionReceiptChain verifies full canonical receipt history through public API", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const { chain, afterSecondReceipt } = await makeReceiptChain();
  const verified = await verifyPositionReceiptChain(sdk, {
    definitionValue: definition,
    positionReceiptChainValues: chain,
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.positionReceiptValue.receipt.positionId, afterSecondReceipt.positionId);
  assert.equal(verified.report.receiptChainTrust?.chainLength, 3);
  assert.equal(verified.report.receiptChainTrust?.startsAtGenesis, true);
  assert.equal(verified.report.receiptChainTrust?.fullChainVerified, true);
});

test("reconcilePosition rolls an attested receipt forward", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const receipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall: makeCapitalCall(),
    effectiveAt: "2026-03-18T00:00:00Z",
  });
  const envelope = await makeEnvelope(receipt);
  const distribution = buildDistributionDescriptor({
    distributionId: "DIST-001",
    receipt,
    assetId: "bitcoin",
    amountSat: 2000,
    approvedAt: "2027-03-18T00:00:00Z",
  });
  const reconciled = await reconcilePosition(sdk, {
    definitionValue: definition,
    positionReceiptValue: envelope,
    distributionValue: distribution,
    signer: { type: "schnorrPrivkeyHex", privkeyHex: MANAGER_PRIVKEY },
    signedAt: "2027-03-18T00:00:00Z",
  });
  assert.equal(reconciled.reconciledReceiptValue.sequence, 1);
  assert.equal(reconciled.reconciledReceiptEnvelope.receipt.sequence, 1);
  assert.equal(reconciled.reconciledReceiptValue.distributedAmount, 2000);
});

test("prepareClosing and finality export require attested envelopes", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const definition = makeDefinition();
  const {
    capitalCall,
    firstDistribution,
    afterFirstEnvelope,
    secondDistribution,
    afterSecondReceipt: settledReceipt,
    afterSecondEnvelope: settledEnvelope,
    chain,
  } = await makeReceiptChain();
  const closing = await prepareClosing(sdk, {
    definitionValue: definition,
    positionReceiptValue: settledEnvelope,
    previousPositionReceiptValue: afterFirstEnvelope,
    positionReceiptChainValues: chain,
    closingId: "CLOSE-001",
    finalDistributionHashes: [
      summarizeDistributionDescriptor(firstDistribution).hash,
      summarizeDistributionDescriptor(secondDistribution).hash,
    ],
    closedAt: "2029-03-18T00:00:00Z",
  });
  const evidence = await exportEvidence(sdk, {
    definitionValue: definition,
    capitalCallValue: capitalCall,
    positionReceiptValue: settledEnvelope,
    previousPositionReceiptValue: afterFirstEnvelope,
    positionReceiptChainValues: chain,
    distributionValues: [firstDistribution, secondDistribution],
    closingValue: closing.closingValue,
  });
  const finality = await exportFinalityPayload(sdk, {
    definitionValue: definition,
    capitalCallValue: capitalCall,
    positionReceiptValue: settledEnvelope,
    previousPositionReceiptValue: afterFirstEnvelope,
    positionReceiptChainValues: chain,
    distributionValues: [firstDistribution, secondDistribution],
    closingValue: closing.closingValue,
  });
  const verifiedReceipt = await verifyPositionReceipt(sdk, {
    definitionValue: definition,
    positionReceiptValue: settledEnvelope,
    previousPositionReceiptValue: afterFirstEnvelope,
    positionReceiptChainValues: chain,
  });
  const verifiedClosing = await verifyClosing(sdk, {
    definitionValue: definition,
    positionReceiptValue: settledEnvelope,
    previousPositionReceiptValue: afterFirstEnvelope,
    positionReceiptChainValues: chain,
    closingValue: closing.closingValue,
  });
  assert.equal(evidence.positionReceipt?.hash, summarizeLPPositionReceipt(settledReceipt).hash);
  assert.equal(evidence.positionReceiptEnvelope?.hash, summarizeLPPositionReceiptEnvelope(settledEnvelope).hash);
  assert.equal(evidence.trustSummary.lineage?.lineageKind, "receipt-chain");
  assert.equal(evidence.trustSummary.lineage?.fullLineageVerified, true);
  assert.equal(finality.positionReceiptHash, summarizeLPPositionReceipt(settledReceipt).hash);
  assert.equal(finality.positionReceiptEnvelopeHash, summarizeLPPositionReceiptEnvelope(settledEnvelope).hash);
  assert.equal(finality.trustSummary.lineage?.lineageKind, "receipt-chain");
  assert.equal(finality.trustSummary.lineage?.fullLineageVerified, true);
  assert.equal(verifiedReceipt.report.receiptTrust?.continuityVerified, true);
  assert.equal(verifiedReceipt.report.receiptChainTrust?.fullChainVerified, true);
  assert.equal(closing.report.receiptChainTrust?.fullChainVerified, true);
  assert.equal(verifiedClosing.report.receiptTrust?.continuityVerified, true);
  assert.equal(verifiedClosing.report.receiptChainTrust?.fullChainVerified, true);
  assert.equal(evidence.trust.receiptChainTrust?.fullChainVerified, true);
  assert.equal(finality.trust.receiptChainTrust?.fullChainVerified, true);
});

test("fund capital call open/refund-only and distribution contracts compile when toolchain is available", async (t) => {
  if (!(await hasToolchain())) {
    t.skip("simc/hal-simplicity not available");
    return;
  }

  const sdk = createSimplicityClient(TEST_CONFIG);
  const tempDir = await mkdtemp(path.join(tmpdir(), "fund-contract-artifacts-"));
  const definition = makeDefinition();
  const capitalCall = makeCapitalCall();
  const capitalCallPrepared = await prepareCapitalCall(sdk, {
    definitionValue: definition,
    capitalCallValue: capitalCall,
    openArtifactPath: path.join(tempDir, "capital-call-open.artifact.json"),
    refundOnlyArtifactPath: path.join(tempDir, "capital-call-refund-only.artifact.json"),
  });
  const capitalCallVerified = await verifyCapitalCall(sdk, {
    artifact: capitalCallPrepared.openCompiled.artifact,
    definitionValue: definition,
    capitalCallValue: capitalCall,
  });
  const receipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall,
    effectiveAt: "2026-03-18T00:00:00Z",
  });
  const envelope = await makeEnvelope(receipt);
  const distributionPrepared = await prepareDistribution(sdk, {
    definitionValue: definition,
    positionReceiptValue: envelope,
    distributionId: "DIST-001",
    assetId: "bitcoin",
    amountSat: 2500,
    approvedAt: "2027-03-18T00:00:00Z",
    artifactPath: path.join(tempDir, "distribution.artifact.json"),
  });
  const distributionVerified = await verifyDistribution(sdk, {
    artifact: distributionPrepared.compiled.artifact,
    definitionValue: definition,
    positionReceiptValue: envelope,
    distributionValue: distributionPrepared.distributionValue,
  });

  assert.equal(capitalCallPrepared.openCompiled.deployment().contractAddress.startsWith("tex1"), true);
  assert.equal(capitalCallPrepared.refundOnlyCompiled.deployment().contractAddress.startsWith("tex1"), true);
  assert.equal(capitalCallVerified.ok, true);
  assert.equal(distributionPrepared.compiled.deployment().contractAddress.startsWith("tex1"), true);
  assert.equal(distributionVerified.ok, true);
});
