import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  createSimplicityClient,
  buildReceivableFundingClaimDescriptor,
  buildReceivableRepaymentClaimDescriptor,
} from "../dist/index.js";
import { resolveRuntimeKeyPair } from "./runtimeKeys.mjs";

const RUNTIME_STATE_SCHEMA_VERSION = "receivable-e2e-testnet-state/v3";

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
    return null;
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
    && existsSync(input.runtimeState.partialRepaidStatePath)
    && existsSync(input.runtimeState.repaidStatePath)
    && existsSync(input.runtimeState.fundingClaimPath)
    && existsSync(input.runtimeState.partialRepaymentClaimPath)
    && existsSync(input.runtimeState.finalRepaymentClaimPath)
    && existsSync(input.runtimeState.fundingArtifactPath)
    && existsSync(input.runtimeState.partialRepaymentArtifactPath)
    && existsSync(input.runtimeState.finalRepaymentArtifactPath)
    && existsSync(input.runtimeState.closingPath);

  if (reusable) {
    return {
      definition: await readJson(input.runtimeState.definitionPath),
      originated: await readJson(input.runtimeState.originatedStatePath),
      funded: await readJson(input.runtimeState.fundedStatePath),
      partialRepaid: await readJson(input.runtimeState.partialRepaidStatePath),
      repaid: await readJson(input.runtimeState.repaidStatePath),
      fundingClaim: await readJson(input.runtimeState.fundingClaimPath),
      partialRepaymentClaim: await readJson(input.runtimeState.partialRepaymentClaimPath),
      finalRepaymentClaim: await readJson(input.runtimeState.finalRepaymentClaimPath),
      closing: await readJson(input.runtimeState.closingPath),
      fundingCompiled: await sdk.loadArtifact(input.runtimeState.fundingArtifactPath),
      partialRepaymentCompiled: await sdk.loadArtifact(input.runtimeState.partialRepaymentArtifactPath),
      finalRepaymentCompiled: await sdk.loadArtifact(input.runtimeState.finalRepaymentArtifactPath),
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
    originatorClaimantXonly: env("RECEIVABLE_ORIGINATOR_CLAIMANT_XONLY", input.claimantKeyPair.xonly),
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
    holderClaimantXonly: definition.originatorClaimantXonly,
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
    holderClaimantXonly: env("RECEIVABLE_HOLDER_CLAIMANT_XONLY", definition.controllerXonly),
    fundedAt: env("RECEIVABLE_FUNDED_AT", "2027-01-02T00:00:00Z"),
  });
  const fundingClaimDescriptor = buildReceivableFundingClaimDescriptor({
    claimId: `${definition.receivableId}-FUNDING-CLAIM`,
    definition,
    currentState: funding.nextStateValue,
  });
  const fundingClaim = await sdk.receivables.prepareFundingClaim({
    definitionValue: definition,
    currentStateValue: funding.nextStateValue,
    stateHistoryValues: [originated, funding.nextStateValue],
    fundingClaimValue: fundingClaimDescriptor,
    artifactPath: input.runtimeState.fundingArtifactPath,
  });

  const partialRepaymentAmountSat = Number(env("RECEIVABLE_PARTIAL_REPAYMENT_AMOUNT_SAT", "4000"));
  if (!Number.isFinite(partialRepaymentAmountSat) || partialRepaymentAmountSat <= 0 || partialRepaymentAmountSat >= definition.faceValue) {
    throw new Error("RECEIVABLE_PARTIAL_REPAYMENT_AMOUNT_SAT must be a positive number smaller than faceValue");
  }
  const partialRepayment = await sdk.receivables.prepareRepayment({
    definitionValue: definition,
    previousStateValue: funding.nextStateValue,
    stateId: `${definition.receivableId}-S2`,
    amount: partialRepaymentAmountSat,
    repaidAt: env("RECEIVABLE_PARTIAL_REPAID_AT", "2027-02-01T00:00:00Z"),
  });
  const partialRepaymentClaimDescriptor = buildReceivableRepaymentClaimDescriptor({
    claimId: `${definition.receivableId}-REPAYMENT-CLAIM-PARTIAL`,
    currentState: partialRepayment.nextStateValue,
  });
  const partialRepaymentClaim = await sdk.receivables.prepareRepaymentClaim({
    definitionValue: definition,
    currentStateValue: partialRepayment.nextStateValue,
    stateHistoryValues: [originated, funding.nextStateValue, partialRepayment.nextStateValue],
    repaymentClaimValue: partialRepaymentClaimDescriptor,
    artifactPath: input.runtimeState.partialRepaymentArtifactPath,
  });

  const finalRepaymentAmountSat = Number(
    env("RECEIVABLE_FINAL_REPAYMENT_AMOUNT_SAT", String(definition.faceValue - partialRepaymentAmountSat)),
  );
  if (!Number.isFinite(finalRepaymentAmountSat) || finalRepaymentAmountSat !== partialRepayment.nextStateValue.outstandingAmount) {
    throw new Error("RECEIVABLE_FINAL_REPAYMENT_AMOUNT_SAT must equal the partial state outstanding amount");
  }
  const finalRepayment = await sdk.receivables.prepareRepayment({
    definitionValue: definition,
    previousStateValue: partialRepayment.nextStateValue,
    stateId: `${definition.receivableId}-S3`,
    amount: finalRepaymentAmountSat,
    repaidAt: env("RECEIVABLE_FINAL_REPAID_AT", "2027-03-01T00:00:00Z"),
  });
  const finalRepaymentClaimDescriptor = buildReceivableRepaymentClaimDescriptor({
    claimId: `${definition.receivableId}-REPAYMENT-CLAIM-FINAL`,
    currentState: finalRepayment.nextStateValue,
  });
  const finalRepaymentClaim = await sdk.receivables.prepareRepaymentClaim({
    definitionValue: definition,
    currentStateValue: finalRepayment.nextStateValue,
    stateHistoryValues: [
      originated,
      funding.nextStateValue,
      partialRepayment.nextStateValue,
      finalRepayment.nextStateValue,
    ],
    repaymentClaimValue: finalRepaymentClaimDescriptor,
    artifactPath: input.runtimeState.finalRepaymentArtifactPath,
  });

  const closing = await sdk.receivables.prepareClosing({
    definitionValue: definition,
    latestStateValue: finalRepayment.nextStateValue,
    stateHistoryValues: [
      originated,
      funding.nextStateValue,
      partialRepayment.nextStateValue,
      finalRepayment.nextStateValue,
    ],
    closingId: `${definition.receivableId}-CLOSE`,
    closedAt: env("RECEIVABLE_CLOSED_AT", "2027-03-02T00:00:00Z"),
  });

  await writeJson(input.runtimeState.definitionPath, definition);
  await writeJson(input.runtimeState.originatedStatePath, originated);
  await writeJson(input.runtimeState.fundedStatePath, funding.nextStateValue);
  await writeJson(input.runtimeState.partialRepaidStatePath, partialRepayment.nextStateValue);
  await writeJson(input.runtimeState.repaidStatePath, finalRepayment.nextStateValue);
  await writeJson(input.runtimeState.fundingClaimPath, fundingClaim.claimValue);
  await writeJson(input.runtimeState.partialRepaymentClaimPath, partialRepaymentClaim.claimValue);
  await writeJson(input.runtimeState.finalRepaymentClaimPath, finalRepaymentClaim.claimValue);
  await writeJson(input.runtimeState.closingPath, closing.closingValue);

  input.runtimeState.phase = "prepared";
  input.runtimeState.receivableId = definition.receivableId;
  input.runtimeState.fundingClaimContractAddress = fundingClaim.compiled.deployment().contractAddress;
  input.runtimeState.partialRepaymentClaimContractAddress = partialRepaymentClaim.compiled.deployment().contractAddress;
  input.runtimeState.finalRepaymentClaimContractAddress = finalRepaymentClaim.compiled.deployment().contractAddress;
  await saveRuntimeState(input.runtimeStatePath, input.runtimeState);

  return {
    definition,
    originated,
    funded: funding.nextStateValue,
    partialRepaid: partialRepayment.nextStateValue,
    repaid: finalRepayment.nextStateValue,
    fundingClaim: fundingClaim.claimValue,
    partialRepaymentClaim: partialRepaymentClaim.claimValue,
    finalRepaymentClaim: finalRepaymentClaim.claimValue,
    closing: closing.closingValue,
    fundingCompiled: fundingClaim.compiled,
    partialRepaymentCompiled: partialRepaymentClaim.compiled,
    finalRepaymentCompiled: finalRepaymentClaim.compiled,
  };
}

async function main() {
  const missingRpcEnv = ["ELEMENTS_RPC_URL", "ELEMENTS_RPC_USER", "ELEMENTS_RPC_PASSWORD"].filter(
    (name) => !process.env[name],
  );
  if (missingRpcEnv.length > 0) {
    console.log(JSON.stringify({
      skipped: true,
      reason: "Elements RPC environment is required for npm run e2e:receivable-testnet",
      missingEnv: missingRpcEnv,
      bindingMode: env("RECEIVABLE_OUTPUT_BINDING_MODE", "script-bound"),
    }, null, 2));
    return;
  }

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
    partialRepaidStatePath: defaultPath(outputBindingMode, "partially-repaid", "json"),
    repaidStatePath: defaultPath(outputBindingMode, "repaid", "json"),
    fundingClaimPath: defaultPath(outputBindingMode, "funding-claim", "json"),
    partialRepaymentClaimPath: defaultPath(outputBindingMode, "repayment-claim-partial", "json"),
    finalRepaymentClaimPath: defaultPath(outputBindingMode, "repayment-claim-final", "json"),
    fundingArtifactPath: defaultPath(outputBindingMode, "funding-claim", "artifact.json"),
    partialRepaymentArtifactPath: defaultPath(outputBindingMode, "repayment-claim-partial", "artifact.json"),
    finalRepaymentArtifactPath: defaultPath(outputBindingMode, "repayment-claim-final", "artifact.json"),
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
  const partialRepaymentClaimFundingSat = scenario.partialRepaymentClaim.amountSat + feeSat;
  const finalRepaymentClaimFundingSat = scenario.finalRepaymentClaim.amountSat + feeSat;

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

  const partialRepaymentClaimFundingTxId = runtimeState.partialRepaymentClaimFundingTxId
    ?? (await sdk.rpc.call("sendtoaddress", [
      scenario.partialRepaymentCompiled.deployment().contractAddress,
      satToBtc(partialRepaymentClaimFundingSat),
    ]));
  if (!runtimeState.partialRepaymentClaimFundingTxId) {
    runtimeState.phase = "partial-repayment-claim-funded";
    runtimeState.partialRepaymentClaimFundingTxId = partialRepaymentClaimFundingTxId;
    await saveRuntimeState(runtimeStatePath, runtimeState);
  }
  await waitForFundingConfirmations(sdk, partialRepaymentClaimFundingTxId, {
    phase: "waiting-partial-repayment-claim-confirmations",
    requiredConfirmations: 1,
    timeoutMs: waitTimeoutMs,
    pollIntervalMs: waitPollMs,
  });
  await waitForSpendableFunding(sdk, scenario.partialRepaymentCompiled.deployment().contractAddress, {
    phase: "waiting-partial-repayment-claim-utxo",
    requiredConfirmations: 1,
    minAmountSat: partialRepaymentClaimFundingSat,
    timeoutMs: waitTimeoutMs,
    pollIntervalMs: waitPollMs,
    expectedTxId: partialRepaymentClaimFundingTxId,
  });

  const partialRepaymentClaimExecution = runtimeState.partialRepaymentClaimExecutionTxId
    ? {
        execution: {
          txId: runtimeState.partialRepaymentClaimExecutionTxId,
          broadcasted: true,
        },
        report: runtimeState.partialRepaymentClaimReport,
      }
    : await sdk.receivables.executeRepaymentClaim({
        artifactPath: runtimeState.partialRepaymentArtifactPath,
        definitionPath: runtimeState.definitionPath,
        currentStatePath: runtimeState.partialRepaidStatePath,
        stateHistoryPaths: [
          runtimeState.originatedStatePath,
          runtimeState.fundedStatePath,
          runtimeState.partialRepaidStatePath,
        ],
        repaymentClaimPath: runtimeState.partialRepaymentClaimPath,
        payoutAddress,
        outputBindingMode,
        wallet,
        signer: { type: "schnorrPrivkeyHex", privkeyHex: claimantKeyPair.privkeyHex },
        feeSat,
        broadcast: true,
      });
  if (!runtimeState.partialRepaymentClaimExecutionTxId) {
    runtimeState.phase = "partial-repayment-claim-executed";
    runtimeState.partialRepaymentClaimExecutionTxId = partialRepaymentClaimExecution.execution.txId;
    runtimeState.partialRepaymentClaimReport = partialRepaymentClaimExecution.report;
    await saveRuntimeState(runtimeStatePath, runtimeState);
  }

  const finalRepaymentClaimFundingTxId = runtimeState.finalRepaymentClaimFundingTxId
    ?? (await sdk.rpc.call("sendtoaddress", [
      scenario.finalRepaymentCompiled.deployment().contractAddress,
      satToBtc(finalRepaymentClaimFundingSat),
    ]));
  if (!runtimeState.finalRepaymentClaimFundingTxId) {
    runtimeState.phase = "final-repayment-claim-funded";
    runtimeState.finalRepaymentClaimFundingTxId = finalRepaymentClaimFundingTxId;
    await saveRuntimeState(runtimeStatePath, runtimeState);
  }
  await waitForFundingConfirmations(sdk, finalRepaymentClaimFundingTxId, {
    phase: "waiting-final-repayment-claim-confirmations",
    requiredConfirmations: 1,
    timeoutMs: waitTimeoutMs,
    pollIntervalMs: waitPollMs,
  });
  await waitForSpendableFunding(sdk, scenario.finalRepaymentCompiled.deployment().contractAddress, {
    phase: "waiting-final-repayment-claim-utxo",
    requiredConfirmations: 1,
    minAmountSat: finalRepaymentClaimFundingSat,
    timeoutMs: waitTimeoutMs,
    pollIntervalMs: waitPollMs,
    expectedTxId: finalRepaymentClaimFundingTxId,
  });

  const finalRepaymentClaimExecution = runtimeState.finalRepaymentClaimExecutionTxId
    ? {
        execution: {
          txId: runtimeState.finalRepaymentClaimExecutionTxId,
          broadcasted: true,
        },
        report: runtimeState.finalRepaymentClaimReport,
      }
    : await sdk.receivables.executeRepaymentClaim({
        artifactPath: runtimeState.finalRepaymentArtifactPath,
        definitionPath: runtimeState.definitionPath,
        currentStatePath: runtimeState.repaidStatePath,
        stateHistoryPaths: [
          runtimeState.originatedStatePath,
          runtimeState.fundedStatePath,
          runtimeState.partialRepaidStatePath,
          runtimeState.repaidStatePath,
        ],
        repaymentClaimPath: runtimeState.finalRepaymentClaimPath,
        payoutAddress,
        outputBindingMode,
        wallet,
        signer: { type: "schnorrPrivkeyHex", privkeyHex: claimantKeyPair.privkeyHex },
        feeSat,
        broadcast: true,
      });
  if (!runtimeState.finalRepaymentClaimExecutionTxId) {
    runtimeState.phase = "final-repayment-claim-executed";
    runtimeState.finalRepaymentClaimExecutionTxId = finalRepaymentClaimExecution.execution.txId;
    runtimeState.finalRepaymentClaimReport = finalRepaymentClaimExecution.report;
    await saveRuntimeState(runtimeStatePath, runtimeState);
  }

  const finality = await sdk.receivables.exportFinalityPayload({
    definitionPath: runtimeState.definitionPath,
    stateHistoryPaths: [
      runtimeState.originatedStatePath,
      runtimeState.fundedStatePath,
      runtimeState.partialRepaidStatePath,
      runtimeState.repaidStatePath,
    ],
    fundingClaimPath: runtimeState.fundingClaimPath,
    repaymentClaimPath: runtimeState.finalRepaymentClaimPath,
    closingPath: runtimeState.closingPath,
  });

  const result = {
    bindingMode: outputBindingMode,
    claimantXonly: claimantKeyPair.xonly,
    fundingClaim: {
      contractAddress: scenario.fundingCompiled.deployment().contractAddress,
      fundingTxId: fundingClaimFundingTxId,
      claimTxId: fundingClaimExecution.execution.txId,
      authoritySource: fundingClaimExecution.report?.fundingClaimTrust?.claimantAuthoritySource ?? null,
      reasonCode: fundingClaimExecution.report?.fundingClaimTrust?.reasonCode ?? null,
    },
    partialRepaymentClaim: {
      contractAddress: scenario.partialRepaymentCompiled.deployment().contractAddress,
      fundingTxId: partialRepaymentClaimFundingTxId,
      claimTxId: partialRepaymentClaimExecution.execution.txId,
      authoritySource: partialRepaymentClaimExecution.report?.repaymentClaimTrust?.claimantAuthoritySource ?? null,
      reasonCode: partialRepaymentClaimExecution.report?.repaymentClaimTrust?.reasonCode ?? null,
    },
    finalRepaymentClaim: {
      contractAddress: scenario.finalRepaymentCompiled.deployment().contractAddress,
      fundingTxId: finalRepaymentClaimFundingTxId,
      claimTxId: finalRepaymentClaimExecution.execution.txId,
      authoritySource: finalRepaymentClaimExecution.report?.repaymentClaimTrust?.claimantAuthoritySource ?? null,
      reasonCode: finalRepaymentClaimExecution.report?.repaymentClaimTrust?.reasonCode ?? null,
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
