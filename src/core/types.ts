export type NetworkName = "liquidtestnet" | "liquidv1" | "regtest";
export type UtxoPolicy = "smallest_over" | "largest" | "newest";
export type DefinitionTrustMode = "hash-anchor";
export type DefinitionAnchorMode = "artifact-hash-anchor" | "on-chain-constant-committed";

export interface RpcConfig {
  url: string;
  username: string;
  password: string;
  wallet?: string;
}

export interface ToolchainConfig {
  simcPath: string;
  halSimplicityPath: string;
  elementsCliPath?: string;
}

export interface SimplicityClientConfig {
  network: NetworkName;
  rpc: RpcConfig;
  toolchain: ToolchainConfig;
  defaults?: {
    feeSat?: number;
    utxoPolicy?: UtxoPolicy;
  };
  relayer?: {
    baseUrl: string;
    apiKey?: string;
  };
}

export interface ArtifactV5 {
  version: 5;
  createdAt: string;
  simfTemplatePath?: string;
  params?: {
    minHeight?: number;
    signerXonly?: string;
  };
  compiled?: {
    program?: string;
    cmr?: string;
    internalKey?: string;
    contractAddress?: string;
  };
  toolchain?: {
    simcPath?: string;
    halSimplicity?: string;
  };
}

export interface SimplicityArtifact {
  version: 6;
  kind: "simplicity-artifact";
  createdAt: string;
  network: NetworkName;
  source: {
    mode: "file" | "preset";
    simfPath?: string;
    preset?: string;
    templateVars?: Record<string, string | number>;
  };
  compiled: {
    program: string;
    cmr: string;
    internalKey: string;
    contractAddress: string;
  };
  toolchain: {
    simcPath: string;
    halSimplicity: string;
  };
  metadata: {
    sdkVersion: string;
    notes: string | null;
  };
  definition?: ArtifactDefinitionMetadata;
  state?: ArtifactStateMetadata;
  legacy?: {
    simfTemplatePath?: string;
    params?: {
      minHeight?: number;
      signerXonly?: string;
    };
  };
}

export type AnyArtifact = ArtifactV5 | SimplicityArtifact;

export interface CompileFromFileInput {
  simfPath: string;
  templateVars?: Record<string, string | number>;
  artifactPath?: string;
  definition?: DefinitionInput;
  state?: StateDocumentInput;
}

export interface CompileFromPresetInput {
  preset: string;
  params: Record<string, string | number>;
  artifactPath?: string;
  definition?: DefinitionInput;
  state?: StateDocumentInput;
}

export interface DefinitionInput {
  type: string;
  id: string;
  schemaVersion?: string;
  jsonPath?: string;
  value?: unknown;
  anchorMode?: DefinitionAnchorMode;
}

export interface DefinitionDescriptor {
  definitionType: string;
  definitionId: string;
  schemaVersion: string;
  canonicalJson: string;
  hash: string;
  sourcePath?: string;
}

export interface StateDocumentInput {
  type: string;
  id: string;
  schemaVersion?: string;
  jsonPath?: string;
  value?: unknown;
  anchorMode?: DefinitionAnchorMode;
}

export interface StateDocumentDescriptor {
  stateType: string;
  stateId: string;
  schemaVersion: string;
  canonicalJson: string;
  hash: string;
  sourcePath?: string;
}

export interface ArtifactDefinitionMetadata {
  definitionType: string;
  definitionId: string;
  schemaVersion: string;
  hash: string;
  trustMode: DefinitionTrustMode;
  anchorMode: DefinitionAnchorMode;
  onChainAnchor?: {
    helper: "nonzero-eq_256";
    templateVar: "DEFINITION_HASH";
    sourceVerified: boolean;
  };
}

export interface ArtifactStateMetadata {
  stateType: string;
  stateId: string;
  schemaVersion: string;
  hash: string;
  trustMode: DefinitionTrustMode;
  anchorMode: DefinitionAnchorMode;
  onChainAnchor?: {
    helper: "nonzero-eq_256";
    templateVar: "STATE_HASH";
    sourceVerified: boolean;
  };
}

export type BondIssuanceStatus = "ISSUED" | "PARTIALLY_REDEEMED" | "REDEEMED";
export type BondTransitionType = "ISSUE" | "REDEEM";

export interface BondStateTransition {
  type: BondTransitionType;
  amount: number;
  at: string;
}

export interface DeploymentInfo {
  contractAddress: string;
  internalKey: string;
  cmr: string;
  network: NetworkName;
  instructions: string[];
}

export interface ContractUtxo {
  txid: string;
  vout: number;
  scriptPubKey: string;
  asset: string;
  sat: number;
  height?: number;
  confirmed: boolean;
}

export interface SignerConfig {
  type: "schnorrPrivkeyHex";
  privkeyHex: string;
}

export interface WitnessValueInput {
  type: string;
  value: string;
}

export interface WitnessConfig {
  source?: string;
  values?: Record<string, WitnessValueInput>;
  signers?: Record<string, SignerConfig>;
}

export interface CallBaseInput {
  wallet: string;
  toAddress: string;
  sendAmount?: number;
  feeSat?: number;
  utxoPolicy?: UtxoPolicy;
  signer?: SignerConfig;
  expectedLiquidReceiver?: string;
  purpose?: string;
  periodId?: string;
  bondDefinitionId?: string;
  sequence?: number;
  witness?: WitnessConfig;
}

export interface InspectCallInput extends CallBaseInput {
  signer: SignerConfig;
}

export interface ExecuteCallInput extends CallBaseInput {
  signer: SignerConfig;
  broadcast?: boolean;
  verbose?: boolean;
}

export interface SummaryOutput {
  n: number;
  value: number | null;
  asset: string | null;
  address: string | null;
  scriptPubKeyHex: string | null;
  isFee: boolean;
}

export interface PsetSummary {
  network: string;
  purpose?: string;
  bondDefinitionId?: string | null;
  periodId?: string | null;
  definition?: {
    type: string | null;
    id: string | null;
    hash: string | null;
    trustMode: DefinitionTrustMode | null;
    anchorMode: DefinitionAnchorMode | null;
  };
  state?: {
    type: string | null;
    id: string | null;
    hash: string | null;
    trustMode: DefinitionTrustMode | null;
    anchorMode: DefinitionAnchorMode | null;
  };
  contract: {
    address: string;
    cmr: string;
    internalKey: string;
    program: string;
    minHeight?: number;
  };
  expectedLiquidReceiver?: string | null;
  inputs: Array<{
    txid: string | null;
    vout: number | null;
    sequence: number | null;
  }>;
  outputs: SummaryOutput[];
  fee: unknown;
}

export interface InspectResult {
  mode: "inspect";
  summary: PsetSummary;
  summaryHash: string;
  summaryCanonicalJson: string;
  psetBase64: string;
  contractUtxo: ContractUtxo;
  warnings: string[];
}

export interface ExecuteResult {
  mode: "execute";
  summary: PsetSummary;
  summaryHash: string;
  summaryCanonicalJson: string;
  psetBase64: string;
  rawTxHex: string;
  txId?: string;
  broadcasted: boolean;
  contractUtxo: ContractUtxo;
}

export interface GaslessExecuteInput {
  relayer?: import("../gasless/RelayerClient").RelayerClient;
  fromLabel?: string;
  wallet?: string;
  sponsorWallet?: string;
  toAddress: string;
  signer: SignerConfig;
  witness?: WitnessConfig;
  sendAmount?: number;
  feeSat?: number;
  contractChangeAddress?: string;
  sponsorChangeAddress?: string;
  utxoPolicy?: UtxoPolicy;
  broadcast?: boolean;
}

export interface GaslessExecuteResult {
  mode: "gasless-execute";
  summary: PsetSummary;
  summaryHash: string;
  summaryCanonicalJson: string;
  psetBase64: string;
  rawTxHex: string;
  txId?: string;
  broadcasted: boolean;
  contractUtxo: ContractUtxo;
  sponsorInput: {
    txid: string;
    vout: number;
    amountSat: number;
  };
}

export interface DefinitionVerificationResult {
  ok: boolean;
  reason?: string;
  definition: DefinitionDescriptor;
  artifactDefinition?: ArtifactDefinitionMetadata;
  trust: {
    artifactMatch: boolean;
    onChainAnchorPresent: boolean;
    onChainAnchorVerified: boolean;
    effectiveMode: "none" | DefinitionAnchorMode;
  };
}

export interface StateVerificationResult {
  ok: boolean;
  reason?: string;
  state: StateDocumentDescriptor;
  artifactState?: ArtifactStateMetadata;
  trust: {
    artifactMatch: boolean;
    onChainAnchorPresent: boolean;
    onChainAnchorVerified: boolean;
    effectiveMode: "none" | DefinitionAnchorMode;
  };
}

export interface BondDefinition {
  bondId: string;
  issuer: string;
  faceValue: number;
  couponBps: number;
  issueDate: string;
  maturityDate: number;
  currencyAssetId: string;
  controllerXonly: string;
}

export interface BondIssuanceState {
  issuanceId: string;
  bondId: string;
  issuerEntityId: string;
  issuedPrincipal: number;
  outstandingPrincipal: number;
  redeemedPrincipal: number;
  currencyAssetId: string;
  controllerXonly: string;
  issuedAt: string;
  status: BondIssuanceStatus;
  previousStateHash?: string | null;
  lastTransition?: BondStateTransition;
}

export interface BondSettlementDescriptor {
  settlementId: string;
  bondId: string;
  issuanceId: string;
  definitionHash: string;
  previousStateHash: string;
  nextStateHash: string;
  previousStatus: BondIssuanceStatus;
  nextStatus: BondIssuanceStatus;
  transitionKind: BondTransitionType;
  redeemAmount: number;
  transitionAt: string;
  assetId: string;
  nextContractAddress: string;
  nextAmountSat: number;
  maxFeeSat: number;
  principal: {
    issued: number;
    previousOutstanding: number;
    nextOutstanding: number;
    previousRedeemed: number;
    nextRedeemed: number;
  };
}

export interface WaitForFundingInput {
  minAmountSat?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  utxoPolicy?: UtxoPolicy;
}

export interface PresetManifestEntry {
  id: string;
  title: string;
  description: string;
  simfTemplatePath: string;
  parameterSchema: Record<string, "string" | "number">;
  witnessSchema?: Record<
    string,
    {
      type: string;
      signerAlias?: string;
      description?: string;
    }
  >;
  exampleWitness?: {
    signers?: Record<string, { type: "schnorrPrivkeyHex"; privkeyHex: string }>;
    values?: Record<string, { type: string; value: string }>;
  };
  executionProfile: {
    witnessMode: "inlineSignature";
    supportsGasless: boolean;
    supportsDirectExecute: boolean;
    supportsRelayerExecute: boolean;
    requiredWitnessFields: string[];
    defaultFeeSat: number;
    recommendedUtxoPolicy: UtxoPolicy;
  };
  exampleParams: Record<string, string | number>;
}
