import path from "node:path";
import {
  buildRefundedCapitalCallState,
  createSimplicityClient,
} from "../src";

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
  const verifiedRefundOnly = await sdk.funds.verifyCapitalCall({
    artifact: capitalCall.refundOnlyCompiled.artifact,
    definitionPath,
    capitalCallValue: capitalCall.refundOnlyCapitalCallValue,
  });

  const refundedCapitalCall = buildRefundedCapitalCallState({
    previous: capitalCall.refundOnlyCapitalCallValue,
    refundedAt: "2026-03-20T00:00:00Z",
  });

  const evidence = await sdk.funds.exportEvidence({
    artifact: capitalCall.refundOnlyCompiled.artifact,
    definitionPath,
    capitalCallValue: refundedCapitalCall,
    verificationReportValue: verifiedRefundOnly.report,
  });
  const finality = await sdk.funds.exportFinalityPayload({
    artifact: capitalCall.refundOnlyCompiled.artifact,
    definitionPath,
    capitalCallValue: refundedCapitalCall,
    verificationReportValue: verifiedRefundOnly.report,
  });

  console.log(JSON.stringify({
    openContractAddress: capitalCall.openCompiled.deployment().contractAddress,
    refundOnlyContractAddress: capitalCall.refundOnlyCompiled.deployment().contractAddress,
    openStage: verifiedOpen.report.capitalCallTrust?.capitalCallStage,
    refundOnlyStage: verifiedRefundOnly.report.capitalCallTrust?.capitalCallStage,
    cutoffMode: verifiedRefundOnly.report.capitalCallTrust?.cutoffMode,
    refundedStatus: refundedCapitalCall.status,
    refundedStateHash: evidence.capitalCall?.hash,
    finalityCapitalCallHash: finality.capitalCallStateHash,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
