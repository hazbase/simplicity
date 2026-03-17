import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createExampleClient, resolveExamplePath } from "./shared";

async function main() {
  const sdk = createExampleClient();
  const definitionPath = resolveExamplePath("docs/definitions/bond-definition.json", "BOND_DEFINITION_JSON");
  const previousIssuancePath = resolveExamplePath(
    "docs/definitions/bond-issuance-state.json",
    "BOND_PREVIOUS_ISSUANCE_JSON"
  );
  const simfPath = resolveExamplePath("docs/definitions/bond-issuance-anchor.simf", "BOND_ISSUANCE_SIMF");
  const amount = Number(process.env.BOND_REDEEM_AMOUNT || "250000");
  const redeemedAt = process.env.BOND_REDEEMED_AT || "2027-03-10T00:00:00Z";
  const nextIssuanceOut =
    process.env.BOND_NEXT_ISSUANCE_OUT || path.resolve(process.cwd(), "bond-redemption-preview.json");

  const prepared = await sdk.bonds.prepareRedemption({
    definitionPath,
    previousIssuancePath,
    amount,
    redeemedAt,
    nextStateSimfPath: simfPath,
    nextAmountSat: Number(process.env.BOND_NEXT_AMOUNT_SAT || "1900"),
    maxFeeSat: process.env.BOND_MAX_FEE_SAT ? Number(process.env.BOND_MAX_FEE_SAT) : 100,
    outputBindingMode:
      (process.env.BOND_OUTPUT_BINDING_MODE as "none" | "script-bound" | "descriptor-bound" | undefined) ??
      "script-bound",
  });

  await mkdir(path.dirname(nextIssuanceOut), { recursive: true });
  await writeFile(nextIssuanceOut, `${JSON.stringify(prepared.preview.next, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        nextIssuanceState: prepared.preview.next,
        settlement: prepared.settlement,
        nextIssuanceOut,
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
