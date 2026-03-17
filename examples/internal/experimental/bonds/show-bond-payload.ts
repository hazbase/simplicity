import { buildBondPayload } from "../../../../src/internal/experimental/bond";
import { createExampleClient, resolveExamplePath } from "../../../shared";

async function main() {
  const sdk = createExampleClient();
  const artifactPath = resolveExamplePath("bond-issuance.artifact.json", "BOND_ISSUANCE_ARTIFACT");
  const definitionPath = resolveExamplePath("docs/definitions/bond-definition.json", "BOND_DEFINITION_JSON");
  const issuancePath = resolveExamplePath("docs/definitions/bond-issuance-state.json", "BOND_ISSUANCE_JSON");

  const result = await buildBondPayload(sdk, {
    artifactPath,
    definitionPath,
    issuancePath,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
