import { existsSync } from "node:fs";
import path from "node:path";
import type { SimplicityClient } from "../client/SimplicityClient";
import { ValidationError } from "../core/errors";
import { executeMultiAssetContractCall, inspectMultiAssetContractCall } from "../core/executor";
import {
  analyzeOutputRawFields,
  computeExplicitV1OutputHash,
  computeRawOutputV1Hash,
  getScriptPubKeyHexViaRpc,
  hashHexBytes,
  isExplicitV1OutputForm,
  normalizeOutputForm,
  normalizeOutputRawFields,
  resolveExplicitAssetHex,
} from "../core/outputBinding";
import { sha256HexUtf8, stableStringify } from "../core/summary";
import type {
  BondOutputBindingMode,
  MultiAssetContractCallInput,
  MultiAssetContractInput,
  MultiAssetContractOutput,
  MultiAssetExecuteResult,
  MultiAssetInspectResult,
  OutputForm,
  OutputRawFields,
  SignerConfig,
  SimplicityArtifact,
  WitnessConfig,
} from "../core/types";
import {
  buildLiquidX402Requirements,
  resolveLiquidX402Asset,
  verifyLiquidX402Payment,
  type LiquidX402AssetKey,
  type LiquidX402Network,
  type LiquidX402PaymentPayload,
  type LiquidX402PaymentRequirements,
  type LiquidX402VerifyPaymentResult,
} from "../x402";

export const RWA_DVP_PURCHASE_SCHEMA_VERSION = "rwa-dvp-purchase/v1" as const;
export const RWA_DVP_DELIVERY_CLAIM_SCHEMA_VERSION = "rwa-dvp-delivery-claim/v1" as const;
export const RWA_DVP_REFUND_CLAIM_SCHEMA_VERSION = "rwa-dvp-refund-claim/v1" as const;
export const RWA_DVP_VERIFICATION_SCHEMA_VERSION = "rwa-dvp-verification/v1" as const;
export const RWA_DVP_EVIDENCE_SCHEMA_VERSION = "rwa-dvp-evidence/v1" as const;

export type RwaDvpPaymentAsset = LiquidX402AssetKey;

export interface RwaDvpEvmLockReference {
  chainId: number;
  lockManager: string;
  orderKey: string;
  token?: string;
  backingOwner?: string;
  classId?: string;
  nonceId?: string;
  amountAtomic: string;
  termsHash?: string;
  lockTxHash?: string;
  consumeTxHash?: string;
  releaseTxHash?: string;
}

export interface RwaDvpPurchaseDefinition {
  schemaVersion: typeof RWA_DVP_PURCHASE_SCHEMA_VERSION;
  purchaseId: string;
  network: LiquidX402Network;
  evmLock: RwaDvpEvmLockReference;
  payment: {
    asset: RwaDvpPaymentAsset;
    assetId: string;
    amountAtomic: string;
    escrowAddress: string;
    treasuryAddress: string;
  };
  delivery: {
    assetId: string;
    amountAtomic: string;
    recipientAddress: string;
  };
  refund: {
    recipientAddress: string;
    after: string;
  };
  expiresAt: string;
  metadata?: Record<string, unknown>;
}

export interface RwaDvpDefinePurchaseInput {
  purchaseId: string;
  network?: LiquidX402Network;
  evmLock: RwaDvpEvmLockReference;
  payment: {
    asset: RwaDvpPaymentAsset;
    assetId?: string;
    amountAtomic: string | number | bigint;
    escrowAddress: string;
    treasuryAddress?: string;
  };
  delivery: {
    assetId: string;
    amountAtomic: string | number | bigint;
    recipientAddress: string;
  };
  refund: {
    recipientAddress: string;
    after: string | Date;
  };
  expiresAt: string | Date;
  metadata?: Record<string, unknown>;
}

export interface RwaDvpSummary {
  canonicalJson: string;
  hash: string;
}

export interface RwaDvpPreparedPurchase {
  definition: RwaDvpPurchaseDefinition;
  summary: RwaDvpSummary;
  termsHash: string;
  policyHash: string;
}

export interface RwaDvpBuildPaymentRequirementsInput {
  purchase: RwaDvpPurchaseDefinition;
  resource: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  maxFeeSat?: string | number | bigint;
  metadata?: Record<string, unknown>;
}

export interface RwaDvpVerifyPaymentPsetInput {
  purchase: RwaDvpPurchaseDefinition;
  requirements: LiquidX402PaymentRequirements | Record<string, unknown>;
  paymentPayload: LiquidX402PaymentPayload | Record<string, unknown>;
  now?: Date;
  verifyPsetOutputs?: boolean;
}

export interface RwaDvpDeliveryClaimDescriptor {
  schemaVersion: typeof RWA_DVP_DELIVERY_CLAIM_SCHEMA_VERSION;
  purchaseId: string;
  network: LiquidX402Network;
  termsHash: string;
  policyHash: string;
  mode: "simplicity-multi-asset-claim" | "operator-wallet-delivery-bridge";
  paymentInput?: {
    txid: string;
    vout?: number;
    assetId: string;
    amountAtomic: string;
  };
  operatorRwaInput?: {
    txid?: string;
    vout?: number;
    assetId: string;
    amountAtomic: string;
    reissuanceAllowed?: boolean;
  };
  outputs: {
    paymentToTreasury: {
      recipientAddress: string;
      assetId: string;
      amountAtomic: string;
      outputIndex: number;
    };
    rwaToBuyer: {
      recipientAddress: string;
      assetId: string;
      amountAtomic: string;
      outputIndex: number;
      outputBindingMode: BondOutputBindingMode;
      rawOutput?: Partial<OutputRawFields>;
    };
  };
  fee: {
    asset: "lbtc";
    maxFeeSat: number;
    feeOutputIndex?: number;
  };
  fundingTxid?: string;
  deliveryTxid?: string;
  createdAt: string;
}

export interface RwaDvpPrepareDeliveryClaimInput {
  purchase: RwaDvpPurchaseDefinition;
  fundingTxid?: string;
  paymentInput?: RwaDvpDeliveryClaimDescriptor["paymentInput"];
  operatorRwaInput?: RwaDvpDeliveryClaimDescriptor["operatorRwaInput"];
  mode?: RwaDvpDeliveryClaimDescriptor["mode"];
  outputBindingMode?: BondOutputBindingMode;
  nextRawOutput?: Partial<OutputRawFields>;
  paymentOutputIndex?: number;
  deliveryOutputIndex?: number;
  maxFeeSat?: number;
  feeOutputIndex?: number;
  deliveryTxid?: string;
  createdAt?: string | Date;
}

export interface RwaDvpRefundClaimDescriptor {
  schemaVersion: typeof RWA_DVP_REFUND_CLAIM_SCHEMA_VERSION;
  purchaseId: string;
  network: LiquidX402Network;
  termsHash: string;
  policyHash: string;
  paymentInput?: {
    txid: string;
    vout?: number;
    assetId: string;
    amountAtomic: string;
  };
  refundOutput: {
    recipientAddress: string;
    assetId: string;
    amountAtomic: string;
    outputIndex: number;
  };
  notBefore: string;
  fee: {
    asset: "lbtc";
    maxFeeSat: number;
    feeOutputIndex?: number;
  };
  refundTxid?: string;
  createdAt: string;
}

export interface RwaDvpPrepareRefundClaimInput {
  purchase: RwaDvpPurchaseDefinition;
  paymentInput?: RwaDvpRefundClaimDescriptor["paymentInput"];
  refundOutputIndex?: number;
  maxFeeSat?: number;
  feeOutputIndex?: number;
  refundTxid?: string;
  createdAt?: string | Date;
}

export interface RwaDvpCompileEscrowContractInput {
  purchase: RwaDvpPurchaseDefinition;
  operatorXonly: string;
  timeoutHeight: number;
  simfPath?: string;
}

export interface RwaDvpCompiledEscrowContract {
  compiled: Awaited<ReturnType<SimplicityClient["compileFromFile"]>>;
  artifact: SimplicityArtifact;
  contractAddress: string;
  timeoutHeight: number;
  termsHash: string;
  policyHash: string;
}

export interface RwaDvpClaimOutputBinding {
  outputHash: string;
  outputScriptHash: string;
  bindingMode: BondOutputBindingMode;
}

export interface RwaDvpClaimExecutionBaseInput {
  purchase: RwaDvpPurchaseDefinition;
  artifactPath?: string;
  artifact?: SimplicityArtifact;
  wallet: string;
  signer: SignerConfig;
  feeSat?: number;
  changeAddress?: string;
  extraInputs?: MultiAssetContractInput[];
  witness?: WitnessConfig;
  locktimeHeight?: number;
}

export interface RwaDvpInspectDeliveryClaimInput extends RwaDvpClaimExecutionBaseInput {
  descriptor: RwaDvpDeliveryClaimDescriptor;
}

export interface RwaDvpExecuteDeliveryClaimInput extends RwaDvpInspectDeliveryClaimInput {
  broadcast?: boolean;
}

export interface RwaDvpInspectRefundClaimInput extends RwaDvpClaimExecutionBaseInput {
  descriptor: RwaDvpRefundClaimDescriptor;
}

export interface RwaDvpExecuteRefundClaimInput extends RwaDvpInspectRefundClaimInput {
  broadcast?: boolean;
}

export interface RwaDvpDeliveryClaimInspection {
  descriptor: RwaDvpDeliveryClaimDescriptor;
  verification: RwaDvpVerificationReport;
  outputBinding: {
    paymentToTreasury: RwaDvpClaimOutputBinding;
    rwaToBuyer: RwaDvpClaimOutputBinding;
  };
  inspect: MultiAssetInspectResult;
}

export interface RwaDvpDeliveryClaimExecution extends Omit<RwaDvpDeliveryClaimInspection, "inspect"> {
  execution: MultiAssetExecuteResult;
}

export interface RwaDvpRefundClaimInspection {
  descriptor: RwaDvpRefundClaimDescriptor;
  verification: RwaDvpVerificationReport;
  outputBinding: {
    refund: RwaDvpClaimOutputBinding;
  };
  inspect: MultiAssetInspectResult;
}

export interface RwaDvpRefundClaimExecution extends Omit<RwaDvpRefundClaimInspection, "inspect"> {
  execution: MultiAssetExecuteResult;
}

export interface RwaDvpVerificationReport {
  schemaVersion: typeof RWA_DVP_VERIFICATION_SCHEMA_VERSION;
  ok: boolean;
  reason?: string;
  purchaseId: string;
  termsHash: string;
  policyHash: string;
  checks: Record<string, boolean>;
}

export interface RwaDvpEvidenceBundle {
  schemaVersion: typeof RWA_DVP_EVIDENCE_SCHEMA_VERSION;
  purchase: RwaDvpPurchaseDefinition;
  termsHash: string;
  policyHash: string;
  paymentRequirements?: LiquidX402PaymentRequirements | Record<string, unknown>;
  paymentVerification?: LiquidX402VerifyPaymentResult;
  deliveryClaim?: RwaDvpDeliveryClaimDescriptor;
  deliveryVerification?: RwaDvpVerificationReport;
  refundClaim?: RwaDvpRefundClaimDescriptor;
  refundVerification?: RwaDvpVerificationReport;
  evm?: {
    lockTxHash?: string;
    consumeTxHash?: string;
    releaseTxHash?: string;
  };
  createdAt: string;
}

export function definePurchase(
  _sdk: SimplicityClient,
  input: RwaDvpDefinePurchaseInput,
): RwaDvpPreparedPurchase {
  const network = input.network ?? "liquidtestnet";
  assertNonEmpty(input.purchaseId, "purchaseId");
  assertNonEmpty(input.payment.escrowAddress, "payment.escrowAddress");
  assertNonEmpty(input.delivery.recipientAddress, "delivery.recipientAddress");
  assertNonEmpty(input.refund.recipientAddress, "refund.recipientAddress");
  assertPositiveInteger(input.payment.amountAtomic, "payment.amountAtomic");
  assertPositiveInteger(input.delivery.amountAtomic, "delivery.amountAtomic");
  assertPositiveInteger(input.evmLock.amountAtomic, "evmLock.amountAtomic");
  assertFutureishDate(input.expiresAt, "expiresAt");
  assertFutureishDate(input.refund.after, "refund.after");

  const assetId = input.payment.assetId ?? resolveLiquidX402Asset(input.payment.asset, network).assetId;
  const definition: RwaDvpPurchaseDefinition = {
    schemaVersion: RWA_DVP_PURCHASE_SCHEMA_VERSION,
    purchaseId: input.purchaseId,
    network,
    evmLock: {
      ...input.evmLock,
      amountAtomic: normalizeInteger(input.evmLock.amountAtomic),
    },
    payment: {
      asset: input.payment.asset,
      assetId,
      amountAtomic: normalizeInteger(input.payment.amountAtomic),
      escrowAddress: input.payment.escrowAddress,
      treasuryAddress: input.payment.treasuryAddress ?? input.payment.escrowAddress,
    },
    delivery: {
      assetId: input.delivery.assetId,
      amountAtomic: normalizeInteger(input.delivery.amountAtomic),
      recipientAddress: input.delivery.recipientAddress,
    },
    refund: {
      recipientAddress: input.refund.recipientAddress,
      after: normalizeIso(input.refund.after),
    },
    expiresAt: normalizeIso(input.expiresAt),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
  const summary = summarizePurchase(definition);
  return {
    definition,
    summary,
    termsHash: summary.hash,
    policyHash: summarizePolicy(definition).hash,
  };
}

export function summarizePurchase(purchase: RwaDvpPurchaseDefinition): RwaDvpSummary {
  return summarizeCanonical(purchase);
}

export function buildPaymentRequirements(
  _sdk: SimplicityClient,
  input: RwaDvpBuildPaymentRequirementsInput,
): LiquidX402PaymentRequirements {
  const summary = summarizePurchase(input.purchase);
  return buildLiquidX402Requirements({
    paymentRequestId: input.purchase.purchaseId,
    resource: input.resource,
    payTo: input.purchase.payment.escrowAddress,
    amountAtomic: input.purchase.payment.amountAtomic,
    network: input.purchase.network,
    asset: input.purchase.payment.asset,
    assetId: input.purchase.payment.assetId,
    description: input.description ?? "Hazbase RWA Liquid delivery-versus-payment",
    mimeType: input.mimeType ?? "application/json",
    maxTimeoutSeconds: input.maxTimeoutSeconds,
    expiresAt: input.purchase.expiresAt,
    maxFeeSat: input.maxFeeSat,
    metadata: {
      ...input.metadata,
      purchaseId: input.purchase.purchaseId,
      termsHash: summary.hash,
      policyHash: summarizePolicy(input.purchase).hash,
      deliveryAssetId: input.purchase.delivery.assetId,
      deliveryAmountAtomic: input.purchase.delivery.amountAtomic,
      deliveryRecipientAddress: input.purchase.delivery.recipientAddress,
    },
  });
}

export async function verifyPaymentPset(
  sdk: SimplicityClient,
  input: RwaDvpVerifyPaymentPsetInput,
): Promise<LiquidX402VerifyPaymentResult> {
  const rpc = input.verifyPsetOutputs === false ? null : sdk.rpc;
  const result = await verifyLiquidX402Payment(rpc, {
    requirements: input.requirements,
    paymentPayload: input.paymentPayload,
    now: input.now,
  });
  if (!result.isValid) return result;
  if (result.paymentRequestId !== input.purchase.purchaseId) {
    return { ...result, isValid: false, invalidReason: "purchase_mismatch" };
  }
  return result;
}

export function prepareDeliveryClaim(
  sdk: SimplicityClient,
  input: RwaDvpPrepareDeliveryClaimInput,
): {
  descriptor: RwaDvpDeliveryClaimDescriptor;
  summary: RwaDvpSummary;
  verification: RwaDvpVerificationReport;
} {
  const purchaseSummary = summarizePurchase(input.purchase);
  const policy = summarizePolicy(input.purchase);
  const descriptor: RwaDvpDeliveryClaimDescriptor = {
    schemaVersion: RWA_DVP_DELIVERY_CLAIM_SCHEMA_VERSION,
    purchaseId: input.purchase.purchaseId,
    network: input.purchase.network,
    termsHash: purchaseSummary.hash,
    policyHash: policy.hash,
    mode: input.mode ?? "simplicity-multi-asset-claim",
    ...(input.paymentInput ? { paymentInput: input.paymentInput } : {}),
    operatorRwaInput: input.operatorRwaInput ?? {
      assetId: input.purchase.delivery.assetId,
      amountAtomic: input.purchase.delivery.amountAtomic,
      reissuanceAllowed: true,
    },
    outputs: {
      paymentToTreasury: {
        recipientAddress: input.purchase.payment.treasuryAddress,
        assetId: input.purchase.payment.assetId,
        amountAtomic: input.purchase.payment.amountAtomic,
        outputIndex: input.paymentOutputIndex ?? 0,
      },
      rwaToBuyer: {
        recipientAddress: input.purchase.delivery.recipientAddress,
        assetId: input.purchase.delivery.assetId,
        amountAtomic: input.purchase.delivery.amountAtomic,
        outputIndex: input.deliveryOutputIndex ?? 1,
        outputBindingMode: input.outputBindingMode ?? "descriptor-bound",
        ...(input.nextRawOutput ? { rawOutput: input.nextRawOutput } : {}),
      },
    },
    fee: {
      asset: "lbtc",
      maxFeeSat: input.maxFeeSat ?? sdk.config.defaults?.feeSat ?? 1000,
      ...(input.feeOutputIndex !== undefined ? { feeOutputIndex: input.feeOutputIndex } : {}),
    },
    ...(input.fundingTxid ? { fundingTxid: input.fundingTxid } : {}),
    ...(input.deliveryTxid ? { deliveryTxid: input.deliveryTxid } : {}),
    createdAt: input.createdAt ? normalizeIso(input.createdAt) : new Date().toISOString(),
  };
  const verification = verifyDeliveryClaim(sdk, { purchase: input.purchase, descriptor });
  return {
    descriptor,
    summary: summarizeCanonical(descriptor),
    verification,
  };
}

export function verifyDeliveryClaim(
  _sdk: SimplicityClient,
  input: { purchase: RwaDvpPurchaseDefinition; descriptor: RwaDvpDeliveryClaimDescriptor },
): RwaDvpVerificationReport {
  const termsHash = summarizePurchase(input.purchase).hash;
  const policyHash = summarizePolicy(input.purchase).hash;
  const checks = {
    schemaVersion: input.descriptor.schemaVersion === RWA_DVP_DELIVERY_CLAIM_SCHEMA_VERSION,
    purchaseId: input.descriptor.purchaseId === input.purchase.purchaseId,
    network: input.descriptor.network === input.purchase.network,
    termsHash: input.descriptor.termsHash === termsHash,
    policyHash: input.descriptor.policyHash === policyHash,
    paymentOutputAsset: input.descriptor.outputs.paymentToTreasury.assetId === input.purchase.payment.assetId,
    paymentOutputAmount: input.descriptor.outputs.paymentToTreasury.amountAtomic === input.purchase.payment.amountAtomic,
    paymentOutputRecipient: input.descriptor.outputs.paymentToTreasury.recipientAddress === input.purchase.payment.treasuryAddress,
    deliveryOutputAsset: input.descriptor.outputs.rwaToBuyer.assetId === input.purchase.delivery.assetId,
    deliveryOutputAmount: input.descriptor.outputs.rwaToBuyer.amountAtomic === input.purchase.delivery.amountAtomic,
    deliveryOutputRecipient: input.descriptor.outputs.rwaToBuyer.recipientAddress === input.purchase.delivery.recipientAddress,
    fee: Number.isInteger(input.descriptor.fee.maxFeeSat) && input.descriptor.fee.maxFeeSat >= 0,
  };
  return report(input.purchase.purchaseId, termsHash, policyHash, checks, "RWA DvP delivery claim descriptor mismatch");
}

export function prepareRefundClaim(
  sdk: SimplicityClient,
  input: RwaDvpPrepareRefundClaimInput,
): {
  descriptor: RwaDvpRefundClaimDescriptor;
  summary: RwaDvpSummary;
  verification: RwaDvpVerificationReport;
} {
  const termsHash = summarizePurchase(input.purchase).hash;
  const policyHash = summarizePolicy(input.purchase).hash;
  const descriptor: RwaDvpRefundClaimDescriptor = {
    schemaVersion: RWA_DVP_REFUND_CLAIM_SCHEMA_VERSION,
    purchaseId: input.purchase.purchaseId,
    network: input.purchase.network,
    termsHash,
    policyHash,
    ...(input.paymentInput ? { paymentInput: input.paymentInput } : {}),
    refundOutput: {
      recipientAddress: input.purchase.refund.recipientAddress,
      assetId: input.purchase.payment.assetId,
      amountAtomic: input.purchase.payment.amountAtomic,
      outputIndex: input.refundOutputIndex ?? 0,
    },
    notBefore: input.purchase.refund.after,
    fee: {
      asset: "lbtc",
      maxFeeSat: input.maxFeeSat ?? sdk.config.defaults?.feeSat ?? 1000,
      ...(input.feeOutputIndex !== undefined ? { feeOutputIndex: input.feeOutputIndex } : {}),
    },
    ...(input.refundTxid ? { refundTxid: input.refundTxid } : {}),
    createdAt: input.createdAt ? normalizeIso(input.createdAt) : new Date().toISOString(),
  };
  const verification = verifyRefundClaim(sdk, { purchase: input.purchase, descriptor });
  return {
    descriptor,
    summary: summarizeCanonical(descriptor),
    verification,
  };
}

export function verifyRefundClaim(
  _sdk: SimplicityClient,
  input: { purchase: RwaDvpPurchaseDefinition; descriptor: RwaDvpRefundClaimDescriptor },
): RwaDvpVerificationReport {
  const termsHash = summarizePurchase(input.purchase).hash;
  const policyHash = summarizePolicy(input.purchase).hash;
  const checks = {
    schemaVersion: input.descriptor.schemaVersion === RWA_DVP_REFUND_CLAIM_SCHEMA_VERSION,
    purchaseId: input.descriptor.purchaseId === input.purchase.purchaseId,
    network: input.descriptor.network === input.purchase.network,
    termsHash: input.descriptor.termsHash === termsHash,
    policyHash: input.descriptor.policyHash === policyHash,
    refundAsset: input.descriptor.refundOutput.assetId === input.purchase.payment.assetId,
    refundAmount: input.descriptor.refundOutput.amountAtomic === input.purchase.payment.amountAtomic,
    refundRecipient: input.descriptor.refundOutput.recipientAddress === input.purchase.refund.recipientAddress,
    notBefore: input.descriptor.notBefore === input.purchase.refund.after,
    fee: Number.isInteger(input.descriptor.fee.maxFeeSat) && input.descriptor.fee.maxFeeSat >= 0,
  };
  return report(input.purchase.purchaseId, termsHash, policyHash, checks, "RWA DvP refund claim descriptor mismatch");
}

const ZERO_HASH_256 = "0000000000000000000000000000000000000000000000000000000000000000";

interface WalletListUnspentResult {
  txid: string;
  vout: number;
  amount: number | string;
  asset: string;
  spendable?: boolean;
  safe?: boolean;
}

function resolveRwaDvpDocsAsset(filename: string): string {
  const cwdCandidate = path.resolve(process.cwd(), "docs/definitions", filename);
  if (existsSync(cwdCandidate)) return cwdCandidate;
  return path.resolve(__dirname, "../docs/definitions", filename);
}

function assertXonly(value: string, field: string): string {
  const normalized = value.trim().toLowerCase().replace(/^0x/u, "");
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new ValidationError(`${field} must be a 32-byte x-only public key`);
  }
  return normalized;
}

function atomicToSafeSat(value: string | number | bigint, field: string): number {
  const normalized = normalizeInteger(value);
  const amount = BigInt(normalized);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError(`${field} exceeds JavaScript safe integer range`);
  }
  return Number(amount);
}

function decimalToSat(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`Invalid Liquid amount: ${String(value)}`);
  }
  return Math.round(parsed * 100_000_000);
}

function sameOutpoint(left: { txid: string; vout: number }, right: { txid?: string; vout?: number }): boolean {
  return left.txid === right.txid && (right.vout === undefined || left.vout === right.vout);
}

function assetEquals(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

async function resolveWalletLbtcAssetId(sdk: SimplicityClient, network: LiquidX402Network): Promise<string> {
  const sidechain = await sdk.rpc.call<{ pegged_asset?: string }>("getsidechaininfo").catch(() => null);
  const peggedAsset = sidechain?.pegged_asset;
  if (peggedAsset && /^[0-9a-f]{64}$/iu.test(peggedAsset)) {
    return peggedAsset.toLowerCase();
  }
  return resolveLiquidX402Asset("lbtc", network).assetId;
}

async function listWalletInputs(sdk: SimplicityClient, wallet: string): Promise<MultiAssetContractInput[]> {
  const entries = await sdk.rpc.call<WalletListUnspentResult[]>("listunspent", [0, 9999999, [], true], wallet);
  return entries
    .filter((entry) => entry.spendable !== false)
    .filter((entry) => entry.safe !== false)
    .map((entry) => ({
      txid: entry.txid,
      vout: entry.vout,
      asset: entry.asset,
      amountSat: decimalToSat(entry.amount),
    }));
}

function selectInputsForAsset(input: {
  candidates: MultiAssetContractInput[];
  assetId: string;
  requiredSat: number;
  exclude?: Set<string>;
  preferred?: { txid?: string; vout?: number };
}): MultiAssetContractInput[] {
  if (input.requiredSat <= 0) return [];
  const exclude = input.exclude ?? new Set<string>();
  const key = (entry: MultiAssetContractInput) => `${entry.txid}:${entry.vout}`;
  const matches = input.candidates
    .filter((entry) => assetEquals(entry.asset, input.assetId))
    .filter((entry) => !exclude.has(key(entry)));
  const preferred = input.preferred?.txid
    ? matches.find((entry) => sameOutpoint(entry, input.preferred ?? {}))
    : undefined;
  if (preferred) {
    if (preferred.amountSat < input.requiredSat) {
      throw new ValidationError("Preferred wallet input is smaller than the required amount", {
        assetId: input.assetId,
        requiredSat: input.requiredSat,
        preferredAmountSat: preferred.amountSat,
      });
    }
    exclude.add(key(preferred));
    return [preferred];
  }

  const selected: MultiAssetContractInput[] = [];
  let total = 0;
  for (const candidate of matches.slice().sort((a, b) => a.amountSat - b.amountSat)) {
    selected.push(candidate);
    exclude.add(key(candidate));
    total += candidate.amountSat;
    if (total >= input.requiredSat) return selected;
  }
  throw new ValidationError("No wallet inputs satisfy the required asset amount", {
    assetId: input.assetId,
    requiredSat: input.requiredSat,
    availableSat: total,
  });
}

async function resolveDeliveryExtraInputs(
  sdk: SimplicityClient,
  input: RwaDvpInspectDeliveryClaimInput,
): Promise<MultiAssetContractInput[]> {
  if (input.extraInputs) return input.extraInputs;
  const candidates = await listWalletInputs(sdk, input.wallet);
  const exclude = new Set<string>();
  const rwa = selectInputsForAsset({
    candidates,
    assetId: input.descriptor.outputs.rwaToBuyer.assetId,
    requiredSat: atomicToSafeSat(input.descriptor.outputs.rwaToBuyer.amountAtomic, "delivery.amountAtomic"),
    exclude,
    preferred: input.descriptor.operatorRwaInput?.txid
      ? { txid: input.descriptor.operatorRwaInput.txid, vout: input.descriptor.operatorRwaInput.vout }
      : undefined,
  });
  const fee = selectInputsForAsset({
    candidates,
    assetId: await resolveWalletLbtcAssetId(sdk, input.purchase.network),
    requiredSat: input.feeSat ?? input.descriptor.fee.maxFeeSat,
    exclude,
  });
  return [...rwa, ...fee];
}

async function resolveRefundExtraInputs(
  sdk: SimplicityClient,
  input: RwaDvpInspectRefundClaimInput,
): Promise<MultiAssetContractInput[]> {
  if (input.extraInputs) return input.extraInputs;
  const candidates = await listWalletInputs(sdk, input.wallet);
  return selectInputsForAsset({
    candidates,
    assetId: await resolveWalletLbtcAssetId(sdk, input.purchase.network),
    requiredSat: input.feeSat ?? input.descriptor.fee.maxFeeSat,
  });
}

async function loadClaimArtifact(
  sdk: SimplicityClient,
  input: RwaDvpClaimExecutionBaseInput,
): Promise<SimplicityArtifact> {
  if (input.artifact) return input.artifact;
  if (input.artifactPath) return (await sdk.loadArtifact(input.artifactPath)).artifact;
  throw new ValidationError("artifact or artifactPath is required for RWA DvP claim execution");
}

function modeToWitnessValue(mode: BondOutputBindingMode): string {
  if (mode === "descriptor-bound") return "0x01";
  if (mode === "script-bound") return "0x02";
  return "0x03";
}

async function resolveClaimOutputBinding(
  sdk: SimplicityClient,
  input: {
    recipientAddress: string;
    assetId: string;
    amountAtomic: string;
    outputBindingMode: BondOutputBindingMode;
    rawOutput?: Partial<OutputRawFields>;
    outputForm?: Partial<OutputForm>;
  },
): Promise<RwaDvpClaimOutputBinding> {
  const scriptPubKeyHex = await getScriptPubKeyHexViaRpc(sdk, input.recipientAddress);
  const outputScriptHash = hashHexBytes(scriptPubKeyHex);
  const rawOutput = normalizeOutputRawFields(input.rawOutput);
  const rawOutputAnalysis = analyzeOutputRawFields(rawOutput);
  const outputForm = normalizeOutputForm(input.outputForm);
  let outputHash = ZERO_HASH_256;

  if (input.outputBindingMode === "descriptor-bound") {
    if (rawOutputAnalysis.valid && rawOutputAnalysis.normalized) {
      outputHash = computeRawOutputV1Hash(rawOutputAnalysis.normalized);
    } else if (isExplicitV1OutputForm(outputForm)) {
      const assetHex = await resolveExplicitAssetHex(sdk, input.assetId);
      if (!assetHex) {
        throw new ValidationError("descriptor-bound output requires a 64-hex asset id or rawOutput fields", {
          assetId: input.assetId,
        });
      }
      outputHash = computeExplicitV1OutputHash({
        assetHex,
        nextAmountSat: atomicToSafeSat(input.amountAtomic, "output.amountAtomic"),
        nextOutputScriptHash: outputScriptHash,
      });
    } else {
      throw new ValidationError("descriptor-bound output requires explicit-v1 or raw-output-v1 fields");
    }
  }

  return {
    outputHash,
    outputScriptHash: input.outputBindingMode === "none" ? ZERO_HASH_256 : outputScriptHash,
    bindingMode: input.outputBindingMode,
  };
}

function claimWitness(input: {
  base?: WitnessConfig;
  delivery: boolean;
  payment?: RwaDvpClaimOutputBinding;
  rwa?: RwaDvpClaimOutputBinding;
  refund?: RwaDvpClaimOutputBinding;
}): WitnessConfig {
  const values: NonNullable<WitnessConfig["values"]> = {
    ...(input.base?.values ?? {}),
    DELIVERY_OR_REFUND: {
      type: "Option<u8>",
      value: input.delivery ? "Some(0x01)" : "None",
    },
    PAYMENT_OUTPUT_HASH: {
      type: "u256",
      value: `0x${input.payment?.outputHash ?? ZERO_HASH_256}`,
    },
    PAYMENT_OUTPUT_SCRIPT_HASH: {
      type: "u256",
      value: `0x${input.payment?.outputScriptHash ?? ZERO_HASH_256}`,
    },
    PAYMENT_OUTPUT_BINDING_MODE: {
      type: "u8",
      value: modeToWitnessValue(input.payment?.bindingMode ?? "none"),
    },
    RWA_OUTPUT_HASH: {
      type: "u256",
      value: `0x${input.rwa?.outputHash ?? ZERO_HASH_256}`,
    },
    RWA_OUTPUT_SCRIPT_HASH: {
      type: "u256",
      value: `0x${input.rwa?.outputScriptHash ?? ZERO_HASH_256}`,
    },
    RWA_OUTPUT_BINDING_MODE: {
      type: "u8",
      value: modeToWitnessValue(input.rwa?.bindingMode ?? "none"),
    },
    REFUND_OUTPUT_HASH: {
      type: "u256",
      value: `0x${input.refund?.outputHash ?? ZERO_HASH_256}`,
    },
    REFUND_OUTPUT_SCRIPT_HASH: {
      type: "u256",
      value: `0x${input.refund?.outputScriptHash ?? ZERO_HASH_256}`,
    },
    REFUND_OUTPUT_BINDING_MODE: {
      type: "u8",
      value: modeToWitnessValue(input.refund?.bindingMode ?? "none"),
    },
  };
  return {
    ...(input.base?.source ? { source: input.base.source } : {}),
    ...(input.base?.signers ? { signers: input.base.signers } : {}),
    values,
  };
}

function paymentContractInput(
  descriptor: RwaDvpDeliveryClaimDescriptor | RwaDvpRefundClaimDescriptor,
): MultiAssetContractCallInput["contractInput"] | undefined {
  if (descriptor.paymentInput?.txid) {
    return {
      txid: descriptor.paymentInput.txid,
      ...(descriptor.paymentInput.vout !== undefined ? { vout: descriptor.paymentInput.vout } : {}),
      asset: descriptor.paymentInput.assetId,
      amountSat: atomicToSafeSat(descriptor.paymentInput.amountAtomic, "paymentInput.amountAtomic"),
    };
  }
  if ("fundingTxid" in descriptor && descriptor.fundingTxid) {
    return { txid: descriptor.fundingTxid };
  }
  return undefined;
}

async function buildDeliveryClaimCallInput(
  sdk: SimplicityClient,
  input: RwaDvpInspectDeliveryClaimInput,
): Promise<{
  artifact: SimplicityArtifact;
  verification: RwaDvpVerificationReport;
  outputBinding: RwaDvpDeliveryClaimInspection["outputBinding"];
  callInput: MultiAssetContractCallInput;
}> {
  const verification = verifyDeliveryClaim(sdk, { purchase: input.purchase, descriptor: input.descriptor });
  if (!verification.ok) {
    throw new ValidationError(verification.reason ?? "RWA DvP delivery claim verification failed");
  }
  const artifact = await loadClaimArtifact(sdk, input);
  const payment = input.descriptor.outputs.paymentToTreasury;
  const rwa = input.descriptor.outputs.rwaToBuyer;
  const paymentBinding = await resolveClaimOutputBinding(sdk, {
    recipientAddress: payment.recipientAddress,
    assetId: payment.assetId,
    amountAtomic: payment.amountAtomic,
    outputBindingMode: "script-bound",
  });
  const rwaBinding = await resolveClaimOutputBinding(sdk, {
    recipientAddress: rwa.recipientAddress,
    assetId: rwa.assetId,
    amountAtomic: rwa.amountAtomic,
    outputBindingMode: rwa.outputBindingMode,
    rawOutput: rwa.rawOutput,
  });
  const outputs: MultiAssetContractOutput[] = [
    {
      address: payment.recipientAddress,
      asset: payment.assetId,
      amountSat: atomicToSafeSat(payment.amountAtomic, "payment.amountAtomic"),
    },
    {
      address: rwa.recipientAddress,
      asset: rwa.assetId,
      amountSat: atomicToSafeSat(rwa.amountAtomic, "delivery.amountAtomic"),
    },
  ];
  const callInput: MultiAssetContractCallInput = {
    wallet: input.wallet,
    signer: input.signer,
    contractInput: paymentContractInput(input.descriptor),
    extraInputs: await resolveDeliveryExtraInputs(sdk, input),
    outputs,
    feeSat: input.feeSat ?? input.descriptor.fee.maxFeeSat,
    ...(input.changeAddress ? { changeAddress: input.changeAddress } : {}),
    purpose: "rwa_dvp_delivery_claim",
    ...(input.locktimeHeight !== undefined ? { locktimeHeight: input.locktimeHeight } : {}),
    witness: claimWitness({
      base: input.witness,
      delivery: true,
      payment: paymentBinding,
      rwa: rwaBinding,
    }),
  };
  return {
    artifact,
    verification,
    outputBinding: {
      paymentToTreasury: paymentBinding,
      rwaToBuyer: rwaBinding,
    },
    callInput,
  };
}

async function buildRefundClaimCallInput(
  sdk: SimplicityClient,
  input: RwaDvpInspectRefundClaimInput,
): Promise<{
  artifact: SimplicityArtifact;
  verification: RwaDvpVerificationReport;
  outputBinding: RwaDvpRefundClaimInspection["outputBinding"];
  callInput: MultiAssetContractCallInput;
}> {
  const verification = verifyRefundClaim(sdk, { purchase: input.purchase, descriptor: input.descriptor });
  if (!verification.ok) {
    throw new ValidationError(verification.reason ?? "RWA DvP refund claim verification failed");
  }
  const artifact = await loadClaimArtifact(sdk, input);
  const refund = input.descriptor.refundOutput;
  const refundBinding = await resolveClaimOutputBinding(sdk, {
    recipientAddress: refund.recipientAddress,
    assetId: refund.assetId,
    amountAtomic: refund.amountAtomic,
    outputBindingMode: "script-bound",
  });
  const callInput: MultiAssetContractCallInput = {
    wallet: input.wallet,
    signer: input.signer,
    contractInput: paymentContractInput(input.descriptor),
    extraInputs: await resolveRefundExtraInputs(sdk, input),
    outputs: [
      {
        address: refund.recipientAddress,
        asset: refund.assetId,
        amountSat: atomicToSafeSat(refund.amountAtomic, "refund.amountAtomic"),
      },
    ],
    feeSat: input.feeSat ?? input.descriptor.fee.maxFeeSat,
    ...(input.changeAddress ? { changeAddress: input.changeAddress } : {}),
    purpose: "rwa_dvp_refund_claim",
    ...(input.locktimeHeight !== undefined ? { locktimeHeight: input.locktimeHeight } : {}),
    witness: claimWitness({
      base: input.witness,
      delivery: false,
      refund: refundBinding,
    }),
  };
  return {
    artifact,
    verification,
    outputBinding: {
      refund: refundBinding,
    },
    callInput,
  };
}

export async function compileEscrowContract(
  sdk: SimplicityClient,
  input: RwaDvpCompileEscrowContractInput,
): Promise<RwaDvpCompiledEscrowContract> {
  if (!Number.isInteger(input.timeoutHeight) || input.timeoutHeight < 0) {
    throw new ValidationError("timeoutHeight must be a non-negative integer");
  }
  const termsHash = summarizePurchase(input.purchase).hash;
  const policyHash = summarizePolicy(input.purchase).hash;
  const compiled = await sdk.compileFromFile({
    simfPath: input.simfPath ?? resolveRwaDvpDocsAsset("rwa-dvp-escrow.simf"),
    templateVars: {
      TERMS_HASH: termsHash,
      POLICY_HASH: policyHash,
      OPERATOR_XONLY: assertXonly(input.operatorXonly, "operatorXonly"),
      TIMEOUT_HEIGHT: input.timeoutHeight,
    },
  });
  return {
    compiled,
    artifact: compiled.artifact,
    contractAddress: compiled.deployment().contractAddress,
    timeoutHeight: input.timeoutHeight,
    termsHash,
    policyHash,
  };
}

export async function inspectDeliveryClaim(
  sdk: SimplicityClient,
  input: RwaDvpInspectDeliveryClaimInput,
): Promise<RwaDvpDeliveryClaimInspection> {
  const prepared = await buildDeliveryClaimCallInput(sdk, input);
  const inspect = await inspectMultiAssetContractCall(sdk.config, prepared.artifact, prepared.callInput);
  return {
    descriptor: input.descriptor,
    verification: prepared.verification,
    outputBinding: prepared.outputBinding,
    inspect,
  };
}

export async function executeDeliveryClaim(
  sdk: SimplicityClient,
  input: RwaDvpExecuteDeliveryClaimInput,
): Promise<RwaDvpDeliveryClaimExecution> {
  const prepared = await buildDeliveryClaimCallInput(sdk, input);
  const execution = await executeMultiAssetContractCall(sdk.config, prepared.artifact, {
    ...prepared.callInput,
    broadcast: input.broadcast,
  });
  return {
    descriptor: input.descriptor,
    verification: prepared.verification,
    outputBinding: prepared.outputBinding,
    execution,
  };
}

export async function inspectRefundClaim(
  sdk: SimplicityClient,
  input: RwaDvpInspectRefundClaimInput,
): Promise<RwaDvpRefundClaimInspection> {
  const prepared = await buildRefundClaimCallInput(sdk, input);
  const inspect = await inspectMultiAssetContractCall(sdk.config, prepared.artifact, prepared.callInput);
  return {
    descriptor: input.descriptor,
    verification: prepared.verification,
    outputBinding: prepared.outputBinding,
    inspect,
  };
}

export async function executeRefundClaim(
  sdk: SimplicityClient,
  input: RwaDvpExecuteRefundClaimInput,
): Promise<RwaDvpRefundClaimExecution> {
  const prepared = await buildRefundClaimCallInput(sdk, input);
  const execution = await executeMultiAssetContractCall(sdk.config, prepared.artifact, {
    ...prepared.callInput,
    broadcast: input.broadcast,
  });
  return {
    descriptor: input.descriptor,
    verification: prepared.verification,
    outputBinding: prepared.outputBinding,
    execution,
  };
}

export function exportEvidence(
  _sdk: SimplicityClient,
  input: Omit<RwaDvpEvidenceBundle, "schemaVersion" | "createdAt" | "termsHash" | "policyHash"> & {
    createdAt?: string | Date;
  },
): RwaDvpEvidenceBundle {
  return {
    schemaVersion: RWA_DVP_EVIDENCE_SCHEMA_VERSION,
    purchase: input.purchase,
    termsHash: summarizePurchase(input.purchase).hash,
    policyHash: summarizePolicy(input.purchase).hash,
    ...(input.paymentRequirements ? { paymentRequirements: input.paymentRequirements } : {}),
    ...(input.paymentVerification ? { paymentVerification: input.paymentVerification } : {}),
    ...(input.deliveryClaim ? { deliveryClaim: input.deliveryClaim } : {}),
    ...(input.deliveryVerification ? { deliveryVerification: input.deliveryVerification } : {}),
    ...(input.refundClaim ? { refundClaim: input.refundClaim } : {}),
    ...(input.refundVerification ? { refundVerification: input.refundVerification } : {}),
    ...(input.evm ? { evm: input.evm } : {}),
    createdAt: input.createdAt ? normalizeIso(input.createdAt) : new Date().toISOString(),
  };
}

function summarizePolicy(purchase: RwaDvpPurchaseDefinition): RwaDvpSummary {
  return summarizeCanonical({
    schemaVersion: "rwa-dvp-policy/v1",
    purchaseId: purchase.purchaseId,
    network: purchase.network,
    evmLock: purchase.evmLock,
    paymentMustFundEscrow: {
      asset: purchase.payment.asset,
      assetId: purchase.payment.assetId,
      amountAtomic: purchase.payment.amountAtomic,
      escrowAddress: purchase.payment.escrowAddress,
    },
    deliveryClaimMustPay: {
      treasuryAddress: purchase.payment.treasuryAddress,
      buyerAddress: purchase.delivery.recipientAddress,
      paymentAssetId: purchase.payment.assetId,
      paymentAmountAtomic: purchase.payment.amountAtomic,
      rwaAssetId: purchase.delivery.assetId,
      rwaAmountAtomic: purchase.delivery.amountAtomic,
    },
    refundAfter: purchase.refund,
    expiresAt: purchase.expiresAt,
  });
}

function summarizeCanonical(value: unknown): RwaDvpSummary {
  const canonicalJson = stableStringify(value);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

function report(
  purchaseId: string,
  termsHash: string,
  policyHash: string,
  checks: Record<string, boolean>,
  reason: string,
): RwaDvpVerificationReport {
  const ok = Object.values(checks).every(Boolean);
  return {
    schemaVersion: RWA_DVP_VERIFICATION_SCHEMA_VERSION,
    ok,
    ...(ok ? {} : { reason }),
    purchaseId,
    termsHash,
    policyHash,
    checks,
  };
}

function assertNonEmpty(value: string | undefined, name: string): void {
  if (!value || !value.trim()) {
    throw new ValidationError(`${name} must be a non-empty string`, { code: "RWA_DVP_FIELD_REQUIRED", field: name });
  }
}

function assertPositiveInteger(value: string | number | bigint, name: string): void {
  normalizeInteger(value);
  if (BigInt(value) <= 0n) {
    throw new ValidationError(`${name} must be positive`, { code: "RWA_DVP_AMOUNT_INVALID", field: name });
  }
}

function normalizeInteger(value: string | number | bigint): string {
  const text = typeof value === "bigint" ? value.toString() : String(value).trim();
  if (!/^[0-9]+$/u.test(text)) {
    throw new ValidationError("amount must be an integer string", { code: "RWA_DVP_AMOUNT_INVALID" });
  }
  return BigInt(text).toString();
}

function assertFutureishDate(value: string | Date, name: string): void {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    throw new ValidationError(`${name} must be a valid date`, { code: "RWA_DVP_DATE_INVALID", field: name });
  }
}

function normalizeIso(value: string | Date): string {
  return new Date(value).toISOString();
}
