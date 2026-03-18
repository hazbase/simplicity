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

export type BondIssuanceStatus = "ISSUED" | "PARTIALLY_REDEEMED" | "REDEEMED" | "CLOSED";
export type BondTransitionType = "ISSUE" | "REDEEM";
export type BondOutputBindingMode = "none" | "script-bound" | "descriptor-bound";
export type PropagationMode = "required" | "optional" | "none";
export type OutputBindingReasonCode =
  | "OK_EXPLICIT"
  | "OK_RAW_OUTPUT"
  | "OK_MANUAL_HASH"
  | "OK_SCRIPT_BOUND"
  | "OK_NONE"
  | "FALLBACK_UNSUPPORTED_ASSET"
  | "FALLBACK_UNSUPPORTED_OUTPUT_FORM"
  | "FALLBACK_MISSING_HASH_INPUT"
  | "FALLBACK_INCOMPLETE_RAW_OUTPUT"
  | "FALLBACK_INVALID_RAW_OUTPUT";
export type OutputBindingSupportedForm = "explicit-v1" | "raw-output-v1" | "unsupported";
export type OutputAssetForm = "explicit" | "confidential";
export type OutputAmountForm = "explicit" | "confidential";
export type OutputNonceForm = "null" | "confidential";
export type OutputRangeProofForm = "empty" | "non-empty";

export interface OutputForm {
  assetForm: OutputAssetForm;
  amountForm: OutputAmountForm;
  nonceForm: OutputNonceForm;
  rangeProofForm: OutputRangeProofForm;
}

export interface OutputRawFields {
  assetBytesHex: string;
  amountBytesHex: string;
  nonceBytesHex: string;
  scriptPubKeyHex?: string;
  scriptPubKeyHashHex?: string;
  rangeProofHex?: string;
  rangeProofHashHex?: string;
}

export interface OutputBindingInputs {
  assetId: string;
  assetForm: OutputAssetForm;
  amountForm: OutputAmountForm;
  nonceForm: OutputNonceForm;
  rangeProofForm: OutputRangeProofForm;
  nextAmountSat: number;
  nextOutputIndex: number;
  feeIndex: number;
  maxFeeSat: number;
  rawOutputComponents?: {
    scriptPubKey: "raw-bytes" | "hash";
    rangeProof: "raw-bytes" | "hash";
  };
}

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
  locktimeHeight?: number;
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
  locktimeHeight?: number;
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
  closedAt?: string;
  closingReason?: "REDEEMED" | "CANCELLED" | "MATURED_OUT";
  finalSettlementDescriptorHash?: string;
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
  expectedOutputDescriptorHash?: string;
  outputBindingMode?: BondOutputBindingMode;
  principal: {
    issued: number;
    previousOutstanding: number;
    nextOutstanding: number;
    previousRedeemed: number;
    nextRedeemed: number;
  };
}

export interface BondExpectedOutputDescriptor {
  nextContractAddress: string;
  nextOutputHash?: string;
  nextOutputScriptHash?: string;
  nextAmountSat: number;
  assetId: string;
  requestedOutputBindingMode?: BondOutputBindingMode;
  outputForm?: OutputForm;
  rawOutput?: Partial<OutputRawFields>;
  feeIndex: number;
  nextOutputIndex: number;
  maxFeeSat: number;
  outputBindingMode?: BondOutputBindingMode;
}

export interface BondClosingDescriptor {
  closingId: string;
  bondId: string;
  issuanceId: string;
  previousStateHash: string;
  closedStateHash: string;
  finalStatus: "CLOSED";
  closingReason: "REDEEMED" | "CANCELLED" | "MATURED_OUT";
  closedAt: string;
  definitionHash: string;
  stateHash: string;
  finalSettlementDescriptorHash: string;
}

export interface BondVerificationReport {
  artifactTrust: {
    definition: DefinitionVerificationResult["trust"];
    state: StateVerificationResult["trust"];
  };
  stateTrust: StateVerificationResult["trust"];
  settlementTrust?: {
    descriptorHashMatch: boolean;
    outputBindingMode: BondOutputBindingMode;
  };
  outputBindingTrust?: {
    mode: BondOutputBindingMode;
    requestedMode?: BondOutputBindingMode;
    supportedForm?: OutputBindingSupportedForm;
    nextContractAddressCommitted: boolean;
    expectedOutputDescriptorCommitted: boolean;
    settlementDescriptorCommitted?: boolean;
    outputCountRuntimeBound: boolean;
    feeIndexRuntimeBound: boolean;
    nextOutputHashRuntimeBound?: boolean;
    nextOutputScriptRuntimeBound: boolean;
    amountRuntimeBound: boolean;
    reasonCode?: OutputBindingReasonCode;
    autoDerived?: boolean;
    fallbackReason?: string;
    bindingInputs?: OutputBindingInputs;
  };
  arithmeticTrust?: {
    principalArithmeticCommitted: boolean;
    principalArithmeticValid: boolean;
    statusProgressionCommitted: boolean;
    statusProgressionValid: boolean;
  };
  closingTrust?: {
    finalStatusValid: boolean;
    finalSettlementDescriptorHashMatch: boolean;
  };
}

export interface BondEvidenceBundle {
  artifact: SimplicityArtifact;
  definition: {
    canonicalJson: string;
    hash: string;
  };
  issuance: {
    canonicalJson: string;
    hash: string;
  };
  transition?: {
    canonicalJson: string;
    hash: string;
  };
  settlement?: {
    canonicalJson: string;
    hash: string;
  };
  closing?: {
    canonicalJson: string;
    hash: string;
  };
  trust: BondVerificationReport;
  renderedSourceHash?: string;
  sourceVerificationMode: "source-reloaded" | "artifact-only";
  compiled: {
    program: string;
    cmr: string;
    contractAddress: string;
  };
}

export type CapitalCallStatus = "OPEN" | "CLAIMED" | "REFUND_ONLY" | "REFUNDED";
export type CapitalCallStage = "open" | "claimed" | "refund-only" | "refunded";
export type CapitalCallCutoffMode = "rollover-window";
export type LPPositionReceiptStatus = "ACTIVE" | "PARTIALLY_DISTRIBUTED" | "FULLY_DISTRIBUTED" | "CLOSED";
export type FundClosingReason = "LIQUIDATED" | "CANCELLED" | "WRITTEN_OFF";
export type FundVerificationReportSchemaVersion = "fund-verification-report/v1";
export type FundEvidenceBundleSchemaVersion = "fund-evidence-bundle/v1";
export type FundFinalityPayloadSchemaVersion = "fund-finality-payload/v1";
export type LPPositionReceiptSchemaVersion = "lp-position-receipt/v2";
export type LPPositionReceiptAttestationScheme = "bip340-sha256";

export interface FundDefinition {
  fundId: string;
  managerEntityId: string;
  managerXonly: string;
  currencyAssetId: string;
  jurisdiction?: string;
  vintage?: string;
}

export interface CapitalCallState {
  callId: string;
  fundId: string;
  lpId: string;
  currencyAssetId: string;
  amount: number;
  lpXonly: string;
  managerXonly: string;
  status: CapitalCallStatus;
  fundedAt?: string;
  claimedAt?: string;
  refundedAt?: string;
  previousStateHash?: string | null;
  claimCutoffHeight: number;
}

export interface LPPositionReceipt {
  schemaVersion: LPPositionReceiptSchemaVersion;
  positionId: string;
  fundId: string;
  lpId: string;
  callId: string;
  currencyAssetId: string;
  lpXonly: string;
  sequence: number;
  committedAmount: number;
  fundedAmount: number;
  distributedAmount: number;
  distributionCount: number;
  effectiveAt: string;
  lastDistributedAt?: string;
  status: LPPositionReceiptStatus;
  previousReceiptHash?: string | null;
}

export interface LPPositionReceiptAttestation {
  positionReceiptHash: string;
  sequence: number;
  managerXonly: string;
  signedAt: string;
  signature: string;
  scheme: LPPositionReceiptAttestationScheme;
}

export interface LPPositionReceiptEnvelope {
  receipt: LPPositionReceipt;
  attestation: LPPositionReceiptAttestation;
}

export interface DistributionDescriptor {
  distributionId: string;
  positionId: string;
  fundId: string;
  lpId: string;
  assetId: string;
  amountSat: number;
  approvedAt: string;
  positionReceiptHash: string;
}

export interface FundPayoutDescriptor {
  receiverAddress: string;
  nextOutputHash?: string;
  nextOutputScriptHash?: string;
  amountSat: number;
  assetId: string;
  requestedOutputBindingMode?: BondOutputBindingMode;
  outputForm?: OutputForm;
  rawOutput?: Partial<OutputRawFields>;
  feeIndex: number;
  nextOutputIndex: number;
  maxFeeSat: number;
  outputBindingMode: BondOutputBindingMode;
}

export interface FundClosingDescriptor {
  closingId: string;
  fundId: string;
  lpId: string;
  positionId: string;
  positionReceiptHash: string;
  finalDistributionHashes: string[];
  closedAt: string;
  closingReason: FundClosingReason;
}

export interface FundVerificationReport {
  schemaVersion: FundVerificationReportSchemaVersion;
  artifactTrust?: {
    definition: DefinitionVerificationResult["trust"];
    state: StateVerificationResult["trust"];
  };
  stateTrust?: StateVerificationResult["trust"];
  capitalCallTrust?: {
    capitalCallStage: CapitalCallStage;
    cutoffMode: CapitalCallCutoffMode;
    fundIdMatch: boolean;
    currencyMatch: boolean;
    managerMatch: boolean;
    claimCutoffCommitted: boolean;
    lpCommitted: boolean;
    managerCommitted: boolean;
    claimPathRuntimeAvailable: boolean;
    refundPathRuntimeAvailable: boolean;
    statusValid: boolean;
  };
  distributionTrust?: {
    fundIdMatch: boolean;
    lpIdMatch: boolean;
    positionIdMatch: boolean;
    positionReceiptHashMatch: boolean;
    positionStatusEligible: boolean;
  };
  outputBindingTrust?: {
    mode: BondOutputBindingMode;
    requestedMode?: BondOutputBindingMode;
    supportedForm?: OutputBindingSupportedForm;
    nextReceiverRuntimeCommitted: boolean;
    outputCountRuntimeBound: boolean;
    feeIndexRuntimeBound: boolean;
    nextOutputHashRuntimeBound?: boolean;
    nextOutputScriptRuntimeBound: boolean;
    amountRuntimeBound: boolean;
    reasonCode?: OutputBindingReasonCode;
    autoDerived?: boolean;
    fallbackReason?: string;
    bindingInputs?: OutputBindingInputs;
  };
  receiptTrust?: {
    generated: boolean;
    positionReceiptHash?: string;
    positionStatus: LPPositionReceiptStatus;
    attested: boolean;
    attestationVerified: boolean;
    sequence?: number;
    sequenceMonotonic?: boolean;
    attestingSignerMatch?: boolean;
  };
  closingTrust?: {
    positionReceiptHashMatch: boolean;
    finalDistributionHashesPresent: boolean;
    positionStatusEligible: boolean;
  };
}

export interface FundEvidenceBundle {
  schemaVersion: FundEvidenceBundleSchemaVersion;
  artifact?: SimplicityArtifact;
  definition: {
    canonicalJson: string;
    hash: string;
  };
  capitalCall?: {
    canonicalJson: string;
    hash: string;
  };
  positionReceipt?: {
    canonicalJson: string;
    hash: string;
  };
  positionReceiptEnvelope?: {
    canonicalJson: string;
    hash: string;
  };
  distribution?: {
    canonicalJson: string;
    hash: string;
  };
  distributions?: Array<{
    canonicalJson: string;
    hash: string;
  }>;
  closing?: {
    canonicalJson: string;
    hash: string;
  };
  trust: FundVerificationReport;
  renderedSourceHash?: string;
  sourceVerificationMode: "source-reloaded" | "artifact-only";
  compiled?: {
    program: string;
    cmr: string;
    contractAddress: string;
  };
}

export interface FundFinalityPayload {
  schemaVersion: FundFinalityPayloadSchemaVersion;
  fundId: string;
  lpId: string;
  callId?: string;
  positionId?: string;
  definitionHash: string;
  capitalCallStateHash?: string | null;
  positionReceiptHash?: string | null;
  positionReceiptEnvelopeHash?: string | null;
  distributionHash?: string | null;
  distributionHashes?: string[] | null;
  closingHash?: string | null;
  bindingMode: BondOutputBindingMode;
  trust: FundVerificationReport;
  trustSummary: {
    definition?: DefinitionVerificationResult["trust"];
    state?: StateVerificationResult["trust"];
    bindingMode: BondOutputBindingMode;
  };
}

export interface PolicyReceiver {
  mode: "plain" | "policy";
  address?: string;
  recipientXonly?: string;
  defaultPolicyTemplateId?: string;
  defaultParams?: Record<string, string | number | boolean>;
}

export interface PolicyTemplateDocument {
  policyTemplateId: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export type PolicyTemplateManifestVersion = "policy-template-manifest/v1";
export type PolicyVerificationReportSchemaVersion = "policy-verification-report/v1";
export type PolicyEvidenceBundleSchemaVersion = "policy-evidence-bundle/v1";
export type PolicyOutputBindingReasonCode = OutputBindingReasonCode;
export type PolicyOutputBindingSupportedForm = OutputBindingSupportedForm;
export type PolicyOutputAssetForm = OutputAssetForm;
export type PolicyOutputAmountForm = OutputAmountForm;
export type PolicyOutputNonceForm = OutputNonceForm;
export type PolicyOutputRangeProofForm = OutputRangeProofForm;
export type PolicyTemplateManifestValidationReasonCode =
  | "OK"
  | "MANIFEST_VERSION_UNSUPPORTED"
  | "MANIFEST_FIELD_REQUIRED"
  | "MANIFEST_FIELD_INVALID"
  | "MANIFEST_PARAMETER_SCHEMA_INVALID"
  | "MANIFEST_BINDING_MODE_INVALID"
  | "MANIFEST_PROPAGATION_MODE_INVALID";

export interface PolicyTemplateManifest {
  templateId: string;
  manifestVersion: PolicyTemplateManifestVersion;
  title: string;
  description: string;
  stateSimfPath: string;
  directStateSimfPath?: string;
  parameterSchema: Record<string, "string" | "number" | "boolean">;
  supportedBindingModes: BondOutputBindingMode[];
  supportsPlainExit: boolean;
  defaultPropagationMode: PropagationMode;
}

export interface PolicyTemplateInput {
  templateId?: string;
  manifestPath?: string;
  manifestValue?: PolicyTemplateManifest;
  jsonPath?: string;
  value?: unknown;
  stateSimfPath?: string;
  directStateSimfPath?: string;
  transferMachineSimfPath?: string;
}

export interface PolicyState {
  policyTemplateId: string;
  policyHash: string;
  recipient: string;
  amountSat: number;
  assetId: string;
  params: Record<string, string | number | boolean>;
  propagationMode: PropagationMode;
  previousStateHash?: string | null;
  hop: number;
  status: "LOCKED" | "SPENT";
}

export interface PolicyOutputDescriptor {
  nextContractAddress: string;
  nextOutputHash?: string;
  nextOutputScriptHash?: string;
  nextAmountSat: number;
  assetId: string;
  requestedOutputBindingMode?: BondOutputBindingMode;
  outputForm?: OutputForm;
  rawOutput?: Partial<OutputRawFields>;
  feeIndex: number;
  nextOutputIndex: number;
  maxFeeSat: number;
  outputBindingMode: BondOutputBindingMode;
}

export interface PolicyTransferDescriptor {
  policyTemplateId: string;
  previousPolicyHash: string;
  nextPolicyHash?: string | null;
  previousStateHash: string;
  nextStateHash?: string | null;
  propagationMode: PropagationMode;
  plainExitAddress?: string | null;
  outputDescriptor?: PolicyOutputDescriptor;
}

export interface PolicyVerificationReport {
  schemaVersion: PolicyVerificationReportSchemaVersion;
  templateTrust?: DefinitionVerificationResult["trust"];
  stateTrust: StateVerificationResult["trust"];
  propagationMode: PropagationMode;
  nextPolicyRequired: boolean;
  nextPolicyPresent: boolean;
  plainExitAllowed: boolean;
  outputBinding?: {
    mode: BondOutputBindingMode;
    supportedForm: PolicyOutputBindingSupportedForm;
    committed: boolean;
    runtimeBound: boolean;
    sdkVerified: boolean;
    amountRuntimeBound: boolean;
    nextOutputHashRuntimeBound: boolean;
    nextOutputScriptRuntimeBound: boolean;
    reasonCode: PolicyOutputBindingReasonCode;
    nextOutputHash?: string;
    autoDerived?: boolean;
    fallbackReason?: string;
    bindingInputs?: OutputBindingInputs;
  };
  enforcement: "sdk-path" | "conditional-hop" | "direct-hop";
}

export interface PolicyEvidenceBundle {
  schemaVersion: PolicyEvidenceBundleSchemaVersion;
  artifact: SimplicityArtifact;
  template: {
    canonicalJson: string;
    hash: string;
  };
  state: {
    canonicalJson: string;
    hash: string;
  };
  transfer?: {
    canonicalJson: string;
    hash: string;
  };
  report: PolicyVerificationReport;
  renderedSourceHash?: string;
  sourceVerificationMode: "source-reloaded" | "artifact-only";
  compiled: {
    program: string;
    cmr: string;
    contractAddress: string;
  };
}

export interface OutputBindingSupportMatrix {
  supportedForms: Array<{
    form: OutputBindingSupportedForm;
    description: string;
    autoDerived: boolean;
  }>;
  unsupportedOutputFeatures: Array<{
    feature: string;
    description: string;
    fallbackReasonCode: Extract<
      OutputBindingReasonCode,
      "FALLBACK_UNSUPPORTED_ASSET" | "FALLBACK_UNSUPPORTED_OUTPUT_FORM"
    >;
    manualHashSupported: boolean;
  }>;
  outputBindingModes: Record<
    BondOutputBindingMode,
    {
      description: string;
      runtimeBinding: "none" | "script-hash" | "output-hash";
      fallbackBehavior: string;
    }
  >;
  autoDeriveConditions: {
    assetInput: string[];
    amountForm: string;
    nonceForm: string;
    rangeProofForm: string;
    rawOutputFields?: string[];
    rawOutputFieldAlternatives?: Record<string, string[]>;
    outputHashExclusions?: string[];
  };
  manualHashPath: {
    supported: boolean;
    description: string;
  };
  fallbackBehavior: {
    defaultMode: BondOutputBindingMode;
    reasonCodes: OutputBindingReasonCode[];
  };
  publicValidationMatrix: {
    local: string[];
    testnet: string[];
  };
  nonGoals: string[];
}

export type PolicyBindingSupportMatrix = OutputBindingSupportMatrix;

export interface OutputBindingSupportEvaluation {
  requestedBindingMode: BondOutputBindingMode;
  resolvedBindingMode: BondOutputBindingMode;
  supportedForm: OutputBindingSupportedForm;
  reasonCode: OutputBindingReasonCode;
  autoDerived: boolean;
  fallbackReason?: string;
  assetId: string;
  outputForm: OutputForm;
  unsupportedFeatures: string[];
  explicitAssetInputSupported: boolean;
  manualHashSupplied: boolean;
  nextOutputScriptAvailable: boolean;
  rawOutputProvided?: boolean;
  rawOutputComponents?: {
    scriptPubKey: "raw-bytes" | "hash";
    rangeProof: "raw-bytes" | "hash";
  };
}

export interface PolicyTemplateManifestValidationResult {
  ok: boolean;
  reasonCode: PolicyTemplateManifestValidationReasonCode;
  reason?: string;
  manifest?: PolicyTemplateManifest;
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
