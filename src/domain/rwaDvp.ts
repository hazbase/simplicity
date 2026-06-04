import type { SimplicityClient } from "../client/SimplicityClient";
import { ValidationError } from "../core/errors";
import { sha256HexUtf8, stableStringify } from "../core/summary";
import type { BondOutputBindingMode, OutputRawFields } from "../core/types";
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
