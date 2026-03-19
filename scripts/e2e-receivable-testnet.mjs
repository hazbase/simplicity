import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  createSimplicityClient,
  buildReceivableFundingClaimDescriptor,
  buildReceivableRepaymentClaimDescriptor,
} from "../dist/index.js";
import { resolveRuntimeKeyPair } from "./runtimeKeys.mjs";

const RUNTIME_STATE_SCHEMA_VERSION = "receivable-e2e-testnet-state/v1";

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

function defaultPath(bindingMode, label, suffix) {
  return `/tmp/receivable-e2e-testnet-${bindingMode}.${label}.${suffix}`;
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
  if (parsed.schemaVersion !== RUNTIME_STATE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported runtime state schemaVersion: ${parsed.schemaVersion} (expected ${RUNTIME_STATE_SCHEMA_VERSION})`,
    );
  }
  return parsed;
}

async function saveRuntimeState(runtimeStatePath, runtimeState) {
  runtimeState.schemaVersion = RUNTIME_STATE_SCHEMA_VERSION;
  await writeFile(runtimeStatePath, `${JSON.stringify(runtimeState, null, 2)}\n`, "utf8");
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
  throw new Error(`Timed out waiting for tx confirmations (${input.requiredConfirmations}) for ${txid}`);
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

async function loadOrPrepareScenario(sdk, input) {
  const reusable =
    input.runtimeState.phase !== "init"
    && existsSync(input.runtimeState.definitionPath)
    && existsSync(input.runtimeState.originatedStatePath)
    && existsSync(input.runtimeState.fundedStatePath)
    && existsSync(input.runtimeState.repaidStatePath)
    && existsSync(input.runtimeState.fundingClaimPath)
    && existsSync(input.runtimeState.repaymentClaimPath)
    && existsSync(input.runtimeState.fundingArtifactPath)
    && existsSync(input.runtimeState.repaymentArtifactPath)
    && existsSync(input.runtimeState.closingPath);

  if (reusable) {
    return {
      definition: await readJson(input.runtimeState.definitionPath),
      originated: await readJson(input.runtimeState.originatedStatePath),
      funded: await readJson(input.runtimeState.fundedStatePath),
      repaid: await readJson(input.runtimeState.repaidStatePath),
      fundingClaim: await readJson(input.runtimeState.fundingClaimPath),
      repaymentClaim: await readJson(input.runtimeState.repaymentClaimPath),
      closing: await readJson(input.runtimeState.closingPath),
      fundingCompiled: await sdk.loadArtifact(input.runtimeState.fundingArtifactPath),
      repaymentCompiled: await sdk.loadArtifact(input.runtimeState.repaymentArtifactPath),
    };
  }

  const sidechain = await sdk.rpc.call("getsidechaininfo", []);
  const definition = {
    receivableId: env("RECEIVABLE_ID", "REC-E2E-001"),
    originatorEntityId: env("RECEIVABLE_ORIGINATOR_ENTITY_ID", "originator-a"),
    debtorEntityId: env("RECEIVABLE_DEBTOR_ENTITY_ID", "debtor-a"),
    currencyAssetId: env("RECEIVABLE_CURRENCY_ASSET_ID", sidechain.pegged_asset ?? "bitcoin"),
    faceValue: input.faceValueSat,
    dueDate: env("RECEIVABLE_DUE_DATE", "2027-12-31T00:00:00Z"),
    controllerXonly: input.claimantKeyPair.xonly,
  };
  const originatedAt = env("RECEIVABLE_ORIGINATED_AT", "2027-01-01T00:00:00Z");
  const originated = {
    stateId: `${definition.receivableId}-S0`,
    receivableId: definition.receivableId,
    originatorEntityId: definition.originatorEntityId,
    debtorEntityId: definition.debtorEntityId,
    holderEntityId: definition.originatorEntityId,
    currencyAssetId: definition.currencyAssetId,
    controllerXonly: definition.controllerXonly,
    faceValue: definition.faceValue,
    outstandingAmount: definition.faceValue,
    repaidAmount: 0,
    status: "ORIGINATED",
    createdAt: originatedAt,
    lastTransition: {
      type: "ORIGINATE",
      amount: definition.faceValue,
      at: originatedAt,
    },
  };

  const funding = await sdk.receivables.prepareFunding({
    definitionValue: definition,
    previousStateValue: originated,
    stateId: `${definition.receivableId}-S1`,
    holderEntityId: env("RECEIVABLE_FUNDER_ENTITY_ID", "spv-a"),
    fundedAt: env("RECEIVABLE_FUNDED_AT", "2027-01-02T00:00:00Z"),
  });
  const fundingClaimDescriptor = buildReceivableFundingClaimDescriptor({
    claimId: `${definition.receivableId}-FUNDING-CLAIM`,
    currentState: funding.nextStateValue,
  });
  const fundingClaim = await sdk.receivables.prepareFundingClaim({
    definitionValue: definition,
    currentStateValue: funding.nextStateValue,
    stateHistoryValues: [originated, funding.nextStateValue],
    fundingClaimValue: fundingClaimDescriptor,
    artifactPath: input.runtimeState.fundingArtifactPath,
  });

  const repayment = await sdk.receivables.prepareRepayment({
    definitionValue: definition,
    previousStateValue: funding.nextStateValue,
    stateId: `${definition.receivableId}-S2`,
    amount: definition.faceValue,
    repaidAt: env("RECEIVABLE_REPAID_AT", "2027-02-01T00:00:00Z"),
  });
  const repaymentClaimDescriptor = buildReceivableRepaymentClaimDescriptor({
    claimId: `${definition.receivableId}-REPAYMENT-CLAIM`,
    currentState: repayment.nextStateValue,
  });
  const repaymentClaim = await sdk.receivables.prepareRepaymentClaim({
    definitionValue: definition,
    currentStateValue: repayment.nextStateValue,
    stateHistoryValues: [originated, funding.nextStateValue, repayment.nextStateValue],
    repaymentClaimValue: repaymentClaimDescriptor,
    artifactPath: input.runtimeState.repaymentArtifactPath,
  });

  const closing = await sdk.receivables.prepareClosing({
    definitionValue: definition,
    latestStateValue: repayment.nextStateValue,
    stateHistoryValues: [originated, funding.nextStateValue, repayment.nextStateValue],
    closingId: `${definition.receivableId}-CLOSE`,
    closedAt: env("RECEIVABLE_CLOSED_AT", "2027-02-02T00:00:00Z"),
  });

  await writeJson(input.runtimeState.definitionPath, definition);
  await writeJson(input.runtimeState.originatedStatePath, originated);
  await writeJson(input.runtimeState.fundedStatePath, funding.nextStateValue);
  await writeJson(input.runtimeState.repaidStatePath, repayment.nextStateValue);
  await writeJson(input.runtimeState.fundingClaimPath, fundingClaim.claimValue);
  await writeJson(input.runtimeState.repaymentClaimPath, repaymentClaim.claimValue);
  await writeJson(input.runtimeState.closingPath, closing.closingValue);

  input.runtimeState.phase = "prepared";
  input.runtimeState.receivableId = definition.receivableId;
  input.runtimeState.fundingClaimContractAddress = fundingClaim.compiled.deployment().contractAddress;
  input.runtimeState.repaymentClaimContractAddress = repaymentClaim.compiled.deployment().contractAddress;
  await saveRuntimeState(input.runtimeStatePath, input.runtimeState);

  return {
    definition,
    originated,
    funded: funding.nextStateValue,
    repaid: repayment.nextStateValue,
    fundingClaim: fundingClaim.claimValue,
    repaymentClaim: repaymentClaim.claimValue,
    closing: closing.closingValue,
    fundingCompiled: fundingClaim.compiled,
    repaymentCompiled: repaymentClaim.compiled,
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

  const outputBindingMode = env("RECEIVABLE_OUTPUT_BINDING_MODE", "script-bound");
  const runtimeStatePath = env(
    "RECEIVABLE_RUNTIME_STATE_PATH",
    defaultPath(outputBindingMode, "runtime", "json"),
  );
  const runtimeState = (await loadRuntimeState(runtimeStatePath)) ?? {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    bindingMode: outputBindingMode,
    phase: "init",
    definitionPath: defaultPath(outputBindingMode, "definition", "json"),
    originatedStatePath: defaultPath(outputBindingMode, "originated", "json"),
    fundedStatePath: defaultPath(outputBindingMode, "funded", "json"),
    repaidStatePath: defaultPath(outputBindingMode, "repaid", "json"),
    fundingClaimPath: defaultPath(outputBindingMode, "funding-claim", "json"),
    repaymentClaimPath: defaultPath(outputBindingMode, "repayment-claim", "json"),
    fundingArtifactPath: defaultPath(outputBindingMode, "funding-claim", "artifact.json"),
    repaymentArtifactPath: defaultPath(outputBindingMode, "repayment-claim", "artifact.json"),
    closingPath: defaultPath(outputBindingMode, "closing", "json"),
  };

  const claimantKeyPair = resolveRuntimeKeyPair({
    label: "receivable controller",
    explicitPrivkey: process.env.RECEIVABLE_CONTROLLER_PRIVKEY,
    explicitXonly: process.env.RECEIVABLE_CONTROLLER_XONLY,
    runtimeState,
    privkeyStateKey: "controllerPrivkey",
    xonlyStateKey: "controllerXonly",
  });
  runtimeState.bindingMode = outputBindingMode;
  await saveRuntimeState(runtimeStatePath, runtimeState);

  if (runtimeState.phase === "finalized" && runtimeState.result) {
    console.log(JSON.stringify(runtimeState.result, null, 2));
    return;
  }

  const waitTimeoutMs = Number(env("RECEIVABLE_WAIT_TIMEOUT_MS", "1800000"));
  const waitPollMs = Number(env("RECEIVABLE_WAIT_POLL_MS", "30000"));
  const feeSat = Number(env("RECEIVABLE_FEE_SAT", "100"));
  const faceValueSat = Number(env("RECEIVABLE_FACE_VALUE_SAT", "10000"));
  const wallet = env("RECEIVABLE_WALLET", env("ELEMENTS_RPC_WALLET", "simplicity-test"));
  const payoutAddress = await sdk.rpc.call("getnewaddress", []);

  const scenario = await loadOrPrepareScenario(sdk, {
    runtimeState,
    runtimeStatePath,
    claimantKeyPair,
    faceValueSat,
  });

  const fundingClaimFundingSat = scenario.fundingClaim.amountSat + feeSat;
  const repaymentClaimFundingSat = scenario.repaymentClaim.amountSat + feeSat;

  const fundingClaimFundingTxId = runtimeState.fundingClaimFundingTxId
    ?? (await sdk.rpc.call("sendtoaddress", [
      scenario.fundingCompiled.deployment().contractAddress,
      satToBtc(fundingClaimFundingSat),
    ]));
  if (!runtimeState.fundingClaimFundingTxId) {
    runtimeState.phase = "funding-claim-funded";
    runtimeState.fundingClaimFundingTxId = fundingClaimFundingTxId;
    await saveRuntimeState(runtimeStatePath, runtimeState);
  }
  await waitForFundingConfirmations(sdk, fundingClaimFundingTxId, {
    phase: "waiting-funding-claim-confirmations",
    requiredConfirmations: 1,
    timeoutMs: waitTimeoutMs,
    pollIntervalMs: waitPollMs,
  });
  await waitForSpendableFunding(sdk, scenario.fundingCompiled.deployment().contractAddress, {
    phase: "waiting-funding-claim-utxo",
    requiredConfirmations: 1,
    minAmountSat: fundingClaimFundingSat,
    timeoutMs: waitTimeoutMs,
    pollIntervalMs: waitPollMs,
    expectedTxId: fundingClaimFundingTxId,
  });

  const fundingClaimExecution = runtimeState.fundingClaimExecutionTxId
    ? {
        execution: {
          txId: runtimeState.fundingClaimExecutionTxId,
          broadcasted: true,
        },
        report: runtimeState.fundingClaimReport,
      }
    : await sdk.receivables.executeFundingClaim({
        artifactPath: runtimeState.fundingArtifactPath,
        definitionPath: runtimeState.definitionPath,
        currentStatePath: runtimeState.fundedStatePath,
        stateHistoryPaths: [runtimeState.originatedStatePath, runtimeState.fundedStatePath],
        fundingClaimPath: runtimeState.fundingClaimPath,
        payoutAddress,
        outputBindingMode,
        wallet,
        signer: { type: "schnorrPrivkeyHex", privkeyHex: claimantKeyPair.privkeyHex },
        feeSat,
        broadcast: true,
      });
  if (!runtimeState.fundingClaimExecutionTxId) {
    runtimeState.phase = "funding-claim-executed";
    runtimeState.fundingClaimExecutionTxId = fundingClaimExecution.execution.txId;
    runtimeState.fundingClaimReport = fundingClaimExecution.report;
    await saveRuntimeState(runtimeStatePath, runtimeState);
  }

  const repaymentClaimFundingTxId = runtimeState.repaymentClaimFundingTxId
    ?? (await sdk.rpc.call("sendtoaddress", [
      scenario.repaymentCompiled.deployment().contractAddress,
      satToBtc(repaymentClaimFundingSat),
    ]));
  if (!runtimeState.repaymentClaimFundingTxId) {
    runtimeState.phase = "repayment-claim-funded";
    runtimeState.repaymentClaimFundingTxId = repaymentClaimFundingTxId;
    await saveRuntimeState(runtimeStatePath, runtimeState);
  }
  await waitForFundingConfirmations(sdk, repaymentClaimFundingTxId, {
    phase: "waiting-repayment-claim-confirmations",
    requiredConfirmations: 1,
    timeoutMs: waitTimeoutMs,
    pollIntervalMs: waitPollMs,
  });
  await waitForSpendableFunding(sdk, scenario.repaymentCompiled.deployment().contractAddress, {
    phase: "waiting-repayment-claim-utxo",
    requiredConfirmations: 1,
    minAmountSat: repaymentClaimFundingSat,
    timeoutMs: waitTimeoutMs,
    pollIntervalMs: waitPollMs,
    expectedTxId: repaymentClaimFundingTxId,
  });

  const repaymentClaimExecution = runtimeState.repaymentClaimExecutionTxId
    ? {
        execution: {
          txId: runtimeState.repaymentClaimExecutionTxId,
          broadcasted: true,
        },
        report: runtimeState.repaymentClaimReport,
      }
    : await sdk.receivables.executeRepaymentClaim({
        artifactPath: runtimeState.repaymentArtifactPath,
        definitionPath: runtimeState.definitionPath,
        currentStatePath: runtimeState.repaidStatePath,
        stateHistoryPaths: [
          runtimeState.originatedStatePath,
          runtimeState.fundedStatePath,
          runtimeState.repaidStatePath,
        ],
        repaymentClaimPath: runtimeState.repaymentClaimPath,
        payoutAddress,
        outputBindingMode,
        wallet,
        signer: { type: "schnorrPrivkeyHex", privkeyHex: claimantKeyPair.privkeyHex },
        feeSat,
        broadcast: true,
      });
  if (!runtimeState.repaymentClaimExecutionTxId) {
    runtimeState.phase = "repayment-claim-executed";
    runtimeState.repaymentClaimExecutionTxId = repaymentClaimExecution.execution.txId;
    runtimeState.repaymentClaimReport = repaymentClaimExecution.report;
    await saveRuntimeState(runtimeStatePath, runtimeState);
  }

  const finality = await sdk.receivables.exportFinalityPayload({
    definitionPath: runtimeState.definitionPath,
    stateHistoryPaths: [
      runtimeState.originatedStatePath,
      runtimeState.fundedStatePath,
      runtimeState.repaidStatePath,
    ],
    fundingClaimPath: runtimeState.fundingClaimPath,
    repaymentClaimPath: runtimeState.repaymentClaimPath,
    closingPath: runtimeState.closingPath,
  });

  const result = {
    bindingMode: outputBindingMode,
    claimantXonly: claimantKeyPair.xonly,
    fundingClaim: {
      contractAddress: scenario.fundingCompiled.deployment().contractAddress,
      fundingTxId: fundingClaimFundingTxId,
      claimTxId: fundingClaimExecution.execution.txId,
      reasonCode: fundingClaimExecution.report?.fundingClaimTrust?.reasonCode ?? null,
    },
    repaymentClaim: {
      contractAddress: scenario.repaymentCompiled.deployment().contractAddress,
      fundingTxId: repaymentClaimFundingTxId,
      claimTxId: repaymentClaimExecution.execution.txId,
      reasonCode: repaymentClaimExecution.report?.repaymentClaimTrust?.reasonCode ?? null,
    },
    closing: {
      closingHash: finality.closingHash,
      closingReason: finality.closingReason,
    },
    finality: {
      latestStateHash: finality.latestStateHash,
      fundingClaimHash: finality.fundingClaimHash,
      repaymentClaimHash: finality.repaymentClaimHash,
      fullLineageVerified: finality.trustSummary.lineage?.fullLineageVerified ?? false,
    },
  };

  runtimeState.phase = "finalized";
  runtimeState.result = result;
  await saveRuntimeState(runtimeStatePath, runtimeState);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
