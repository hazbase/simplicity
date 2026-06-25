import { createHash } from "node:crypto";
import { stableStringify } from "../core/summary";

export const LIQUID_ATOMIC_DVP_PSET_SCHEME = "rwa-liquid-atomic-dvp-pset" as const;
export const LIQUID_ATOMIC_DVP_PSET_MODE = "service_cosign_atomic_pset_v1" as const;

export type LiquidAtomicDvpNetwork = "liquidtestnet" | "liquidv1";

export interface LiquidAtomicDvpOutputRequirement {
  assetId: string;
  amountAtomic: string;
  recipient: string;
}

export interface LiquidAtomicDvpServiceSigner {
  type: "operator_wallet" | "simplicity";
  xonly?: string;
}

export interface LiquidAtomicDvpRequirementsInput {
  network?: LiquidAtomicDvpNetwork;
  paymentRequestId: string;
  resource: string;
  termsHash: string;
  policyHash?: string | null;
  expiresAt: string | Date;
  maxTimeoutSeconds?: number;
  description?: string;
  mimeType?: string;
  payment: {
    assetId: string;
    amountAtomic: string | number | bigint;
    recipient: string;
  };
  delivery: {
    assetId: string;
    amountAtomic: string | number | bigint;
    recipient: string;
  };
  maxFeeSat?: string | number | bigint;
  serviceSigner?: LiquidAtomicDvpServiceSigner | null;
}

export interface LiquidAtomicDvpRequirements {
  scheme: typeof LIQUID_ATOMIC_DVP_PSET_SCHEME;
  mode: typeof LIQUID_ATOMIC_DVP_PSET_MODE;
  network: LiquidAtomicDvpNetwork;
  paymentRequestId: string;
  resource: string;
  description: string;
  mimeType: string;
  expiresAt: string;
  maxTimeoutSeconds: number;
  termsHash: string;
  policyHash: string | null;
  summaryHash: string;
  maxFeeSat: string | null;
  outputs: {
    paymentToTreasury: LiquidAtomicDvpOutputRequirement;
    rwaToBuyer: LiquidAtomicDvpOutputRequirement;
  };
  serviceSigner: LiquidAtomicDvpServiceSigner | null;
  extra: {
    settlementMode: typeof LIQUID_ATOMIC_DVP_PSET_MODE;
    payment: LiquidAtomicDvpOutputRequirement;
    delivery: LiquidAtomicDvpOutputRequirement;
    feeAsset: "lbtc";
    maxFeeSat: string | null;
  };
}

export interface LiquidAtomicDvpPaymentPayload {
  scheme: typeof LIQUID_ATOMIC_DVP_PSET_SCHEME;
  mode?: typeof LIQUID_ATOMIC_DVP_PSET_MODE;
  network: LiquidAtomicDvpNetwork;
  paymentRequestId: string;
  psetBase64: string;
  summaryHash: string;
  expiresAt?: string;
  payer?: string;
  metadata?: Record<string, unknown>;
}

export interface LiquidAtomicDvpLwkWasmModule {
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
  OutPoint: {
    new (value: string): any;
  };
  Pset: {
    new (value: string): any;
  };
  Signer: new (mnemonic: any, network: any) => any;
  Transaction?: {
    new (value: string): any;
    fromString?: (value: string) => any;
  };
  UnvalidatedLiquidexProposal: {
    fromPset: (pset: any) => any;
    new?: (value: string) => any;
  };
  Wollet: new (network: any, descriptor: any) => any;
};

export interface LiquidAtomicDvpPrepareMakerProposalInput {
  requirements: LiquidAtomicDvpRequirements | Record<string, unknown>;
  mnemonic: string;
  deliveryOutpoint?: string;
  esploraUrl?: string;
  waterfalls?: boolean;
  concurrency?: number;
  utxoOnly?: boolean;
  scan?: boolean;
  scanToIndex?: number;
  feeRate?: number;
  sign?: boolean;
  lwk?: LiquidAtomicDvpLwkWasmModule;
  importLwk?: () => Promise<LiquidAtomicDvpLwkWasmModule>;
}

export interface LiquidAtomicDvpPrepareMakerProposalResult {
  proposalPsetBase64: string;
  proposal: string;
  deliveryOutpoint: string;
  deliveryAssetId: string;
  deliveryAmountAtomic: string;
  paymentAssetId: string;
  paymentAmountAtomic: string;
  paymentRecipient: string;
  summaryHash: string;
  descriptor: string;
  dwid?: string;
}

export interface LiquidAtomicDvpTakeProposalInput {
  requirements: LiquidAtomicDvpRequirements | Record<string, unknown>;
  mnemonic: string;
  proposal?: string;
  proposalPsetBase64?: string;
  proposalTxHex?: string;
  payer?: string;
  esploraUrl?: string;
  waterfalls?: boolean;
  concurrency?: number;
  utxoOnly?: boolean;
  scan?: boolean;
  scanToIndex?: number;
  feeRate?: number;
  finalize?: boolean;
  lwk?: LiquidAtomicDvpLwkWasmModule;
  importLwk?: () => Promise<LiquidAtomicDvpLwkWasmModule>;
}

export type LiquidAtomicDvpTakeProposalResult = ReturnType<typeof buildLiquidAtomicDvpPaymentFromPset> & {
  descriptor: string;
  dwid?: string;
  proposalInput: LiquidAtomicDvpOutputRequirement;
  proposalOutput: LiquidAtomicDvpOutputRequirement;
};

export interface LiquidAtomicDvpVerifyPayloadResult {
  isValid: boolean;
  invalidReason?: string;
  network?: LiquidAtomicDvpNetwork;
  paymentRequestId?: string;
  summaryHash?: string;
}

export function buildLiquidAtomicDvpRequirements(
  input: LiquidAtomicDvpRequirementsInput
): LiquidAtomicDvpRequirements {
  const network = normalizeAtomicNetwork(input.network ?? "liquidtestnet");
  const paymentRequestId = requiredString(input.paymentRequestId, "paymentRequestId");
  const resource = requiredString(input.resource, "resource");
  const termsHash = requiredString(input.termsHash, "termsHash");
  const policyHash = input.policyHash ?? null;
  const expiresAt = normalizeDateTime(input.expiresAt, "expiresAt");
  const maxTimeoutSeconds = normalizeTimeout(input.maxTimeoutSeconds);
  const payment = normalizeOutput(input.payment, "payment");
  const delivery = normalizeOutput(input.delivery, "delivery");
  const maxFeeSat = input.maxFeeSat === undefined ? null : normalizeInteger(input.maxFeeSat, "maxFeeSat");
  const serviceSigner = normalizeServiceSigner(input.serviceSigner);
  const summaryHash = buildLiquidAtomicDvpSummaryHash({
    network,
    paymentRequestId,
    termsHash,
    policyHash,
    expiresAt,
    maxFeeSat,
    payment,
    delivery,
    serviceSigner,
  });

  return {
    scheme: LIQUID_ATOMIC_DVP_PSET_SCHEME,
    mode: LIQUID_ATOMIC_DVP_PSET_MODE,
    network,
    paymentRequestId,
    resource,
    description: String(input.description ?? "").trim() || "Hazbase RWA atomic Liquid DvP payment",
    mimeType: String(input.mimeType ?? "").trim() || "application/json",
    expiresAt,
    maxTimeoutSeconds,
    termsHash,
    policyHash,
    summaryHash,
    maxFeeSat,
    outputs: {
      paymentToTreasury: payment,
      rwaToBuyer: delivery,
    },
    serviceSigner,
    extra: {
      settlementMode: LIQUID_ATOMIC_DVP_PSET_MODE,
      payment,
      delivery,
      feeAsset: "lbtc",
      maxFeeSat,
    },
  };
}

export async function prepareLiquidAtomicDvpLwkWasmMakerProposal(
  input: LiquidAtomicDvpPrepareMakerProposalInput
): Promise<LiquidAtomicDvpPrepareMakerProposalResult> {
  const requirements = coerceAtomicRequirements(input.requirements);
  ensureLwkWasmNodeTimerCompat();
  const lwk = input.lwk ?? await loadLwkWasm(input.importLwk);
  const { network, signer, descriptor, wollet } = await buildLwkContext(lwk, requirements.network, input.mnemonic, input);
  const delivery = requirements.outputs.rwaToBuyer;
  const payment = requirements.outputs.paymentToTreasury;
  const deliveryUtxo = selectExactDeliveryUtxo(wollet, delivery, input.deliveryOutpoint);
  const paymentRecipient = parseLwkAddress(lwk, payment.recipient, network);
  let builder = network.txBuilder();
  if (input.feeRate !== undefined) builder = builder.feeRate(input.feeRate);
  builder = builder.liquidexMake(
    deliveryUtxo.outpoint,
    paymentRecipient,
    BigInt(payment.amountAtomic),
    parseLwkAssetId(lwk, payment.assetId),
  );
  const unsigned = builder.finish(wollet);
  const proposalPset = input.sign === false ? unsigned : signer.sign(unsigned);
  const proposalPsetBase64 = proposalPset.toString();
  const proposal = lwk.UnvalidatedLiquidexProposal.fromPset(proposalPset).toString();
  return {
    proposalPsetBase64,
    proposal,
    deliveryOutpoint: deliveryUtxo.outpointText,
    deliveryAssetId: delivery.assetId,
    deliveryAmountAtomic: delivery.amountAtomic,
    paymentAssetId: payment.assetId,
    paymentAmountAtomic: payment.amountAtomic,
    paymentRecipient: payment.recipient,
    summaryHash: requirements.summaryHash,
    descriptor: descriptor.toString(),
    ...(typeof wollet.dwid === "function" ? { dwid: wollet.dwid() } : {}),
  };
}

export async function prepareLiquidAtomicDvpLwkWasmTakerPayment(
  input: LiquidAtomicDvpTakeProposalInput
): Promise<LiquidAtomicDvpTakeProposalResult> {
  const requirements = coerceAtomicRequirements(input.requirements);
  ensureLwkWasmNodeTimerCompat();
  const lwk = input.lwk ?? await loadLwkWasm(input.importLwk);
  const { network, signer, descriptor, wollet } = await buildLwkContext(lwk, requirements.network, input.mnemonic, input);
  const proposal = parseLiquidexProposal(lwk, input.proposalPsetBase64 ?? input.proposal);
  const validated = input.proposalTxHex
    ? proposal.validate(parseLwkTransaction(lwk, input.proposalTxHex))
    : proposal.insecureValidate();
  const proposalInput = assetAmountRequirement(validated.input());
  const proposalOutput = assetAmountRequirement(validated.output());
  assertOutputMatches(proposalInput, requirements.outputs.rwaToBuyer, "Liquidex maker input");
  assertOutputMatches(proposalOutput, requirements.outputs.paymentToTreasury, "Liquidex maker output");

  let builder = network.txBuilder();
  if (input.feeRate !== undefined) builder = builder.feeRate(input.feeRate);
  builder = builder.liquidexTake([validated]);
  const unsigned = builder.finish(wollet);
  const signed = signer.sign(unsigned);
  const pset = input.finalize === false ? signed : wollet.finalize(signed);
  const payment = buildLiquidAtomicDvpPaymentFromPset({
    requirements,
    psetBase64: pset.toString(),
    payer: input.payer,
  });
  return {
    ...payment,
    descriptor: descriptor.toString(),
    ...(typeof wollet.dwid === "function" ? { dwid: wollet.dwid() } : {}),
    proposalInput,
    proposalOutput,
  };
}

export function buildLiquidAtomicDvpSummaryHash(input: {
  network: LiquidAtomicDvpNetwork;
  paymentRequestId: string;
  termsHash: string;
  policyHash: string | null;
  expiresAt: string;
  maxFeeSat: string | null;
  payment: LiquidAtomicDvpOutputRequirement;
  delivery: LiquidAtomicDvpOutputRequirement;
  serviceSigner: LiquidAtomicDvpServiceSigner | null;
}): string {
  return sha256Hex(stableStringify({
    scheme: LIQUID_ATOMIC_DVP_PSET_SCHEME,
    mode: LIQUID_ATOMIC_DVP_PSET_MODE,
    network: input.network,
    paymentRequestId: input.paymentRequestId,
    termsHash: input.termsHash,
    policyHash: input.policyHash,
    expiresAt: input.expiresAt,
    maxFeeSat: input.maxFeeSat,
    outputs: {
      paymentToTreasury: input.payment,
      rwaToBuyer: input.delivery,
    },
    serviceSigner: input.serviceSigner
      ? {
          type: input.serviceSigner.type,
          xonly: input.serviceSigner.xonly ?? null,
        }
      : null,
  }));
}

export function encodeLiquidAtomicDvpPayment(payload: LiquidAtomicDvpPaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeLiquidAtomicDvpPayment(raw: string): LiquidAtomicDvpPaymentPayload | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (String(parsed.scheme ?? "") !== LIQUID_ATOMIC_DVP_PSET_SCHEME) return null;
    return coerceAtomicPayload(parsed);
  } catch {
    return null;
  }
}

export function buildLiquidAtomicDvpPaymentFromPset(input: {
  requirements: LiquidAtomicDvpRequirements | Record<string, unknown>;
  psetBase64: string;
  payer?: string;
  metadata?: Record<string, unknown>;
}): {
  paymentPayload: LiquidAtomicDvpPaymentPayload;
  xPayment: string;
  psetBase64: string;
  summaryHash: string;
} {
  const requirements = coerceAtomicRequirements(input.requirements);
  const psetBase64 = requiredString(input.psetBase64, "psetBase64");
  const paymentPayload: LiquidAtomicDvpPaymentPayload = {
    scheme: LIQUID_ATOMIC_DVP_PSET_SCHEME,
    mode: LIQUID_ATOMIC_DVP_PSET_MODE,
    network: requirements.network,
    paymentRequestId: requirements.paymentRequestId,
    psetBase64,
    summaryHash: requirements.summaryHash,
    expiresAt: requirements.expiresAt,
    ...(input.payer ? { payer: input.payer } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
  return {
    paymentPayload,
    xPayment: encodeLiquidAtomicDvpPayment(paymentPayload),
    psetBase64,
    summaryHash: requirements.summaryHash,
  };
}

export function verifyLiquidAtomicDvpPayment(input: {
  requirements: LiquidAtomicDvpRequirements | Record<string, unknown>;
  paymentPayload: LiquidAtomicDvpPaymentPayload | Record<string, unknown>;
  now?: Date;
}): LiquidAtomicDvpVerifyPayloadResult {
  const requirements = coerceAtomicRequirements(input.requirements);
  const payload = coerceAtomicPayload(input.paymentPayload);
  const now = input.now ?? new Date();
  const base = {
    network: payload.network,
    paymentRequestId: payload.paymentRequestId,
    summaryHash: payload.summaryHash,
  };
  if (payload.scheme !== LIQUID_ATOMIC_DVP_PSET_SCHEME) {
    return { ...base, isValid: false, invalidReason: "scheme_mismatch" };
  }
  if (payload.network !== requirements.network) return { ...base, isValid: false, invalidReason: "network_mismatch" };
  if (payload.paymentRequestId !== requirements.paymentRequestId) {
    return { ...base, isValid: false, invalidReason: "payment_request_id_mismatch" };
  }
  if (normalizeHexHash(payload.summaryHash) !== normalizeHexHash(requirements.summaryHash)) {
    return { ...base, isValid: false, invalidReason: "summary_hash_mismatch" };
  }
  if (!payload.psetBase64) return { ...base, isValid: false, invalidReason: "pset_missing" };
  if (!looksBase64(payload.psetBase64)) return { ...base, isValid: false, invalidReason: "pset_invalid_base64" };
  if (new Date(payload.expiresAt ?? requirements.expiresAt).getTime() <= now.getTime()) {
    return { ...base, isValid: false, invalidReason: "payment_expired" };
  }
  return { ...base, isValid: true };
}

export function coerceAtomicRequirements(value: LiquidAtomicDvpRequirements | Record<string, unknown>): LiquidAtomicDvpRequirements {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("atomic DvP requirements must be an object");
  }
  const raw = value as Record<string, any>;
  const outputs = raw.outputs && typeof raw.outputs === "object" && !Array.isArray(raw.outputs) ? raw.outputs : {};
  const extra = raw.extra && typeof raw.extra === "object" && !Array.isArray(raw.extra) ? raw.extra : {};
  const payment = normalizeOutput(outputs.paymentToTreasury ?? extra.payment, "paymentToTreasury");
  const delivery = normalizeOutput(outputs.rwaToBuyer ?? extra.delivery, "rwaToBuyer");
  const network = normalizeAtomicNetwork(raw.network);
  const policyHash = typeof raw.policyHash === "string" && raw.policyHash.trim() ? raw.policyHash.trim() : null;
  const maxFeeSat = raw.maxFeeSat === null || raw.maxFeeSat === undefined ? null : normalizeInteger(raw.maxFeeSat, "maxFeeSat");
  const serviceSigner = normalizeServiceSigner(raw.serviceSigner);
  const fallbackSummaryHash = buildLiquidAtomicDvpSummaryHash({
    network,
    paymentRequestId: requiredString(raw.paymentRequestId, "paymentRequestId"),
    termsHash: requiredString(raw.termsHash, "termsHash"),
    policyHash,
    expiresAt: normalizeDateTime(raw.expiresAt, "expiresAt"),
    maxFeeSat,
    payment,
    delivery,
    serviceSigner,
  });
  return {
    scheme: LIQUID_ATOMIC_DVP_PSET_SCHEME,
    mode: LIQUID_ATOMIC_DVP_PSET_MODE,
    network,
    paymentRequestId: requiredString(raw.paymentRequestId, "paymentRequestId"),
    resource: requiredString(raw.resource, "resource"),
    description: String(raw.description ?? "").trim() || "Hazbase RWA atomic Liquid DvP payment",
    mimeType: String(raw.mimeType ?? "").trim() || "application/json",
    expiresAt: normalizeDateTime(raw.expiresAt, "expiresAt"),
    maxTimeoutSeconds: normalizeTimeout(raw.maxTimeoutSeconds),
    termsHash: requiredString(raw.termsHash, "termsHash"),
    policyHash,
    summaryHash: typeof raw.summaryHash === "string" && raw.summaryHash.trim() ? raw.summaryHash.trim() : fallbackSummaryHash,
    maxFeeSat,
    outputs: {
      paymentToTreasury: payment,
      rwaToBuyer: delivery,
    },
    serviceSigner,
    extra: {
      settlementMode: LIQUID_ATOMIC_DVP_PSET_MODE,
      payment,
      delivery,
      feeAsset: "lbtc",
      maxFeeSat,
    },
  };
}

function coerceAtomicPayload(value: LiquidAtomicDvpPaymentPayload | Record<string, unknown>): LiquidAtomicDvpPaymentPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("atomic DvP payment payload must be an object");
  }
  const raw = value as Record<string, any>;
  return {
    scheme: String(raw.scheme ?? LIQUID_ATOMIC_DVP_PSET_SCHEME) as typeof LIQUID_ATOMIC_DVP_PSET_SCHEME,
    mode: raw.mode === LIQUID_ATOMIC_DVP_PSET_MODE ? LIQUID_ATOMIC_DVP_PSET_MODE : undefined,
    network: normalizeAtomicNetwork(raw.network),
    paymentRequestId: requiredString(raw.paymentRequestId, "paymentRequestId"),
    psetBase64: requiredString(raw.psetBase64, "psetBase64"),
    summaryHash: requiredString(raw.summaryHash, "summaryHash"),
    expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : undefined,
    ...(typeof raw.payer === "string" && raw.payer.trim() ? { payer: raw.payer.trim() } : {}),
    ...(raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
      ? { metadata: raw.metadata as Record<string, unknown> }
      : {}),
  };
}

type LwkScanOptions = {
  esploraUrl?: string;
  waterfalls?: boolean;
  concurrency?: number;
  utxoOnly?: boolean;
  scan?: boolean;
  scanToIndex?: number;
};

async function loadLwkWasm(importer?: () => Promise<LiquidAtomicDvpLwkWasmModule>): Promise<LiquidAtomicDvpLwkWasmModule> {
  ensureLwkWasmNodeTimerCompat();
  if (importer) return importer();
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<LiquidAtomicDvpLwkWasmModule | { default?: LiquidAtomicDvpLwkWasmModule }>;
  const failures: string[] = [];
  for (const specifier of ["lwk_wasm", "lwk_node"]) {
    try {
      const imported = await dynamicImport(specifier);
      return (imported as { default?: LiquidAtomicDvpLwkWasmModule }).default ?? imported as LiquidAtomicDvpLwkWasmModule;
    } catch (error) {
      failures.push(`${specifier}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    "lwk_wasm or lwk_node is required for atomic Liquid DvP PSETs. " +
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

async function buildLwkContext(
  lwk: LiquidAtomicDvpLwkWasmModule,
  networkKey: LiquidAtomicDvpNetwork,
  mnemonicText: string,
  options: LwkScanOptions,
): Promise<{ network: any; signer: any; descriptor: any; wollet: any }> {
  const network = networkKey === "liquidv1" ? lwk.Network.mainnet() : lwk.Network.testnet();
  const mnemonic = new lwk.Mnemonic(mnemonicText);
  const signer = new lwk.Signer(mnemonic, network);
  const descriptor = signer.wpkhSlip77Descriptor();
  const wollet = new lwk.Wollet(network, descriptor);
  if (options.scan !== false) {
    const client = options.esploraUrl
      ? new lwk.EsploraClient(
        network,
        options.esploraUrl,
        options.waterfalls ?? false,
        options.concurrency ?? 4,
        options.utxoOnly ?? false,
      )
      : network.defaultEsploraClient();
    const update = options.scanToIndex !== undefined
      ? await client.fullScanToIndex(wollet, options.scanToIndex)
      : await client.fullScan(wollet);
    if (update) wollet.applyUpdate(update);
  }
  return { network, signer, descriptor, wollet };
}

function parseLwkAddress(lwk: LiquidAtomicDvpLwkWasmModule, address: string, network: any): any {
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

function parseLwkAssetId(lwk: LiquidAtomicDvpLwkWasmModule, assetId: string): any {
  return typeof lwk.AssetId.fromString === "function" ? lwk.AssetId.fromString(assetId) : new lwk.AssetId(assetId);
}

function parseLwkTransaction(lwk: LiquidAtomicDvpLwkWasmModule, txHex: string): any {
  if (lwk.Transaction?.fromString) return lwk.Transaction.fromString(txHex);
  if (lwk.Transaction) return new lwk.Transaction(txHex);
  throw new Error("LWK Transaction support is required to validate a Liquidex proposal against a transaction.");
}

function parseLiquidexProposal(lwk: LiquidAtomicDvpLwkWasmModule, value: string | undefined): any {
  const encoded = String(value ?? "").trim();
  if (!encoded) throw new Error("Liquidex proposal PSET is required");
  try {
    return lwk.UnvalidatedLiquidexProposal.fromPset(new lwk.Pset(encoded));
  } catch (psetError) {
    if (typeof lwk.UnvalidatedLiquidexProposal.new === "function") {
      try {
        return lwk.UnvalidatedLiquidexProposal.new(encoded);
      } catch {}
    }
    throw psetError;
  }
}

function selectExactDeliveryUtxo(
  wollet: any,
  delivery: LiquidAtomicDvpOutputRequirement,
  requestedOutpoint?: string,
): { outpoint: any; outpointText: string } {
  const utxos = typeof wollet.utxos === "function" ? wollet.utxos() : [];
  for (const utxo of utxos) {
    const outpoint = utxo.outpoint();
    const outpointText = outpointString(outpoint);
    if (requestedOutpoint && outpointText !== requestedOutpoint) continue;
    const secrets = utxo.unblinded();
    const assetId = secrets?.asset?.().toString?.();
    const amountAtomic = secrets?.value?.().toString?.();
    if (assetId === delivery.assetId && amountAtomic === delivery.amountAtomic) {
      return { outpoint, outpointText };
    }
  }
  if (requestedOutpoint) {
    throw new Error(`Delivery UTXO ${requestedOutpoint} is not an exact match for the atomic DvP delivery output.`);
  }
  throw new Error("No exact Liquid RWA UTXO is available for the atomic DvP delivery output.");
}

function outpointString(outpoint: any): string {
  try {
    return `${outpoint.txid().toString()}:${outpoint.vout()}`;
  } catch {
    return String(outpoint);
  }
}

function assetAmountRequirement(value: any): LiquidAtomicDvpOutputRequirement {
  return {
    assetId: value.asset().toString(),
    amountAtomic: value.amount().toString(),
    recipient: "",
  };
}

function assertOutputMatches(
  actual: LiquidAtomicDvpOutputRequirement,
  expected: LiquidAtomicDvpOutputRequirement,
  label: string,
): void {
  if (actual.assetId !== expected.assetId || actual.amountAtomic !== expected.amountAtomic) {
    throw new Error(
      `${label} does not match atomic DvP requirements: ` +
      `expected ${expected.amountAtomic} ${expected.assetId}, got ${actual.amountAtomic} ${actual.assetId}`
    );
  }
}

function normalizeAtomicNetwork(value: unknown): LiquidAtomicDvpNetwork {
  if (value === "liquidv1") return "liquidv1";
  if (value === "liquidtestnet" || value === undefined || value === null || value === "") return "liquidtestnet";
  throw new Error(`unsupported Liquid atomic DvP network: ${String(value)}`);
}

function normalizeOutput(value: unknown, name: string): LiquidAtomicDvpOutputRequirement {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} output requirement is required`);
  }
  const raw = value as Record<string, unknown>;
  return {
    assetId: requiredString(raw.assetId, `${name}.assetId`),
    amountAtomic: normalizeInteger(raw.amountAtomic, `${name}.amountAtomic`),
    recipient: requiredString(raw.recipient, `${name}.recipient`),
  };
}

function normalizeServiceSigner(value: unknown): LiquidAtomicDvpServiceSigner | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const type = raw.type === "simplicity" ? "simplicity" : raw.type === "operator_wallet" ? "operator_wallet" : null;
  if (!type) return null;
  const xonly = typeof raw.xonly === "string" && raw.xonly.trim() ? raw.xonly.trim() : undefined;
  return { type, ...(xonly ? { xonly } : {}) };
}

function normalizeInteger(value: unknown, name: string): string {
  const text = String(value ?? "").trim();
  if (!/^\d+$/u.test(text)) throw new Error(`${name} must be a non-negative integer string`);
  return BigInt(text).toString();
}

function normalizeDateTime(value: string | Date | unknown, name: string): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} must be a valid date`);
  return date.toISOString();
}

function normalizeTimeout(value: unknown): number {
  const timeout = Number(value ?? 60);
  if (!Number.isFinite(timeout) || timeout <= 0) return 60;
  return Math.floor(timeout);
}

function requiredString(value: unknown, name: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function looksBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/u.test(value) || /^[A-Za-z0-9_-]+={0,2}$/u.test(value);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeHexHash(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/u, "");
}
