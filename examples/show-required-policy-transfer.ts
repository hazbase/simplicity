import { createExampleClient, exampleValue } from "./shared";

async function main() {
  const sdk = createExampleClient();
  const template = {
    templateId: "recursive-delay" as const,
    value: { policyTemplateId: "recursive-delay" },
  };

  const issued = await sdk.policies.issue({
    recipient: {
      mode: "policy",
      recipientXonly: exampleValue(
        "POLICY_CURRENT_RECIPIENT_XONLY",
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      ),
    },
    template,
    params: {
      lockDistanceBlocks: Number(exampleValue("POLICY_LOCK_DISTANCE_BLOCKS", "2")),
    },
    amountSat: Number(exampleValue("POLICY_AMOUNT_SAT", "6000")),
    assetId: exampleValue("POLICY_ASSET_ID", "bitcoin"),
    propagationMode: "required",
  });

  const prepared = await sdk.policies.prepareTransfer({
    currentArtifact: issued.compiled.artifact,
    template,
    currentStateValue: issued.state,
    nextReceiver: {
      mode: "policy",
      recipientXonly: exampleValue(
        "POLICY_NEXT_RECIPIENT_XONLY",
        "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
      ),
    },
    nextAmountSat: Number(exampleValue("POLICY_NEXT_AMOUNT_SAT", "6000")),
    nextParams: {
      lockDistanceBlocks: Number(exampleValue("POLICY_NEXT_LOCK_DISTANCE_BLOCKS", "2")),
    },
    outputBindingMode: (exampleValue("POLICY_OUTPUT_BINDING_MODE", "descriptor-bound") as "none" | "script-bound" | "descriptor-bound"),
  });

  console.log(
    JSON.stringify(
      {
        issuedState: issued.state,
        nextState: prepared.nextState,
        transferDescriptor: prepared.transferDescriptor,
        verificationReport: prepared.verificationReport,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
