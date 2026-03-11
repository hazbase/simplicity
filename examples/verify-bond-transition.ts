import { createExampleClient, resolveExamplePath } from "./shared";

async function main() {
  const sdk = createExampleClient();
  const previousIssuancePath = resolveExamplePath(
    "docs/definitions/bond-issuance-state.json",
    "BOND_PREVIOUS_ISSUANCE_JSON"
  );
  const nextIssuancePath = resolveExamplePath("bond-redemption-state.json", "BOND_NEXT_ISSUANCE_JSON");

  const result = await sdk.bonds.verifyBondTransition({
    previousIssuancePath,
    nextIssuancePath,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
