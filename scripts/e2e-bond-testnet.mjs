import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createSimplicityClient } from "../dist/index.js";
import { resolveRuntimeKeyPair } from "./runtimeKeys.mjs";

const RUNTIME_STATE_SCHEMA_VERSION = "bond-e2e-testnet-state/v3";

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
  return `/tmp/bond-e2e-testnet-${bindingMode}.artifact.json`;
}

function defaultDefinitionPath(bindingMode) {
  return `/tmp/bond-e2e-testnet-${bindingMode}.definition.json`;
}

function defaultIssuancePath(bindingMode) {
  return `/tmp/bond-e2e-testnet-${bindingMode}.issuance.json`;
}

function defaultNextIssuancePath(bindingMode) {
  return `/tmp/bond-e2e-testnet-${bindingMode}.next-issuance.json`;
}

function defaultRuntimeStatePath(bindingMode) {
  return `/tmp/bond-e2e-testnet-${bindingMode}.runtime.json`;
}

function defaultIssuanceHistoryPath(bindingMode) {
  return `/tmp/bond-e2e-testnet-${bindingMode}.issuance-history.json`;
}

function defaultClosedIssuancePath(bindingMode) {
  return `/tmp/bond-e2e-testnet-${bindingMode}.closed-issuance.json`;
}

async function loadRuntimeState(runtimeStatePath) {
  if (!existsSync(runtimeStatePath)) return null;
  const parsed = JSON.parse(await readFile(runtimeStatePath, "utf8"));
  if (parsed.schemaVersion !== "bond-e2e-testnet-state/v2" && parsed.schemaVersion !== RUNTIME_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported runtime state schemaVersion: ${parsed.schemaVersion} (expected ${RUNTIME_STATE_SCHEMA_VERSION})`,
    );
  }
  if (parsed.schemaVersion === "bond-e2e-testnet-state/v2") {
    parsed.schemaVersion = RUNTIME_STATE_SCHEMA_VERSION;
  }
  return parsed;
}

async function saveRuntimeState(runtimeStatePath, runtimeState) {
  runtimeState.schemaVersion = RUNTIME_STATE_SCHEMA_VERSION;
  await writeFile(runtimeStatePath, `${JSON.stringify(runtimeState, null, 2)}\n`, "utf8");
}

async function loadIssuanceHistoryValues(runtimeState) {
  if (!runtimeState.issuanceHistoryPath || !existsSync(runtimeState.issuanceHistoryPath)) {
    return [];
  }
  const parsed = JSON.parse(await readFile(runtimeState.issuanceHistoryPath, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

async function saveIssuanceHistoryValues(runtimeState, values) {
  runtimeState.issuanceHistoryLength = values.length;
  runtimeState.latestIssuanceHistoryHash = values.length > 0
    ? createHash("sha256").update(JSON.stringify(values.at(-1))).digest("hex")
    : null;
  await writeJson(runtimeState.issuanceHistoryPath, values);
}

async function appendIssuanceHistoryValue(runtimeState, issuanceValue) {
  const current = await loadIssuanceHistoryValues(runtimeState);
  const nextHash = JSON.stringify(issuanceValue);
  const deduped = current.length > 0 && JSON.stringify(current.at(-1)) === nextHash
    ? current
    : [...current, clone(issuanceValue)];
  await saveIssuanceHistoryValues(runtimeState, deduped);
  return deduped;
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
    const scan = await sdk.rpc.call("scantxoutset", ["start", [`addr(${compiled.contractAddress})`]]);
    const utxos = Array.isArray(scan.unspents) ? scan.unspents : [];
    const best = utxos
      .map((utxo) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        sat: Math.round(Number(utxo.amount ?? 0) * 1e8),
        height: typeof utxo.height === "number" ? utxo.height : null,
      }))
      .find(
        (utxo) =>
          utxo.height !== null
          && utxo.sat >= input.minAmountSat
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
      const currentHeight = Number(await sdk.rpc.call("getblockcount", []));
      const confirmations = currentHeight - best.height + 1;
      if (confirmations >= input.requiredConfirmations) {
        return { utxo: best, confirmations };
      }
    }
    await sleep(input.pollIntervalMs);
  }
  throw new Error(
    `Timed out waiting for spendable funding (${input.requiredConfirmations} confirmations, minAmountSat=${input.minAmountSat})`,
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadOrInitializeDefinitionState(sdk, input) {
  const reusable =
    input.runtimeState.phase !== "init"
    && existsSync(input.runtimeState.definitionPath)
    && existsSync(input.runtimeState.issuancePath)
    && existsSync(input.runtimeState.artifactPath);

  if (reusable) {
    const compiled = await sdk.loadArtifact(input.runtimeState.artifactPath);
    const definition = JSON.parse(await readFile(input.runtimeState.definitionPath, "utf8"));
    const issuance = JSON.parse(await readFile(input.runtimeState.issuancePath, "utf8"));
    if ((await loadIssuanceHistoryValues(input.runtimeState)).length === 0) {
      await saveIssuanceHistoryValues(input.runtimeState, [issuance]);
      await saveRuntimeState(input.runtimeStatePath, input.runtimeState);
    }
    logPhase("defined", {
      contractAddress: compiled.contractAddress,
      maturityDate: definition.maturityDate,
      issuanceId: issuance.issuanceId,
      reused: true,
    });
    return { compiled, definition, issuance };
  }

  const baseDefinition = JSON.parse(await readFile(input.baseDefinitionPath, "utf8"));
  const baseIssuance = JSON.parse(await readFile(input.baseIssuancePath, "utf8"));
  const currentHeight = Number(await sdk.rpc.call("getblockcount", []));
  const maturityDate = currentHeight + input.maturityOffset;
  const definition = {
    ...clone(baseDefinition),
    maturityDate,
    controllerXonly: input.signerXonly,
  };
  const issuance = {
    ...clone(baseIssuance),
    previousStateHash: null,
    controllerXonly: input.signerXonly,
  };
  await writeJson(input.runtimeState.definitionPath, definition);
  await writeJson(input.runtimeState.issuancePath, issuance);

  const compiled = await sdk.bonds.define({
    definitionPath: input.runtimeState.definitionPath,
    issuancePath: input.runtimeState.issuancePath,
    simfPath: input.stateSimfPath,
    artifactPath: input.runtimeState.artifactPath,
  });

  Object.assign(input.runtimeState, {
    phase: "defined",
    contractAddress: compiled.contractAddress,
    maturityDate,
  });
  await saveIssuanceHistoryValues(input.runtimeState, [issuance]);
  await saveRuntimeState(input.runtimeStatePath, input.runtimeState);
  logPhase("defined", {
    contractAddress: compiled.contractAddress,
    maturityDate,
    issuanceId: issuance.issuanceId,
    reused: false,
  });
  return { compiled, definition, issuance };
}

async function prepareOrReuseRedemption(sdk, input) {
  const reusable =
    (input.runtimeState.phase === "prepared" || input.runtimeState.phase === "funded" || input.runtimeState.phase === "executed")
    && existsSync(input.runtimeState.nextIssuancePath);
  if (reusable) {
    const nextIssuance = JSON.parse(await readFile(input.runtimeState.nextIssuancePath, "utf8"));
    const settlement = input.runtimeState.settlement;
    logPhase("prepared", {
      descriptorHash: settlement?.descriptorHash ?? null,
      outputBindingMode: settlement?.outputBindingMode ?? input.outputBindingMode,
      nextStatus: nextIssuance.status,
      reused: true,
    });
    return { nextIssuance, settlement };
  }

  const prepared = await sdk.bonds.prepareRedemption({
    definitionPath: input.runtimeState.definitionPath,
    previousIssuancePath: input.runtimeState.issuancePath,
    amount: input.redeemAmount,
    redeemedAt: input.redeemedAt,
    nextStateSimfPath: input.stateSimfPath,
    nextAmountSat: input.nextAmountSat,
    maxFeeSat: input.maxFeeSat,
    outputBindingMode: input.outputBindingMode,
  });
  await writeJson(input.runtimeState.nextIssuancePath, prepared.preview.next);
  input.runtimeState.settlement = {
    descriptorHash: prepared.settlement.descriptorHash,
    outputBindingMode: prepared.settlement.descriptor.outputBindingMode,
    supportedForm: prepared.settlement.supportedForm,
    reasonCode: prepared.settlement.reasonCode,
    nextOutputHash: prepared.settlement.expectedOutputDescriptor?.nextOutputHash ?? null,
  };
  input.runtimeState.phase = "prepared";
  await saveRuntimeState(input.runtimeStatePath, input.runtimeState);
  logPhase("prepared", {
    descriptorHash: prepared.settlement.descriptorHash,
    outputBindingMode: prepared.settlement.descriptor.outputBindingMode,
    nextStatus: prepared.preview.next.status,
    reused: false,
  });
  return {
    nextIssuance: prepared.preview.next,
    settlement: input.runtimeState.settlement,
  };
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

  const repoRoot = new URL("../dist/docs/definitions/", import.meta.url);
  const baseDefinitionPath = env("BOND_BASE_DEFINITION_PATH", new URL("bond-definition.json", repoRoot).pathname);
  const baseIssuancePath = env("BOND_BASE_ISSUANCE_PATH", new URL("bond-issuance-state.json", repoRoot).pathname);
  const stateSimfPath = env("BOND_STATE_SIMF_PATH", new URL("bond-issuance-anchor.simf", repoRoot).pathname);
  const outputBindingMode = env("BOND_OUTPUT_BINDING_MODE", "script-bound");
  const artifactPath = env("BOND_ARTIFACT_PATH", defaultArtifactPath(outputBindingMode));
  const definitionPath = env("BOND_DEFINITION_PATH", defaultDefinitionPath(outputBindingMode));
  const issuancePath = env("BOND_ISSUANCE_PATH", defaultIssuancePath(outputBindingMode));
  const nextIssuancePath = env("BOND_NEXT_ISSUANCE_PATH", defaultNextIssuancePath(outputBindingMode));
  const runtimeStatePath = env("BOND_RUNTIME_STATE_PATH", defaultRuntimeStatePath(outputBindingMode));
  const issuanceHistoryPath = env("BOND_ISSUANCE_HISTORY_PATH", defaultIssuanceHistoryPath(outputBindingMode));
  const closedIssuancePath = env("BOND_CLOSED_ISSUANCE_PATH", defaultClosedIssuancePath(outputBindingMode));
  const maturityOffset = Number(env("BOND_MATURITY_OFFSET", "0"));
  const redeemAmount = Number(env("BOND_REDEEM_AMOUNT", "250000"));
  const nextAmountSat = Number(env("BOND_NEXT_AMOUNT_SAT", "1900"));
  const maxFeeSat = Number(env("BOND_MAX_FEE_SAT", "100"));
  const feeSat = Number(env("BOND_FEE_SAT", String(maxFeeSat)));
  const fundingSat = Number(env("BOND_FUNDING_SAT", String(nextAmountSat + feeSat)));
  const redeemedAt = env("BOND_REDEEMED_AT", "2027-03-10T00:00:00Z");
  const closedAt = env("BOND_CLOSED_AT", redeemedAt);
  const closingReason = env("BOND_CLOSING_REASON", "REDEEMED");
  const waitTimeoutMs = Number(env("BOND_WAIT_TIMEOUT_MS", "1800000"));
  const waitPollMs = Number(env("BOND_WAIT_POLL_MS", "30000"));

  const runtimeState = (await loadRuntimeState(runtimeStatePath)) ?? {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    bindingMode: outputBindingMode,
    artifactPath,
    definitionPath,
    issuancePath,
    nextIssuancePath,
    issuanceHistoryPath,
    closedIssuancePath,
    phase: "init",
  };

  const signerKeyPair = resolveRuntimeKeyPair({
    label: "bond signer",
    explicitPrivkey: process.env.BOND_SIGNER_PRIVKEY,
    explicitXonly: process.env.BOND_SIGNER_XONLY,
    runtimeState,
    privkeyStateKey: "signerPrivkey",
    xonlyStateKey: "signerXonly",
  });

  runtimeState.bindingMode = outputBindingMode;
  runtimeState.artifactPath = artifactPath;
  runtimeState.definitionPath = definitionPath;
  runtimeState.issuancePath = issuancePath;
  runtimeState.nextIssuancePath = nextIssuancePath;
  runtimeState.issuanceHistoryPath = issuanceHistoryPath;
  runtimeState.closedIssuancePath = closedIssuancePath;
  await saveRuntimeState(runtimeStatePath, runtimeState);

  if (runtimeState.phase === "executed" && runtimeState.result) {
    logPhase("executed", {
      txId: runtimeState.result.execution?.txId ?? runtimeState.executionTxId ?? null,
      resumed: true,
    });
    console.log(JSON.stringify(runtimeState.result, null, 2));
    return;
  }

  const defined = await loadOrInitializeDefinitionState(sdk, {
    runtimeState,
    runtimeStatePath,
    baseDefinitionPath,
    baseIssuancePath,
    stateSimfPath,
    maturityOffset,
    signerXonly: signerKeyPair.xonly,
  });

  await prepareOrReuseRedemption(sdk, {
    runtimeState,
    runtimeStatePath,
    outputBindingMode,
    redeemAmount,
    redeemedAt,
    nextAmountSat,
    maxFeeSat,
    stateSimfPath,
  });

  const fundingTxId =
    runtimeState.fundingTxId
    ?? (await sdk.rpc.call("sendtoaddress", [
      defined.compiled.contractAddress,
      satToBtc(fundingSat),
    ]));
  if (!runtimeState.fundingTxId) {
    Object.assign(runtimeState, {
      fundingTxId,
      phase: "funded",
    });
    await saveRuntimeState(runtimeStatePath, runtimeState);
    logPhase("funded", {
      contractAddress: defined.compiled.contractAddress,
      fundingTxId,
      amountSat: fundingSat,
    });
  } else {
    logPhase("funded", {
      contractAddress: defined.compiled.contractAddress,
      fundingTxId,
      amountSat: fundingSat,
      reused: true,
    });
  }

  await waitForFundingConfirmations(sdk, fundingTxId, {
    requiredConfirmations: Number(env("BOND_REQUIRED_CONFIRMATIONS", "3")),
    timeoutMs: waitTimeoutMs,
    pollIntervalMs: waitPollMs,
  });

  await waitForSpendableFunding(defined.compiled, sdk, {
    minAmountSat: fundingSat,
    expectedTxId: fundingTxId,
    requiredConfirmations: Number(env("BOND_REQUIRED_CONFIRMATIONS", "3")),
    timeoutMs: waitTimeoutMs,
    pollIntervalMs: waitPollMs,
  });

  const result = await sdk.bonds.executeRedemption({
    currentArtifactPath: runtimeState.artifactPath,
    definitionPath: runtimeState.definitionPath,
    previousIssuancePath: runtimeState.issuancePath,
    nextIssuancePath: runtimeState.nextIssuancePath,
    nextStateSimfPath: stateSimfPath,
    nextAmountSat,
    maxFeeSat,
    outputBindingMode,
    wallet: env("ELEMENTS_RPC_WALLET", "simplicity-test"),
    signer: { type: "schnorrPrivkeyHex", privkeyHex: signerKeyPair.privkeyHex },
    feeSat,
    utxoPolicy: (env("BOND_UTXO_POLICY", "largest")),
    broadcast: true,
  });

  const nextIssuanceValue = JSON.parse(await readFile(runtimeState.nextIssuancePath, "utf8"));
  let issuanceHistoryValues = await appendIssuanceHistoryValue(runtimeState, nextIssuanceValue);
  let closing = null;
  let closingVerification = null;
  let finalIssuanceValue = nextIssuanceValue;

  if (nextIssuanceValue.status === "REDEEMED") {
    closing = await sdk.bonds.prepareClosing({
      definitionPath: runtimeState.definitionPath,
      redeemedIssuanceValue: nextIssuanceValue,
      settlementDescriptorValue: result.settlement.descriptor,
      closedAt,
      closingReason,
    });
    await writeJson(runtimeState.closedIssuancePath, closing.closed);
    issuanceHistoryValues = await appendIssuanceHistoryValue(runtimeState, closing.closed);
    finalIssuanceValue = closing.closed;
    closingVerification = await sdk.bonds.verifyClosing({
      definitionPath: runtimeState.definitionPath,
      redeemedIssuanceValue: nextIssuanceValue,
      closedIssuanceValue: closing.closed,
      settlementDescriptorValue: result.settlement.descriptor,
      closingDescriptorValue: closing.closing,
    });
  }

  const issuanceHistoryVerification = await sdk.bonds.verifyIssuanceHistory({
    definitionPath: runtimeState.definitionPath,
    issuanceHistoryValues,
  });
  const evidence = await sdk.bonds.exportEvidence({
    artifactPath: runtimeState.artifactPath,
    definitionPath: runtimeState.definitionPath,
    issuanceValue: finalIssuanceValue,
    issuanceHistoryValues,
    settlementDescriptorValue: result.settlement.descriptor,
    closingDescriptorValue: closing?.closing,
  });
  const finality = await sdk.bonds.exportFinalityPayload({
    artifactPath: runtimeState.artifactPath,
    definitionPath: runtimeState.definitionPath,
    issuanceValue: finalIssuanceValue,
    issuanceHistoryValues,
    settlementDescriptorValue: result.settlement.descriptor,
    closingDescriptorValue: closing?.closing,
  });
  const enrichedResult = {
    ...result,
    issuanceHistory: issuanceHistoryValues,
    issuanceLineageTrust: issuanceHistoryVerification.report.issuanceLineageTrust,
    closing,
    closingVerification,
    evidence,
    finality,
  };

  Object.assign(runtimeState, {
    phase: "executed",
    executionTxId: result.execution.txId ?? null,
    result: enrichedResult,
  });
  await saveRuntimeState(runtimeStatePath, runtimeState);

  logPhase("executed", {
    txId: result.execution.txId ?? null,
    mode: result.mode,
    descriptorHash: result.settlement.descriptorHash,
    fullHistoryVerified: issuanceHistoryVerification.report.issuanceLineageTrust?.fullHistoryVerified ?? false,
    closingHash: closing?.closingHash ?? null,
  });
  console.log(JSON.stringify(enrichedResult, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
