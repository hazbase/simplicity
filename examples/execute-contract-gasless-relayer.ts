import { createExampleClient, exampleValue, requireEnv, resolveExamplePath } from "./shared";

async function main() {
  const sdk = createExampleClient();

  const compiled = await sdk.loadArtifact(resolveExamplePath("./artifact.json", "SIMPLICITY_ARTIFACT"));
  const relayer = sdk.relayer({
    baseUrl: exampleValue("SIMPLICITY_RELAYER_URL", "http://127.0.0.1:3000"),
    apiKey: requireEnv("SIMPLICITY_RELAYER_API_KEY"),
  });

  const result = await compiled.at().executeGasless({
    relayer,
    fromLabel: "demo-user",
    wallet: "simplicity-test",
    toAddress: "tex1example",
    signer: { type: "schnorrPrivkeyHex", privkeyHex: requireEnv("SIMPLICITY_PRIMARY_PRIVKEY") },
  });

  console.log(result.txId);
}

main().catch(console.error);
