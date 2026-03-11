import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ValidationError } from "../core/errors";
import { createSimplicityClient } from "../client/SimplicityClient";
import {
  validateBondCrossChecks,
  validateBondDefinition,
  validateBondIssuanceState,
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
