import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createSimplicityClient } from "../dist/index.js";
import { resolveRuntimeKeyPair } from "./runtimeKeys.mjs";

const RUNTIME_STATE_SCHEMA_VERSION = "policy-e2e-testnet-state/v2";
const EMPTY_BUFFER_SHA256 = createHash("sha256").update(Buffer.alloc(0)).digest("hex");

function env(name, fallback) {
  return process.env[name] || fallback;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function satToBtc(sat) {
  return Number((sat / 1e8).toFixed(8));
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logPhase(phase, data = {}) {
  process.stderr.write(`${JSON.stringify({ phase, ...data })}\n`);
}

function defaultArtifactPath(bindingMode, scenario = "generic") {
  return `/tmp/policy-e2e-testnet-${scenario}-${bindingMode}.artifact.json`;
}

function defaultStatePath(bindingMode, scenario = "generic") {
  return `/tmp/policy-e2e-testnet-${scenario}-${bindingMode}.state.json`;
}

function defaultRuntimeStatePath(bindingMode, scenario = "generic") {
  return `/tmp/policy-e2e-testnet-${scenario}-${bindingMode}.runtime.json`;
}

function parseJsonEnv(name) {
  const raw = process.env[name];
  return raw ? JSON.parse(raw) : undefined;
}

function hashHexBytes(hex) {
  return createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
}

function reverseHexBytes(hex) {
  return hex.match(/../g)?.reverse().join("") ?? hex;
}

function encodeExplicitAssetBytesHex(assetHex) {
  return `01${reverseHexBytes(assetHex.toLowerCase())}`;
}

function encodeExplicitAmountBytesHex(amountSat) {
  const amount = Buffer.alloc(9);
  amount[0] = 0x01;
  amount.writeBigUInt64BE(BigInt(amountSat), 1);
  return amount.toString("hex");
}

async function resolveExplicitAssetHex(sdk, assetId) {
  if (/^[0-9a-f]{64}$/i.test(assetId)) {
    return assetId.toLowerCase();
  }
  if (String(assetId).toLowerCase() === "bitcoin") {
    const sidechain = await sdk.rpc.call("getsidechaininfo", []);
    if (sidechain.pegged_asset && /^[0-9a-f]{64}$/i.test(sidechain.pegged_asset)) {
      return sidechain.pegged_asset.toLowerCase();
    }
  }
  return undefined;
}

async function buildAutoNextRawOutput(sdk, input) {
  if (input.mode !== "explicit-v1-hash-backed") {
    return null;
  }
  const addressInfo = await sdk.rpc.call("getaddressinfo", [input.nextContractAddress]);
  const scriptPubKeyHex = String(addressInfo.scriptPubKey ?? "").toLowerCase();
  if (!scriptPubKeyHex) {
    throw new Error(`Could not derive scriptPubKey for address: ${input.nextContractAddress}`);
  }
  const assetHex = await resolveExplicitAssetHex(sdk, input.assetId);
  if (!assetHex) {
    throw new Error(`Could not resolve explicit asset hex for assetId: ${input.assetId}`);
  }
  return {
    outputForm: {
      assetForm: "explicit",
      amountForm: "explicit",
      nonceForm: "null",
      rangeProofForm: "empty",
    },
    rawOutput: {
      assetBytesHex: encodeExplicitAssetBytesHex(assetHex),
      amountBytesHex: encodeExplicitAmountBytesHex(input.nextAmountSat),
      nonceBytesHex: "00",
      scriptPubKeyHashHex: hashHexBytes(scriptPubKeyHex),
      rangeProofHashHex: EMPTY_BUFFER_SHA256,
    },
  };
}

async function loadRuntimeState(runtimeStatePath) {
  if (!existsSync(runtimeStatePath)) {
    return null;
  }
  const parsed = JSON.parse(await readFile(runtimeStatePath, "utf8"));
  if (parsed.schemaVersion !== RUNTIME_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported runtime state schemaVersion: ${parsed.schemaVersion} (expected ${RUNTIME_STATE_SCHEMA_VERSION})`,
    );
  }
  return parsed;
}

async function saveRuntimeState(runtimeStatePath, runtimeState) {
  await writeFile(runtimeStatePath, `${JSON.stringify(runtimeState, null, 2)}\n`, "utf8");
}

async function waitForFundingConfirmations(sdk, txid, input) {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const transaction = await sdk.rpc.call("gettransaction", [txid]);
    const confirmations = Number(transaction.confirmations ?? 0);
    logPhase("waiting-funding-confirmations", {
      txid,
      confirmations,
      requiredConfirmations: input.requiredConfirmations,
    });
    if (confirmations >= input.requiredConfirmations) {
      return transaction;
    }
    await sleep(input.pollIntervalMs);
  }
  throw new Error(`Timed out waiting for funding tx confirmations (${input.requiredConfirmations}) for ${txid}`);
}

async function waitForSpendableFunding(compiled, sdk, input) {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const utxos = await compiled.at().findUtxos();
    const best = utxos.find(
      (utxo) =>
        utxo.confirmed
        && utxo.sat >= input.minAmountSat
        && typeof utxo.height === "number"
        && (!input.expectedTxId || utxo.txid === input.expectedTxId),
    );
    logPhase("waiting-contract-utxo", {
      contractAddress: compiled.contractAddress,
      minAmountSat: input.minAmountSat,
      expectedTxId: input.expectedTxId ?? null,
      candidateCount: utxos.length,
      best: best ? { txid: best.txid, vout: best.vout, sat: best.sat, height: best.height } : null,
    });
    if (best) {
      const currentHeight = await sdk.rpc.call("getblockcount", []);
      const confirmations = currentHeight - best.height + 1;
      if (confirmations >= input.requiredConfirmations) {
        return { utxo: best, currentHeight, confirmations };
      }
    }
    await sleep(input.pollIntervalMs);
  }
  throw new Error(
    `Timed out waiting for spendable funding (${input.requiredConfirmations} confirmations, minAmountSat=${input.minAmountSat})`,
  );
}

async function readPolicyState(statePath) {
  return JSON.parse(await readFile(statePath, "utf8"));
}

async function issueOrReusePolicy(sdk, input) {
  const reusable =
    input.runtimeState.phase !== "init"
    && existsSync(input.runtimeState.artifactPath)
    && existsSync(input.runtimeState.statePath);

  if (reusable) {
    const compiled = await sdk.loadArtifact(input.runtimeState.artifactPath);
    const state = await readPolicyState(input.runtimeState.statePath);
    logPhase("issued", {
      contractAddress: compiled.contractAddress,
      policyHash: state.policyHash,
      propagationMode: state.propagationMode,
      reused: true,
    });
    return {
      compiled,
      state,
      policyHash: state.policyHash,
    };
  }

  const issued = await sdk.policies.issue({
    recipient: { mode: "policy", recipientXonly: input.currentRecipientXonly },
    template: input.template,
    params: { lockDistanceBlocks: input.lockDistanceBlocks },
    amountSat: input.amountSat,
    assetId: input.assetId,
    propagationMode: "required",
    artifactPath: input.runtimeState.artifactPath,
  });

  await writeFile(input.runtimeState.statePath, `${JSON.stringify(issued.state, null, 2)}\n`, "utf8");
  Object.assign(input.runtimeState, {
    phase: "issued",
    contractAddress: issued.compiled.contractAddress,
    policyHash: issued.policyHash,
  });
  await saveRuntimeState(input.runtimeStatePath, input.runtimeState);
  logPhase("issued", {
    contractAddress: issued.compiled.contractAddress,
    policyHash: issued.policyHash,
    propagationMode: issued.state.propagationMode,
    reused: false,
  });
  return issued;
}

async function main() {
  const sdk = createSimplicityClient({
    network: "liquidtestnet",
    rpc: {
      url: requireEnv("ELEMENTS_RPC_URL"),
      username: requireEnv("ELEMENTS_RPC_USER"),
      password: requireEnv("ELEMENTS_RPC_PASSWORD"),
      wallet: env("ELEMENTS_RPC_WALLET", "simplicity-test"),
    },
    toolchain: {
      simcPath: env("SIMC_PATH", "simc"),
      halSimplicityPath: env("HAL_SIMPLICITY_PATH", "hal-simplicity"),
      elementsCliPath: env("ELEMENTS_CLI_PATH", "eltc"),
    },
  });

  const template = {
    templateId: "recursive-delay",
    value: { policyTemplateId: "recursive-delay" },
  };
  const lockDistanceBlocks = Number(env("POLICY_LOCK_DISTANCE_BLOCKS", "2"));
  const amountSat = Number(env("POLICY_AMOUNT_SAT", "6000"));
  const feeSat = Number(env("POLICY_FEE_SAT", "100"));
  const fundingSat = Number(env("POLICY_FUNDING_SAT", String(amountSat + feeSat)));
  const scenario = env("POLICY_SCENARIO", "generic");
  const outputBindingMode = env("POLICY_OUTPUT_BINDING_MODE", "script-bound");
  const nextRecipientXonly =
    env("POLICY_NEXT_RECIPIENT_XONLY", "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5");
  const artifactPath = env("POLICY_ARTIFACT_PATH", defaultArtifactPath(outputBindingMode, scenario));
  const statePath = env("POLICY_STATE_PATH", defaultStatePath(outputBindingMode, scenario));
  const runtimeStatePath = env("POLICY_RUNTIME_STATE_PATH", defaultRuntimeStatePath(outputBindingMode, scenario));
  const nextOutputHash = env("POLICY_NEXT_OUTPUT_HASH", "");
  const nextOutputForm = parseJsonEnv("POLICY_NEXT_OUTPUT_FORM_JSON");
  const nextRawOutput = parseJsonEnv("POLICY_NEXT_RAW_OUTPUT_JSON");
  const autoNextRawOutputMode = env("POLICY_NEXT_RAW_OUTPUT_AUTO", "");
  const waitTimeoutMs = Number(env("POLICY_WAIT_TIMEOUT_MS", "1800000"));
  const waitPollMs = Number(env("POLICY_WAIT_POLL_MS", "30000"));

  const runtimeState = (await loadRuntimeState(runtimeStatePath)) ?? {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    scenario,
    bindingMode: outputBindingMode,
    artifactPath,
    statePath,
    phase: "init",
    lockDistanceBlocks,
  };

  const currentRecipientKeyPair = resolveRuntimeKeyPair({
    label: "policy current recipient",
    explicitPrivkey: process.env.POLICY_CURRENT_RECIPIENT_PRIVKEY,
    explicitXonly: process.env.POLICY_CURRENT_RECIPIENT_XONLY,
    runtimeState,
    privkeyStateKey: "currentRecipientPrivkey",
    xonlyStateKey: "currentRecipientXonly",
  });

  runtimeState.bindingMode = outputBindingMode;
  runtimeState.scenario = scenario;
  runtimeState.artifactPath = artifactPath;
  runtimeState.statePath = statePath;
  runtimeState.lockDistanceBlocks = lockDistanceBlocks;
  await saveRuntimeState(runtimeStatePath, runtimeState);

  if (runtimeState.phase === "executed" && runtimeState.result) {
    logPhase("executed", {
      txId: runtimeState.result.execution?.txId ?? runtimeState.executionTxId ?? null,
      resumed: true,
    });
    console.log(JSON.stringify(runtimeState.result, null, 2));
    return;
  }

  const issued = await issueOrReusePolicy(sdk, {
    runtimeState,
    runtimeStatePath,
    template,
    currentRecipientXonly: currentRecipientKeyPair.xonly,
    lockDistanceBlocks,
    amountSat,
    assetId: env("POLICY_ASSET_ID", "bitcoin"),
  });

  const fundingTxId = runtimeState.fundingTxId
    ?? (await sdk.rpc.call("sendtoaddress", [
      issued.compiled.contractAddress,
      satToBtc(fundingSat),
    ]));
  if (!runtimeState.fundingTxId) {
    Object.assign(runtimeState, {
      fundingTxId,
      fundingSat,
      phase: "funded",
    });
    await saveRuntimeState(runtimeStatePath, runtimeState);
  }
  logPhase("funded", {
    fundingTxId,
    fundingSat,
    contractAddress: issued.compiled.contractAddress,
    reused: runtimeState.fundingTxId === fundingTxId && runtimeState.phase !== "funded",
  });

  if (runtimeState.phase === "funded" || runtimeState.phase === "waiting-funding-confirmations") {
    runtimeState.phase = "waiting-funding-confirmations";
    await saveRuntimeState(runtimeStatePath, runtimeState);
    await waitForFundingConfirmations(sdk, fundingTxId, {
      requiredConfirmations: lockDistanceBlocks + 1,
      timeoutMs: waitTimeoutMs,
      pollIntervalMs: waitPollMs,
    });
    runtimeState.phase = "waiting-contract-utxo";
    await saveRuntimeState(runtimeStatePath, runtimeState);
  }

  const funding = await waitForSpendableFunding(issued.compiled, sdk, {
    minAmountSat: fundingSat,
    requiredConfirmations: lockDistanceBlocks + 1,
    timeoutMs: waitTimeoutMs,
    pollIntervalMs: waitPollMs,
    expectedTxId: fundingTxId,
  });

  let effectiveNextOutputForm = nextOutputForm;
  let effectiveNextRawOutput = nextRawOutput;
  if (outputBindingMode === "descriptor-bound" && autoNextRawOutputMode && !effectiveNextRawOutput) {
    const preview = await sdk.policies.prepareTransfer({
      currentArtifactPath: runtimeState.artifactPath,
      template,
      currentStatePath: runtimeState.statePath,
      nextReceiver: {
        mode: "policy",
        recipientXonly: nextRecipientXonly,
      },
      nextAmountSat: amountSat,
      nextParams: {
        lockDistanceBlocks,
      },
      ...(nextOutputHash ? { nextOutputHash } : {}),
      ...(effectiveNextOutputForm ? { nextOutputForm: effectiveNextOutputForm } : {}),
      outputBindingMode,
    });
    const generated = await buildAutoNextRawOutput(sdk, {
      mode: autoNextRawOutputMode,
      nextContractAddress: preview.nextCompiled.contractAddress,
      nextAmountSat: amountSat,
      assetId: env("POLICY_ASSET_ID", "bitcoin"),
    });
    if (generated) {
      effectiveNextOutputForm = generated.outputForm;
      effectiveNextRawOutput = generated.rawOutput;
      logPhase("prepared-auto-next-raw-output", {
        nextContractAddress: preview.nextCompiled.contractAddress,
        assetId: env("POLICY_ASSET_ID", "bitcoin"),
        mode: autoNextRawOutputMode,
      });
    }
  }

  const execution = await sdk.policies.executeTransfer({
    currentArtifactPath: runtimeState.artifactPath,
    template,
    currentStatePath: runtimeState.statePath,
    nextReceiver: {
      mode: "policy",
      recipientXonly: nextRecipientXonly,
    },
    nextAmountSat: amountSat,
    nextParams: {
      lockDistanceBlocks,
    },
    ...(nextOutputHash ? { nextOutputHash } : {}),
    ...(effectiveNextOutputForm ? { nextOutputForm: effectiveNextOutputForm } : {}),
    ...(effectiveNextRawOutput ? { nextRawOutput: effectiveNextRawOutput } : {}),
    outputBindingMode,
    wallet: env("POLICY_WALLET", env("ELEMENTS_RPC_WALLET", "simplicity-test")),
    signer: {
      type: "schnorrPrivkeyHex",
      privkeyHex: currentRecipientKeyPair.privkeyHex,
    },
    feeSat,
    broadcast: true,
    utxoPolicy: env("POLICY_UTXO_POLICY", "largest"),
  });

  const result = {
    scenario,
    currentRecipientXonly: currentRecipientKeyPair.xonly,
    nextRecipientXonly,
    ...(scenario === "restricted-otc"
      ? {
          sellerCustodianXonly: currentRecipientKeyPair.xonly,
          approvedBuyerCustodianXonly: nextRecipientXonly,
        }
      : {}),
    fundingTxId,
    funding,
    issue: {
      contractAddress: issued.compiled.contractAddress,
      policyHash: issued.policyHash,
      artifactPath: runtimeState.artifactPath,
      statePath: runtimeState.statePath,
    },
    execution: {
      mode: execution.mode,
      txId: execution.execution.txId,
      broadcasted: execution.execution.broadcasted,
      summaryHash: execution.execution.summaryHash,
      verificationReport: execution.prepared.verificationReport,
      enforcement: execution.prepared.verificationReport.enforcement,
      reasonCode: execution.prepared.verificationReport.outputBinding?.reasonCode ?? null,
      bindingMode: execution.prepared.verificationReport.outputBinding?.mode ?? null,
      supportedForm: execution.prepared.verificationReport.outputBinding?.supportedForm ?? null,
      nextContractAddress: execution.prepared.nextCompiled?.contractAddress ?? null,
    },
  };

  Object.assign(runtimeState, {
    phase: "executed",
    executionTxId: execution.execution.txId,
    nextContractAddress: execution.prepared.nextCompiled?.contractAddress ?? null,
    result,
  });
  await saveRuntimeState(runtimeStatePath, runtimeState);
  logPhase("executed", {
    txId: execution.execution.txId,
    summaryHash: execution.execution.summaryHash,
    nextContractAddress: execution.prepared.nextCompiled?.contractAddress ?? null,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
