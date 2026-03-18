import path from "node:path";
import {
  buildClaimedCapitalCallState,
  buildLPPositionReceipt,
  createSimplicityClient,
  summarizeDistributionDescriptor,
} from "../src";

const MANAGER_PRIVKEY = "0000000000000000000000000000000000000000000000000000000000000001";

async function main() {
  const sdk = createSimplicityClient({
    network: "liquidtestnet",
    rpc: {
      url: process.env.ELEMENTS_RPC_URL ?? "http://127.0.0.1:18884",
      username: process.env.ELEMENTS_RPC_USER ?? "user",
      password: process.env.ELEMENTS_RPC_PASSWORD ?? "pass",
      wallet: process.env.ELEMENTS_RPC_WALLET ?? "simplicity-test",
    },
    toolchain: {
      simcPath: process.env.SIMC_PATH ?? "simc",
      halSimplicityPath: process.env.HAL_SIMPLICITY_PATH ?? "hal-simplicity",
      elementsCliPath: process.env.ELEMENTS_CLI_PATH ?? "eltc",
    },
  });

  const docsRoot = path.resolve(process.cwd(), "docs/definitions");
  const definitionPath = path.join(docsRoot, "fund-definition.json");
  const capitalCallPath = path.join(docsRoot, "fund-capital-call-state.json");

  const capitalCall = await sdk.funds.prepareCapitalCall({
    definitionPath,
    capitalCallPath,
  });
  const verifiedOpen = await sdk.funds.verifyCapitalCall({
    artifact: capitalCall.openCompiled.artifact,
    definitionPath,
    capitalCallValue: capitalCall.capitalCallValue,
  });

  const claimedAt = "2026-03-18T00:00:00Z";
  const claimedCapitalCall = buildClaimedCapitalCallState({
    previous: capitalCall.capitalCallValue,
    claimedAt,
  });

  const initialReceipt = buildLPPositionReceipt({
    positionId: "POS-001",
    capitalCall: capitalCall.capitalCallValue,
    effectiveAt: claimedAt,
  });
  const signedInitialReceipt = await sdk.funds.signPositionReceipt({
    definitionPath,
    positionReceiptValue: initialReceipt,
    signer: { type: "schnorrPrivkeyHex", privkeyHex: MANAGER_PRIVKEY },
    signedAt: claimedAt,
  });

  const firstDistribution = await sdk.funds.prepareDistribution({
    definitionPath,
    positionReceiptValue: signedInitialReceipt.positionReceiptEnvelope,
    distributionId: "DIST-001",
    assetId: capitalCall.capitalCallValue.currencyAssetId,
    amountSat: 2000,
    approvedAt: "2027-03-18T00:00:00Z",
  });
  const afterFirst = await sdk.funds.reconcilePosition({
    definitionPath,
    positionReceiptValue: signedInitialReceipt.positionReceiptEnvelope,
    distributionValue: firstDistribution.distributionValue,
    signer: { type: "schnorrPrivkeyHex", privkeyHex: MANAGER_PRIVKEY },
    signedAt: "2027-03-18T00:00:00Z",
  });

  const secondDistribution = await sdk.funds.prepareDistribution({
    definitionPath,
    positionReceiptValue: afterFirst.reconciledReceiptEnvelope,
    distributionId: "DIST-002",
    assetId: capitalCall.capitalCallValue.currencyAssetId,
    amountSat: initialReceipt.fundedAmount - 2000,
    approvedAt: "2028-03-18T00:00:00Z",
  });
  const afterSecond = await sdk.funds.reconcilePosition({
    definitionPath,
    positionReceiptValue: afterFirst.reconciledReceiptEnvelope,
    distributionValue: secondDistribution.distributionValue,
    signer: { type: "schnorrPrivkeyHex", privkeyHex: MANAGER_PRIVKEY },
    signedAt: "2028-03-18T00:00:00Z",
  });

  const closing = await sdk.funds.prepareClosing({
    definitionPath,
    positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
    closingId: "CLOSE-001",
    finalDistributionHashes: [
      summarizeDistributionDescriptor(firstDistribution.distributionValue).hash,
      summarizeDistributionDescriptor(secondDistribution.distributionValue).hash,
    ],
    closedAt: "2029-03-18T00:00:00Z",
  });
  const verifiedFinalReceipt = await sdk.funds.verifyPositionReceipt({
    definitionPath,
    positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
  });
  const verifiedClosing = await sdk.funds.verifyClosing({
    definitionPath,
    positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
    closingValue: closing.closingValue,
  });

  const finality = await sdk.funds.exportFinalityPayload({
    artifact: secondDistribution.compiled.artifact,
    definitionPath,
    capitalCallValue: claimedCapitalCall,
    positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
    distributionValues: [
      firstDistribution.distributionValue,
      secondDistribution.distributionValue,
    ],
    closingValue: closing.closingValue,
    verificationReportValue: {
      schemaVersion: "fund-verification-report/v1",
      capitalCallTrust: {
        capitalCallStage: "claimed",
        cutoffMode: "rollover-window",
      },
      receiptTrust: verifiedFinalReceipt.report.receiptTrust,
      closingTrust: verifiedClosing.report.closingTrust,
    },
  });

  console.log(JSON.stringify({
    openContractAddress: capitalCall.openCompiled.deployment().contractAddress,
    refundOnlyContractAddress: capitalCall.refundOnlyCompiled.deployment().contractAddress,
    capitalCallStage: verifiedOpen.report.capitalCallTrust?.capitalCallStage,
    cutoffMode: verifiedOpen.report.capitalCallTrust?.cutoffMode,
    initialReceiptHash: signedInitialReceipt.positionReceiptSummary.hash,
    initialEnvelopeHash: signedInitialReceipt.positionReceiptEnvelopeSummary.hash,
    firstDistributionContractAddress: firstDistribution.compiled.deployment().contractAddress,
    secondDistributionContractAddress: secondDistribution.compiled.deployment().contractAddress,
    finalSequence: afterSecond.reconciledReceiptValue.sequence,
    finalReceiptHash: afterSecond.reconciledReceiptSummary.hash,
    finalEnvelopeHash: afterSecond.reconciledReceiptEnvelopeSummary.hash,
    closingHash: closing.closingHash,
    finalityPositionReceiptEnvelopeHash: finality.positionReceiptEnvelopeHash,
    finalityDistributionHashes: finality.distributionHashes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
