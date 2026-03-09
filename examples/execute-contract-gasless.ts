import { createExampleClient, requireEnv, resolveExamplePath } from "./shared";

async function main() {
  const sdk = createExampleClient();

  const compiled = await sdk.loadArtifact(resolveExamplePath("./artifact.json", "SIMPLICITY_ARTIFACT"));
  const result = await compiled.at().executeGasless({
    wallet: "simplicity-test",
    sponsorWallet: "sponsorwallet",
    toAddress: "tex1example",
    signer: { type: "schnorrPrivkeyHex", privkeyHex: requireEnv("SIMPLICITY_PRIMARY_PRIVKEY") },
    broadcast: false,
  });

  console.log(result.rawTxHex);
}

main().catch(console.error);
