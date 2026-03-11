import { createSdkFromEnv, resolveExamplePath } from "./shared";

async function main() {
  const sdk = createSdkFromEnv();
  const definitionPath = resolveExamplePath("docs/definitions/bond-definition.json", "BOND_DEFINITION_JSON");
  const previousIssuancePath = resolveExamplePath(
    "docs/definitions/bond-issuance-state.json",
    "BOND_PREVIOUS_ISSUANCE_JSON"
  );
  const nextIssuancePath = resolveExamplePath(
    "docs/definitions/bond-issuance-state-partial-redemption.json",
    "BOND_NEXT_ISSUANCE_JSON"
  );
  const simfPath = resolveExamplePath(
    "docs/definitions/bond-redemption-transition.simf",
    "BOND_TRANSITION_SIMF"
  );
  const artifactPath = process.env.BOND_TRANSITION_ARTIFACT || "./bond-transition.artifact.json";

  const result = await sdk.bonds.compileBondTransition({
    definitionPath,
    previousIssuancePath,
    nextIssuancePath,
    simfPath,
    artifactPath,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
