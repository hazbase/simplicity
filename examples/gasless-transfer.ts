import { createSimplicityClient } from "../src";
import { exampleValue, requireEnv } from "./shared";

async function main() {
  const sdk = createSimplicityClient({
    network: "liquidtestnet",
    rpc: {
      url: exampleValue("ELEMENTS_RPC_URL", "http://127.0.0.1:18884"),
      username: exampleValue("ELEMENTS_RPC_USER", "<rpc-user>"),
      password: exampleValue("ELEMENTS_RPC_PASSWORD", "<rpc-password>"),
      wallet: "userwallet",
    },
    toolchain: {
      simcPath: process.env.SIMC_PATH || "simc",
      halSimplicityPath: "hal-simplicity",
      elementsCliPath: "eltc",
    },
  });

  const result = await sdk.payments.gaslessTransfer({
    relayer: sdk.relayer({
      baseUrl: exampleValue("SIMPLICITY_RELAYER_URL", "http://127.0.0.1:3000"),
      apiKey: requireEnv("SIMPLICITY_RELAYER_API_KEY"),
    }),
    amount: 0.0001,
    toAddress: "tex1example",
    fromLabel: "user-1",
    userWallet: "userwallet",
  });

  console.log(result.submit.txId);
}

main().catch(console.error);
