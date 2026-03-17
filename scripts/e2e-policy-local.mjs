import { createSimplicityClient } from "../dist/index.js";
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
    throw new Error(`e2e:policy-local mock does not support RPC method: ${method}`);
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
      reason: "simc/hal-simplicity are required for npm run e2e:policy-local",
    }, null, 2));
    return;
  }

  const sdk = createLocalPolicyClient();
  const template = {
    templateId: "recursive-delay",
    value: { policyTemplateId: "recursive-delay" },
  };
  const currentRecipient =
    env("POLICY_CURRENT_RECIPIENT_XONLY", "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
  const nextRecipient =
    env("POLICY_NEXT_RECIPIENT_XONLY", "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5");
  const amountSat = Number(env("POLICY_AMOUNT_SAT", "6000"));

  const requiredIssued = await sdk.policies.issue({
    recipient: { mode: "policy", recipientXonly: currentRecipient },
    template,
    params: { lockDistanceBlocks: 0 },
    amountSat,
    assetId: "bitcoin",
    propagationMode: "required",
  });

  const requiredScriptBound = await sdk.policies.prepareTransfer({
    currentArtifact: requiredIssued.compiled.artifact,
    template,
    currentStateValue: requiredIssued.state,
    nextReceiver: { mode: "policy", recipientXonly: nextRecipient },
    nextAmountSat: amountSat,
    nextParams: { lockDistanceBlocks: 0 },
    outputBindingMode: "script-bound",
  });

  const requiredDescriptorBound = await sdk.policies.prepareTransfer({
    currentArtifact: requiredIssued.compiled.artifact,
    template,
    currentStateValue: requiredIssued.state,
    nextReceiver: { mode: "policy", recipientXonly: nextRecipient },
    nextAmountSat: amountSat,
    nextParams: { lockDistanceBlocks: 0 },
    outputBindingMode: "descriptor-bound",
  });

  const optionalIssued = await sdk.policies.issue({
    recipient: { mode: "policy", recipientXonly: currentRecipient },
    template,
    params: { lockDistanceBlocks: 0 },
    amountSat,
    assetId: "bitcoin",
    propagationMode: "optional",
  });

  const optionalPlain = await sdk.policies.prepareTransfer({
    currentArtifact: optionalIssued.compiled.artifact,
    template,
    currentStateValue: optionalIssued.state,
    nextReceiver: { mode: "plain", address: env("POLICY_PLAIN_EXIT_ADDRESS", "ert1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7kz4n") },
    nextAmountSat: amountSat,
  });

  const optionalRecursive = await sdk.policies.prepareTransfer({
    currentArtifact: optionalIssued.compiled.artifact,
    template,
    currentStateValue: optionalIssued.state,
    nextReceiver: { mode: "policy", recipientXonly: nextRecipient },
    nextAmountSat: amountSat,
    nextParams: { lockDistanceBlocks: 0 },
    outputBindingMode: "script-bound",
  });

  console.log(JSON.stringify({
    matrix: {
      requiredScriptBound: {
        propagationMode: requiredScriptBound.verificationReport.propagationMode,
        enforcement: requiredScriptBound.verificationReport.enforcement,
        outputBinding: requiredScriptBound.verificationReport.outputBinding,
        transferHash: requiredScriptBound.transferSummary.hash,
      },
      requiredDescriptorBound: {
        propagationMode: requiredDescriptorBound.verificationReport.propagationMode,
        enforcement: requiredDescriptorBound.verificationReport.enforcement,
        outputBinding: requiredDescriptorBound.verificationReport.outputBinding,
        transferHash: requiredDescriptorBound.transferSummary.hash,
      },
      optionalPlain: {
        propagationMode: optionalPlain.verificationReport.propagationMode,
        enforcement: optionalPlain.verificationReport.enforcement,
        outputBinding: optionalPlain.verificationReport.outputBinding ?? null,
        transferHash: optionalPlain.transferSummary.hash,
      },
      optionalRecursive: {
        propagationMode: optionalRecursive.verificationReport.propagationMode,
        enforcement: optionalRecursive.verificationReport.enforcement,
        outputBinding: optionalRecursive.verificationReport.outputBinding,
        transferHash: optionalRecursive.transferSummary.hash,
      },
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
