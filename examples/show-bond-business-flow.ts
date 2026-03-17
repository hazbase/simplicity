import { createExampleClient, resolveExamplePath } from "./shared";

async function main() {
  const sdk = createExampleClient();
  const artifactPath = resolveExamplePath("bond-issuance.artifact.json", "BOND_ARTIFACT");
  const definitionPath = resolveExamplePath("docs/definitions/bond-definition.json", "BOND_DEFINITION_JSON");
  const issuancePath = resolveExamplePath("docs/definitions/bond-issuance-state.json", "BOND_ISSUANCE_JSON");
  const redeemedIssuancePath = resolveExamplePath(
    "docs/definitions/bond-issuance-state-redeemed.json",
    "BOND_REDEEMED_ISSUANCE_JSON"
  );
  const nextStateSimfPath = resolveExamplePath("docs/definitions/bond-issuance-anchor.simf", "BOND_NEXT_STATE_SIMF");

  const defined = await sdk.bonds.define({
    definitionPath,
    issuancePath,
    simfPath: nextStateSimfPath,
    artifactPath,
  });

  const verified = await sdk.bonds.verify({
    artifactPath,
    definitionPath,
    issuancePath,
  });

  const redemption = await sdk.bonds.prepareRedemption({
    definitionPath,
    previousIssuancePath: issuancePath,
    amount: Number(process.env.BOND_REDEEM_AMOUNT ?? "250000"),
    redeemedAt: process.env.BOND_REDEEMED_AT ?? "2027-03-10T00:00:00Z",
    nextStateSimfPath,
    nextAmountSat: Number(process.env.BOND_NEXT_AMOUNT_SAT ?? "1900"),
    maxFeeSat: Number(process.env.BOND_MAX_FEE_SAT ?? "100"),
    outputBindingMode:
      (process.env.BOND_OUTPUT_BINDING_MODE as "none" | "script-bound" | "descriptor-bound" | undefined) ??
      "script-bound",
  });

  const settlement = await sdk.bonds.buildSettlement({
    definitionPath,
    previousIssuancePath: issuancePath,
    nextIssuanceValue: redemption.preview.next,
    nextStateSimfPath,
    nextAmountSat: redemption.settlement.nextAmountSat,
    maxFeeSat: redemption.settlement.maxFeeSat,
    outputBindingMode: redemption.settlement.descriptor.outputBindingMode,
  });

  const closing = await sdk.bonds.prepareClosing({
    definitionPath,
    redeemedIssuancePath,
    settlementDescriptorValue: settlement.descriptor,
    closedAt: process.env.BOND_CLOSED_AT ?? "2027-03-10T00:00:00Z",
    closingReason: (process.env.BOND_CLOSING_REASON as "REDEEMED" | "CANCELLED" | "MATURED_OUT" | undefined) ?? "REDEEMED",
  });

  const finality = await sdk.bonds.exportFinalityPayload({
    artifactPath,
    definitionPath,
    issuancePath,
    settlementDescriptorValue: settlement.descriptor,
    closingDescriptorValue: closing.closing,
  });

  console.log(
    JSON.stringify(
      {
        deployment: defined.deployment(),
        verification: {
          definitionOk: verified.definition.ok,
          issuanceOk: verified.issuance.ok,
          principalInvariantValid: verified.crossChecks.principalInvariantValid,
        },
        redemption: {
          nextStatus: redemption.preview.next.status,
          settlementHash: redemption.settlement.descriptorHash,
          bindingMode: redemption.settlement.descriptor.outputBindingMode,
        },
        settlement: {
          descriptorHash: settlement.descriptorHash,
          supportedForm: settlement.supportedForm,
          reasonCode: settlement.reasonCode,
        },
        closing: {
          closingHash: closing.closingHash,
          closedAt: closing.closing.closedAt,
          closingReason: closing.closing.closingReason,
        },
        finality: finality.payload,
        trustSummary: finality.trustSummary,
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
