import { createSimplicityClient } from "../src";

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

  const verification = await sdk.receivables.verifyStateHistory({
    definitionPath: "./docs/definitions/receivable-definition.json",
    stateHistoryPaths: [
      "./docs/definitions/receivable-state-originated.json",
      "./docs/definitions/receivable-state-funded.json",
      "./docs/definitions/receivable-state-repaid.json",
    ],
  });

  const evidence = await sdk.receivables.exportEvidence({
    definitionPath: "./docs/definitions/receivable-definition.json",
    stateHistoryPaths: [
      "./docs/definitions/receivable-state-originated.json",
      "./docs/definitions/receivable-state-funded.json",
      "./docs/definitions/receivable-state-repaid.json",
    ],
  });

  console.log(
    JSON.stringify(
      {
        verified: verification.verified,
        latestStatus: verification.report.stateLineageTrust?.latestStatus,
        fullLineageVerified: verification.report.stateLineageTrust?.fullLineageVerified,
        trustSummary: evidence.trustSummary,
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
