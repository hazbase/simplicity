import { createSimplicityClient } from "../dist/index.js";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

function env(name, fallback) {
  return process.env[name] || fallback;
}

function createLocalPolicyClient() {
  const sdk = createSimplicityClient({
    network: "liquidtestnet",
    rpc: {
      url: env("ELEMENTS_RPC_URL", "http://127.0.0.1:18884"),
      username: env("ELEMENTS_RPC_USER", "user"),
      password: env("ELEMENTS_RPC_PASSWORD", "pass"),
      wallet: env("ELEMENTS_RPC_WALLET", "simplicity-test"),
    },
    toolchain: {
      simcPath: env("SIMC_PATH", "simc"),
      halSimplicityPath: env("HAL_SIMPLICITY_PATH", "hal-simplicity"),
      elementsCliPath: env("ELEMENTS_CLI_PATH", "eltc"),
    },
  });

  sdk.rpc.call = async (method) => {
    if (method === "getaddressinfo") {
      return { scriptPubKey: "5120" + "11".repeat(32) };
    }
    if (method === "getsidechaininfo") {
      return { pegged_asset: "22".repeat(32) };
    }
    throw new Error(`e2e:policy-restricted-otc-local mock does not support RPC method: ${method}`);
  };
  return sdk;
}

async function main() {
  try {
    await execFileAsync(env("SIMC_PATH", "simc"), ["--version"]);
    await execFileAsync(env("HAL_SIMPLICITY_PATH", "hal-simplicity"), ["--version"]);
  } catch {
    console.log(JSON.stringify({
      skipped: true,
      reason: "simc/hal-simplicity are required for npm run e2e:policy-restricted-otc-local",
    }, null, 2));
    return;
  }

  const sdk = createLocalPolicyClient();
  const template = {
    templateId: "recursive-delay",
    value: { policyTemplateId: "recursive-delay" },
    stateSimfPath: path.resolve("docs/definitions/recursive-delay-optional.simf"),
    directStateSimfPath: path.resolve("docs/definitions/recursive-delay-required.simf"),
  };

  const sellerCustodianXonly = env(
    "POLICY_OTC_SELLER_CUSTODIAN_XONLY",
    "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  );
  const approvedBuyerCustodianXonly = env(
    "POLICY_OTC_APPROVED_BUYER_CUSTODIAN_XONLY",
    "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
  );
  const amountSat = Number(env("POLICY_OTC_AMOUNT_SAT", "6000"));
  const lockDistanceBlocks = Number(env("POLICY_OTC_LOCK_DISTANCE_BLOCKS", "6"));

  const issued = await sdk.policies.issue({
    recipient: {
      mode: "policy",
      recipientXonly: sellerCustodianXonly,
    },
    template,
    params: { lockDistanceBlocks },
    amountSat,
    assetId: env("POLICY_OTC_ASSET_ID", "unsupported-asset-alias"),
    propagationMode: "required",
  });

  const prepared = await sdk.policies.prepareTransfer({
    currentArtifact: issued.compiled.artifact,
    template,
    currentStateValue: issued.state,
    nextReceiver: {
      mode: "policy",
      recipientXonly: approvedBuyerCustodianXonly,
    },
    nextAmountSat: Number(env("POLICY_OTC_NEXT_AMOUNT_SAT", String(amountSat))),
    nextParams: {
      lockDistanceBlocks: Number(env("POLICY_OTC_NEXT_LOCK_DISTANCE_BLOCKS", String(lockDistanceBlocks))),
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

  const evidence = await sdk.policies.exportEvidence({
    artifact: issued.compiled.artifact,
    template,
    stateValue: issued.state,
    transferDescriptorValue: prepared.transferDescriptor,
  });

  console.log(JSON.stringify({
    scenario: "restricted-otc-transfer",
    sellerCustodianXonly,
    approvedBuyerCustodianXonly,
    propagationMode: prepared.transferDescriptor.propagationMode,
    enforcement: verified.verificationReport.enforcement,
    nextRecipient: prepared.nextState?.recipient ?? null,
    bindingMode: verified.verificationReport.outputBinding?.mode ?? null,
    supportedForm: verified.verificationReport.outputBinding?.supportedForm ?? null,
    reasonCode: verified.verificationReport.outputBinding?.reasonCode ?? null,
    transferHash: prepared.transferSummary.hash,
    evidenceBindingMode: evidence.trustSummary.bindingMode,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
