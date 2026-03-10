import path from "node:path";
import { createExampleClient, resolveExamplePath } from "./shared";

async function main() {
  const sdk = createExampleClient();
  const definitionPath = resolveExamplePath("docs/definitions/bond-definition.json", "BOND_DEFINITION_JSON");
  const simfPath = resolveExamplePath("docs/definitions/bond-anchor.simf", "BOND_ANCHOR_SIMF");
  const artifactPath = process.env.BOND_ARTIFACT || path.resolve(process.cwd(), "bond.artifact.json");

  const definition = await sdk.loadDefinition({
    type: "bond",
    id: process.env.BOND_DEFINITION_ID || "BOND-2026-001",
    jsonPath: definitionPath,
  });

  const compiled = await sdk.compileFromFile({
    simfPath,
    templateVars: {
      MIN_HEIGHT: Number(process.env.BOND_MIN_HEIGHT || 2344430),
      SIGNER_XONLY:
        process.env.BOND_CONTROLLER_XONLY ||
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
    definition: {
      type: definition.definitionType,
      id: definition.definitionId,
      schemaVersion: definition.schemaVersion,
      jsonPath: definition.sourcePath,
    },
    artifactPath,
  });

  console.log(JSON.stringify({ definition, deployment: compiled.deployment(), artifactPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
