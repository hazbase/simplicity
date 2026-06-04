import { createHash } from "node:crypto";
import { ElementsRpcClient } from "../core/rpc";

export const LIQUID_X402_SCHEME = "exact-liquid-pset" as const;
export const LIQUID_X402_VERSION = 1 as const;
export const LIQUID_X402_DEFAULT_NETWORK = "liquidtestnet" as const;
export const LIQUID_X402_DEFAULT_TIMEOUT_SECONDS = 60;

export type LiquidX402Network = "liquidtestnet" | "liquidv1";
export type LiquidX402AssetKey = "lbtc" | "usdt";

export interface LiquidX402Asset {
  key: LiquidX402AssetKey;
  label: string;
  network: LiquidX402Network;
  assetId: string;
  decimals: number;
  isNative: boolean;
}

export interface LiquidX402RequirementsInput {
  paymentRequestId: string;
  resource: string;
  payTo: string;
  amountAtomic: string | number | bigint;
  network?: LiquidX402Network;
  asset?: LiquidX402AssetKey | string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  expiresAt?: string | Date;
  maxFeeSat?: string | number | bigint;
  metadata?: Record<string, unknown>;
}

export interface LiquidX402PaymentRequirements {
  scheme: typeof LIQUID_X402_SCHEME;
  network: LiquidX402Network;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: {
    paymentRequestId: string;
    asset: LiquidX402AssetKey;
    assetId: string;
    decimals: number;
    expiresAt: string;
    feeAsset: "lbtc";
    feeAssetId?: string;
    maxFeeSat?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface LiquidX402PaymentPayload {
  scheme: typeof LIQUID_X402_SCHEME;
  network: LiquidX402Network;
  paymentRequestId: string;
  asset: LiquidX402AssetKey;
  assetId: string;
  amountAtomic: string;
  payTo: string;
  psetBase64: string;
  summaryHash: string;
  payer?: string;
  expiresAt: string;
}

export interface LiquidX402PreparePsetPaymentInput {
  requirements: LiquidX402PaymentRequirements;
  wallet: string;
  payer?: string;
  locktime?: number;
  sign?: boolean;
}

export interface LiquidX402PreparePsetPaymentResult {
  paymentPayload: LiquidX402PaymentPayload;
  xPayment: string;
  psetBase64: string;
  summaryHash: string;
}

export interface LiquidX402BuildPaymentFromPsetInput {
  requirements: LiquidX402PaymentRequirements | Record<string, unknown>;
  psetBase64: string;
  decoded?: DecodePsbtResult;
  payer?: string;
  summaryHash?: string;
}

export interface LiquidX402PrepareLwkWasmPaymentInput {
  requirements: LiquidX402PaymentRequirements | Record<string, unknown>;
  mnemonic: string;
  payer?: string;
  esploraUrl?: string;
  waterfalls?: boolean;
  concurrency?: number;
  utxoOnly?: boolean;
  scan?: boolean;
  scanToIndex?: number;
  feeRate?: number;
  finalize?: boolean;
  lwk?: LiquidX402LwkWasmModule;
  importLwk?: () => Promise<LiquidX402LwkWasmModule>;
}

export type LiquidX402PrepareLwkWasmPaymentResult = LiquidX402PreparePsetPaymentResult & {
  descriptor: string;
  dwid?: string;
};

export interface LiquidX402DeriveLwkWasmAddressInput {
  mnemonic: string;
  network?: LiquidX402Network;
  index?: number;
  lwk?: LiquidX402LwkWasmModule;
  importLwk?: () => Promise<LiquidX402LwkWasmModule>;
}

export interface LiquidX402DeriveLwkWasmAddressResult {
  network: LiquidX402Network;
  address: string;
  unconfidentialAddress?: string;
  index: number;
  isBlinded?: boolean;
  descriptor: string;
  dwid?: string;
  policyAsset?: string;
}

export interface LiquidX402VerifyPaymentInput {
  requirements: LiquidX402PaymentRequirements | Record<string, unknown>;
  paymentPayload: LiquidX402PaymentPayload | Record<string, unknown>;
  now?: Date;
}

export interface LiquidX402VerifyPaymentResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string | null;
  network?: LiquidX402Network;
  paymentRequestId?: string;
  summaryHash?: string;
}

export interface LiquidX402SettlePaymentInput extends LiquidX402VerifyPaymentInput {
  wallet?: string;
  broadcast?: boolean;
}

export interface LiquidX402SettlePaymentResult {
  success: boolean;
  errorCode?: string;
  txId?: string;
  transactionHash?: string;
  rawTxHex?: string;
  summaryHash?: string;
}

export type DecodePsbtResult = {
  fees?: Record<string, number>;
  outputs?: Array<{
    amount?: number;
    asset?: string;
    script?: {
      address?: string;
      hex?: string;
    };
    scriptPubKey?: {
      address?: string;
      hex?: string;
    };
  }>;
};

type FinalizePsbtResult = {
  complete?: boolean;
  hex?: string;
  psbt?: string;
};

type ValidateAddressResult = {
  isvalid?: boolean;
  address?: string;
  unconfidential?: string;
  confidential?: string;
  scriptPubKey?: string;
};

type ExpectedLiquidOutputTarget = {
  addresses: Set<string>;
  scriptHexes: Set<string>;
};

export type LiquidX402LwkWasmModule = {
  Address: {
    new (value: string): any;
    parse?: (value: string, network: any) => any;
  };
  AssetId: {
    new (value: string): any;
    fromString?: (value: string) => any;
  };
  EsploraClient: new (network: any, url: string, waterfalls: boolean, concurrency: number, utxoOnly: boolean) => any;
  Mnemonic: new (value: string) => any;
  Network: {
    mainnet: () => any;
    testnet: () => any;
  };
  Signer: new (mnemonic: any, network: any) => any;
  Wollet: new (network: any, descriptor: any) => any;
};

const LIQUID_TESTNET_USDT_ASSET_ID = "b612eb46313a2cd6ebabd8b7a8eed5696e29898b87a43bff41c94f51acef9d73";
const LIQUID_MAINNET_USDT_ASSET_ID = "ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2";
const LIQUID_TESTNET_LBTC_ASSET_ID = "144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49";
const LIQUID_MAINNET_LBTC_ASSET_ID = "6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d";

export const LIQUID_X402_ASSETS: Record<LiquidX402Network, Record<LiquidX402AssetKey, LiquidX402Asset>> = {
  liquidtestnet: {
    lbtc: {
      key: "lbtc",
      label: "Liquid Bitcoin",
      network: "liquidtestnet",
      assetId: LIQUID_TESTNET_LBTC_ASSET_ID,
      decimals: 8,
      isNative: true,
    },
    usdt: {
      key: "usdt",
      label: "Tether USDt",
      network: "liquidtestnet",
      assetId: LIQUID_TESTNET_USDT_ASSET_ID,
      decimals: 8,
      isNative: false,
    },
  },
  liquidv1: {
    lbtc: {
      key: "lbtc",
      label: "Liquid Bitcoin",
      network: "liquidv1",
      assetId: LIQUID_MAINNET_LBTC_ASSET_ID,
      decimals: 8,
      isNative: true,
    },
    usdt: {
      key: "usdt",
      label: "Tether USDt",
      network: "liquidv1",
      assetId: LIQUID_MAINNET_USDT_ASSET_ID,
      decimals: 8,
      isNative: false,
    },
  },
};

export function listLiquidX402Assets(network?: LiquidX402Network): LiquidX402Asset[] {
  if (network) return Object.values(LIQUID_X402_ASSETS[network]);
  return Object.values(LIQUID_X402_ASSETS).flatMap((assets) => Object.values(assets));
}

export function resolveLiquidX402Asset(
  asset: LiquidX402AssetKey | string,
  network: LiquidX402Network = LIQUID_X402_DEFAULT_NETWORK
): LiquidX402Asset {
  const key = normalizeAssetKey(asset);
  const resolved = LIQUID_X402_ASSETS[network]?.[key];
  if (!resolved) {
    throw new Error(`unsupported Liquid x402 asset: ${asset} on ${network}`);
  }
  return resolved;
}

export function buildLiquidX402Requirements(input: LiquidX402RequirementsInput): LiquidX402PaymentRequirements {
  const network = normalizeNetwork(input.network ?? LIQUID_X402_DEFAULT_NETWORK);
  const asset = resolveLiquidX402Asset(input.asset ?? "usdt", network);
  const amountAtomic = normalizeAmountAtomic(input.amountAtomic);
  const expiresAt = normalizeExpiresAt(input.expiresAt, input.maxTimeoutSeconds);
  const description = String(input.description ?? "").trim() || "Unlock resource";
  const mimeType = String(input.mimeType ?? "").trim() || "application/octet-stream";
  const maxTimeoutSeconds = normalizeTimeout(input.maxTimeoutSeconds);
  const paymentRequestId = String(input.paymentRequestId ?? "").trim();
  if (!paymentRequestId) throw new Error("paymentRequestId is required");
  const resource = String(input.resource ?? "").trim();
  if (!resource) throw new Error("resource is required");
  const payTo = String(input.payTo ?? "").trim();
  if (!payTo) throw new Error("payTo is required");

  return {
    scheme: LIQUID_X402_SCHEME,
    network,
    maxAmountRequired: amountAtomic,
    resource,
    description,
    mimeType,
    payTo,
    maxTimeoutSeconds,
    asset: asset.assetId,
    extra: {
      paymentRequestId,
      asset: asset.key,
      assetId: asset.assetId,
      decimals: asset.decimals,
      expiresAt,
      feeAsset: "lbtc",
      feeAssetId: LIQUID_X402_ASSETS[network].lbtc.assetId,
      ...(input.maxFeeSat !== undefined ? { maxFeeSat: normalizeAmountAtomic(input.maxFeeSat) } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  };
}

export function encodeLiquidXPayment(payload: LiquidX402PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeLiquidXPayment(raw: string): LiquidX402PaymentPayload | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (String(parsed.scheme ?? "") !== LIQUID_X402_SCHEME) return null;
    return parsed as LiquidX402PaymentPayload;
  } catch {
    return null;
  }
}

export async function prepareLiquidX402PsetPayment(
  rpc: ElementsRpcClient,
  input: LiquidX402PreparePsetPaymentInput
): Promise<LiquidX402PreparePsetPaymentResult> {
  const requirements = coerceRequirements(input.requirements);
  const amount = atomicToDecimalNumber(requirements.maxAmountRequired, requirements.extra.decimals);
  const outputs: Array<Record<string, number | string>> = [
    { [requirements.payTo]: amount, asset: requirements.asset },
  ];
  const pset = await rpc.call<string>(
    "createpsbt",
    [[], outputs, input.locktime ?? 0, true],
    input.wallet
  );
  const updatedPset = await rpc.call<string>("utxoupdatepsbt", [pset], input.wallet);
  const signed = input.sign === false
    ? updatedPset
    : (await rpc.call<{ psbt?: string }>("walletprocesspsbt", [updatedPset, true, "ALL", true], input.wallet)).psbt ?? updatedPset;
  const decoded = await rpc.call<DecodePsbtResult>("decodepsbt", [signed], input.wallet);
  const summaryHash = buildLiquidPsetSummaryHash(decoded, requirements);
  const paymentPayload: LiquidX402PaymentPayload = {
    scheme: LIQUID_X402_SCHEME,
    network: requirements.network,
    paymentRequestId: requirements.extra.paymentRequestId,
    asset: requirements.extra.asset,
    assetId: requirements.asset,
    amountAtomic: requirements.maxAmountRequired,
    payTo: requirements.payTo,
    psetBase64: signed,
    summaryHash,
    ...(input.payer ? { payer: input.payer } : {}),
    expiresAt: requirements.extra.expiresAt,
  };
  return {
    paymentPayload,
    xPayment: encodeLiquidXPayment(paymentPayload),
    psetBase64: signed,
    summaryHash,
  };
}

export function buildLiquidX402PaymentFromPset(
  input: LiquidX402BuildPaymentFromPsetInput
): LiquidX402PreparePsetPaymentResult {
  const requirements = coerceRequirements(input.requirements);
  const psetBase64 = String(input.psetBase64 ?? "").trim();
  if (!psetBase64) throw new Error("psetBase64 is required");
  const summaryHash = input.summaryHash ?? buildLiquidPsetSummaryHash(input.decoded ?? {}, requirements);
  const paymentPayload: LiquidX402PaymentPayload = {
    scheme: LIQUID_X402_SCHEME,
    network: requirements.network,
    paymentRequestId: requirements.extra.paymentRequestId,
    asset: requirements.extra.asset,
    assetId: requirements.asset,
    amountAtomic: requirements.maxAmountRequired,
    payTo: requirements.payTo,
    psetBase64,
    summaryHash,
    ...(input.payer ? { payer: input.payer } : {}),
    expiresAt: requirements.extra.expiresAt,
  };
  return {
    paymentPayload,
    xPayment: encodeLiquidXPayment(paymentPayload),
    psetBase64,
    summaryHash,
  };
}

export async function prepareLiquidX402LwkWasmPayment(
  input: LiquidX402PrepareLwkWasmPaymentInput
): Promise<LiquidX402PrepareLwkWasmPaymentResult> {
  const requirements = coerceRequirements(input.requirements);
  ensureLwkWasmNodeTimerCompat();
  const lwk = input.lwk ?? await loadLwkWasm(input.importLwk);
  const network = requirements.network === "liquidv1" ? lwk.Network.mainnet() : lwk.Network.testnet();
  const mnemonic = new lwk.Mnemonic(input.mnemonic);
  const signer = new lwk.Signer(mnemonic, network);
  const descriptor = signer.wpkhSlip77Descriptor();
  const wollet = new lwk.Wollet(network, descriptor);
  const client = input.esploraUrl
    ? new lwk.EsploraClient(
      network,
      input.esploraUrl,
      input.waterfalls ?? false,
      input.concurrency ?? 4,
      input.utxoOnly ?? false,
    )
    : network.defaultEsploraClient();

  if (input.scan !== false) {
    const update = input.scanToIndex !== undefined
      ? await client.fullScanToIndex(wollet, input.scanToIndex)
      : await client.fullScan(wollet);
    if (update) wollet.applyUpdate(update);
  }

  let builder = network.txBuilder();
  if (input.feeRate !== undefined) builder = builder.feeRate(input.feeRate);
  const recipient = parseLwkAddress(lwk, requirements.payTo, network);
  const amount = BigInt(requirements.maxAmountRequired);
  if (requirements.extra.asset === "lbtc") {
    builder = builder.addLbtcRecipient(recipient, amount);
  } else if (typeof recipient.isBlinded === "function" && recipient.isBlinded() === false && typeof builder.addExplicitRecipient === "function") {
    builder = builder.addExplicitRecipient(recipient, amount, parseLwkAssetId(lwk, requirements.asset));
  } else {
    builder = builder.addRecipient(recipient, amount, parseLwkAssetId(lwk, requirements.asset));
  }

  const unsigned = builder.finish(wollet);
  const signed = signer.sign(unsigned);
  const pset = input.finalize === false ? signed : wollet.finalize(signed);
  const decoded = decodeLwkPsetForX402(pset, wollet);
  const payment = buildLiquidX402PaymentFromPset({
    requirements,
    psetBase64: pset.toString(),
    decoded,
    payer: input.payer,
  });

  return {
    ...payment,
    descriptor: descriptor.toString(),
    ...(typeof wollet.dwid === "function" ? { dwid: wollet.dwid() } : {}),
  };
}

export async function deriveLiquidX402LwkWasmAddress(
  input: LiquidX402DeriveLwkWasmAddressInput
): Promise<LiquidX402DeriveLwkWasmAddressResult> {
  const networkKey = normalizeNetwork(input.network ?? LIQUID_X402_DEFAULT_NETWORK);
  ensureLwkWasmNodeTimerCompat();
  const lwk = input.lwk ?? await loadLwkWasm(input.importLwk);
  const network = networkKey === "liquidv1" ? lwk.Network.mainnet() : lwk.Network.testnet();
  const mnemonic = new lwk.Mnemonic(input.mnemonic);
  const signer = new lwk.Signer(mnemonic, network);
  const descriptor = signer.wpkhSlip77Descriptor();
  const wollet = new lwk.Wollet(network, descriptor);
  const addressResult = wollet.address(input.index ?? null);
  const address = addressResult.address();
  return {
    network: networkKey,
    address: address.toString(),
    ...(typeof address.toUnconfidential === "function" ? { unconfidentialAddress: address.toUnconfidential().toString() } : {}),
    index: typeof addressResult.index === "function" ? addressResult.index() : input.index ?? 0,
    ...(typeof address.isBlinded === "function" ? { isBlinded: address.isBlinded() } : {}),
    descriptor: descriptor.toString(),
    ...(typeof wollet.dwid === "function" ? { dwid: wollet.dwid() } : {}),
    ...(typeof network.policyAsset === "function" ? { policyAsset: network.policyAsset().toString() } : {}),
  };
}

export async function verifyLiquidX402Payment(
  rpc: ElementsRpcClient | null,
  input: LiquidX402VerifyPaymentInput
): Promise<LiquidX402VerifyPaymentResult> {
  const requirements = coerceRequirements(input.requirements);
  const payload = coercePaymentPayload(input.paymentPayload);
  const basic = verifyLiquidX402PayloadFields(requirements, payload, input.now);
  if (!basic.isValid) return basic;
  if (!rpc) {
    return basic;
  }
  try {
    const expectedTarget = await resolveExpectedLiquidOutputTarget(rpc, requirements);
    const decoded = await rpc.call<DecodePsbtResult>("decodepsbt", [payload.psetBase64]);
    const actualSummaryHash = buildLiquidPsetSummaryHash(decoded, requirements);
    if (actualSummaryHash !== payload.summaryHash) {
      return { ...basic, isValid: false, invalidReason: "pset_summary_mismatch" };
    }
    if (!decodedContainsExpectedOutput(decoded, requirements, expectedTarget)) {
      return { ...basic, isValid: false, invalidReason: "pset_expected_output_missing" };
    }
    if (!decodedFeeWithinCap(decoded, requirements)) {
      return { ...basic, isValid: false, invalidReason: "fee_too_high" };
    }
    return basic;
  } catch {
    return { ...basic, isValid: false, invalidReason: "pset_decode_failed" };
  }
}

export async function settleLiquidX402Payment(
  rpc: ElementsRpcClient,
  input: LiquidX402SettlePaymentInput
): Promise<LiquidX402SettlePaymentResult> {
  const verification = await verifyLiquidX402Payment(rpc, input);
  if (!verification.isValid) {
    return { success: false, errorCode: verification.invalidReason ?? "payment_verification_failed" };
  }
  const payload = coercePaymentPayload(input.paymentPayload);
  try {
    const finalized = await rpc.call<FinalizePsbtResult>("finalizepsbt", [payload.psetBase64, true], input.wallet);
    if (!finalized.complete || !finalized.hex) {
      return { success: false, errorCode: "pset_not_complete", summaryHash: payload.summaryHash };
    }
    const mempool = await rpc.call<Array<{ allowed?: boolean; reject_reason?: string; "reject-reason"?: string }>>(
      "testmempoolaccept",
      [[finalized.hex]],
      input.wallet
    );
    if (mempool[0]?.allowed !== true) {
      return {
        success: false,
        errorCode: mempoolRejectReason(mempool[0]),
        rawTxHex: finalized.hex,
        summaryHash: payload.summaryHash,
      };
    }
    if (input.broadcast === false) {
      return { success: true, rawTxHex: finalized.hex, summaryHash: payload.summaryHash };
    }
    const txId = await rpc.call<string>("sendrawtransaction", [finalized.hex], input.wallet);
    return {
      success: true,
      txId,
      transactionHash: txId,
      rawTxHex: finalized.hex,
      summaryHash: payload.summaryHash,
    };
  } catch {
    return { success: false, errorCode: "settlement_rpc_failed", summaryHash: payload.summaryHash };
  }
}

export function verifyLiquidX402PayloadFields(
  requirements: LiquidX402PaymentRequirements | Record<string, unknown>,
  payload: LiquidX402PaymentPayload | Record<string, unknown>,
  now: Date = new Date()
): LiquidX402VerifyPaymentResult {
  const req = coerceRequirements(requirements);
  const parsed = coercePaymentPayload(payload);
  const base = {
    payer: parsed.payer ?? null,
    network: parsed.network,
    paymentRequestId: parsed.paymentRequestId,
    summaryHash: parsed.summaryHash,
  };
  if (parsed.scheme !== LIQUID_X402_SCHEME) return { ...base, isValid: false, invalidReason: "unsupported_scheme" };
  if (parsed.network !== req.network) return { ...base, isValid: false, invalidReason: "network_mismatch" };
  if (parsed.paymentRequestId !== req.extra.paymentRequestId) {
    return { ...base, isValid: false, invalidReason: "payment_request_mismatch" };
  }
  if (parsed.asset !== req.extra.asset || parsed.assetId !== req.asset) {
    return { ...base, isValid: false, invalidReason: "asset_mismatch" };
  }
  if (parsed.amountAtomic !== req.maxAmountRequired) {
    return { ...base, isValid: false, invalidReason: "amount_mismatch" };
  }
  if (parsed.payTo !== req.payTo) return { ...base, isValid: false, invalidReason: "recipient_mismatch" };
  if (!parsed.psetBase64) return { ...base, isValid: false, invalidReason: "pset_missing" };
  if (!parsed.summaryHash) return { ...base, isValid: false, invalidReason: "summary_hash_missing" };
  if (new Date(parsed.expiresAt).getTime() <= now.getTime()) {
    return { ...base, isValid: false, invalidReason: "payment_expired" };
  }
  return { ...base, isValid: true };
}

export function buildLiquidPsetSummaryHash(
  _decoded: DecodePsbtResult,
  requirements: LiquidX402PaymentRequirements | Record<string, unknown>
): string {
  const req = coerceRequirements(requirements);
  return sha256Hex(stableStringify({
    scheme: LIQUID_X402_SCHEME,
    network: req.network,
    paymentRequestId: req.extra.paymentRequestId,
    asset: req.extra.asset,
    assetId: req.asset,
    amountAtomic: req.maxAmountRequired,
    payTo: req.payTo,
    expectedOutput: {
      amountAtomic: req.maxAmountRequired,
      assetId: req.asset,
      payTo: req.payTo,
    },
    feeAsset: req.extra.feeAsset,
    feeAssetId: req.extra.feeAssetId ?? LIQUID_X402_ASSETS[req.network].lbtc.assetId,
    maxFeeSat: req.extra.maxFeeSat ?? null,
  }));
}

function decodedContainsExpectedOutput(
  decoded: DecodePsbtResult,
  requirements: LiquidX402PaymentRequirements,
  expectedTarget: ExpectedLiquidOutputTarget = buildFallbackExpectedLiquidOutputTarget(requirements)
): boolean {
  const expectedAmount = atomicToDecimalNumber(requirements.maxAmountRequired, requirements.extra.decimals);
  return (decoded.outputs ?? []).some((output) => (
    String(output.asset ?? "").toLowerCase() === requirements.asset.toLowerCase() &&
    Math.round(Number(output.amount ?? 0) * 10 ** requirements.extra.decimals) ===
      Math.round(expectedAmount * 10 ** requirements.extra.decimals) &&
    decodedOutputMatchesLiquidTarget(output, expectedTarget)
  ));
}

async function resolveExpectedLiquidOutputTarget(
  rpc: ElementsRpcClient,
  requirements: LiquidX402PaymentRequirements
): Promise<ExpectedLiquidOutputTarget> {
  const target = buildFallbackExpectedLiquidOutputTarget(requirements);
  try {
    const info = await rpc.call<ValidateAddressResult>("validateaddress", [requirements.payTo]);
    if (info?.isvalid !== false) {
      addNormalizedAddress(target.addresses, info.address);
      addNormalizedAddress(target.addresses, info.unconfidential);
      addNormalizedAddress(target.addresses, info.confidential);
      addNormalizedHex(target.scriptHexes, info.scriptPubKey);
    }
  } catch {
    // Older or mocked RPC clients may not expose validateaddress. Exact payTo
    // matching remains safe for unconfidential outputs in that case.
  }
  return target;
}

function buildFallbackExpectedLiquidOutputTarget(
  requirements: LiquidX402PaymentRequirements
): ExpectedLiquidOutputTarget {
  const target: ExpectedLiquidOutputTarget = { addresses: new Set(), scriptHexes: new Set() };
  addNormalizedAddress(target.addresses, requirements.payTo);
  return target;
}

function decodedOutputMatchesLiquidTarget(
  output: NonNullable<DecodePsbtResult["outputs"]>[number],
  expectedTarget: ExpectedLiquidOutputTarget
): boolean {
  const address = output.script?.address ?? output.scriptPubKey?.address;
  const scriptHex = output.script?.hex ?? output.scriptPubKey?.hex;
  return (
    expectedTarget.addresses.has(normalizeAddressForComparison(address)) ||
    expectedTarget.scriptHexes.has(normalizeHexForComparison(scriptHex))
  );
}

function addNormalizedAddress(target: Set<string>, value: unknown): void {
  const normalized = normalizeAddressForComparison(value);
  if (normalized) target.add(normalized);
}

function addNormalizedHex(target: Set<string>, value: unknown): void {
  const normalized = normalizeHexForComparison(value);
  if (normalized) target.add(normalized);
}

function normalizeAddressForComparison(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeHexForComparison(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/^0x/u, "");
}

function mempoolRejectReason(result: unknown): string {
  if (!result || typeof result !== "object") return "mempool_rejected";
  const raw = result as Record<string, unknown>;
  return String(raw["reject-reason"] ?? raw.reject_reason ?? raw.error ?? "mempool_rejected").trim() || "mempool_rejected";
}

function coerceRequirements(value: LiquidX402PaymentRequirements | Record<string, unknown>): LiquidX402PaymentRequirements {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("requirements must be an object");
  const raw = value as Record<string, any>;
  const extra = raw.extra && typeof raw.extra === "object" && !Array.isArray(raw.extra) ? raw.extra : {};
  const network = normalizeNetwork(raw.network);
  const asset = resolveLiquidX402Asset(extra.asset ?? raw.asset, network);
  const rawAssetId = String(raw.asset ?? extra.assetId ?? asset.assetId);
  const assetId = isLiquidAssetAlias(rawAssetId) ? asset.assetId : rawAssetId;
  return {
    scheme: LIQUID_X402_SCHEME,
    network,
    maxAmountRequired: normalizeAmountAtomic(raw.maxAmountRequired),
    resource: String(raw.resource ?? ""),
    description: String(raw.description ?? ""),
    mimeType: String(raw.mimeType ?? ""),
    payTo: String(raw.payTo ?? ""),
    maxTimeoutSeconds: normalizeTimeout(raw.maxTimeoutSeconds),
    asset: assetId,
    extra: {
      paymentRequestId: String(extra.paymentRequestId ?? raw.paymentRequestId ?? ""),
      asset: asset.key,
      assetId,
      decimals: Number(extra.decimals ?? asset.decimals),
      expiresAt: String(extra.expiresAt ?? ""),
      feeAsset: "lbtc",
      feeAssetId: String(extra.feeAssetId ?? LIQUID_X402_ASSETS[network].lbtc.assetId),
      ...(extra.maxFeeSat !== undefined ? { maxFeeSat: normalizeAmountAtomic(extra.maxFeeSat) } : {}),
      ...(extra.metadata ? { metadata: extra.metadata as Record<string, unknown> } : {}),
    },
  };
}

function decodedFeeWithinCap(
  decoded: DecodePsbtResult,
  requirements: LiquidX402PaymentRequirements
): boolean {
  if (requirements.extra.maxFeeSat === undefined) return true;
  const maxFeeSat = BigInt(requirements.extra.maxFeeSat);
  const feeSat = Object.values(decoded.fees ?? {}).reduce((sum, amount) => {
    const sat = Math.round(Number(amount) * 100_000_000);
    return sum + BigInt(Number.isFinite(sat) ? sat : 0);
  }, 0n);
  return feeSat <= maxFeeSat;
}

async function loadLwkWasm(importer?: () => Promise<LiquidX402LwkWasmModule>): Promise<LiquidX402LwkWasmModule> {
  ensureLwkWasmNodeTimerCompat();
  if (importer) return importer();
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<LiquidX402LwkWasmModule>;
  const failures: string[] = [];
  for (const specifier of ["lwk_wasm", "lwk_node"]) {
    try {
      const imported = await dynamicImport(specifier) as LiquidX402LwkWasmModule | { default?: LiquidX402LwkWasmModule };
      return (imported as { default?: LiquidX402LwkWasmModule }).default ?? imported as LiquidX402LwkWasmModule;
    } catch (error) {
      failures.push(`${specifier}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    "lwk_wasm or lwk_node is required for lightweight Liquid x402 payments. " +
    "Install one of them in the consuming app and bundle its WASM artifact when needed. " +
    `Import failed: ${failures.join("; ")}`
  );
}

function ensureLwkWasmNodeTimerCompat(): void {
  const scope = globalThis as any;
  if (typeof scope.window === "undefined" && typeof scope.setTimeout === "function") {
    scope.window = scope;
  }
  if (typeof scope.Window === "undefined" && typeof scope.window !== "undefined") {
    scope.Window = Object;
  }
}

function parseLwkAddress(lwk: LiquidX402LwkWasmModule, address: string, network: any) {
  if (typeof lwk.Address.parse === "function") {
    try {
      return lwk.Address.parse(address, network);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("non-blinded")) throw error;
    }
  }
  return new lwk.Address(address);
}

function parseLwkAssetId(lwk: LiquidX402LwkWasmModule, assetId: string) {
  return typeof lwk.AssetId.fromString === "function" ? lwk.AssetId.fromString(assetId) : new lwk.AssetId(assetId);
}

function decodeLwkPsetForX402(pset: any, wollet: any): DecodePsbtResult {
  const details = wollet.psetDetails(pset);
  const balance = details.balance();
  const recipients = typeof balance.recipients === "function" ? balance.recipients() : [];
  const fee = typeof balance.fee === "function" ? balance.fee() : 0n;
  return {
    fees: { bitcoin: atomicToDecimalNumber(String(fee), 8) },
    outputs: recipients.map((recipient: any) => ({
      amount: recipient.value() === undefined ? undefined : atomicToDecimalNumber(String(recipient.value()), 8),
      asset: recipient.asset()?.toString(),
      script: {
        address: recipient.address()?.toString(),
      },
    })),
  };
}

function coercePaymentPayload(value: LiquidX402PaymentPayload | Record<string, unknown>): LiquidX402PaymentPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("payment payload must be an object");
  const raw = value as Record<string, unknown>;
  return {
    scheme: LIQUID_X402_SCHEME,
    network: normalizeNetwork(raw.network),
    paymentRequestId: String(raw.paymentRequestId ?? ""),
    asset: normalizeAssetKey(String(raw.asset ?? "")),
    assetId: String(raw.assetId ?? ""),
    amountAtomic: normalizeAmountAtomic(raw.amountAtomic as string | number | bigint),
    payTo: String(raw.payTo ?? ""),
    psetBase64: String(raw.psetBase64 ?? ""),
    summaryHash: String(raw.summaryHash ?? ""),
    ...(raw.payer ? { payer: String(raw.payer) } : {}),
    expiresAt: String(raw.expiresAt ?? ""),
  };
}

function normalizeNetwork(input: unknown): LiquidX402Network {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "liquidtestnet" || value === "liquidv1") return value;
  throw new Error(`unsupported Liquid x402 network: ${String(input)}`);
}

function normalizeAssetKey(input: unknown): LiquidX402AssetKey {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "lbtc" || value === "bitcoin" || value === LIQUID_TESTNET_LBTC_ASSET_ID || value === LIQUID_MAINNET_LBTC_ASSET_ID) {
    return "lbtc";
  }
  if (
    value === "usdt" ||
    value === "usdt-liquid" ||
    value === "tether" ||
    value === LIQUID_TESTNET_USDT_ASSET_ID ||
    value === LIQUID_MAINNET_USDT_ASSET_ID
  ) {
    return "usdt";
  }
  throw new Error(`unsupported Liquid x402 asset: ${String(input)}`);
}

function isLiquidAssetAlias(input: unknown): boolean {
  const value = String(input ?? "").trim().toLowerCase();
  return value === "lbtc" ||
    value === "bitcoin" ||
    value === "usdt" ||
    value === "usdt-liquid" ||
    value === "tether";
}

function normalizeAmountAtomic(input: string | number | bigint): string {
  const raw = typeof input === "bigint" ? input.toString() : String(input ?? "").trim();
  if (!/^\d+$/u.test(raw)) throw new Error("amountAtomic must be an integer string");
  return BigInt(raw).toString();
}

function normalizeTimeout(input: unknown): number {
  const parsed = Number(input ?? LIQUID_X402_DEFAULT_TIMEOUT_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : LIQUID_X402_DEFAULT_TIMEOUT_SECONDS;
}

function normalizeExpiresAt(expiresAt: string | Date | undefined, timeoutSeconds: number | undefined): string {
  if (expiresAt instanceof Date) return expiresAt.toISOString();
  const raw = String(expiresAt ?? "").trim();
  if (raw) return new Date(raw).toISOString();
  return new Date(Date.now() + normalizeTimeout(timeoutSeconds) * 1000).toISOString();
}

function atomicToDecimalNumber(amountAtomic: string, decimals: number): number {
  const amount = BigInt(amountAtomic);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const frac = amount % scale;
  return Number(`${whole}.${frac.toString().padStart(decimals, "0")}`);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
