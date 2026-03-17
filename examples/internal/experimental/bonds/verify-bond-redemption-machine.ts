import { verifyBondRedemptionMachineArtifact } from "../../../../src/internal/experimental/bond";
import { createExampleClient, resolveExamplePath } from "../../../shared";

const sdk = createExampleClient();

const result = await verifyBondRedemptionMachineArtifact(sdk, {
  artifactPath:
    process.env.BOND_ARTIFACT_PATH ??
    resolveExamplePath("tmp/bond-redemption-machine.artifact.json", "BOND_ARTIFACT_PATH"),
  definitionPath:
    process.env.BOND_DEFINITION_PATH ??
    resolveExamplePath("docs/definitions/bond-definition.json", "BOND_DEFINITION_PATH"),
  previousIssuancePath:
    process.env.BOND_PREVIOUS_ISSUANCE_PATH ??
    resolveExamplePath("docs/definitions/bond-issuance-state.json", "BOND_PREVIOUS_ISSUANCE_PATH"),
  nextIssuancePath:
    process.env.BOND_NEXT_ISSUANCE_PATH ??
    resolveExamplePath("docs/definitions/bond-issuance-state-partial-redemption.json", "BOND_NEXT_ISSUANCE_PATH"),
});

console.log(JSON.stringify(result, null, 2));
