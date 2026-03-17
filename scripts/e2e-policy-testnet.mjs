import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createSimplicityClient } from "../dist/index.js";

const RUNTIME_STATE_SCHEMA_VERSION = "policy-e2e-testnet-state/v1";

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

function defaultArtifactPath(bindingMode) {
  return `/tmp/policy-e2e-testnet-${bindingMode}.artifact.json`;
}

function defaultStatePath(bindingMode) {
  return `/tmp/policy-e2e-testnet-${bindingMode}.state.json`;
}

function defaultRuntimeStatePath(bindingMode) {
  return `/tmp/policy-e2e-testnet-${bindingMode}.runtime.json`;
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
  const outputBindingMode = env("POLICY_OUTPUT_BINDING_MODE", "script-bound");
  const currentRecipientXonly =
    env("POLICY_CURRENT_RECIPIENT_XONLY", "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798");
  const nextRecipientXonly =
    env("POLICY_NEXT_RECIPIENT_XONLY", "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5");
  const currentRecipientPrivkey =
    env("POLICY_CURRENT_RECIPIENT_PRIVKEY", "0000000000000000000000000000000000000000000000000000000000000001");
  const artifactPath = env("POLICY_ARTIFACT_PATH", defaultArtifactPath(outputBindingMode));
  const statePath = env("POLICY_STATE_PATH", defaultStatePath(outputBindingMode));
  const runtimeStatePath = env("POLICY_RUNTIME_STATE_PATH", defaultRuntimeStatePath(outputBindingMode));
  const waitTimeoutMs = Number(env("POLICY_WAIT_TIMEOUT_MS", "1800000"));
  const waitPollMs = Number(env("POLICY_WAIT_POLL_MS", "30000"));

  const runtimeState = (await loadRuntimeState(runtimeStatePath)) ?? {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    bindingMode: outputBindingMode,
    artifactPath,
    statePath,
    phase: "init",
    lockDistanceBlocks,
  };

  runtimeState.bindingMode = outputBindingMode;
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
    currentRecipientXonly,
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
    outputBindingMode,
    wallet: env("POLICY_WALLET", env("ELEMENTS_RPC_WALLET", "simplicity-test")),
    signer: {
      type: "schnorrPrivkeyHex",
      privkeyHex: currentRecipientPrivkey,
    },
    feeSat,
    broadcast: true,
    utxoPolicy: env("POLICY_UTXO_POLICY", "largest"),
  });

  const result = {
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
