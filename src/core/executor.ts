import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ExecutionError,
  PresetExecutionError,
  UnsupportedFeatureError,
  UtxoNotFoundError,
  ValidationError,
} from "./errors";
import { summarize } from "./summary";
import { renderTemplate } from "./templating";
import { getPresetOrThrow, validateWitnessConfig } from "./presets";
import {
  runCommand,
  runHalExtract,
  runHalFinalize,
  runHalSighash,
  runHalUpdateInput,
  runSimcWithWitness,
} from "./toolchain";
import {
  ContractUtxo,
  ExecuteCallInput,
  ExecuteResult,
  GaslessExecuteInput,
  GaslessExecuteResult,
  InspectCallInput,
  InspectResult,
  PsetSummary,
  SimplicityArtifact,
  SimplicityClientConfig,
  UtxoPolicy,
  WitnessConfig,
} from "./types";
import { RelayerClient } from "../gasless/RelayerClient";

const DEFAULT_FEE_SAT = 100;
const DEFAULT_SEQUENCE = 4294967293;
const DUST_MARGIN_SAT = 600;

interface WalletListUnspentResult {
  txid: string;
  vout: number;
  amount: number;
  asset: string;
  amountblinder?: string;
  confirmations?: number;
  spendable?: boolean;
  safe?: boolean;
}

interface RawTransactionVerboseResult {
  vout?: Array<{
    n: number;
    value?: number;
    asset?: string;
    scriptPubKey?: {
      hex?: string;
      address?: string;
    };
  }>;
}

interface SponsorCandidate {
  txid: string;
  vout: number;
  amountSat: number;
  asset: string;
  isExplicit: boolean;
}

function btcStringToSatNumber(btcStr: string): number {
  const x = Number(btcStr);
  if (!Number.isFinite(x)) throw new ValidationError(`Invalid BTC amount: ${btcStr}`);
  return Math.round(x * 1e8);
}

function satToBtcNumber(sat: number): number {
  return Number((sat / 1e8).toFixed(8));
}

function satToBtcStringFromNumber(sat: number): string {
  const value = BigInt(sat);
  const whole = value / 100000000n;
  const frac = value % 100000000n;
  return `${whole}.${frac.toString().padStart(8, "0")}`;
}

function getArtifactLocktime(artifact: SimplicityArtifact): number {
  const legacyMinHeight = artifact.legacy?.params?.minHeight;
  if (typeof legacyMinHeight === "number" && Number.isFinite(legacyMinHeight) && legacyMinHeight >= 0) {
    return Math.trunc(legacyMinHeight);
  }
  const templateVars = artifact.source.templateVars ?? {};
  const candidate = templateVars.MIN_HEIGHT ?? templateVars.TIMEOUT_HEIGHT;
  if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
    return Math.trunc(candidate);
  }
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.trunc(parsed);
    }
  }
  return 0;
}

function parseSimcWitness(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("Witness:")) {
      const rest = line.slice("Witness:".length).trim();
      if (rest) return rest;
    }
  }
  const nextLineIndex = lines.findIndex((line) => line === "Witness:");
  if (nextLineIndex >= 0 && lines[nextLineIndex + 1]) {
    return lines[nextLineIndex + 1];
  }
  throw new ExecutionError("Could not parse Witness from simc output", { output });
}

function normalizeRawTx(maybeJsonOrHex: string): string {
  const value = String(maybeJsonOrHex).trim();
  if (value.startsWith("{") || value.startsWith("[")) {
    const parsed = JSON.parse(value) as Record<string, string>;
    const hex = parsed.hex ?? parsed.rawtx ?? parsed.rawTx ?? parsed.rawTransactionHex;
    if (hex) return hex.trim();
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    const parsed = JSON.parse(value) as string;
    return parsed.trim();
  }
  return value;
}

function chooseUtxo(utxos: ContractUtxo[], minSat: number, policy: UtxoPolicy): ContractUtxo | null {
  const sortCandidates = (entries: ContractUtxo[]) =>
    entries.sort((left, right) => {
      if (policy === "largest") return right.sat - left.sat;
      if (policy === "newest") return (right.height ?? 0) - (left.height ?? 0);
      return left.sat - right.sat;
    });
  const confirmed = sortCandidates(utxos.filter((utxo) => utxo.confirmed).filter((utxo) => utxo.sat >= minSat));
  if (confirmed[0]) return confirmed[0];
  const unconfirmed = sortCandidates(utxos.filter((utxo) => !utxo.confirmed).filter((utxo) => utxo.sat >= minSat));
  return unconfirmed[0] ?? null;
}

async function findContractUtxosInMempool(elementsCliPath: string, contractAddress: string): Promise<ContractUtxo[]> {
  const mempool = await runCommand(elementsCliPath, ["getrawmempool"]);
  const txids = JSON.parse(mempool.stdout) as string[];
  const matches: ContractUtxo[] = [];
  for (const txid of txids) {
    const tx = await runCommand(elementsCliPath, ["getrawtransaction", txid, "true"]);
    const parsed = JSON.parse(tx.stdout) as RawTransactionVerboseResult;
    for (const output of parsed.vout ?? []) {
      if (output.scriptPubKey?.address !== contractAddress) continue;
      matches.push({
        txid,
        vout: output.n,
        scriptPubKey: output.scriptPubKey?.hex ?? "",
        asset: output.asset ?? "",
        sat: btcStringToSatNumber(String(output.value ?? 0)),
        confirmed: false,
      });
    }
  }
  return matches;
}

async function scanUtxosByAddress(elementsCliPath: string, contractAddress: string): Promise<ContractUtxo[]> {
  const pattern = `["addr(${contractAddress})"]`;
  const result = await runCommand(elementsCliPath, ["scantxoutset", "start", pattern]);
  const parsed = JSON.parse(result.stdout) as {
    success?: boolean;
    unspents?: Array<{
      txid: string;
      vout: number;
      scriptPubKey: string;
      asset: string;
      amount: string;
      height?: number;
    }>;
  };
  if (!parsed.success || !Array.isArray(parsed.unspents)) {
    throw new ExecutionError("scantxoutset failed", parsed);
  }
  const confirmed = parsed.unspents.map((utxo) => ({
    txid: utxo.txid,
    vout: utxo.vout,
    scriptPubKey: utxo.scriptPubKey,
    asset: utxo.asset,
    sat: btcStringToSatNumber(String(utxo.amount)),
    height: utxo.height,
    confirmed: true,
  }));
  const mempool = confirmed.length === 0 ? await findContractUtxosInMempool(elementsCliPath, contractAddress) : [];
  return [...confirmed, ...mempool];
}

async function decodePsbt(elementsCliPath: string, psetBase64: string, wallet: string): Promise<Record<string, any>> {
  const result = await runCommand(elementsCliPath, [`-rpcwallet=${wallet}`, "decodepsbt", psetBase64]);
  return JSON.parse(result.stdout) as Record<string, any>;
}

async function getAddressInfo(
  elementsCliPath: string,
  wallet: string,
  address: string
): Promise<{ scriptPubKey: string; unconfidential?: string }> {
  const result = await runCommand(elementsCliPath, [`-rpcwallet=${wallet}`, "getaddressinfo", address]);
  const parsed = JSON.parse(result.stdout) as { scriptPubKey?: string; unconfidential?: string };
  if (!parsed.scriptPubKey) {
    throw new ExecutionError(`Could not get scriptPubKey from address: ${address}`);
  }
  return { scriptPubKey: parsed.scriptPubKey, unconfidential: parsed.unconfidential };
}

async function allocateWalletAddress(
  elementsCliPath: string,
  wallet: string
): Promise<{ address: string; scriptPubKey: string }> {
  const result = await runCommand(elementsCliPath, [`-rpcwallet=${wallet}`, "getnewaddress"]);
  const address = result.stdout.trim();
  const info = await getAddressInfo(elementsCliPath, wallet, address);
  return {
    address: info.unconfidential ?? address,
    scriptPubKey: info.scriptPubKey,
  };
}

async function listWalletUtxos(
  elementsCliPath: string,
  wallet: string
): Promise<SponsorCandidate[]> {
  const result = await runCommand(elementsCliPath, [`-rpcwallet=${wallet}`, "listunspent", "0", "9999999", "[]", "true"]);
  const parsed = JSON.parse(result.stdout) as WalletListUnspentResult[];
  return parsed.map((entry) => ({
    txid: entry.txid,
    vout: entry.vout,
    amountSat: btcStringToSatNumber(String(entry.amount)),
    asset: entry.asset,
    isExplicit: !entry.amountblinder || /^0+$/.test(entry.amountblinder),
  }));
}

function chooseSponsorUtxo(utxos: SponsorCandidate[], feeSat: number): SponsorCandidate | null {
  const candidates = utxos
    .filter((entry) => entry.amountSat >= feeSat)
    .sort((left, right) => {
      if (left.isExplicit !== right.isExplicit) {
        return left.isExplicit ? -1 : 1;
      }
      return left.amountSat - right.amountSat;
    });
  return candidates[0] ?? null;
}

function buildPsetSummary(decoded: Record<string, any>, meta: Record<string, any>): PsetSummary {
  const inputs = Array.isArray(decoded.inputs)
    ? decoded.inputs.map((entry: Record<string, any>) => ({
        txid: entry.previous_txid ?? null,
        vout: entry.previous_vout ?? null,
        sequence: entry.sequence ?? null,
      }))
    : [];
  const outputs = Array.isArray(decoded.outputs)
    ? decoded.outputs.map((entry: Record<string, any>, index: number) => ({
        n: index,
        value: entry.amount ?? null,
        asset: entry.asset ?? null,
        address: entry.script?.address ?? null,
        scriptPubKeyHex: entry.script?.hex ?? null,
        isFee:
          entry.script?.type === "fee" || entry.script?.is_fee === true || entry.script?.fee === true,
      }))
    : [];

  return {
    network: meta.network,
    purpose: meta.purpose,
    bondDefinitionId:
      meta.definitionType === "bond"
        ? (meta.definitionId ?? meta.bondDefinitionId ?? null)
        : (meta.bondDefinitionId ?? null),
    periodId: meta.periodId ?? null,
    definition: {
      type: meta.definitionType ?? null,
      id: meta.definitionId ?? null,
      hash: meta.definitionHash ?? null,
      trustMode: meta.definitionTrustMode ?? null,
      anchorMode: meta.definitionAnchorMode ?? null,
    },
    state: {
      type: meta.stateType ?? null,
      id: meta.stateId ?? null,
      hash: meta.stateHash ?? null,
      trustMode: meta.stateTrustMode ?? null,
      anchorMode: meta.stateAnchorMode ?? null,
    },
    contract: {
      address: meta.contractAddress,
      cmr: meta.cmr,
      internalKey: meta.internalKey,
      program: meta.program,
      minHeight: meta.minHeight,
    },
    expectedLiquidReceiver: meta.expectedLiquidReceiver ?? null,
    inputs,
    outputs,
    fee: decoded.fees ?? decoded.fee ?? null,
  };
}

async function getScriptPubKeyHexFromAddress(elementsCliPath: string, address: string): Promise<string> {
  const result = await runCommand(elementsCliPath, ["getaddressinfo", address]);
  const parsed = JSON.parse(result.stdout) as { scriptPubKey?: string };
  if (!parsed.scriptPubKey) {
    throw new ExecutionError(`Could not get scriptPubKey from address: ${address}`);
  }
  return parsed.scriptPubKey.toLowerCase();
}

async function assertSummaryPolicy(
  elementsCliPath: string,
  summary: PsetSummary,
  expectedLiquidReceiver?: string
): Promise<void> {
  if (!expectedLiquidReceiver) return;
  const expectedSpk = await getScriptPubKeyHexFromAddress(elementsCliPath, expectedLiquidReceiver);
  const normalOutputs = summary.outputs.filter((output) => output.isFee !== true);
  const found = normalOutputs.some((output) => (output.scriptPubKeyHex ?? "").toLowerCase() === expectedSpk);
  if (!found) {
    throw new ExecutionError("Expected receiver not found in non-fee outputs", {
      expectedLiquidReceiver,
      expectedSpk,
      outputs: normalOutputs,
    });
  }
}

async function buildExecutionState(
  config: SimplicityClientConfig,
  artifact: SimplicityArtifact,
  input: InspectCallInput | ExecuteCallInput
): Promise<{
  pset2: string;
  decoded: Record<string, any>;
  summary: PsetSummary;
  summaryHash: string;
  summaryCanonicalJson: string;
  contractUtxo: ContractUtxo;
  sendSat: number;
}> {
  const elementsCliPath = config.toolchain.elementsCliPath ?? "eltc";
  await runCommand(elementsCliPath, [`-rpcwallet=${input.wallet}`, "getwalletinfo"]);

  const feeSat = input.feeSat ?? config.defaults?.feeSat ?? DEFAULT_FEE_SAT;
  const minSat = feeSat + DUST_MARGIN_SAT;
  const utxoPolicy = input.utxoPolicy ?? config.defaults?.utxoPolicy ?? "smallest_over";
  const recipientInfo = await getAddressInfo(elementsCliPath, input.wallet, input.toAddress);
  const recipientAddress = recipientInfo.unconfidential ?? input.toAddress;

  const utxos = await scanUtxosByAddress(elementsCliPath, artifact.compiled.contractAddress);
  const contractUtxo = chooseUtxo(utxos, minSat, utxoPolicy);
  if (!contractUtxo) {
    throw new UtxoNotFoundError(
      `No contract UTXO found for address=${artifact.compiled.contractAddress} satisfying minSat=${minSat}`
    );
  }

  const sendSat = input.sendAmount
    ? Math.round(input.sendAmount * 1e8)
    : contractUtxo.sat - feeSat;
  if (!Number.isFinite(sendSat) || sendSat <= 0) {
    throw new ExecutionError("Invalid send amount after fee calculation", {
      utxoSat: contractUtxo.sat,
      feeSat,
      sendSat,
    });
  }

  const inputsJson = JSON.stringify([
    {
      txid: contractUtxo.txid,
      vout: contractUtxo.vout,
      sequence: input.sequence ?? DEFAULT_SEQUENCE,
    },
  ]);
  const outputsJson = JSON.stringify([{ [recipientAddress]: satToBtcNumber(sendSat) }, { fee: satToBtcNumber(feeSat) }]);
  const pset1 = await runCommand(elementsCliPath, [
    "createpsbt",
    inputsJson,
    outputsJson,
    String(getArtifactLocktime(artifact)),
    "true",
  ]);
  const psetUpdated = await runCommand(elementsCliPath, ["utxoupdatepsbt", pset1.stdout]);
  const utxoSpec = `${contractUtxo.scriptPubKey}:${contractUtxo.asset}:${satToBtcStringFromNumber(contractUtxo.sat)}`;
  const updateJson = (await runHalUpdateInput(
    config.toolchain.halSimplicityPath,
    psetUpdated.stdout,
    0,
    utxoSpec,
    artifact.compiled.cmr,
    artifact.compiled.internalKey
  )) as { pset?: string };
  const pset2 = updateJson.pset;
  if (!pset2) {
    throw new ExecutionError("update-input did not return a pset", updateJson);
  }

  const decoded = await decodePsbt(elementsCliPath, pset2, input.wallet);
  const summary = buildPsetSummary(decoded, {
    network: artifact.network,
    purpose: input.purpose ?? "sdk_execute",
    bondDefinitionId: input.bondDefinitionId,
    periodId: input.periodId,
    definitionType: artifact.definition?.definitionType,
    definitionId: artifact.definition?.definitionId,
    definitionHash: artifact.definition?.hash,
    definitionTrustMode: artifact.definition?.trustMode,
    definitionAnchorMode: artifact.definition?.anchorMode,
    stateType: artifact.state?.stateType,
    stateId: artifact.state?.stateId,
    stateHash: artifact.state?.hash,
    stateTrustMode: artifact.state?.trustMode,
    stateAnchorMode: artifact.state?.anchorMode,
    expectedLiquidReceiver: input.expectedLiquidReceiver ?? recipientAddress,
    contractAddress: artifact.compiled.contractAddress,
    cmr: artifact.compiled.cmr,
    internalKey: artifact.compiled.internalKey,
    program: artifact.compiled.program,
    minHeight: getArtifactLocktime(artifact) || undefined,
  });
  const { canonicalJson: summaryCanonicalJson, hash: summaryHash } = summarize(summary);

  return {
    pset2,
    decoded,
    summary,
    summaryHash,
    summaryCanonicalJson,
    contractUtxo,
    sendSat,
  };
}

export async function inspectContractCall(
  config: SimplicityClientConfig,
  artifact: SimplicityArtifact,
  input: InspectCallInput
): Promise<InspectResult> {
  const state = await buildExecutionState(config, artifact, input);
  return {
    mode: "inspect",
    summary: state.summary,
    summaryHash: state.summaryHash,
    summaryCanonicalJson: state.summaryCanonicalJson,
    psetBase64: state.pset2,
    contractUtxo: state.contractUtxo,
    warnings: [],
  };
}

export async function executeContractCall(
  config: SimplicityClientConfig,
  artifact: SimplicityArtifact,
  input: ExecuteCallInput
): Promise<ExecuteResult> {
  const elementsCliPath = config.toolchain.elementsCliPath ?? "eltc";
  const state = await buildExecutionState(config, artifact, input);
  await assertSummaryPolicy(elementsCliPath, state.summary, input.expectedLiquidReceiver);

  const finalizedPset = await signContractInput(
    config,
    artifact,
    state.pset2,
    input.signer.privkeyHex,
    input.witness
  );
  const finalized = { pset: finalizedPset };
  if (!finalized.pset) {
    throw new ExecutionError("finalize did not return a pset", finalized);
  }

  const rawTxHex = normalizeRawTx(
    await runHalExtract(config.toolchain.halSimplicityPath, finalized.pset)
  );

  let txId: string | undefined;
  if (input.broadcast) {
    const mempool = await runCommand(elementsCliPath, ["testmempoolaccept", `["${rawTxHex}"]`]);
    const mempoolParsed = JSON.parse(mempool.stdout) as Array<{ allowed?: boolean }>;
    if (!Array.isArray(mempoolParsed) || mempoolParsed[0]?.allowed !== true) {
      throw new ExecutionError("testmempoolaccept rejected transaction", mempoolParsed);
    }
    const sendTx = await runCommand(elementsCliPath, ["sendrawtransaction", rawTxHex]);
    txId = sendTx.stdout.trim();
  }

  return {
    mode: "execute",
    summary: state.summary,
    summaryHash: state.summaryHash,
    summaryCanonicalJson: state.summaryCanonicalJson,
    psetBase64: finalized.pset,
    rawTxHex,
    txId,
    broadcasted: Boolean(input.broadcast),
    contractUtxo: state.contractUtxo,
  };
}

export async function findContractUtxos(
  config: SimplicityClientConfig,
  artifact: SimplicityArtifact
): Promise<ContractUtxo[]> {
  const elementsCliPath = config.toolchain.elementsCliPath ?? "eltc";
  return scanUtxosByAddress(elementsCliPath, artifact.compiled.contractAddress);
}

export async function executeGaslessContractCall(
  config: SimplicityClientConfig,
  artifact: SimplicityArtifact,
  input: GaslessExecuteInput
): Promise<GaslessExecuteResult> {
  if (input.relayer) {
    return executeRelayedGaslessContractCall(config, artifact, input, input.relayer);
  }
  const elementsCliPath = config.toolchain.elementsCliPath ?? "eltc";
  const wallet = input.wallet ?? config.rpc.wallet ?? "simplicity-test";
  if (!input.sponsorWallet) {
    throw new ValidationError("sponsorWallet is required when relayer is not provided");
  }
  await runCommand(elementsCliPath, [`-rpcwallet=${wallet}`, "getwalletinfo"]);
  await runCommand(elementsCliPath, [`-rpcwallet=${input.sponsorWallet}`, "getwalletinfo"]);

  const contractUtxos = await scanUtxosByAddress(elementsCliPath, artifact.compiled.contractAddress);
  const contractUtxo = chooseUtxo(
    contractUtxos,
    input.sendAmount ? Math.round(input.sendAmount * 1e8) : 1,
    input.utxoPolicy ?? config.defaults?.utxoPolicy ?? "smallest_over"
  );
  if (!contractUtxo) {
    throw new UtxoNotFoundError(`No contract UTXO found for address=${artifact.compiled.contractAddress}`);
  }

  const feeSat = input.feeSat ?? config.defaults?.feeSat ?? DEFAULT_FEE_SAT;
  const sendSat = input.sendAmount ? Math.round(input.sendAmount * 1e8) : contractUtxo.sat;
  if (sendSat <= 0 || sendSat > contractUtxo.sat) {
    throw new ValidationError("sendAmount must be positive and no greater than the contract UTXO amount");
  }

  let contractChangeAddress: string | undefined;
  let contractChangeScriptPubKey: string | undefined;
  const contractChangeSat = contractUtxo.sat - sendSat;
  if (contractChangeSat > 0) {
    if (!input.contractChangeAddress) {
      throw new ValidationError("contractChangeAddress is required when sendAmount is smaller than the contract UTXO");
    }
    const changeInfo = await getAddressInfo(elementsCliPath, wallet, input.contractChangeAddress);
    contractChangeAddress = changeInfo.unconfidential ?? input.contractChangeAddress;
    contractChangeScriptPubKey = changeInfo.scriptPubKey;
  }

  const sponsorUtxos = await listWalletUtxos(elementsCliPath, input.sponsorWallet);
  const sponsorInput = chooseSponsorUtxo(sponsorUtxos, feeSat);
  if (!sponsorInput) {
    throw new UtxoNotFoundError(`No sponsor UTXO found in wallet=${input.sponsorWallet} for feeSat=${feeSat}`);
  }

  const sponsorChangeSat = sponsorInput.amountSat - feeSat;
  let sponsorChangeAddress: string | undefined;
  let sponsorChangeScriptPubKey: string | undefined;
  if (sponsorChangeSat > 0) {
    if (input.sponsorChangeAddress) {
      const info = await getAddressInfo(elementsCliPath, input.sponsorWallet, input.sponsorChangeAddress);
      sponsorChangeAddress = info.unconfidential ?? input.sponsorChangeAddress;
      sponsorChangeScriptPubKey = info.scriptPubKey;
    } else {
      const allocated = await allocateWalletAddress(elementsCliPath, input.sponsorWallet);
      sponsorChangeAddress = allocated.address;
      sponsorChangeScriptPubKey = allocated.scriptPubKey;
    }
  }

  const recipientInfo = await getAddressInfo(elementsCliPath, wallet, input.toAddress);
  const recipientAddress = recipientInfo.unconfidential ?? input.toAddress;

  const outputs: Array<Record<string, number>> = [{ [recipientAddress]: satToBtcNumber(sendSat) }];
  if (contractChangeSat > 0 && contractChangeAddress) {
    outputs.push({ [contractChangeAddress]: satToBtcNumber(contractChangeSat) });
  }
  if (sponsorChangeSat > 0 && sponsorChangeAddress) {
    outputs.push({ [sponsorChangeAddress]: satToBtcNumber(sponsorChangeSat) });
  }
  outputs.push({ fee: satToBtcNumber(feeSat) });

  const inputsJson = JSON.stringify([
    { txid: contractUtxo.txid, vout: contractUtxo.vout, sequence: DEFAULT_SEQUENCE },
    { txid: sponsorInput.txid, vout: sponsorInput.vout, sequence: DEFAULT_SEQUENCE },
  ]);
  const outputsJson = JSON.stringify(outputs);
  const pset1 = await runCommand(elementsCliPath, [
    "createpsbt",
    inputsJson,
    outputsJson,
    String(getArtifactLocktime(artifact)),
    "true",
  ]);
  const psetUpdated = await runCommand(elementsCliPath, ["utxoupdatepsbt", pset1.stdout]);
  const contractSpec = `${contractUtxo.scriptPubKey}:${contractUtxo.asset}:${satToBtcStringFromNumber(contractUtxo.sat)}`;
  const contractUpdated = (await runHalUpdateInput(
    config.toolchain.halSimplicityPath,
    psetUpdated.stdout,
    0,
    contractSpec,
    artifact.compiled.cmr,
    artifact.compiled.internalKey
  )) as { pset?: string };
  if (!contractUpdated.pset) {
    throw new ExecutionError("update-input did not return a pset", contractUpdated);
  }

  const decoded = await decodePsbt(elementsCliPath, contractUpdated.pset, input.sponsorWallet);
  const summary = buildPsetSummary(decoded, {
    network: artifact.network,
    purpose: "sdk_gasless_execute",
    bondDefinitionId: null,
    definitionType: artifact.definition?.definitionType,
    definitionId: artifact.definition?.definitionId,
    definitionHash: artifact.definition?.hash,
    definitionTrustMode: artifact.definition?.trustMode,
    definitionAnchorMode: artifact.definition?.anchorMode,
    stateType: artifact.state?.stateType,
    stateId: artifact.state?.stateId,
    stateHash: artifact.state?.hash,
    stateTrustMode: artifact.state?.trustMode,
    stateAnchorMode: artifact.state?.anchorMode,
    contractAddress: artifact.compiled.contractAddress,
    cmr: artifact.compiled.cmr,
    internalKey: artifact.compiled.internalKey,
    program: artifact.compiled.program,
    minHeight: getArtifactLocktime(artifact) || undefined,
    expectedLiquidReceiver: recipientAddress,
  });
  const { canonicalJson: summaryCanonicalJson, hash: summaryHash } = summarize(summary);

  const contractSignedPset = await signContractInput(
    config,
    artifact,
    contractUpdated.pset,
    input.signer.privkeyHex,
    input.witness
  );

  const sponsorSigned = await runCommand(elementsCliPath, [
    `-rpcwallet=${input.sponsorWallet}`,
    "walletprocesspsbt",
    contractSignedPset,
    "true",
    "ALL",
    "true",
  ]);
  const sponsorSignedParsed = JSON.parse(sponsorSigned.stdout) as { psbt?: string; complete?: boolean };
  if (!sponsorSignedParsed.psbt) {
    throw new ExecutionError("walletprocesspsbt did not return a sponsor-signed pset", sponsorSignedParsed);
  }

  const finalized = await runCommand(elementsCliPath, ["finalizepsbt", sponsorSignedParsed.psbt, "true"]);
  const finalizedParsed = JSON.parse(finalized.stdout) as { complete?: boolean; hex?: string };
  if (!finalizedParsed.complete || !finalizedParsed.hex) {
    throw new ExecutionError("PSET was not complete after sponsor signing", finalizedParsed);
  }

  let txId: string | undefined;
  if (input.broadcast) {
    const mempool = await runCommand(elementsCliPath, ["testmempoolaccept", `[\"${finalizedParsed.hex}\"]`]);
    const mempoolParsed = JSON.parse(mempool.stdout) as Array<{ allowed?: boolean }>;
    if (!Array.isArray(mempoolParsed) || mempoolParsed[0]?.allowed !== true) {
      throw new ExecutionError("testmempoolaccept rejected transaction", mempoolParsed);
    }
    const sent = await runCommand(elementsCliPath, ["sendrawtransaction", finalizedParsed.hex]);
    txId = sent.stdout.trim();
  }

  return {
    mode: "gasless-execute",
    summary,
    summaryHash,
    summaryCanonicalJson,
    psetBase64: sponsorSignedParsed.psbt,
    rawTxHex: finalizedParsed.hex,
    txId,
    broadcasted: Boolean(input.broadcast),
    contractUtxo,
    sponsorInput: {
      txid: sponsorInput.txid,
      vout: sponsorInput.vout,
      amountSat: sponsorInput.amountSat,
    },
  };
}

async function signContractInput(
  config: SimplicityClientConfig,
  artifact: SimplicityArtifact,
  psetBase64: string,
  privkeyHex: string,
  witnessConfig?: WitnessConfig
): Promise<string> {
  assertArtifactExecutionSupport(artifact, "direct");
  const signatures = await buildSignatureMap(config, artifact, psetBase64, privkeyHex, witnessConfig);

  const workDir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-gasless-"));
  const witnessPath = path.join(workDir, "witness.json");
  await writeFile(
    witnessPath,
    JSON.stringify(buildWitnessJson(artifact, signatures, witnessConfig), null, 2),
    "utf8"
  );
  const simfSourcePath = artifact.legacy?.simfTemplatePath ?? artifact.source.simfPath;
  if (!simfSourcePath) {
    throw new ExecutionError("Artifact does not include a source simf path for witness generation");
  }
  const simfTemplate = await readFile(simfSourcePath, "utf8");
  const simfRendered = renderTemplate(simfTemplate, artifact.source.templateVars ?? {});
  const simfRenderedPath = path.join(workDir, "program.simf");
  await writeFile(simfRenderedPath, simfRendered, "utf8");
  const witnessOutput = await runSimcWithWitness(config.toolchain.simcPath, simfRenderedPath, witnessPath);
  const witness = parseSimcWitness(witnessOutput);

  const contractFinalized = (await runHalFinalize(
    config.toolchain.halSimplicityPath,
    psetBase64,
    0,
    artifact.compiled.program,
    witness
  )) as { pset?: string };
  if (!contractFinalized.pset) {
    throw new ExecutionError("finalize did not return a pset", contractFinalized);
  }
  return contractFinalized.pset;
}

async function buildSignatureMap(
  config: SimplicityClientConfig,
  artifact: SimplicityArtifact,
  psetBase64: string,
  privkeyHex: string,
  witnessConfig?: WitnessConfig
): Promise<Record<string, string>> {
  const primary = (await runHalSighash(
    config.toolchain.halSimplicityPath,
    psetBase64,
    0,
    artifact.compiled.cmr,
    privkeyHex
  )) as { signature?: string };
  if (!primary.signature) {
    throw new ExecutionError("sighash did not return a signature", primary);
  }

  const signatures: Record<string, string> = {
    SIGNATURE: primary.signature,
  };

  for (const [name, signer] of Object.entries(witnessConfig?.signers ?? {})) {
    if (signer.type !== "schnorrPrivkeyHex") {
      throw new UnsupportedFeatureError(`Unsupported witness signer type for '${name}'`);
    }
    const result = (await runHalSighash(
      config.toolchain.halSimplicityPath,
      psetBase64,
      0,
      artifact.compiled.cmr,
      signer.privkeyHex
    )) as { signature?: string };
    if (!result.signature) {
      throw new ExecutionError(`sighash did not return a signature for witness signer '${name}'`, result);
    }
    signatures[`SIGNATURE:${name}`] = result.signature;
  }

  return signatures;
}

function replaceSignaturePlaceholders(value: string, signatures: Record<string, string>): string {
  return value.replace(/\$\{SIGNATURE(?::([A-Z0-9_]+))?\}/g, (_match, name?: string) => {
    const key = name ? `SIGNATURE:${name}` : "SIGNATURE";
    const signature = signatures[key];
    if (!signature) {
      throw new PresetExecutionError(`Missing signature placeholder binding for '${key}'`);
    }
    return `0x${signature}`;
  });
}

function buildWitnessJson(
  artifact: SimplicityArtifact,
  signatures: Record<string, string>,
  witnessConfig?: WitnessConfig
): Record<string, { type: string; value: string }> {
  if (witnessConfig?.source) {
    throw new UnsupportedFeatureError(
      "witness.source is not supported in v0.1.0; use witness.values because simc currently expects JSON witness input"
    );
  }

  const assignments = new Map<string, { type: string; value: string }>();
  for (const [name, assignment] of Object.entries(witnessConfig?.values ?? {})) {
    assignments.set(name, {
      type: assignment.type,
      value: replaceSignaturePlaceholders(assignment.value, signatures),
    });
  }

  const presetId = artifact.source.preset;
  const requiredWitnessFields = presetId
    ? getPresetOrThrow(presetId).executionProfile.requiredWitnessFields
    : ["SIGNER_SIGNATURE"];
  const preset = presetId ? getPresetOrThrow(presetId) : null;
  if (preset) {
    validateWitnessConfig(preset, witnessConfig);
  }

  if (
    requiredWitnessFields.length === 1 &&
    requiredWitnessFields[0] === "SIGNER_SIGNATURE" &&
    !assignments.has("SIGNER_SIGNATURE")
  ) {
    assignments.set("SIGNER_SIGNATURE", { type: "Signature", value: `0x${signatures.SIGNATURE}` });
  }

  for (const field of requiredWitnessFields) {
    if (!assignments.has(field)) {
      throw new PresetExecutionError(`Missing witness value for required field '${field}'`, {
        preset: presetId,
        requiredWitnessFields,
      });
    }
  }

  const witnessJson: Record<string, { type: string; value: string }> = {};
  for (const [name, assignment] of Array.from(assignments.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    witnessJson[name] = assignment;
  }
  return witnessJson;
}

function assertArtifactExecutionSupport(
  artifact: SimplicityArtifact,
  mode: "direct" | "relayer"
): void {
  if (artifact.source.mode !== "preset" || !artifact.source.preset) return;
  const preset = getPresetOrThrow(artifact.source.preset);
  const supported =
    mode === "direct"
      ? preset.executionProfile.supportsDirectExecute
      : preset.executionProfile.supportsRelayerExecute;
  if (!supported) {
    throw new PresetExecutionError(
      `Preset '${preset.id}' does not support ${mode === "direct" ? "direct execute" : "relayer-backed execute"} in v0.1.0`,
      {
        preset: preset.id,
        requiredWitnessFields: preset.executionProfile.requiredWitnessFields,
      }
    );
  }
}

async function executeRelayedGaslessContractCall(
  config: SimplicityClientConfig,
  artifact: SimplicityArtifact,
  input: GaslessExecuteInput,
  relayer: RelayerClient
): Promise<GaslessExecuteResult> {
  assertArtifactExecutionSupport(artifact, "relayer");
  if (!input.fromLabel) {
    throw new ValidationError("fromLabel is required when relayer is provided");
  }
  const request = await relayer.requestSimplicityExecution({
    fromLabel: input.fromLabel,
    artifact: {
      compiled: artifact.compiled,
      source: artifact.source,
      legacy: { params: { minHeight: getArtifactLocktime(artifact) || undefined } },
      network: artifact.network,
    },
    toAddress: input.toAddress,
    sendAmount: input.sendAmount,
    feeSat: input.feeSat,
  });
  const signedPsetBase64 = await signContractInput(
    config,
    artifact,
    request.psetBase64,
    input.signer.privkeyHex,
    input.witness
  );
  const submit = await relayer.submitSimplicityExecution({
    requestId: request.requestId,
    signedPsetBase64,
  });
  return {
    mode: "gasless-execute",
    summary: {
      network: artifact.network,
      purpose: "sdk_gasless_execute_relayer",
      bondDefinitionId: artifact.definition?.definitionType === "bond" ? artifact.definition.definitionId : null,
      periodId: null,
      definition: {
        type: artifact.definition?.definitionType ?? null,
        id: artifact.definition?.definitionId ?? null,
        hash: artifact.definition?.hash ?? null,
        trustMode: artifact.definition?.trustMode ?? null,
        anchorMode: artifact.definition?.anchorMode ?? null,
      },
      state: {
        type: artifact.state?.stateType ?? null,
        id: artifact.state?.stateId ?? null,
        hash: artifact.state?.hash ?? null,
        trustMode: artifact.state?.trustMode ?? null,
        anchorMode: artifact.state?.anchorMode ?? null,
      },
      contract: {
        address: request.detailedSummary.contract.contractAddress,
        cmr: request.detailedSummary.contract.cmr,
        internalKey: request.detailedSummary.contract.internalKey,
        program: request.detailedSummary.contract.program,
        minHeight: getArtifactLocktime(artifact) || undefined,
      },
      expectedLiquidReceiver: request.detailedSummary.expectedReceiver,
      inputs: request.detailedSummary.inputs,
      outputs: request.detailedSummary.outputs.map((output) => ({
        n: output.n,
        value: output.amount,
        asset: output.asset,
        address: output.address,
        scriptPubKeyHex: output.scriptPubKeyHex,
        isFee: output.isFee,
      })),
      fee: request.detailedSummary.fee,
    },
    summaryHash: submit.summaryHash,
    summaryCanonicalJson: request.summaryCanonicalJson,
    psetBase64: signedPsetBase64,
    rawTxHex: submit.rawTxHex,
    txId: submit.txId,
    broadcasted: true,
    contractUtxo: {
      txid: request.summary.contractInput.txid,
      vout: request.summary.contractInput.vout,
      scriptPubKey: "",
      asset: "",
      sat: request.summary.contractInput.amountSat,
      confirmed: true,
    },
    sponsorInput: request.summary.sponsorInput,
  };
}
