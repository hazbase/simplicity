import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  createSimplicityClient,
  summarizeDistributionDescriptor,
} from "../dist/index.js";
import { resolveRuntimeKeyPair } from "./runtimeKeys.mjs";

const RUNTIME_STATE_SCHEMA_VERSION = "fund-e2e-testnet-state/v6";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logPhase(phase, data = {}) {
  process.stderr.write(`${JSON.stringify({ phase, ...data })}\n`);
}

function docsPath(filename) {
  return new URL(`../dist/docs/definitions/${filename}`, import.meta.url).pathname;
}

function defaultPath(bindingMode, flowMode, suffix) {
  return `/tmp/fund-e2e-testnet-${bindingMode}-${flowMode}.${suffix}`;
}

function distributionPath(bindingMode, flowMode, index, suffix) {
  return `/tmp/fund-e2e-testnet-${bindingMode}-${flowMode}-distribution-${index + 1}.${suffix}`;
}

function deriveSiblingPath(runtimeStatePath, label, suffix) {
  const base = runtimeStatePath.endsWith(".runtime.json")
    ? runtimeStatePath.slice(0, -".runtime.json".length)
    : runtimeStatePath.endsWith(".json")
      ? runtimeStatePath.slice(0, -".json".length)
      : runtimeStatePath;
  return `${base}.${label}.${suffix}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function parseCsvStrings(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseCsvNumbers(raw) {
  return parseCsvStrings(raw).map((value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid numeric CSV value: ${value}`);
    }
    return parsed;
  });
}

function defaultStringList(count, factory, explicit = []) {
  if (explicit.length === 0) {
    return Array.from({ length: count }, (_, index) => factory(index));
  }
  if (explicit.length !== count) {
    throw new Error(`Expected ${count} CSV values but got ${explicit.length}`);
  }
  return explicit;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadRuntimeState(runtimeStatePath) {
  if (!existsSync(runtimeStatePath)) return null;
  const parsed = JSON.parse(await readFile(runtimeStatePath, "utf8"));
  if (parsed.schemaVersion !== "fund-e2e-testnet-state/v5" && parsed.schemaVersion !== RUNTIME_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported runtime state schemaVersion: ${parsed.schemaVersion} (expected ${RUNTIME_STATE_SCHEMA_VERSION})`,
    );
  }
  if (parsed.schemaVersion === "fund-e2e-testnet-state/v5") {
    parsed.schemaVersion = RUNTIME_STATE_SCHEMA_VERSION;
  }
  return parsed;
}

async function saveRuntimeState(runtimeStatePath, runtimeState) {
  runtimeState.schemaVersion = RUNTIME_STATE_SCHEMA_VERSION;
  await writeFile(runtimeStatePath, `${JSON.stringify(runtimeState, null, 2)}\n`, "utf8");
}

async function loadReceiptChainValues(runtimeState) {
  if (!runtimeState.positionReceiptChainPath || !existsSync(runtimeState.positionReceiptChainPath)) {
    return [];
  }
  const parsed = await readJson(runtimeState.positionReceiptChainPath);
  return Array.isArray(parsed) ? parsed : [];
}

async function saveReceiptChainValues(runtimeState, values) {
  runtimeState.positionReceiptChainLength = values.length;
  runtimeState.positionReceiptChainEnvelopeHash = values.length > 0 ? values.at(-1)?.attestation?.positionReceiptHash ?? null : null;
  await writeJson(runtimeState.positionReceiptChainPath, values);
}

async function appendReceiptEnvelopeToChain(runtimeState, envelope) {
  const current = await loadReceiptChainValues(runtimeState);
  const nextHash = envelope.attestation.positionReceiptHash;
  const deduped = current.length > 0 && current.at(-1)?.attestation?.positionReceiptHash === nextHash
    ? current
    : [...current, clone(envelope)];
  await saveReceiptChainValues(runtimeState, deduped);
  return deduped;
}

async function resolveReceiptChainValues(runtimeState) {
  const persisted = await loadReceiptChainValues(runtimeState);
  if (persisted.length > 0) {
    return persisted;
  }
  const fallback = [];
  if (runtimeState.previousPositionReceiptEnvelopePath && existsSync(runtimeState.previousPositionReceiptEnvelopePath)) {
    fallback.push(await readJson(runtimeState.previousPositionReceiptEnvelopePath));
  }
  if (runtimeState.positionReceiptEnvelopePath && existsSync(runtimeState.positionReceiptEnvelopePath)) {
    fallback.push(await readJson(runtimeState.positionReceiptEnvelopePath));
  }
  if (fallback.length > 0) {
    await saveReceiptChainValues(runtimeState, fallback);
  }
  return fallback;
}

async function waitForFundingConfirmations(sdk, txid, input) {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const transaction = await sdk.rpc.call("gettransaction", [txid]);
    const confirmations = Number(transaction.confirmations ?? 0);
    logPhase(input.phase, {
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

async function waitForSpendableFunding(sdk, contractAddress, input) {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const scan = await sdk.rpc.call("scantxoutset", ["start", [`addr(${contractAddress})`]]);
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
    logPhase(input.phase, {
      contractAddress,
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

async function waitForBlockHeight(sdk, targetHeight, input) {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const currentHeight = Number(await sdk.rpc.call("getblockcount", []));
    logPhase(input.phase, {
      currentHeight,
      targetHeight,
    });
    if (currentHeight >= targetHeight) {
      return currentHeight;
    }
    await sleep(input.pollIntervalMs);
  }
  throw new Error(`Timed out waiting for block height ${targetHeight}`);
}

async function loadOrPrepareCapitalCall(sdk, input) {
  const reusable =
    input.runtimeState.phase !== "init"
    && existsSync(input.runtimeState.definitionPath)
    && existsSync(input.runtimeState.openCapitalCallPath)
    && existsSync(input.runtimeState.openArtifactPath)
    && existsSync(input.runtimeState.refundOnlyArtifactPath);

  if (reusable) {
    const openCompiled = await sdk.loadArtifact(input.runtimeState.openArtifactPath);
    const refundOnlyCompiled = await sdk.loadArtifact(input.runtimeState.refundOnlyArtifactPath);
    const definition = await readJson(input.runtimeState.definitionPath);
    const openCapitalCall = await readJson(input.runtimeState.openCapitalCallPath);
    const refundOnlyCapitalCall = existsSync(input.runtimeState.refundOnlyCapitalCallPath)
      ? await readJson(input.runtimeState.refundOnlyCapitalCallPath)
      : input.runtimeState.refundOnlyCapitalCallValue ?? null;
    logPhase("capital-call-prepared", {
      openContractAddress: openCompiled.contractAddress,
      refundOnlyContractAddress: refundOnlyCompiled.contractAddress,
      callId: openCapitalCall.callId,
      fundId: definition.fundId,
      reused: true,
    });
    return {
      definition,
      openCapitalCall,
      refundOnlyCapitalCall,
      openCompiled,
      refundOnlyCompiled,
    };
  }

  const baseDefinition = await readJson(docsPath("fund-definition.json"));
  const baseCapitalCall = await readJson(docsPath("fund-capital-call-state.json"));
  const currentHeight = Number(await sdk.rpc.call("getblockcount", []));
  const sidechain = await sdk.rpc.call("getsidechaininfo", []);
  const currencyAssetId = env("FUND_CURRENCY_ASSET_ID", sidechain.pegged_asset ?? baseDefinition.currencyAssetId);

  const definition = {
    ...clone(baseDefinition),
    fundId: env("FUND_ID", "FUND-E2E-001"),
    managerEntityId: env("FUND_MANAGER_ENTITY_ID", "manager-a"),
    managerXonly: input.managerXonly,
    currencyAssetId,
    vintage: env("FUND_VINTAGE", String(new Date().getUTCFullYear())),
    jurisdiction: env("FUND_JURISDICTION", "JP"),
  };
  const openCapitalCall = {
    ...clone(baseCapitalCall),
    callId: env("FUND_CALL_ID", "CALL-E2E-001"),
    fundId: definition.fundId,
    lpId: env("FUND_LP_ID", "lp-a"),
    currencyAssetId,
    amount: input.capitalCallAmountSat,
    lpXonly: input.lpXonly,
    managerXonly: definition.managerXonly,
    status: "OPEN",
    claimCutoffHeight: currentHeight + input.claimCutoffBlocks,
  };

  await writeJson(input.runtimeState.definitionPath, definition);
  await writeJson(input.runtimeState.openCapitalCallPath, openCapitalCall);
  const prepared = await sdk.funds.prepareCapitalCall({
    definitionPath: input.runtimeState.definitionPath,
    capitalCallPath: input.runtimeState.openCapitalCallPath,
    openArtifactPath: input.runtimeState.openArtifactPath,
    refundOnlyArtifactPath: input.runtimeState.refundOnlyArtifactPath,
  });
  input.runtimeState.phase = "capital-call-prepared";
  input.runtimeState.fundId = definition.fundId;
  input.runtimeState.callId = openCapitalCall.callId;
  input.runtimeState.openContractAddress = prepared.openCompiled.deployment().contractAddress;
  input.runtimeState.refundOnlyContractAddress = prepared.refundOnlyCompiled.deployment().contractAddress;
  input.runtimeState.refundOnlyCapitalCallValue = prepared.refundOnlyCapitalCallValue;
  await saveRuntimeState(input.runtimeStatePath, input.runtimeState);
  logPhase("capital-call-prepared", {
    openContractAddress: prepared.openCompiled.deployment().contractAddress,
    refundOnlyContractAddress: prepared.refundOnlyCompiled.deployment().contractAddress,
    callId: openCapitalCall.callId,
    fundId: definition.fundId,
    reused: false,
  });
  return {
    definition,
    openCapitalCall,
    refundOnlyCapitalCall: prepared.refundOnlyCapitalCallValue,
    openCompiled: prepared.openCompiled,
    refundOnlyCompiled: prepared.refundOnlyCompiled,
  };
}

async function loadOrPrepareDistribution(sdk, input) {
  const reusable =
    input.entry.phase !== "init"
    && existsSync(input.entry.distributionPath)
    && existsSync(input.entry.distributionArtifactPath);

  if (reusable) {
    const compiled = await sdk.loadArtifact(input.entry.distributionArtifactPath);
    const distribution = await readJson(input.entry.distributionPath);
    logPhase("distribution-prepared", {
      index: input.entry.index,
      contractAddress: compiled.contractAddress,
      distributionId: distribution.distributionId,
      reused: true,
    });
    return { compiled, distribution };
  }

  const prepared = await sdk.funds.prepareDistribution({
    definitionPath: input.runtimeState.definitionPath,
    positionReceiptPath: input.runtimeState.positionReceiptEnvelopePath,
    distributionId: input.entry.distributionId,
    assetId: input.assetId,
    amountSat: input.entry.amountSat,
    approvedAt: input.entry.approvedAt,
    artifactPath: input.entry.distributionArtifactPath,
  });
  await writeJson(input.entry.distributionPath, prepared.distributionValue);
  input.entry.phase = "prepared";
  input.entry.distributionContractAddress = prepared.compiled.deployment().contractAddress;
  await saveRuntimeState(input.runtimeStatePath, input.runtimeState);
  logPhase("distribution-prepared", {
    index: input.entry.index,
    contractAddress: prepared.compiled.deployment().contractAddress,
    distributionId: prepared.distributionValue.distributionId,
    reused: false,
  });
  return { compiled: prepared.compiled, distribution: prepared.distributionValue };
}

function buildDistributionEntries(runtimeState, input) {
  const existing = new Map(
    Array.isArray(runtimeState.distributions)
      ? runtimeState.distributions.map((entry) => [entry.distributionId ?? entry.index, entry])
      : [],
  );
  runtimeState.distributions = input.distributionAmountSats.map((amountSat, index) => {
    const distributionId = input.distributionIds[index];
    const previous = existing.get(distributionId) ?? existing.get(index) ?? {};
    return {
      index,
      phase: previous.phase ?? "init",
      distributionId,
      amountSat,
      approvedAt: input.distributionApprovedAts[index],
      fundingSat: input.distributionFundingSats[index],
      distributionPath:
        process.env[`FUND_DISTRIBUTION_${index + 1}_PATH`]
        ?? previous.distributionPath
        ?? deriveSiblingPath(runtimeState.runtimeStatePath ?? defaultPath(input.outputBindingMode, input.flowMode, "runtime.json"), `distribution-${index + 1}`, "json"),
      distributionArtifactPath:
        process.env[`FUND_DISTRIBUTION_${index + 1}_ARTIFACT_PATH`]
        ?? previous.distributionArtifactPath
        ?? deriveSiblingPath(runtimeState.runtimeStatePath ?? defaultPath(input.outputBindingMode, input.flowMode, "runtime.json"), `distribution-${index + 1}`, "artifact.json"),
      distributionContractAddress: previous.distributionContractAddress ?? null,
      fundingTxId: previous.fundingTxId ?? null,
      executionTxId: previous.executionTxId ?? null,
      reconciledEnvelopeHash: previous.reconciledEnvelopeHash ?? null,
      reconciledSequence: previous.reconciledSequence ?? null,
    };
  });
}

function buildFinalClaimCloseReport(input) {
  return {
    schemaVersion: "fund-verification-report/v1",
    capitalCallTrust: input.capitalCallTrust,
    outputBindingTrust: input.outputBindingTrust,
    receiptTrust: input.receiptTrust,
    receiptChainTrust: input.receiptChainTrust,
    closingTrust: input.closingTrust,
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

  const outputBindingMode = env("FUND_OUTPUT_BINDING_MODE", "script-bound");
  const flowMode = env("FUND_FLOW_MODE", "claim-close");
  const runtimeStatePath = env("FUND_RUNTIME_STATE_PATH", defaultPath(outputBindingMode, flowMode, "runtime.json"));
  const definitionPath = env("FUND_DEFINITION_PATH", deriveSiblingPath(runtimeStatePath, "definition", "json"));
  const openCapitalCallPath = env("FUND_OPEN_CAPITAL_CALL_PATH", deriveSiblingPath(runtimeStatePath, "capital-call-open", "json"));
  const claimedCapitalCallPath = env("FUND_CLAIMED_CAPITAL_CALL_PATH", deriveSiblingPath(runtimeStatePath, "capital-call-claimed", "json"));
  const refundOnlyCapitalCallPath = env("FUND_REFUND_ONLY_CAPITAL_CALL_PATH", deriveSiblingPath(runtimeStatePath, "capital-call-refund-only", "json"));
  const refundedCapitalCallPath = env("FUND_REFUNDED_CAPITAL_CALL_PATH", deriveSiblingPath(runtimeStatePath, "capital-call-refunded", "json"));
  const openArtifactPath = env("FUND_OPEN_ARTIFACT_PATH", deriveSiblingPath(runtimeStatePath, "capital-call-open", "artifact.json"));
  const refundOnlyArtifactPath = env("FUND_REFUND_ONLY_ARTIFACT_PATH", deriveSiblingPath(runtimeStatePath, "capital-call-refund-only", "artifact.json"));
  const positionReceiptEnvelopePath = env("FUND_POSITION_RECEIPT_PATH", deriveSiblingPath(runtimeStatePath, "position-receipt-envelope", "json"));
  const previousPositionReceiptEnvelopePath = env(
    "FUND_PREVIOUS_POSITION_RECEIPT_PATH",
    deriveSiblingPath(runtimeStatePath, "position-receipt-envelope.previous", "json"),
  );
  const positionReceiptChainPath = env(
    "FUND_POSITION_RECEIPT_CHAIN_PATH",
    deriveSiblingPath(runtimeStatePath, "position-receipt-chain", "json"),
  );
  const closingPath = env("FUND_CLOSING_PATH", deriveSiblingPath(runtimeStatePath, "closing", "json"));

  const capitalCallAmountSat = Number(env("FUND_CAPITAL_CALL_AMOUNT_SAT", "6000"));
  const feeSat = Number(env("FUND_FEE_SAT", "100"));
  const capitalCallFundingSat = Number(env("FUND_CAPITAL_CALL_FUNDING_SAT", String(capitalCallAmountSat + feeSat)));
  const claimCutoffBlocks = Number(env("FUND_CLAIM_CUTOFF_BLOCKS", "2"));
  const requiredConfirmations = Number(env("FUND_REQUIRED_CONFIRMATIONS", "1"));
  const waitTimeoutMs = Number(env("FUND_WAIT_TIMEOUT_MS", "1800000"));
  const waitPollMs = Number(env("FUND_WAIT_POLL_MS", "30000"));
  const claimedAt = env("FUND_CLAIMED_AT", nowIso());
  const refundedAt = env("FUND_REFUNDED_AT", nowIso());
  const approvedAt = env("FUND_APPROVED_AT", "2027-03-18T00:00:00Z");
  const closedAt = env("FUND_CLOSED_AT", "2029-03-18T00:00:00Z");
  const distributionIdBase = env("FUND_DISTRIBUTION_ID", "DIST-E2E-001");
  const positionId = env("FUND_POSITION_ID", "POS-E2E-001");
  const closingId = env("FUND_CLOSING_ID", "CLOSE-E2E-001");
  const distributionAmountSats = (() => {
    const explicit = parseCsvNumbers(process.env.FUND_DISTRIBUTION_AMOUNTS_SAT);
    if (explicit.length > 0) return explicit;
    return flowMode === "claim-close" ? [capitalCallAmountSat] : [];
  })();
  const distributionIds = defaultStringList(
    distributionAmountSats.length,
    (index) => (distributionAmountSats.length === 1 ? distributionIdBase : `${distributionIdBase}-${index + 1}`),
    parseCsvStrings(process.env.FUND_DISTRIBUTION_IDS),
  );
  const distributionApprovedAts = defaultStringList(
    distributionAmountSats.length,
    () => approvedAt,
    parseCsvStrings(process.env.FUND_APPROVED_ATS),
  );
  const explicitFundingSats = parseCsvNumbers(process.env.FUND_DISTRIBUTION_FUNDING_SATS);
  const distributionFundingSats = explicitFundingSats.length > 0
    ? defaultStringList(
        distributionAmountSats.length,
        () => String(feeSat),
        explicitFundingSats.map(String),
      ).map((value) => Number(value))
    : distributionAmountSats.map((amountSat) => amountSat + feeSat);

  const runtimeState = (await loadRuntimeState(runtimeStatePath)) ?? {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    runtimeStatePath,
    phase: "init",
    bindingMode: outputBindingMode,
    flowMode,
    definitionPath,
    openCapitalCallPath,
    claimedCapitalCallPath,
    refundOnlyCapitalCallPath,
    refundedCapitalCallPath,
    openArtifactPath,
    refundOnlyArtifactPath,
    positionReceiptEnvelopePath,
    previousPositionReceiptEnvelopePath,
    positionReceiptChainPath,
    closingPath,
    distributions: [],
  };

  const managerKeyPair = resolveRuntimeKeyPair({
    label: "fund manager",
    explicitPrivkey: process.env.FUND_MANAGER_PRIVKEY,
    explicitXonly: process.env.FUND_MANAGER_XONLY,
    runtimeState,
    privkeyStateKey: "managerPrivkey",
    xonlyStateKey: "managerXonly",
  });
  const lpKeyPair = resolveRuntimeKeyPair({
    label: "fund lp",
    explicitPrivkey: process.env.FUND_LP_PRIVKEY,
    explicitXonly: process.env.FUND_LP_XONLY,
    runtimeState,
    privkeyStateKey: "lpPrivkey",
    xonlyStateKey: "lpXonly",
  });

  runtimeState.bindingMode = outputBindingMode;
  runtimeState.flowMode = flowMode;
  runtimeState.runtimeStatePath = runtimeStatePath;
  runtimeState.definitionPath = definitionPath;
  runtimeState.openCapitalCallPath = openCapitalCallPath;
  runtimeState.claimedCapitalCallPath = claimedCapitalCallPath;
  runtimeState.refundOnlyCapitalCallPath = refundOnlyCapitalCallPath;
  runtimeState.refundedCapitalCallPath = refundedCapitalCallPath;
  runtimeState.openArtifactPath = openArtifactPath;
  runtimeState.refundOnlyArtifactPath = refundOnlyArtifactPath;
  runtimeState.positionReceiptEnvelopePath = positionReceiptEnvelopePath;
  runtimeState.previousPositionReceiptEnvelopePath = previousPositionReceiptEnvelopePath;
  runtimeState.positionReceiptChainPath = positionReceiptChainPath;
  runtimeState.closingPath = closingPath;
  buildDistributionEntries(runtimeState, {
    outputBindingMode,
    flowMode,
    distributionAmountSats,
    distributionIds,
    distributionApprovedAts,
    distributionFundingSats,
  });
  await saveRuntimeState(runtimeStatePath, runtimeState);

  if (runtimeState.phase === "finalized" && runtimeState.result) {
    logPhase("finalized", { resumed: true });
    console.log(JSON.stringify(runtimeState.result, null, 2));
    return;
  }

  const capitalCallPrepared = await loadOrPrepareCapitalCall(sdk, {
    runtimeState,
    runtimeStatePath,
    capitalCallAmountSat,
    claimCutoffBlocks,
    managerXonly: managerKeyPair.xonly,
    lpXonly: lpKeyPair.xonly,
  });

  const openContractAddress = capitalCallPrepared.openCompiled.deployment().contractAddress;
  const refundOnlyContractAddress = capitalCallPrepared.refundOnlyCompiled.deployment().contractAddress;

  const capitalCallFundingTxId = runtimeState.capitalCallFundingTxId
    ?? (await sdk.rpc.call("sendtoaddress", [openContractAddress, satToBtc(capitalCallFundingSat)]));
  if (!runtimeState.capitalCallFundingTxId) {
    runtimeState.capitalCallFundingTxId = capitalCallFundingTxId;
    runtimeState.phase = "capital-call-funded";
    await saveRuntimeState(runtimeStatePath, runtimeState);
  }
  logPhase("capital-call-funded", {
    openContractAddress,
    fundingTxId: capitalCallFundingTxId,
    fundingSat: capitalCallFundingSat,
  });

  if (["capital-call-funded", "waiting-capital-call-confirmations"].includes(runtimeState.phase)) {
    runtimeState.phase = "waiting-capital-call-confirmations";
    await saveRuntimeState(runtimeStatePath, runtimeState);
    await waitForFundingConfirmations(sdk, capitalCallFundingTxId, {
      phase: "waiting-capital-call-confirmations",
      requiredConfirmations,
      timeoutMs: waitTimeoutMs,
      pollIntervalMs: waitPollMs,
    });
    runtimeState.phase = "waiting-capital-call-utxo";
    await saveRuntimeState(runtimeStatePath, runtimeState);
  }

  await waitForSpendableFunding(sdk, openContractAddress, {
    phase: "waiting-capital-call-utxo",
    minAmountSat: capitalCallFundingSat,
    requiredConfirmations,
    timeoutMs: waitTimeoutMs,
    pollIntervalMs: waitPollMs,
    expectedTxId: capitalCallFundingTxId,
  });

  if (flowMode === "refund") {
    if (!runtimeState.capitalCallRolloverTxId) {
      runtimeState.phase = "waiting-claim-cutoff";
      await saveRuntimeState(runtimeStatePath, runtimeState);
      await waitForBlockHeight(sdk, capitalCallPrepared.openCapitalCall.claimCutoffHeight, {
        phase: "waiting-claim-cutoff",
        timeoutMs: waitTimeoutMs,
        pollIntervalMs: waitPollMs,
      });

      const rolloverResult = await sdk.funds.executeCapitalCallRollover({
        artifactPath: openArtifactPath,
        refundOnlyArtifactPath,
        definitionPath,
        capitalCallPath: openCapitalCallPath,
        wallet: env("ELEMENTS_RPC_WALLET", "simplicity-test"),
        signer: { type: "schnorrPrivkeyHex", privkeyHex: managerKeyPair.privkeyHex },
        feeSat,
        broadcast: true,
      });
      await writeJson(refundOnlyCapitalCallPath, rolloverResult.rolledOverCapitalCall);
      runtimeState.capitalCallRolloverTxId = rolloverResult.execution.txId;
      runtimeState.phase = "capital-call-rolled-over";
      await saveRuntimeState(runtimeStatePath, runtimeState);
      logPhase("capital-call-rolled-over", {
        txId: rolloverResult.execution.txId,
        refundOnlyContractAddress,
      });
    }

    await waitForSpendableFunding(sdk, refundOnlyContractAddress, {
      phase: "waiting-refund-only-utxo",
      minAmountSat: capitalCallAmountSat,
      requiredConfirmations,
      timeoutMs: waitTimeoutMs,
      pollIntervalMs: waitPollMs,
      expectedTxId: runtimeState.capitalCallRolloverTxId,
    });

    if (!runtimeState.capitalCallRefundTxId) {
      const refundAddress = env("FUND_LP_REFUND_ADDRESS", await sdk.rpc.call("getnewaddress", []));
      const refundResult = await sdk.funds.executeCapitalCallRefund({
        artifactPath: refundOnlyArtifactPath,
        definitionPath,
        capitalCallPath: refundOnlyCapitalCallPath,
        refundAddress,
        refundedAt,
        outputBindingMode,
        wallet: env("ELEMENTS_RPC_WALLET", "simplicity-test"),
        signer: { type: "schnorrPrivkeyHex", privkeyHex: lpKeyPair.privkeyHex },
        feeSat,
        broadcast: true,
      });
      await writeJson(refundedCapitalCallPath, refundResult.refundedCapitalCall);
      const evidence = await sdk.funds.exportEvidence({
        artifactPath: refundOnlyArtifactPath,
        definitionPath,
        capitalCallPath: refundedCapitalCallPath,
        verificationReportValue: refundResult.report,
      });
      const finality = await sdk.funds.exportFinalityPayload({
        artifactPath: refundOnlyArtifactPath,
        definitionPath,
        capitalCallPath: refundedCapitalCallPath,
        verificationReportValue: refundResult.report,
      });
      const result = {
        flowMode,
        bindingMode: outputBindingMode,
        definition: capitalCallPrepared.definition,
        capitalCall: refundResult.refundedCapitalCall,
        openContractAddress,
        refundOnlyContractAddress,
        fundingTxId: capitalCallFundingTxId,
        rolloverTxId: runtimeState.capitalCallRolloverTxId,
        refundTxId: refundResult.execution.txId,
        evidence,
        finality,
      };
      runtimeState.capitalCallRefundTxId = refundResult.execution.txId;
      runtimeState.phase = "finalized";
      runtimeState.result = result;
      await saveRuntimeState(runtimeStatePath, runtimeState);
      logPhase("finalized", {
        flowMode,
        refundTxId: refundResult.execution.txId,
        rolloverTxId: runtimeState.capitalCallRolloverTxId,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
  }

  let capitalCallClaimReport = null;
  if (!runtimeState.capitalCallClaimTxId) {
    const payoutAddress = env("FUND_MANAGER_PAYOUT_ADDRESS", await sdk.rpc.call("getnewaddress", []));
    const claimResult = await sdk.funds.executeCapitalCallClaim({
      artifactPath: openArtifactPath,
      definitionPath,
      capitalCallPath: openCapitalCallPath,
      payoutAddress,
      positionId,
      claimedAt,
      outputBindingMode,
      wallet: env("ELEMENTS_RPC_WALLET", "simplicity-test"),
      signer: { type: "schnorrPrivkeyHex", privkeyHex: managerKeyPair.privkeyHex },
      feeSat,
      broadcast: true,
    });
    await writeJson(claimedCapitalCallPath, claimResult.claimedCapitalCall);
    await writeJson(positionReceiptEnvelopePath, claimResult.positionReceiptEnvelope);
    await saveReceiptChainValues(runtimeState, [claimResult.positionReceiptEnvelope]);
    runtimeState.capitalCallClaimTxId = claimResult.execution.txId;
    runtimeState.phase = "capital-call-claimed";
    await saveRuntimeState(runtimeStatePath, runtimeState);
    capitalCallClaimReport = claimResult.report;
    logPhase("capital-call-claimed", {
      txId: claimResult.execution.txId,
      positionReceiptEnvelopeHash: claimResult.positionReceiptEnvelopeSummary.hash,
      bindingMode: claimResult.report.outputBindingTrust?.mode ?? "none",
    });
  }

  if (!capitalCallClaimReport && existsSync(positionReceiptEnvelopePath)) {
    const receiptChainValues = await resolveReceiptChainValues(runtimeState);
    const verifiedReceipt = await sdk.funds.verifyPositionReceipt({
      definitionPath,
      positionReceiptPath: positionReceiptEnvelopePath,
      previousPositionReceiptPath: existsSync(runtimeState.previousPositionReceiptEnvelopePath)
        ? runtimeState.previousPositionReceiptEnvelopePath
        : undefined,
      positionReceiptChainValues: receiptChainValues.length > 0 ? receiptChainValues : undefined,
    });
    capitalCallClaimReport = {
      schemaVersion: "fund-verification-report/v1",
      capitalCallTrust: {
        capitalCallStage: "claimed",
        cutoffMode: "rollover-window",
      },
      receiptTrust: verifiedReceipt.report.receiptTrust,
      receiptChainTrust: verifiedReceipt.report.receiptChainTrust,
    };
  }

  const distributionPaths = [];
  let lastDistributionReport = null;
  for (const entry of runtimeState.distributions) {
    const distributionPrepared = await loadOrPrepareDistribution(sdk, {
      runtimeState,
      runtimeStatePath,
      entry,
      assetId: capitalCallPrepared.definition.currencyAssetId,
    });
    distributionPaths.push(entry.distributionPath);

    const fundingTxId = entry.fundingTxId
      ?? (await sdk.rpc.call("sendtoaddress", [
        distributionPrepared.compiled.deployment().contractAddress,
        satToBtc(entry.fundingSat),
      ]));
    if (!entry.fundingTxId) {
      entry.fundingTxId = fundingTxId;
      entry.phase = "funded";
      runtimeState.phase = "distributions-in-progress";
      await saveRuntimeState(runtimeStatePath, runtimeState);
    }
    logPhase("distribution-funded", {
      index: entry.index,
      contractAddress: distributionPrepared.compiled.deployment().contractAddress,
      fundingTxId,
      fundingSat: entry.fundingSat,
    });

    if (["funded", "waiting-confirmations"].includes(entry.phase)) {
      entry.phase = "waiting-confirmations";
      await saveRuntimeState(runtimeStatePath, runtimeState);
      await waitForFundingConfirmations(sdk, fundingTxId, {
        phase: "waiting-distribution-confirmations",
        requiredConfirmations,
        timeoutMs: waitTimeoutMs,
        pollIntervalMs: waitPollMs,
      });
      entry.phase = "waiting-utxo";
      await saveRuntimeState(runtimeStatePath, runtimeState);
    }

    await waitForSpendableFunding(sdk, distributionPrepared.compiled.deployment().contractAddress, {
      phase: "waiting-distribution-utxo",
      minAmountSat: entry.fundingSat,
      requiredConfirmations,
      timeoutMs: waitTimeoutMs,
      pollIntervalMs: waitPollMs,
      expectedTxId: fundingTxId,
    });

    if (!entry.executionTxId) {
      const payoutAddress = env("FUND_LP_PAYOUT_ADDRESS", await sdk.rpc.call("getnewaddress", []));
      const execution = await sdk.funds.executeDistributionClaim({
        artifactPath: entry.distributionArtifactPath,
        definitionPath,
        positionReceiptPath: positionReceiptEnvelopePath,
        distributionPath: entry.distributionPath,
        payoutAddress,
        outputBindingMode,
        wallet: env("ELEMENTS_RPC_WALLET", "simplicity-test"),
        signer: { type: "schnorrPrivkeyHex", privkeyHex: lpKeyPair.privkeyHex },
        feeSat,
        broadcast: true,
      });
      entry.executionTxId = execution.execution.txId;
      entry.phase = "claimed";
      lastDistributionReport = execution.report;
      await saveRuntimeState(runtimeStatePath, runtimeState);
      logPhase("distribution-claimed", {
        index: entry.index,
        txId: execution.execution.txId,
        bindingMode: execution.report.outputBindingTrust?.mode ?? "none",
      });
    }

    if (!entry.reconciledEnvelopeHash) {
      const reconciled = await sdk.funds.reconcilePosition({
        definitionPath,
        positionReceiptPath: positionReceiptEnvelopePath,
        distributionPath: entry.distributionPath,
        signer: { type: "schnorrPrivkeyHex", privkeyHex: managerKeyPair.privkeyHex },
        signedAt: entry.approvedAt,
      });
      await writeJson(runtimeState.previousPositionReceiptEnvelopePath, await readJson(positionReceiptEnvelopePath));
      await writeJson(positionReceiptEnvelopePath, reconciled.reconciledReceiptEnvelope);
      await appendReceiptEnvelopeToChain(runtimeState, reconciled.reconciledReceiptEnvelope);
      entry.reconciledEnvelopeHash = reconciled.reconciledReceiptEnvelopeSummary.hash;
      entry.reconciledSequence = reconciled.reconciledReceiptValue.sequence;
      await saveRuntimeState(runtimeStatePath, runtimeState);
      logPhase("receipt-reconciled", {
        index: entry.index,
        sequence: reconciled.reconciledReceiptValue.sequence,
        envelopeHash: reconciled.reconciledReceiptEnvelopeSummary.hash,
      });
    }
  }

  if (!existsSync(claimedCapitalCallPath)) {
    throw new Error("Claimed capital call state is missing after claim-close execution");
  }

  const finalDistributionHashes = await Promise.all(
    runtimeState.distributions.map(async (entry) => summarizeDistributionDescriptor(await readJson(entry.distributionPath)).hash),
  );
  const receiptChainValues = await resolveReceiptChainValues(runtimeState);

  const closingPrepared = existsSync(closingPath)
    ? await sdk.funds.prepareClosing({
        definitionPath,
        positionReceiptPath: positionReceiptEnvelopePath,
        previousPositionReceiptPath: runtimeState.previousPositionReceiptEnvelopePath,
        positionReceiptChainValues: receiptChainValues.length > 0 ? receiptChainValues : undefined,
        closingPath,
      })
    : await sdk.funds.prepareClosing({
        definitionPath,
        positionReceiptPath: positionReceiptEnvelopePath,
        previousPositionReceiptPath: runtimeState.previousPositionReceiptEnvelopePath,
        positionReceiptChainValues: receiptChainValues.length > 0 ? receiptChainValues : undefined,
        closingId,
        finalDistributionHashes,
        closedAt,
        closingReason: env("FUND_CLOSING_REASON", "LIQUIDATED"),
      });

  if (!existsSync(closingPath)) {
    await writeJson(closingPath, closingPrepared.closingValue);
  }
  runtimeState.phase = "closing-prepared";
  await saveRuntimeState(runtimeStatePath, runtimeState);
  logPhase("closing-prepared", {
    closingHash: closingPrepared.closingHash,
    finalSequence: closingPrepared.positionReceiptValue.receipt.sequence,
  });

  const finalReceiptVerification = await sdk.funds.verifyPositionReceipt({
    definitionPath,
    positionReceiptPath: positionReceiptEnvelopePath,
    previousPositionReceiptPath: runtimeState.previousPositionReceiptEnvelopePath,
    positionReceiptChainValues: receiptChainValues.length > 0 ? receiptChainValues : undefined,
  });
  const finalReceiptChainVerification = await sdk.funds.verifyPositionReceiptChain({
    definitionPath,
    positionReceiptChainValues: receiptChainValues.length > 0 ? receiptChainValues : undefined,
  });
  const closingVerification = await sdk.funds.verifyClosing({
    definitionPath,
    positionReceiptPath: positionReceiptEnvelopePath,
    previousPositionReceiptPath: runtimeState.previousPositionReceiptEnvelopePath,
    positionReceiptChainValues: receiptChainValues.length > 0 ? receiptChainValues : undefined,
    closingPath,
  });
  const finalReport = buildFinalClaimCloseReport({
    capitalCallTrust: capitalCallClaimReport?.capitalCallTrust,
    outputBindingTrust: lastDistributionReport?.outputBindingTrust,
    receiptTrust: finalReceiptVerification.report.receiptTrust,
    receiptChainTrust: finalReceiptChainVerification.report.receiptChainTrust,
    closingTrust: closingVerification.report.closingTrust,
  });

  const evidence = await sdk.funds.exportEvidence({
    definitionPath,
    capitalCallPath: claimedCapitalCallPath,
    positionReceiptPath: positionReceiptEnvelopePath,
    previousPositionReceiptPath: runtimeState.previousPositionReceiptEnvelopePath,
    positionReceiptChainValues: receiptChainValues.length > 0 ? receiptChainValues : undefined,
    distributionPaths,
    closingPath,
    verificationReportValue: finalReport,
  });
  const finality = await sdk.funds.exportFinalityPayload({
    definitionPath,
    capitalCallPath: claimedCapitalCallPath,
    positionReceiptPath: positionReceiptEnvelopePath,
    previousPositionReceiptPath: runtimeState.previousPositionReceiptEnvelopePath,
    positionReceiptChainValues: receiptChainValues.length > 0 ? receiptChainValues : undefined,
    distributionPaths,
    closingPath,
    verificationReportValue: finalReport,
  });

  const result = {
    flowMode,
    bindingMode: outputBindingMode,
    definition: capitalCallPrepared.definition,
    capitalCall: await readJson(claimedCapitalCallPath),
    positionReceiptEnvelope: await readJson(positionReceiptEnvelopePath),
    positionReceiptChain: receiptChainValues,
    distributions: await Promise.all(runtimeState.distributions.map((entry) => readJson(entry.distributionPath))),
    closing: await readJson(closingPath),
    openContractAddress,
    refundOnlyContractAddress,
    fundingTxId: capitalCallFundingTxId,
    claimTxId: runtimeState.capitalCallClaimTxId,
    distributionExecutions: runtimeState.distributions.map((entry) => ({
      distributionId: entry.distributionId,
      txId: entry.executionTxId,
    })),
    evidence,
    finality,
    fullChainVerified: finalReceiptChainVerification.report.receiptChainTrust?.fullChainVerified ?? false,
  };

  runtimeState.phase = "finalized";
  runtimeState.result = result;
  await saveRuntimeState(runtimeStatePath, runtimeState);
  logPhase("finalized", {
    flowMode,
    claimTxId: runtimeState.capitalCallClaimTxId,
    distributionExecutionTxIds: runtimeState.distributions.map((entry) => entry.executionTxId),
    positionReceiptEnvelopeHash: finality.positionReceiptEnvelopeHash,
    fullChainVerified: finalReceiptChainVerification.report.receiptChainTrust?.fullChainVerified ?? false,
    closingHash: finality.closingHash,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
