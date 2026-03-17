import { buildBondRolloverPlan } from "../../../../src/internal/experimental/bond";
import { createExampleClient, resolveExamplePath } from "../../../shared";

async function main() {
  const sdk = createExampleClient();
  const result = await buildBondRolloverPlan(sdk, {
    currentArtifactPath: resolveExamplePath("bond-issuance.artifact.json", "BOND_CURRENT_ARTIFACT"),
    definitionPath: resolveExamplePath("docs/definitions/bond-definition.json", "BOND_DEFINITION_JSON"),
    previousIssuancePath: resolveExamplePath("docs/definitions/bond-issuance-state.json", "BOND_PREVIOUS_ISSUANCE_JSON"),
    nextIssuancePath: resolveExamplePath(
      "docs/definitions/bond-issuance-state-partial-redemption.json",
      "BOND_NEXT_ISSUANCE_JSON"
    ),
    nextSimfPath: resolveExamplePath("docs/definitions/bond-issuance-anchor.simf", "BOND_NEXT_SIMF"),
    nextArtifactPath: process.env.BOND_NEXT_ARTIFACT,
  });

  console.log(
    JSON.stringify(
      {
        currentContractAddress: result.currentArtifact.compiled.contractAddress,
        nextContractAddress: result.nextContractAddress,
        transitionPayload: result.transitionPayload,
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
