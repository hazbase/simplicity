import { createSimplicityClient } from "@hazbase/simplicity";
import { loadSharedConfig } from "./shared";

async function main() {
  const sdk = createSimplicityClient(loadSharedConfig());
  const result = await sdk.bonds.buildBondSettlementPayload({
    definitionPath: process.env.BOND_DEFINITION_JSON ?? "./docs/definitions/bond-definition.json",
    previousIssuancePath:
      process.env.BOND_PREVIOUS_ISSUANCE_JSON ?? "./docs/definitions/bond-issuance-state.json",
    nextIssuancePath:
      process.env.BOND_NEXT_ISSUANCE_JSON ?? "./docs/definitions/bond-issuance-state-partial-redemption.json",
    nextStateSimfPath:
      process.env.BOND_NEXT_STATE_SIMF ?? "./docs/definitions/bond-issuance-anchor.simf",
    nextAmountSat: Number(process.env.BOND_NEXT_AMOUNT_SAT ?? "1900"),
    maxFeeSat: Number(process.env.BOND_MAX_FEE_SAT ?? "100"),
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
