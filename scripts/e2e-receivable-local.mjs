import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { resolveRuntimeKeyPair } from "./runtimeKeys.mjs";
import {
  createSimplicityClient,
  buildReceivableFundingClaimDescriptor,
  buildReceivableRepaymentClaimDescriptor,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

function env(name, fallback) {
  return process.env[name] || fallback;
}

function createLocalReceivableClient() {
  return createSimplicityClient({
    network: "liquidtestnet",
    rpc: {
      url: env("ELEMENTS_RPC_URL", "http://127.0.0.1:18884"),
      username: env("ELEMENTS_RPC_USER", "user"),
      password: env("ELEMENTS_RPC_PASSWORD", "pass"),
      wallet: env("ELEMENTS_RPC_WALLET", "simplicity-test"),
    },
    toolchain: {
      simcPath: env("SIMC_PATH", "simc"),
      halSimplicityPath: env("HAL_SIMPLICITY_PATH", "hal-simplicity"),
      elementsCliPath: env("ELEMENTS_CLI_PATH", "eltc"),
    },
  });
}

async function main() {
  try {
    await execFileAsync(env("SIMC_PATH", "simc"), ["--help"]);
    await execFileAsync(env("HAL_SIMPLICITY_PATH", "hal-simplicity"), ["--version"]);
  } catch {
    console.log(JSON.stringify({
      skipped: true,
      reason: "simc/hal-simplicity are required for npm run e2e:receivable-local",
    }, null, 2));
    return;
  }

  const sdk = createLocalReceivableClient();
  try {
    await sdk.rpc.call("getblockchaininfo", []);
  } catch {
    console.log(JSON.stringify({
      skipped: true,
      reason: "local Elements RPC is required for npm run e2e:receivable-local",
    }, null, 2));
    return;
  }

  const sidechain = await sdk.rpc.call("getsidechaininfo", []);
  const claimantKeyPair = resolveRuntimeKeyPair({
    label: "receivable controller",
    explicitPrivkey: process.env.RECEIVABLE_CONTROLLER_PRIVKEY,
    explicitXonly: process.env.RECEIVABLE_CONTROLLER_XONLY,
    privkeyStateKey: "controllerPrivkey",
    xonlyStateKey: "controllerXonly",
  });

  const definition = {
    receivableId: env("RECEIVABLE_ID", "REC-LOCAL-001"),
    originatorEntityId: env("RECEIVABLE_ORIGINATOR_ENTITY_ID", "originator-a"),
    debtorEntityId: env("RECEIVABLE_DEBTOR_ENTITY_ID", "debtor-a"),
    currencyAssetId: env("RECEIVABLE_CURRENCY_ASSET_ID", sidechain.pegged_asset ?? "bitcoin"),
    faceValue: Number(env("RECEIVABLE_FACE_VALUE_SAT", "10000")),
    dueDate: env("RECEIVABLE_DUE_DATE", "2027-12-31T00:00:00Z"),
    controllerXonly: claimantKeyPair.xonly,
    originatorClaimantXonly: env("RECEIVABLE_ORIGINATOR_CLAIMANT_XONLY", claimantKeyPair.xonly),
  };
  const originated = {
    stateId: `${definition.receivableId}-S0`,
    receivableId: definition.receivableId,
    originatorEntityId: definition.originatorEntityId,
    debtorEntityId: definition.debtorEntityId,
    holderEntityId: definition.originatorEntityId,
    currencyAssetId: definition.currencyAssetId,
    controllerXonly: definition.controllerXonly,
    holderClaimantXonly: definition.originatorClaimantXonly,
    faceValue: definition.faceValue,
    outstandingAmount: definition.faceValue,
    repaidAmount: 0,
    status: "ORIGINATED",
    createdAt: env("RECEIVABLE_ORIGINATED_AT", "2027-01-01T00:00:00Z"),
    lastTransition: {
      type: "ORIGINATE",
      amount: definition.faceValue,
      at: env("RECEIVABLE_ORIGINATED_AT", "2027-01-01T00:00:00Z"),
    },
  };

  const funding = await sdk.receivables.prepareFunding({
    definitionValue: definition,
    previousStateValue: originated,
    stateId: `${definition.receivableId}-S1`,
    holderEntityId: env("RECEIVABLE_FUNDER_ENTITY_ID", "spv-a"),
    holderClaimantXonly: env("RECEIVABLE_HOLDER_CLAIMANT_XONLY", definition.controllerXonly),
    fundedAt: env("RECEIVABLE_FUNDED_AT", "2027-01-02T00:00:00Z"),
  });
  const fundingClaimDescriptor = buildReceivableFundingClaimDescriptor({
    claimId: `${definition.receivableId}-FUNDING-CLAIM`,
    definition,
    currentState: funding.nextStateValue,
  });
  const fundingClaim = await sdk.receivables.prepareFundingClaim({
    definitionValue: definition,
    currentStateValue: funding.nextStateValue,
    stateHistoryValues: [originated, funding.nextStateValue],
    fundingClaimValue: fundingClaimDescriptor,
  });
  const verifiedFundingClaim = await sdk.receivables.verifyFundingClaim({
    artifact: fundingClaim.compiled.artifact,
    definitionValue: definition,
    currentStateValue: funding.nextStateValue,
    stateHistoryValues: [originated, funding.nextStateValue],
    fundingClaimValue: fundingClaimDescriptor,
  });

  const partialRepayment = await sdk.receivables.prepareRepayment({
    definitionValue: definition,
    previousStateValue: funding.nextStateValue,
    stateId: `${definition.receivableId}-S2`,
    amount: 4000,
    repaidAt: env("RECEIVABLE_REPAID_AT", "2027-02-01T00:00:00Z"),
  });
  const partialRepaymentClaimDescriptor = buildReceivableRepaymentClaimDescriptor({
    claimId: `${definition.receivableId}-REPAYMENT-CLAIM-PARTIAL`,
    currentState: partialRepayment.nextStateValue,
  });
  const partialRepaymentClaim = await sdk.receivables.prepareRepaymentClaim({
    definitionValue: definition,
    currentStateValue: partialRepayment.nextStateValue,
    stateHistoryValues: [originated, funding.nextStateValue, partialRepayment.nextStateValue],
    repaymentClaimValue: partialRepaymentClaimDescriptor,
  });
  const verifiedPartialRepaymentClaim = await sdk.receivables.verifyRepaymentClaim({
    artifact: partialRepaymentClaim.compiled.artifact,
    definitionValue: definition,
    currentStateValue: partialRepayment.nextStateValue,
    stateHistoryValues: [originated, funding.nextStateValue, partialRepayment.nextStateValue],
    repaymentClaimValue: partialRepaymentClaimDescriptor,
  });

  const finalRepayment = await sdk.receivables.prepareRepayment({
    definitionValue: definition,
    previousStateValue: partialRepayment.nextStateValue,
    stateId: `${definition.receivableId}-S3`,
    amount: definition.faceValue - partialRepayment.nextStateValue.repaidAmount,
    repaidAt: env("RECEIVABLE_FINAL_REPAID_AT", "2027-03-01T00:00:00Z"),
  });
  const finalRepaymentClaimDescriptor = buildReceivableRepaymentClaimDescriptor({
    claimId: `${definition.receivableId}-REPAYMENT-CLAIM-FINAL`,
    currentState: finalRepayment.nextStateValue,
  });
  const finalRepaymentClaim = await sdk.receivables.prepareRepaymentClaim({
    definitionValue: definition,
    currentStateValue: finalRepayment.nextStateValue,
    stateHistoryValues: [
      originated,
      funding.nextStateValue,
      partialRepayment.nextStateValue,
      finalRepayment.nextStateValue,
    ],
    repaymentClaimValue: finalRepaymentClaimDescriptor,
  });
  const verifiedFinalRepaymentClaim = await sdk.receivables.verifyRepaymentClaim({
    artifact: finalRepaymentClaim.compiled.artifact,
    definitionValue: definition,
    currentStateValue: finalRepayment.nextStateValue,
    stateHistoryValues: [
      originated,
      funding.nextStateValue,
      partialRepayment.nextStateValue,
      finalRepayment.nextStateValue,
    ],
    repaymentClaimValue: finalRepaymentClaimDescriptor,
  });

  const closing = await sdk.receivables.prepareClosing({
    definitionValue: definition,
    latestStateValue: finalRepayment.nextStateValue,
    stateHistoryValues: [
      originated,
      funding.nextStateValue,
      partialRepayment.nextStateValue,
      finalRepayment.nextStateValue,
    ],
    closingId: `${definition.receivableId}-CLOSE`,
    closedAt: env("RECEIVABLE_CLOSED_AT", "2027-03-02T00:00:00Z"),
  });
  const finality = await sdk.receivables.exportFinalityPayload({
    definitionValue: definition,
    stateHistoryValues: [
      originated,
      funding.nextStateValue,
      partialRepayment.nextStateValue,
      finalRepayment.nextStateValue,
    ],
    fundingClaimValue: fundingClaimDescriptor,
    repaymentClaimValue: finalRepaymentClaimDescriptor,
    closingValue: closing.closingValue,
  });

  console.log(JSON.stringify({
    matrix: {
      funding: {
        verified: funding.verified,
        status: funding.nextStateValue.status,
      },
      fundingClaim: {
        verified: verifiedFundingClaim.verified,
        authoritySource: verifiedFundingClaim.report.fundingClaimTrust?.claimantAuthoritySource,
        contractAddress: fundingClaim.compiled.deployment().contractAddress,
      },
      partialRepayment: {
        verified: partialRepayment.verified,
        status: partialRepayment.nextStateValue.status,
      },
      partialRepaymentClaim: {
        verified: verifiedPartialRepaymentClaim.verified,
        authoritySource: verifiedPartialRepaymentClaim.report.repaymentClaimTrust?.claimantAuthoritySource,
        contractAddress: partialRepaymentClaim.compiled.deployment().contractAddress,
      },
      finalRepayment: {
        verified: finalRepayment.verified,
        status: finalRepayment.nextStateValue.status,
      },
      finalRepaymentClaim: {
        verified: verifiedFinalRepaymentClaim.verified,
        authoritySource: verifiedFinalRepaymentClaim.report.repaymentClaimTrust?.claimantAuthoritySource,
        contractAddress: finalRepaymentClaim.compiled.deployment().contractAddress,
      },
      closing: {
        verified: closing.verified,
        closingHash: closing.closingSummary.hash,
      },
      finality: {
        latestStateHash: finality.latestStateHash,
        fundingClaimHash: finality.fundingClaimHash,
        repaymentClaimHash: finality.repaymentClaimHash,
        fullLineageVerified: finality.trustSummary.lineage?.fullLineageVerified ?? false,
      },
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
