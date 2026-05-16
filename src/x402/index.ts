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

type DecodePsbtResult = {
  fees?: Record<string, number>;
  outputs?: Array<{
    amount?: number;
    asset?: string;
    script?: {
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

const LIQUID_TESTNET_USDT_ASSET_ID = "b612eb46313a2cd6ebabd8b7a8eed5696e29898b87a43bff41c94f51acef9d73";
const LIQUID_MAINNET_USDT_ASSET_ID = "ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2";

export const LIQUID_X402_ASSETS: Record<LiquidX402Network, Record<LiquidX402AssetKey, LiquidX402Asset>> = {
  liquidtestnet: {
    lbtc: {
      key: "lbtc",
      label: "Liquid Bitcoin",
      network: "liquidtestnet",
      assetId: "bitcoin",
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
      assetId: "bitcoin",
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
    const decoded = await rpc.call<DecodePsbtResult>("decodepsbt", [payload.psetBase64]);
    const actualSummaryHash = buildLiquidPsetSummaryHash(decoded, requirements);
    if (actualSummaryHash !== payload.summaryHash) {
      return { ...basic, isValid: false, invalidReason: "pset_summary_mismatch" };
    }
    if (!decodedContainsExpectedOutput(decoded, requirements)) {
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
    const mempool = await rpc.call<Array<{ allowed?: boolean; reject_reason?: string }>>(
      "testmempoolaccept",
      [[finalized.hex]],
      input.wallet
    );
    if (mempool[0]?.allowed !== true) {
      return {
        success: false,
        errorCode: mempool[0]?.reject_reason || "mempool_rejected",
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
  decoded: DecodePsbtResult,
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
    outputs: normalizeDecodedOutputs(decoded),
    fees: decoded.fees ?? {},
  }));
}

function decodedContainsExpectedOutput(
  decoded: DecodePsbtResult,
  requirements: LiquidX402PaymentRequirements
): boolean {
  const expectedAmount = atomicToDecimalNumber(requirements.maxAmountRequired, requirements.extra.decimals);
  return (decoded.outputs ?? []).some((output) => (
    String(output.asset ?? "").toLowerCase() === requirements.asset.toLowerCase() &&
    Math.round(Number(output.amount ?? 0) * 10 ** requirements.extra.decimals) ===
      Math.round(expectedAmount * 10 ** requirements.extra.decimals) &&
    String(output.script?.address ?? "") === requirements.payTo
  ));
}

function normalizeDecodedOutputs(decoded: DecodePsbtResult) {
  return (decoded.outputs ?? []).map((output) => ({
    amount: output.amount ?? null,
    asset: output.asset ?? null,
    address: output.script?.address ?? null,
    scriptPubKey: output.script?.hex ?? null,
  }));
}

function coerceRequirements(value: LiquidX402PaymentRequirements | Record<string, unknown>): LiquidX402PaymentRequirements {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("requirements must be an object");
  const raw = value as Record<string, any>;
  const extra = raw.extra && typeof raw.extra === "object" && !Array.isArray(raw.extra) ? raw.extra : {};
  const network = normalizeNetwork(raw.network);
  const asset = resolveLiquidX402Asset(extra.asset ?? raw.asset, network);
  return {
    scheme: LIQUID_X402_SCHEME,
    network,
    maxAmountRequired: normalizeAmountAtomic(raw.maxAmountRequired),
    resource: String(raw.resource ?? ""),
    description: String(raw.description ?? ""),
    mimeType: String(raw.mimeType ?? ""),
    payTo: String(raw.payTo ?? ""),
    maxTimeoutSeconds: normalizeTimeout(raw.maxTimeoutSeconds),
    asset: String(raw.asset ?? extra.assetId ?? asset.assetId),
    extra: {
      paymentRequestId: String(extra.paymentRequestId ?? raw.paymentRequestId ?? ""),
      asset: asset.key,
      assetId: String(extra.assetId ?? raw.asset ?? asset.assetId),
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
  if (value === "lbtc" || value === "bitcoin") return "lbtc";
  if (value === "usdt" || value === "usdt-liquid" || value === "tether") return "usdt";
  throw new Error(`unsupported Liquid x402 asset: ${String(input)}`);
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
