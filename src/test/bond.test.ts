import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ValidationError } from "../core/errors";
import { createSimplicityClient } from "../client/SimplicityClient";
import { buildBondPayload, buildBondRedemption, buildBondTransitionPayload } from "../domain/bond";
import {
  buildBondRolloverPlan,
  buildBondMachineRolloverPlan,
  buildBondMachineSettlementPlan,
  compileBondRedemptionMachine,
  compileBondTransition,
  verifyBondRedemptionMachineArtifact,
} from "../domain/bond";
import {
  buildRedeemedBondIssuanceState,
  summarizeBondIssuanceState,
  validateBondCrossChecks,
  validateBondDefinition,
  validateBondIssuanceState,
  validateBondStateTransition,
} from "../domain/bondValidation";

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

test("valid BondDefinition and BondIssuanceState pass cross-checks", () => {
  const definition = validateBondDefinition({
    bondId: "BOND-1",
    issuer: "Hazbase Treasury",
    faceValue: 1000,
    couponBps: 500,
    issueDate: "2026-03-10",
    maturityDate: 2344430,
    currencyAssetId: "bitcoin",
    controllerXonly: "79be",
  });
  const issuance = validateBondIssuanceState({
    issuanceId: "ISSUE-1",
    bondId: "BOND-1",
    issuerEntityId: "hazbase-treasury",
    issuedPrincipal: 1000,
    outstandingPrincipal: 1000,
    redeemedPrincipal: 0,
    currencyAssetId: "bitcoin",
    controllerXonly: "79be",
    issuedAt: "2026-03-10T00:00:00Z",
    status: "ISSUED",
  });
  const crossChecks = validateBondCrossChecks(definition, issuance);
  assert.equal(crossChecks.bondIdMatch, true);
  assert.equal(crossChecks.currencyMatch, true);
  assert.equal(crossChecks.controllerMatch, true);
  assert.equal(crossChecks.principalInvariantValid, true);
});

test("bondId mismatch fails", () => {
  assert.throws(
    () =>
      validateBondCrossChecks(
        validateBondDefinition({
          bondId: "BOND-1",
          issuer: "Hazbase Treasury",
          faceValue: 1000,
          couponBps: 500,
          issueDate: "2026-03-10",
          maturityDate: 2344430,
          currencyAssetId: "bitcoin",
          controllerXonly: "79be",
        }),
        validateBondIssuanceState({
          issuanceId: "ISSUE-1",
          bondId: "BOND-2",
          issuerEntityId: "hazbase-treasury",
          issuedPrincipal: 1000,
          outstandingPrincipal: 1000,
          redeemedPrincipal: 0,
          currencyAssetId: "bitcoin",
          controllerXonly: "79be",
          issuedAt: "2026-03-10T00:00:00Z",
          status: "ISSUED",
        })
      ),
    (error: unknown) => error instanceof ValidationError && (error.details as { code?: string })?.code === "BOND_ID_MISMATCH"
  );
});

test("currency mismatch fails", () => {
  assert.throws(
    () =>
      validateBondCrossChecks(
        validateBondDefinition({
          bondId: "BOND-1",
          issuer: "Hazbase Treasury",
          faceValue: 1000,
          couponBps: 500,
          issueDate: "2026-03-10",
          maturityDate: 2344430,
          currencyAssetId: "bitcoin",
          controllerXonly: "79be",
        }),
        validateBondIssuanceState({
          issuanceId: "ISSUE-1",
          bondId: "BOND-1",
          issuerEntityId: "hazbase-treasury",
          issuedPrincipal: 1000,
          outstandingPrincipal: 1000,
          redeemedPrincipal: 0,
          currencyAssetId: "usd",
          controllerXonly: "79be",
          issuedAt: "2026-03-10T00:00:00Z",
          status: "ISSUED",
        })
      ),
    (error: unknown) => error instanceof ValidationError && (error.details as { code?: string })?.code === "BOND_CURRENCY_MISMATCH"
  );
});

test("controller mismatch fails", () => {
  assert.throws(
    () =>
      validateBondCrossChecks(
        validateBondDefinition({
          bondId: "BOND-1",
          issuer: "Hazbase Treasury",
          faceValue: 1000,
          couponBps: 500,
          issueDate: "2026-03-10",
          maturityDate: 2344430,
          currencyAssetId: "bitcoin",
          controllerXonly: "79be",
        }),
        validateBondIssuanceState({
          issuanceId: "ISSUE-1",
          bondId: "BOND-1",
          issuerEntityId: "hazbase-treasury",
          issuedPrincipal: 1000,
          outstandingPrincipal: 1000,
          redeemedPrincipal: 0,
          currencyAssetId: "bitcoin",
          controllerXonly: "abcd",
          issuedAt: "2026-03-10T00:00:00Z",
          status: "ISSUED",
        })
      ),
    (error: unknown) => error instanceof ValidationError && (error.details as { code?: string })?.code === "BOND_CONTROLLER_MISMATCH"
  );
});

test("principal invariant invalid fails", () => {
  assert.throws(
    () =>
      validateBondIssuanceState({
        issuanceId: "ISSUE-1",
        bondId: "BOND-1",
        issuerEntityId: "hazbase-treasury",
        issuedPrincipal: 1000,
        outstandingPrincipal: 900,
        redeemedPrincipal: 50,
        currencyAssetId: "bitcoin",
        controllerXonly: "79be",
        issuedAt: "2026-03-10T00:00:00Z",
        status: "ISSUED",
      }),
    (error: unknown) =>
      error instanceof ValidationError &&
      (error.details as { code?: string })?.code === "BOND_PRINCIPAL_INVARIANT_INVALID"
  );
});

test("invalid status fails", () => {
  assert.throws(
    () =>
      validateBondIssuanceState({
        issuanceId: "ISSUE-1",
        bondId: "BOND-1",
        issuerEntityId: "hazbase-treasury",
        issuedPrincipal: 1000,
        outstandingPrincipal: 1000,
        redeemedPrincipal: 0,
        currencyAssetId: "bitcoin",
        controllerXonly: "79be",
        issuedAt: "2026-03-10T00:00:00Z",
        status: "PENDING" as "ISSUED",
      }),
    (error: unknown) => error instanceof ValidationError && (error.details as { code?: string })?.code === "BOND_STATUS_INVALID"
  );
});

test("buildRedeemedBondIssuanceState produces partially redeemed state", () => {
  const previous = validateBondIssuanceState({
    issuanceId: "ISSUE-1",
    bondId: "BOND-1",
    issuerEntityId: "hazbase-treasury",
    issuedPrincipal: 1000,
    outstandingPrincipal: 1000,
    redeemedPrincipal: 0,
    currencyAssetId: "bitcoin",
    controllerXonly: "79be",
    issuedAt: "2026-03-10T00:00:00Z",
    status: "ISSUED",
  });
  const next = buildRedeemedBondIssuanceState({
    previous,
    amount: 250,
    redeemedAt: "2027-03-10T00:00:00Z",
  });
  assert.equal(next.status, "PARTIALLY_REDEEMED");
  assert.equal(next.outstandingPrincipal, 750);
  assert.equal(next.redeemedPrincipal, 250);
  assert.equal(next.lastTransition?.type, "REDEEM");
});

test("buildRedeemedBondIssuanceState produces fully redeemed state", () => {
  const previous = validateBondIssuanceState({
    issuanceId: "ISSUE-1",
    bondId: "BOND-1",
    issuerEntityId: "hazbase-treasury",
    issuedPrincipal: 1000,
    outstandingPrincipal: 400,
    redeemedPrincipal: 600,
    currencyAssetId: "bitcoin",
    controllerXonly: "79be",
    issuedAt: "2026-03-10T00:00:00Z",
    status: "PARTIALLY_REDEEMED",
    previousStateHash: "a".repeat(64),
    lastTransition: {
      type: "REDEEM",
      amount: 600,
      at: "2027-01-01T00:00:00Z",
    },
  });
  const next = buildRedeemedBondIssuanceState({
    previous,
    amount: 400,
    redeemedAt: "2027-03-10T00:00:00Z",
  });
  assert.equal(next.status, "REDEEMED");
  assert.equal(next.outstandingPrincipal, 0);
  assert.equal(next.redeemedPrincipal, 1000);
});

test("validateBondStateTransition accepts redeem progression", () => {
  const previous = validateBondIssuanceState({
    issuanceId: "ISSUE-1",
    bondId: "BOND-1",
    issuerEntityId: "hazbase-treasury",
    issuedPrincipal: 1000,
    outstandingPrincipal: 1000,
    redeemedPrincipal: 0,
    currencyAssetId: "bitcoin",
    controllerXonly: "79be",
    issuedAt: "2026-03-10T00:00:00Z",
    status: "ISSUED",
  });
  const next = buildRedeemedBondIssuanceState({
    previous,
    amount: 250,
    redeemedAt: "2027-03-10T00:00:00Z",
  });
  const transition = validateBondStateTransition(previous, next);
  assert.equal(transition.previousStateHashMatch, true);
  assert.equal(transition.redemptionArithmeticValid, true);
  assert.equal(transition.statusProgressionValid, true);
});

test("validateBondStateTransition rejects redeem amount that does not match state delta", () => {
  const previous = validateBondIssuanceState({
    issuanceId: "ISSUE-1",
    bondId: "BOND-1",
    issuerEntityId: "hazbase-treasury",
    issuedPrincipal: 1000,
    outstandingPrincipal: 1000,
    redeemedPrincipal: 0,
    currencyAssetId: "bitcoin",
    controllerXonly: "79be",
    issuedAt: "2026-03-10T00:00:00Z",
    status: "ISSUED",
  });
  const next = validateBondIssuanceState({
    issuanceId: "ISSUE-1",
    bondId: "BOND-1",
    issuerEntityId: "hazbase-treasury",
    issuedPrincipal: 1000,
    outstandingPrincipal: 700,
    redeemedPrincipal: 300,
    currencyAssetId: "bitcoin",
    controllerXonly: "79be",
    issuedAt: "2026-03-10T00:00:00Z",
    status: "PARTIALLY_REDEEMED",
    previousStateHash: summarizeBondIssuanceState(previous).hash,
    lastTransition: {
      type: "REDEEM",
      amount: 250,
      at: "2027-03-10T00:00:00Z",
    },
  });
  assert.throws(
    () => validateBondStateTransition(previous, next),
    (error: unknown) =>
      error instanceof ValidationError &&
      (error.details as { code?: string })?.code === "BOND_REDEMPTION_ARITHMETIC_INVALID"
  );
});

test("buildBondRedemption returns next state and hashes", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const result = await buildBondRedemption(sdk, {
    definitionValue: {
      bondId: "BOND-1",
      issuer: "Hazbase Treasury",
      faceValue: 1000,
      couponBps: 500,
      issueDate: "2026-03-10",
      maturityDate: 2344430,
      currencyAssetId: "bitcoin",
      controllerXonly: "79be",
    },
    previousIssuanceValue: {
      issuanceId: "ISSUE-1",
      bondId: "BOND-1",
      issuerEntityId: "hazbase-treasury",
      issuedPrincipal: 1000,
      outstandingPrincipal: 1000,
      redeemedPrincipal: 0,
      currencyAssetId: "bitcoin",
      controllerXonly: "79be",
      issuedAt: "2026-03-10T00:00:00Z",
      status: "ISSUED",
    },
    amount: 250,
    redeemedAt: "2027-03-10T00:00:00Z",
  });

  assert.equal(result.next.status, "PARTIALLY_REDEEMED");
  assert.equal(result.transition.redemptionArithmeticValid, true);
  assert.equal(result.previousHash.length, 64);
  assert.equal(result.nextHash.length, 64);
  assert.notEqual(result.previousHash, result.nextHash);
});

test("bond verify keeps on-chain anchor verified when artifact is saved outside source tree", async (t) => {
  try {
    await execFileAsync("simc", ["--version"]);
    await execFileAsync("hal-simplicity", ["--version"]);
  } catch {
    t.skip("simc/hal-simplicity not available");
    return;
  }

  const sdk = createSimplicityClient(TEST_CONFIG);
  const tempDir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-bond-verify-"));
  const artifactPath = path.join(tempDir, "bond.artifact.json");
  const simfPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf";
  const definitionPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json";
  const issuancePath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json";

  await sdk.bonds.defineBond({
    definitionPath,
    issuancePath,
    simfPath,
    artifactPath,
  });

  const verified = await sdk.bonds.verifyBond({
    artifactPath,
    definitionPath,
    issuancePath,
  });

  assert.equal(verified.definition.ok, true);
  assert.equal(verified.definition.trust.onChainAnchorVerified, true);
  assert.equal(verified.issuance.ok, true);
  assert.equal(verified.issuance.trust.onChainAnchorVerified, true);
});

test("buildBondPayload returns bridge-ready trust summary", async (t) => {
  try {
    await execFileAsync("simc", ["--version"]);
    await execFileAsync("hal-simplicity", ["--version"]);
  } catch {
    t.skip("simc/hal-simplicity not available");
    return;
  }

  const sdk = createSimplicityClient(TEST_CONFIG);
  const tempDir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-bond-payload-"));
  const artifactPath = path.join(tempDir, "bond.artifact.json");
  const simfPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf";
  const definitionPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json";
  const issuancePath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json";

  await sdk.bonds.defineBond({
    definitionPath,
    issuancePath,
    simfPath,
    artifactPath,
  });

  const result = await buildBondPayload(sdk, {
    artifactPath,
    definitionPath,
    issuancePath,
  });

  assert.equal(result.payload.bondId, "BOND-2026-001");
  assert.equal(result.payload.issuanceId, "BOND-2026-001-ISSUE-1");
  assert.equal(result.payload.anchorModes.definition, "on-chain-constant-committed");
  assert.equal(result.payload.anchorModes.state, "on-chain-constant-committed");
  assert.equal(result.trust.definitionTrust.onChainAnchorVerified, true);
  assert.equal(result.trust.issuanceTrust.onChainAnchorVerified, true);
  assert.equal(result.payload.crossChecks.principalInvariantValid, true);
});

test("compileBondTransition compiles previous and next issuance state into a new artifact", async (t) => {
  try {
    await execFileAsync("simc", ["--version"]);
    await execFileAsync("hal-simplicity", ["--version"]);
  } catch {
    t.skip("simc/hal-simplicity not available");
    return;
  }

  const sdk = createSimplicityClient(TEST_CONFIG);
  const tempDir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-bond-transition-"));
  const artifactPath = path.join(tempDir, "bond-transition.artifact.json");
  const simfPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-redemption-transition.simf";
  const definitionPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json";
  const previousIssuancePath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json";
  const nextIssuancePath =
    "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json";

  const result = await compileBondTransition(sdk, {
    definitionPath,
    previousIssuancePath,
    nextIssuancePath,
    simfPath,
    artifactPath,
  });

  assert.equal(result.transition.previousStateHashMatch, true);
  assert.equal(result.transition.statusProgressionValid, true);
  assert.equal(result.compiled.state()?.hash, result.nextHash);
  assert.notEqual(result.previousHash, result.nextHash);
  assert.equal(result.compiled.artifact.source.templateVars?.PREVIOUS_STATE_HASH, result.previousHash);
  assert.equal(result.payload.redeemAmount, 250000);
  assert.equal(result.payload.previousStatus, "ISSUED");
  assert.equal(result.payload.nextStatus, "PARTIALLY_REDEEMED");
  assert.equal(result.payload.previousStatusCode, 1);
  assert.equal(result.payload.nextStatusCode, 2);
  assert.equal(result.payload.principal.outstandingDelta, 250000);
  assert.equal(result.payload.principal.redeemedDelta, 250000);
});

test("compileBondRedemptionMachine commits redeem amount and transition kind", async (t) => {
  try {
    await execFileAsync("simc", ["--version"]);
    await execFileAsync("hal-simplicity", ["--version"]);
  } catch {
    t.skip("simc/hal-simplicity not available");
    return;
  }

  const sdk = createSimplicityClient(TEST_CONFIG);
  const tempDir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-bond-redemption-machine-"));
  const artifactPath = path.join(tempDir, "bond-redemption-machine.artifact.json");
  const simfPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-redemption-state-machine.simf";
  const definitionPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json";
  const previousIssuancePath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json";
  const nextIssuancePath =
    "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json";

  const result = await compileBondRedemptionMachine(sdk, {
    definitionPath,
    previousIssuancePath,
    nextIssuancePath,
    simfPath,
    artifactPath,
  });

  assert.equal(result.transitionKind, "REDEEM");
  assert.equal(result.redeemAmount, 250000);
  assert.equal(result.compiled.artifact.source.templateVars?.PREVIOUS_STATE_HASH, result.previousHash);
  assert.equal(result.compiled.artifact.source.templateVars?.REDEEM_AMOUNT_256, "000000000000000000000000000000000000000000000000000000000003d090");
  assert.equal(result.compiled.artifact.source.templateVars?.TRANSITION_KIND_256, "0000000000000000000000000000000000000000000000000000000000000001");
  assert.equal(result.compiled.artifact.source.templateVars?.REDEEM_AMOUNT_32, "0003d090");
  assert.equal(result.compiled.artifact.source.templateVars?.PREVIOUS_STATUS_32, "00000001");
  assert.equal(result.compiled.artifact.source.templateVars?.NEXT_STATUS_32, "00000002");
  assert.equal(result.compiled.artifact.source.templateVars?.PREVIOUS_OUTSTANDING_32, "000f4240");
  assert.equal(result.compiled.artifact.source.templateVars?.PREVIOUS_REDEEMED_32, "00000000");
  assert.equal(result.compiled.artifact.source.templateVars?.NEXT_OUTSTANDING_32, "000b71b0");
  assert.equal(result.compiled.artifact.source.templateVars?.NEXT_REDEEMED_32, "0003d090");
  assert.equal(
    result.compiled.artifact.source.templateVars?.NEXT_CONTRACT_ADDRESS_HASH_256,
    result.nextStateContractAddressHash,
  );
  assert.equal(
    result.compiled.artifact.source.templateVars?.SETTLEMENT_DESCRIPTOR_HASH,
    result.settlementDescriptorHash,
  );
  assert.equal(result.payload.redeemAmount, 250000);
  assert.equal(result.payload.transitionKind, "REDEEM");
  assert.equal(result.payload.previousStatusCode, 1);
  assert.equal(result.payload.nextStatusCode, 2);
  assert.equal(result.payload.principal.outstandingDelta, 250000);
  assert.equal(result.payload.principal.redeemedDelta, 250000);
  assert.equal(result.payload.anchorModes.definition, "on-chain-constant-committed");
  assert.equal(result.payload.anchorModes.state, "on-chain-constant-committed");
  assert.equal(result.payload.nextStateContractAddress, result.nextStateContractAddress);
  assert.equal(result.payload.nextStateContractAddressHash, result.nextStateContractAddressHash);
  assert.equal(result.payload.settlementDescriptorHash, result.settlementDescriptorHash);
  assert.equal(result.payload.settlementDescriptor.nextContractAddress, result.nextStateContractAddress);
});

test("verifyBondRedemptionMachineArtifact validates committed transition parameters", async (t) => {
  try {
    await execFileAsync("simc", ["--version"]);
    await execFileAsync("hal-simplicity", ["--version"]);
  } catch {
    t.skip("simc/hal-simplicity not available");
    return;
  }

  const sdk = createSimplicityClient(TEST_CONFIG);
  const tempDir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-bond-redemption-verify-"));
  const artifactPath = path.join(tempDir, "bond-redemption-machine.artifact.json");
  const simfPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-redemption-state-machine.simf";
  const definitionPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json";
  const previousIssuancePath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json";
  const nextIssuancePath =
    "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json";

  await compileBondRedemptionMachine(sdk, {
    definitionPath,
    previousIssuancePath,
    nextIssuancePath,
    simfPath,
    artifactPath,
  });

  const result = await verifyBondRedemptionMachineArtifact(sdk, {
    artifactPath,
    definitionPath,
    previousIssuancePath,
    nextIssuancePath,
  });

  assert.equal(result.verified, true);
  assert.equal(result.definition.trust.onChainAnchorVerified, true);
  assert.equal(result.issuance.trust.onChainAnchorVerified, true);
  assert.equal(result.checks.previousStateHashCommitted, true);
  assert.equal(result.checks.redeemAmountCommitted, true);
  assert.equal(result.checks.transitionKindCommitted, true);
  assert.equal(result.checks.statusCodesCommitted, true);
  assert.equal(result.checks.principalArithmeticCommitted, true);
  assert.equal(result.checks.nextContractAddressCommitted, true);
  assert.equal(result.checks.settlementDescriptorCommitted, true);
  assert.equal(result.expectedPayload.redeemAmount, 250000);
  assert.equal(result.expectedPayload.previousStatusCode, 1);
  assert.equal(result.expectedPayload.nextStatusCode, 2);
  assert.equal(result.expectedPayload.nextStateContractAddress, result.expectedNextContractAddress);
  assert.equal(result.expectedPayload.nextStateContractAddressHash, result.expectedNextContractAddressHash);
  assert.equal(result.expectedSettlementDescriptor.nextContractAddress, result.expectedNextContractAddress);
  assert.equal(result.expectedSettlementDescriptorHash.length, 64);
});

test("buildBondTransitionPayload returns bridge-ready transition summary", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const previous = {
    issuanceId: "ISSUE-1",
    bondId: "BOND-1",
    issuerEntityId: "hazbase-treasury",
    issuedPrincipal: 1000,
    outstandingPrincipal: 1000,
    redeemedPrincipal: 0,
    currencyAssetId: "bitcoin",
    controllerXonly: "79be",
    issuedAt: "2026-03-10T00:00:00Z",
    status: "ISSUED" as const,
  };
  const result = await buildBondTransitionPayload(sdk, {
    definitionValue: {
      bondId: "BOND-1",
      issuer: "Hazbase Treasury",
      faceValue: 1000,
      couponBps: 500,
      issueDate: "2026-03-10",
      maturityDate: 2344430,
      currencyAssetId: "bitcoin",
      controllerXonly: "79be",
    },
    previousIssuanceValue: previous,
    nextIssuanceValue: {
      issuanceId: "ISSUE-1",
      bondId: "BOND-1",
      issuerEntityId: "hazbase-treasury",
      issuedPrincipal: 1000,
      outstandingPrincipal: 750,
      redeemedPrincipal: 250,
      currencyAssetId: "bitcoin",
      controllerXonly: "79be",
      issuedAt: "2026-03-10T00:00:00Z",
      status: "PARTIALLY_REDEEMED",
      previousStateHash: summarizeBondIssuanceState(previous).hash,
      lastTransition: {
        type: "REDEEM",
        amount: 250,
        at: "2027-03-10T00:00:00Z",
      },
    },
  });

  assert.equal(result.payload.bondId, "BOND-1");
  assert.equal(result.payload.transitionKind, "REDEEM");
  assert.equal(result.payload.redeemAmount, 250);
  assert.equal(result.payload.previousStatus, "ISSUED");
  assert.equal(result.payload.nextStatus, "PARTIALLY_REDEEMED");
  assert.equal(result.payload.previousStatusCode, 1);
  assert.equal(result.payload.nextStatusCode, 2);
  assert.equal(result.payload.principal.outstandingDelta, 250);
  assert.equal(result.payload.principal.redeemedDelta, 250);
  assert.equal(result.payload.crossChecks.transition.statusProgressionValid, true);
});

test("buildBondRolloverPlan compiles next state artifact and targets next contract address", async (t) => {
  try {
    await execFileAsync("simc", ["--version"]);
    await execFileAsync("hal-simplicity", ["--version"]);
  } catch {
    t.skip("simc/hal-simplicity not available");
    return;
  }

  const sdk = createSimplicityClient(TEST_CONFIG);
  const tempDir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-bond-rollover-plan-"));
  const currentArtifactPath = path.join(tempDir, "bond-current.artifact.json");
  const nextArtifactPath = path.join(tempDir, "bond-next.artifact.json");
  const simfPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf";
  const definitionPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json";
  const previousIssuancePath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json";
  const nextIssuancePath =
    "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json";

  await sdk.bonds.defineBond({
    definitionPath,
    issuancePath: previousIssuancePath,
    simfPath,
    artifactPath: currentArtifactPath,
  });

  const result = await buildBondRolloverPlan(sdk, {
    currentArtifactPath,
    definitionPath,
    previousIssuancePath,
    nextIssuancePath,
    nextSimfPath: simfPath,
    nextArtifactPath,
  });

  assert.equal(result.currentVerification.definition.ok, true);
  assert.equal(result.currentVerification.issuance.ok, true);
  assert.equal(result.transitionPayload.transitionKind, "REDEEM");
  assert.equal(result.transitionPayload.redeemAmount, 250000);
  assert.equal(result.nextCompiled.artifact.compiled.contractAddress, result.nextContractAddress);
  assert.notEqual(result.currentArtifact.compiled.contractAddress, result.nextContractAddress);
});

test("buildBondMachineRolloverPlan compiles redemption machine artifact and targets machine contract address", async (t) => {
  try {
    await execFileAsync("simc", ["--version"]);
    await execFileAsync("hal-simplicity", ["--version"]);
  } catch {
    t.skip("simc/hal-simplicity not available");
    return;
  }

  const sdk = createSimplicityClient(TEST_CONFIG);
  const tempDir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-bond-machine-rollover-plan-"));
  const currentArtifactPath = path.join(tempDir, "bond-current.artifact.json");
  const machineArtifactPath = path.join(tempDir, "bond-machine.artifact.json");
  const currentSimfPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf";
  const machineSimfPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-redemption-state-machine.simf";
  const definitionPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json";
  const previousIssuancePath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json";
  const nextIssuancePath =
    "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json";

  await sdk.bonds.defineBond({
    definitionPath,
    issuancePath: previousIssuancePath,
    simfPath: currentSimfPath,
    artifactPath: currentArtifactPath,
  });

  const result = await buildBondMachineRolloverPlan(sdk, {
    currentArtifactPath,
    definitionPath,
    previousIssuancePath,
    nextIssuancePath,
    machineSimfPath,
    machineArtifactPath,
  });

  assert.equal(result.currentVerification.definition.ok, true);
  assert.equal(result.currentVerification.issuance.ok, true);
  assert.equal(result.machineVerification.verified, true);
  assert.equal(result.transitionPayload.transitionKind, "REDEEM");
  assert.equal(result.transitionPayload.redeemAmount, 250000);
  assert.equal(result.transitionPayload.nextStateContractAddress, result.machineCompiled.nextStateContractAddress);
  assert.equal(result.machineCompiled.compiled.artifact.compiled.contractAddress, result.nextContractAddress);
  assert.notEqual(result.currentArtifact.compiled.contractAddress, result.nextContractAddress);
});

test("buildBondMachineSettlementPlan compiles next state artifact and targets next state contract address", async (t) => {
  try {
    await execFileAsync("simc", ["--version"]);
    await execFileAsync("hal-simplicity", ["--version"]);
  } catch {
    t.skip("simc/hal-simplicity not available");
    return;
  }

  const sdk = createSimplicityClient(TEST_CONFIG);
  const tempDir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-bond-machine-settlement-"));
  const currentMachineArtifactPath = path.join(tempDir, "bond-machine-current.artifact.json");
  const nextArtifactPath = path.join(tempDir, "bond-next.artifact.json");
  const machineSimfPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-redemption-state-machine.simf";
  const nextSimfPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-anchor.simf";
  const definitionPath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-definition.json";
  const previousIssuancePath = "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state.json";
  const nextIssuancePath =
    "/Users/y_hoshino/Work/hazbase/liquid/simplicity-sdk/docs/definitions/bond-issuance-state-partial-redemption.json";

  const machine = await compileBondRedemptionMachine(sdk, {
    definitionPath,
    previousIssuancePath,
    nextIssuancePath,
    simfPath: machineSimfPath,
    artifactPath: currentMachineArtifactPath,
  });

  const result = await buildBondMachineSettlementPlan(sdk, {
    currentMachineArtifactPath,
    definitionPath,
    previousIssuancePath,
    nextIssuancePath,
    nextSimfPath,
    nextArtifactPath,
  });

  assert.equal(result.machineVerification.verified, true);
  assert.equal(result.transitionPayload.transitionKind, "REDEEM");
  assert.equal(result.transitionPayload.nextStateHash, result.nextCompiled.state()?.hash);
  assert.equal(result.nextContractAddressMatchesMachineCommitment, true);
  assert.equal(result.machineVerification.expectedNextContractAddress, result.nextContractAddress);
  assert.equal(result.nextCompiled.deployment().contractAddress, result.nextContractAddress);
  assert.notEqual(machine.compiled.deployment().contractAddress, result.nextContractAddress);
});
