export type NetworkName = "liquidtestnet" | "liquidv1" | "regtest";
export type UtxoPolicy = "smallest_over" | "largest" | "newest";

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
}

export interface CompileFromPresetInput {
  preset: string;
  params: Record<string, string | number>;
  artifactPath?: string;
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
