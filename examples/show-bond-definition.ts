import { createExampleClient, resolveExamplePath } from "./shared";

async function main() {
  const sdk = createExampleClient();
  const artifactPath = resolveExamplePath("bond.artifact.json", "BOND_ARTIFACT");
  const definitionPath = resolveExamplePath("docs/definitions/bond-definition.json", "BOND_DEFINITION_JSON");
  const compiled = await sdk.loadArtifact(artifactPath);
  const verification = await compiled.at().getTrustedDefinition({
    jsonPath: definitionPath,
    type: "bond",
    id: process.env.BOND_DEFINITION_ID || "BOND-2026-001",
  });

  console.log(JSON.stringify(verification, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
