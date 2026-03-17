import { createExampleClient, exampleValue, requireEnv } from "./shared";

async function main() {
  const sdk = createExampleClient();
  const template = {
    templateId: "recursive-delay" as const,
    value: { policyTemplateId: "recursive-delay" },
  };

  const result = await sdk.policies.executeTransfer({
    currentArtifactPath: requireEnv("POLICY_CURRENT_ARTIFACT"),
    template,
    currentStatePath: requireEnv("POLICY_CURRENT_STATE_JSON"),
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
    outputBindingMode: exampleValue("POLICY_OUTPUT_BINDING_MODE", "descriptor-bound") as
      | "none"
      | "script-bound"
      | "descriptor-bound",
    wallet: exampleValue("POLICY_WALLET", "simplicity-test"),
    signer: {
      type: "schnorrPrivkeyHex",
      privkeyHex: requireEnv("POLICY_CURRENT_RECIPIENT_PRIVKEY"),
    },
    feeSat: Number(exampleValue("POLICY_FEE_SAT", "100")),
    broadcast: exampleValue("POLICY_BROADCAST", "false") === "true",
    utxoPolicy: exampleValue("POLICY_UTXO_POLICY", "largest") as "smallest_over" | "largest" | "newest",
  });

  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        transferHash: result.prepared.transferSummary.hash,
        verificationReport: result.prepared.verificationReport,
        execution: result.execution,
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
