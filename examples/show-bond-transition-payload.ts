import { createSimplicityClient } from "@hazbase/simplicity";
import { buildClientConfig, resolveExamplePath } from "./shared";

async function main() {
  const sdk = createSimplicityClient(buildClientConfig());

  const result = await sdk.bonds.buildBondTransitionPayload({
    definitionPath: process.env.BOND_DEFINITION_PATH ?? resolveExamplePath("../docs/definitions/bond-definition.json"),
    previousIssuancePath:
      process.env.BOND_PREVIOUS_ISSUANCE_PATH ??
      resolveExamplePath("../docs/definitions/bond-issuance-state.json"),
    nextIssuancePath:
      process.env.BOND_NEXT_ISSUANCE_PATH ??
      resolveExamplePath("../docs/definitions/bond-issuance-state-partial-redemption.json"),
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
