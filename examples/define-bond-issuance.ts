import path from "node:path";
import { createExampleClient, resolveExamplePath } from "./shared";

async function main() {
  const sdk = createExampleClient();
  const definitionPath = resolveExamplePath("docs/definitions/bond-definition.json", "BOND_DEFINITION_JSON");
  const issuancePath = resolveExamplePath("docs/definitions/bond-issuance-state.json", "BOND_ISSUANCE_JSON");
  const simfPath = resolveExamplePath("docs/definitions/bond-issuance-anchor.simf", "BOND_ISSUANCE_SIMF");
  const artifactPath = process.env.BOND_ARTIFACT || path.resolve(process.cwd(), "bond-issuance.artifact.json");

  const compiled = await sdk.bonds.defineBond({
    definitionPath,
    issuancePath,
    simfPath,
    artifactPath,
  });

  console.log(
    JSON.stringify(
      {
        deployment: compiled.deployment(),
        definition: compiled.definition(),
        state: compiled.state(),
        artifactPath,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
