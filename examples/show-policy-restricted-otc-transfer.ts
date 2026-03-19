import path from "node:path";
import { createExampleClient, exampleValue } from "./shared";

async function main() {
  const sdk = createExampleClient();
  const template = {
    templateId: "recursive-delay" as const,
    value: { policyTemplateId: "recursive-delay" },
    stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
    directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
  };

  const issued = await sdk.policies.issue({
    recipient: {
      mode: "policy",
      recipientXonly: exampleValue(
        "POLICY_OTC_SELLER_CUSTODIAN_XONLY",
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      ),
    },
    template,
    params: {
      lockDistanceBlocks: Number(exampleValue("POLICY_OTC_LOCK_DISTANCE_BLOCKS", "6")),
    },
    amountSat: Number(exampleValue("POLICY_OTC_AMOUNT_SAT", "6000")),
    assetId: exampleValue("POLICY_OTC_ASSET_ID", "unsupported-asset-alias"),
    propagationMode: "required",
  });

  const prepared = await sdk.policies.prepareTransfer({
    currentArtifact: issued.compiled.artifact,
    template,
    currentStateValue: issued.state,
    nextReceiver: {
      mode: "policy",
      recipientXonly: exampleValue(
        "POLICY_OTC_APPROVED_BUYER_CUSTODIAN_XONLY",
        "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
      ),
    },
    nextAmountSat: Number(exampleValue("POLICY_OTC_NEXT_AMOUNT_SAT", "6000")),
    nextParams: {
      lockDistanceBlocks: Number(exampleValue("POLICY_OTC_NEXT_LOCK_DISTANCE_BLOCKS", "6")),
    },
    nextRawOutput: {
      assetBytesHex: `01${"22".repeat(32)}`,
      amountBytesHex: "010000000000001770",
      nonceBytesHex: "00",
      scriptPubKeyHex: `5120${"11".repeat(32)}`,
      rangeProofHex: "",
    },
    nextOutputForm: {
      assetForm: "confidential",
      amountForm: "confidential",
      nonceForm: "confidential",
      rangeProofForm: "non-empty",
    },
    outputBindingMode: "descriptor-bound",
  });

  const verified = await sdk.policies.verifyTransfer({
    template,
    currentArtifact: issued.compiled.artifact,
    currentStateValue: issued.state,
    transferDescriptorValue: prepared.transferDescriptor,
    nextStateValue: prepared.nextState ?? undefined,
  });

  console.log(
    JSON.stringify(
      {
        scenario: "restricted-otc-transfer",
        enforcement: verified.verificationReport.enforcement,
        propagationMode: prepared.transferDescriptor.propagationMode,
        nextRecipient: prepared.nextState?.recipient ?? null,
        bindingMode: verified.verificationReport.outputBinding?.mode ?? null,
        supportedForm: verified.verificationReport.outputBinding?.supportedForm ?? null,
        reasonCode: verified.verificationReport.outputBinding?.reasonCode ?? null,
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
