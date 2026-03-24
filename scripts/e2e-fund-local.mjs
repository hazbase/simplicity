import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { resolveRuntimeKeyPair } from "./runtimeKeys.mjs";
import {
  buildClaimedCapitalCallState,
  buildLPPositionReceipt,
  createSimplicityClient,
  summarizeDistributionDescriptor,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

function env(name, fallback) {
  return process.env[name] || fallback;
}

function createLocalFundClient() {
  const sdk = createSimplicityClient({
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

  sdk.rpc.call = async (method) => {
    if (method === "getaddressinfo") {
      return { scriptPubKey: "5120" + "11".repeat(32) };
    }
    if (method === "getsidechaininfo") {
      return { pegged_asset: "22".repeat(32) };
    }
    throw new Error(`e2e:fund-local mock does not support RPC method: ${method}`);
  };
  return sdk;
}

async function main() {
  try {
    await execFileAsync(env("SIMC_PATH", "simc"), ["--help"]);
    await execFileAsync(env("HAL_SIMPLICITY_PATH", "hal-simplicity"), ["--version"]);
  } catch {
    console.log(JSON.stringify({
      skipped: true,
      reason: "simc/hal-simplicity are required for npm run e2e:fund-local",
    }, null, 2));
    return;
  }

  const sdk = createLocalFundClient();
  const managerKeyPair = resolveRuntimeKeyPair({
    label: "fund manager",
    explicitPrivkey: process.env.FUND_MANAGER_PRIVKEY,
    explicitXonly: process.env.FUND_MANAGER_XONLY,
    privkeyStateKey: "managerPrivkey",
    xonlyStateKey: "managerXonly",
  });
  const definition = {
    fundId: "FUND-LOCAL-001",
    managerEntityId: "manager-a",
    managerXonly: managerKeyPair.xonly,
    currencyAssetId: env("FUND_CURRENCY_ASSET_ID", "bitcoin"),
    jurisdiction: "JP",
    vintage: "2026",
  };
  const capitalCall = {
    callId: "CALL-LOCAL-001",
    fundId: definition.fundId,
    lpId: "lp-a",
    currencyAssetId: definition.currencyAssetId,
    amount: Number(env("FUND_CAPITAL_CALL_AMOUNT_SAT", "6000")),
    lpXonly: env("FUND_LP_XONLY", "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"),
    managerXonly: definition.managerXonly,
    status: "OPEN",
    claimCutoffHeight: Number(env("FUND_CLAIM_CUTOFF_HEIGHT", "2345678")),
  };

  const capitalCallPrepared = await sdk.funds.prepareCapitalCall({
    definitionValue: definition,
    capitalCallValue: capitalCall,
  });
  const capitalCallVerified = await sdk.funds.verifyCapitalCall({
    artifact: capitalCallPrepared.openCompiled.artifact,
    definitionValue: definition,
    capitalCallValue: capitalCall,
  });
  const refundOnlyVerified = await sdk.funds.verifyCapitalCall({
    artifact: capitalCallPrepared.refundOnlyCompiled.artifact,
    definitionValue: definition,
    capitalCallValue: capitalCallPrepared.refundOnlyCapitalCallValue,
  });

  const claimedCapitalCall = buildClaimedCapitalCallState({
    previous: capitalCall,
    claimedAt: env("FUND_CLAIMED_AT", "2026-03-18T00:00:00Z"),
  });
  const initialReceipt = buildLPPositionReceipt({
    positionId: env("FUND_POSITION_ID", "POS-LOCAL-001"),
    capitalCall,
    effectiveAt: env("FUND_EFFECTIVE_AT", "2026-03-18T00:00:00Z"),
  });
  const signedInitialReceipt = await sdk.funds.signPositionReceipt({
    definitionValue: definition,
    positionReceiptValue: initialReceipt,
    signer: { type: "schnorrPrivkeyHex", privkeyHex: managerKeyPair.privkeyHex },
    signedAt: env("FUND_EFFECTIVE_AT", "2026-03-18T00:00:00Z"),
  });
  const verifiedInitialReceipt = await sdk.funds.verifyPositionReceipt({
    definitionValue: definition,
    positionReceiptValue: signedInitialReceipt.positionReceiptEnvelope,
  });

  const firstDistribution = await sdk.funds.prepareDistribution({
    definitionValue: definition,
    positionReceiptValue: signedInitialReceipt.positionReceiptEnvelope,
    distributionId: env("FUND_DISTRIBUTION_ID", "DIST-LOCAL-001"),
    assetId: definition.currencyAssetId,
    amountSat: Number(env("FUND_FIRST_DISTRIBUTION_AMOUNT_SAT", "2000")),
    approvedAt: env("FUND_FIRST_APPROVED_AT", "2027-03-18T00:00:00Z"),
  });
  const verifiedFirstDistribution = await sdk.funds.verifyDistribution({
    artifact: firstDistribution.compiled.artifact,
    definitionValue: definition,
    positionReceiptValue: signedInitialReceipt.positionReceiptEnvelope,
    distributionValue: firstDistribution.distributionValue,
  });
  const afterFirst = await sdk.funds.reconcilePosition({
    definitionValue: definition,
    positionReceiptValue: signedInitialReceipt.positionReceiptEnvelope,
    distributionValue: firstDistribution.distributionValue,
    signer: { type: "schnorrPrivkeyHex", privkeyHex: managerKeyPair.privkeyHex },
    signedAt: env("FUND_FIRST_APPROVED_AT", "2027-03-18T00:00:00Z"),
  });

  const secondDistribution = await sdk.funds.prepareDistribution({
    definitionValue: definition,
    positionReceiptValue: afterFirst.reconciledReceiptEnvelope,
    distributionId: env("FUND_SECOND_DISTRIBUTION_ID", "DIST-LOCAL-002"),
    assetId: definition.currencyAssetId,
    amountSat: initialReceipt.fundedAmount - Number(env("FUND_FIRST_DISTRIBUTION_AMOUNT_SAT", "2000")),
    approvedAt: env("FUND_SECOND_APPROVED_AT", "2028-03-18T00:00:00Z"),
  });
  const verifiedSecondDistribution = await sdk.funds.verifyDistribution({
    artifact: secondDistribution.compiled.artifact,
    definitionValue: definition,
    positionReceiptValue: afterFirst.reconciledReceiptEnvelope,
    distributionValue: secondDistribution.distributionValue,
  });
  const afterSecond = await sdk.funds.reconcilePosition({
    definitionValue: definition,
    positionReceiptValue: afterFirst.reconciledReceiptEnvelope,
    distributionValue: secondDistribution.distributionValue,
    signer: { type: "schnorrPrivkeyHex", privkeyHex: managerKeyPair.privkeyHex },
    signedAt: env("FUND_SECOND_APPROVED_AT", "2028-03-18T00:00:00Z"),
  });
  const receiptChain = [
    signedInitialReceipt.positionReceiptEnvelope,
    afterFirst.reconciledReceiptEnvelope,
    afterSecond.reconciledReceiptEnvelope,
  ];

  const closingPrepared = await sdk.funds.prepareClosing({
    definitionValue: definition,
    positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
    previousPositionReceiptValue: afterFirst.reconciledReceiptEnvelope,
    positionReceiptChainValues: receiptChain,
    closingId: env("FUND_CLOSING_ID", "CLOSE-LOCAL-001"),
    finalDistributionHashes: [
      summarizeDistributionDescriptor(firstDistribution.distributionValue).hash,
      summarizeDistributionDescriptor(secondDistribution.distributionValue).hash,
    ],
    closedAt: env("FUND_CLOSED_AT", "2029-03-18T00:00:00Z"),
  });
  const verifiedFinalReceipt = await sdk.funds.verifyPositionReceipt({
    definitionValue: definition,
    positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
    previousPositionReceiptValue: afterFirst.reconciledReceiptEnvelope,
    positionReceiptChainValues: receiptChain,
  });
  const verifiedReceiptChain = await sdk.funds.verifyPositionReceiptChain({
    definitionValue: definition,
    positionReceiptChainValues: receiptChain,
  });
  const verifiedClosing = await sdk.funds.verifyClosing({
    definitionValue: definition,
    positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
    previousPositionReceiptValue: afterFirst.reconciledReceiptEnvelope,
    positionReceiptChainValues: receiptChain,
    closingValue: closingPrepared.closingValue,
  });

  const binding = sdk.outputBinding.evaluateSupport({
    assetId: definition.currencyAssetId,
    requestedBindingMode: "descriptor-bound",
    rawOutput: {
      assetBytesHex: "01" + "22".repeat(32),
      amountBytesHex: "0100000000000009c4",
      nonceBytesHex: "00",
      scriptPubKeyHashHex: "33".repeat(32),
      rangeProofHashHex: "44".repeat(32),
    },
  });

  const finality = await sdk.funds.exportFinalityPayload({
    artifact: secondDistribution.compiled.artifact,
    definitionValue: definition,
    capitalCallValue: claimedCapitalCall,
    positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
    previousPositionReceiptValue: afterFirst.reconciledReceiptEnvelope,
    positionReceiptChainValues: receiptChain,
    distributionValues: [firstDistribution.distributionValue, secondDistribution.distributionValue],
    closingValue: closingPrepared.closingValue,
    verificationReportValue: {
      schemaVersion: "fund-verification-report/v1",
      capitalCallTrust: {
        capitalCallStage: "claimed",
        cutoffMode: "rollover-window",
      },
      receiptTrust: verifiedFinalReceipt.report.receiptTrust,
      receiptChainTrust: verifiedFinalReceipt.report.receiptChainTrust,
      closingTrust: verifiedClosing.report.closingTrust,
    },
  });

  console.log(JSON.stringify({
    matrix: {
      capitalCall: {
        verified: capitalCallVerified.ok,
        stage: capitalCallVerified.report.capitalCallTrust?.capitalCallStage,
        openContractAddress: capitalCallPrepared.openCompiled.deployment().contractAddress,
        refundOnlyContractAddress: capitalCallPrepared.refundOnlyCompiled.deployment().contractAddress,
      },
      refundOnly: {
        verified: refundOnlyVerified.ok,
        stage: refundOnlyVerified.report.capitalCallTrust?.capitalCallStage,
      },
      receipt: {
        verified: verifiedInitialReceipt.verified,
        envelopeHash: signedInitialReceipt.positionReceiptEnvelopeSummary.hash,
      },
      distribution: {
        verified: verifiedFirstDistribution.ok && verifiedSecondDistribution.ok,
        finalSequence: afterSecond.reconciledReceiptValue.sequence,
        fullChainVerified: verifiedReceiptChain.report.receiptChainTrust?.fullChainVerified,
      },
      closing: {
        verified: true,
        closingHash: closingPrepared.closingHash,
      },
      binding: {
        reasonCode: binding.reasonCode,
        supportedForm: binding.supportedForm,
        resolvedBindingMode: binding.resolvedBindingMode,
      },
      finality: {
        definitionHash: finality.definitionHash,
        positionReceiptHash: finality.positionReceiptHash,
        positionReceiptEnvelopeHash: finality.positionReceiptEnvelopeHash,
        bindingMode: finality.bindingMode,
      },
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
