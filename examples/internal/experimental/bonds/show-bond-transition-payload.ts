import { buildBondTransitionPayload } from "../../../../src/internal/experimental/bond";
import { createExampleClient, resolveExamplePath } from "../../../shared";

async function main() {
  const sdk = createExampleClient();

  const result = await buildBondTransitionPayload(sdk, {
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
