import { createExampleClient, requireEnv, resolveExamplePath } from "./shared";

async function main() {
  const sdk = createExampleClient();

  const compiled = await sdk.loadArtifact(resolveExamplePath("./artifact.json", "SIMPLICITY_ARTIFACT"));
  const result = await compiled.at().inspectCall({
    wallet: "simplicity-test",
    toAddress: "tex1example",
    signer: { type: "schnorrPrivkeyHex", privkeyHex: requireEnv("SIMPLICITY_PRIMARY_PRIVKEY") },
  });

  console.log(result.summaryHash);
}

main().catch(console.error);
