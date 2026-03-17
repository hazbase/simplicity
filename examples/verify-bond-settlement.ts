import { createExampleClient } from "./shared";

async function main() {
  const sdk = createExampleClient();
  const result = await sdk.bonds.verifySettlement({
    descriptorPath: process.env.BOND_SETTLEMENT_DESCRIPTOR_JSON,
    definitionPath: process.env.BOND_DEFINITION_JSON ?? "./docs/definitions/bond-definition.json",
    previousIssuancePath:
      process.env.BOND_PREVIOUS_ISSUANCE_JSON ?? "./docs/definitions/bond-issuance-state.json",
    nextIssuancePath:
      process.env.BOND_NEXT_ISSUANCE_JSON ?? "./docs/definitions/bond-issuance-state-partial-redemption.json",
    nextStateSimfPath:
      process.env.BOND_NEXT_STATE_SIMF ?? "./docs/definitions/bond-issuance-anchor.simf",
    nextAmountSat: process.env.BOND_NEXT_AMOUNT_SAT ? Number(process.env.BOND_NEXT_AMOUNT_SAT) : undefined,
    maxFeeSat: process.env.BOND_MAX_FEE_SAT ? Number(process.env.BOND_MAX_FEE_SAT) : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
