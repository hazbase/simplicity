import path from "node:path";
import { createExampleClient, resolveExamplePath } from "./shared";

async function main() {
  const sdk = createExampleClient();
  const definitionPath = resolveExamplePath("docs/definitions/bond-definition.json", "BOND_DEFINITION_JSON");
  const previousIssuancePath = resolveExamplePath(
    "docs/definitions/bond-issuance-state.json",
    "BOND_PREVIOUS_ISSUANCE_JSON"
  );
  const simfPath = resolveExamplePath("docs/definitions/bond-issuance-anchor.simf", "BOND_ISSUANCE_SIMF");
  const artifactPath = process.env.BOND_REDEEM_ARTIFACT || path.resolve(process.cwd(), "bond-redemption.artifact.json");
  const amount = Number(process.env.BOND_REDEEM_AMOUNT || "250000");
  const redeemedAt = process.env.BOND_REDEEMED_AT || "2027-03-10T00:00:00Z";

  const compiled = await sdk.bonds.redeemBond({
    definitionPath,
    previousIssuancePath,
    amount,
    redeemedAt,
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
        amount,
        redeemedAt,
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
