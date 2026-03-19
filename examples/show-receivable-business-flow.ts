import {
  buildReceivableFundingClaimDescriptor,
  buildReceivableRepaymentClaimDescriptor,
  createSimplicityClient,
} from "../src";

async function main() {
  const sdk = createSimplicityClient({
    network: "liquidtestnet",
    rpc: {
      url: process.env.ELEMENTS_RPC_URL ?? "http://127.0.0.1:18884",
      username: process.env.ELEMENTS_RPC_USER ?? "admin",
      password: process.env.ELEMENTS_RPC_PASSWORD ?? "adminpass",
      wallet: process.env.ELEMENTS_RPC_WALLET ?? "simplicity-test",
    },
    toolchain: {
      simcPath: process.env.SIMC_PATH ?? "simc",
      halSimplicityPath: process.env.HAL_SIMPLICITY_PATH ?? "hal-simplicity",
      elementsCliPath: process.env.ELEMENTS_CLI_PATH ?? "eltc",
    },
  });

  const definition = {
    receivableId: "REC-001",
    originatorEntityId: "originator-1",
    debtorEntityId: "debtor-1",
    currencyAssetId: "bitcoin",
    faceValue: 10000,
    dueDate: "2027-12-31T00:00:00Z",
    controllerXonly: "11".repeat(32),
  };

  const originated = {
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
    status: "ORIGINATED" as const,
    createdAt: "2027-01-01T00:00:00Z",
    lastTransition: {
      type: "ORIGINATE" as const,
      amount: 10000,
      at: "2027-01-01T00:00:00Z",
    },
  };

  const funded = await sdk.receivables.prepareFunding({
    definitionValue: definition,
    previousStateValue: originated,
    stateId: "REC-001-S1",
    holderEntityId: "fund-1",
    fundedAt: "2027-01-02T00:00:00Z",
  });
  const fundingClaim = await sdk.receivables.verifyFundingClaim({
    definitionValue: definition,
    currentStateValue: funded.nextStateValue,
    stateHistoryValues: [originated, funded.nextStateValue],
    fundingClaimValue: buildReceivableFundingClaimDescriptor({
      claimId: "REC-001-FUNDING-CLAIM",
      currentState: funded.nextStateValue,
    }),
  });
  const repaid = await sdk.receivables.prepareRepayment({
    definitionValue: definition,
    previousStateValue: funded.nextStateValue,
    stateId: "REC-001-S2",
    amount: 10000,
    repaidAt: "2027-02-01T00:00:00Z",
  });
  const repaymentClaim = await sdk.receivables.verifyRepaymentClaim({
    definitionValue: definition,
    currentStateValue: repaid.nextStateValue,
    stateHistoryValues: [originated, funded.nextStateValue, repaid.nextStateValue],
    repaymentClaimValue: buildReceivableRepaymentClaimDescriptor({
      claimId: "REC-001-REPAYMENT-CLAIM",
      currentState: repaid.nextStateValue,
    }),
  });
  const closing = await sdk.receivables.prepareClosing({
    definitionValue: definition,
    latestStateValue: repaid.nextStateValue,
    stateHistoryValues: [originated, funded.nextStateValue, repaid.nextStateValue],
    closingId: "REC-CLOSE-001",
    closedAt: "2027-02-02T00:00:00Z",
  });
  const finality = await sdk.receivables.exportFinalityPayload({
    definitionValue: definition,
    stateHistoryValues: [originated, funded.nextStateValue, repaid.nextStateValue],
    fundingClaimValue: fundingClaim.claimValue,
    repaymentClaimValue: repaymentClaim.claimValue,
    closingValue: closing.closingValue,
  });

  console.log(
    JSON.stringify(
      {
        fundingStatus: funded.nextStateValue.status,
        fundingClaimVerified: fundingClaim.verified,
        repaymentStatus: repaid.nextStateValue.status,
        repaymentClaimVerified: repaymentClaim.verified,
        closingReason: closing.closingValue.closingReason,
        fullLineageVerified: finality.trustSummary.lineage?.fullLineageVerified ?? false,
        latestStateHash: finality.latestStateHash,
        fundingClaimHash: finality.fundingClaimHash,
        repaymentClaimHash: finality.repaymentClaimHash,
        closingHash: finality.closingHash,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
