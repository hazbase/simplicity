import { loadArtifact } from "../core/artifact";
import { compileFromFile, compileFromPreset } from "../core/compiler";
import { loadDefinitionInput, verifyDefinitionAgainstArtifact } from "../core/definition";
import { loadStateInput, verifyStateAgainstArtifact } from "../core/state";
import { ValidationError } from "../core/errors";
import { ElementsRpcClient } from "../core/rpc";
import {
  BondDefinition,
  BondIssuanceState,
  DefinitionInput,
  DefinitionVerificationResult,
  CompileFromFileInput,
  CompileFromPresetInput,
  DefinitionDescriptor,
  StateDocumentDescriptor,
  StateDocumentInput,
  StateVerificationResult,
  SimplicityArtifact,
  SimplicityClientConfig,
} from "../core/types";
import { RelayerClient } from "../gasless/RelayerClient";
import { GaslessTransferInput, GaslessTransferResult, RelayerClientConfig } from "../gasless/types";
import { CompiledContract } from "./ContractFactory";
import { DeployedContract } from "./DeployedContract";
import { defineBond, loadBond, verifyBond } from "../domain/bond";

export class SimplicityClient {
  public readonly rpc: ElementsRpcClient;
  public readonly payments: {
    gaslessTransfer: (input: GaslessTransferInput) => Promise<GaslessTransferResult>;
  };
  public readonly bonds: {
    defineBond: (input: {
      definitionPath?: string;
      definitionValue?: BondDefinition;
      issuancePath?: string;
      issuanceValue?: BondIssuanceState;
      simfPath?: string;
      artifactPath?: string;
    }) => Promise<CompiledContract>;
    verifyBond: (input: {
      artifactPath?: string;
      artifact?: SimplicityArtifact;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      issuancePath?: string;
      issuanceValue?: BondIssuanceState;
    }) => ReturnType<typeof verifyBond>;
    loadBond: (input: {
      artifactPath: string;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      issuancePath?: string;
      issuanceValue?: BondIssuanceState;
    }) => ReturnType<typeof loadBond>;
  };

  constructor(public readonly config: SimplicityClientConfig) {
    this.rpc = new ElementsRpcClient(config.rpc);
    this.payments = {
      gaslessTransfer: async (input) => this.gaslessTransfer(input),
    };
    this.bonds = {
      defineBond: async (input) => defineBond(this, input),
      verifyBond: async (input) => verifyBond(this, input),
      loadBond: async (input) => loadBond(this, input),
    };
  }

  async compileFromFile(input: CompileFromFileInput): Promise<CompiledContract> {
    const artifact = await compileFromFile(this.config, input);
    return new CompiledContract(this.config, artifact);
  }

  async compileFromPreset(input: CompileFromPresetInput): Promise<CompiledContract> {
    const artifact = await compileFromPreset(this.config, input);
    return new CompiledContract(this.config, artifact);
  }

  async loadArtifact(path: string): Promise<CompiledContract> {
    const artifact = await loadArtifact(path, this.config.network);
    return new CompiledContract(this.config, artifact);
  }

  async define(input: DefinitionInput): Promise<DefinitionDescriptor> {
    return loadDefinitionInput(input);
  }

  async loadDefinition(input: DefinitionInput): Promise<DefinitionDescriptor> {
    return loadDefinitionInput(input);
  }

  async loadStateDocument(input: StateDocumentInput): Promise<StateDocumentDescriptor> {
    return loadStateInput(input);
  }

  async verifyDefinitionAgainstArtifact(input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    jsonPath?: string;
    value?: unknown;
    expectedType?: string;
    expectedId?: string;
    type?: string;
    id?: string;
    schemaVersion?: string;
  }): Promise<DefinitionVerificationResult> {
    const artifact =
      input.artifact ?? (input.artifactPath ? await loadArtifact(input.artifactPath, this.config.network) : undefined);
    if (!artifact) {
      throw new ValidationError("artifactPath or artifact is required");
    }
    return verifyDefinitionAgainstArtifact({
      artifact,
      definition: {
        type: input.type ?? input.expectedType ?? artifact.definition?.definitionType ?? "",
        id: input.id ?? input.expectedId ?? artifact.definition?.definitionId ?? "",
        schemaVersion: input.schemaVersion,
        jsonPath: input.jsonPath,
        value: input.value,
      },
      expectedType: input.expectedType,
      expectedId: input.expectedId,
    });
  }

  async verifyStateAgainstArtifact(input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    jsonPath?: string;
    value?: unknown;
    expectedType?: string;
    expectedId?: string;
    type?: string;
    id?: string;
    schemaVersion?: string;
  }): Promise<StateVerificationResult> {
    const artifact =
      input.artifact ?? (input.artifactPath ? await loadArtifact(input.artifactPath, this.config.network) : undefined);
    if (!artifact) {
      throw new ValidationError("artifactPath or artifact is required");
    }
    return verifyStateAgainstArtifact({
      artifact,
      state: {
        type: input.type ?? input.expectedType ?? artifact.state?.stateType ?? "",
        id: input.id ?? input.expectedId ?? artifact.state?.stateId ?? "",
        schemaVersion: input.schemaVersion,
        jsonPath: input.jsonPath,
        value: input.value,
      },
      expectedType: input.expectedType,
      expectedId: input.expectedId,
    });
  }

  fromArtifact(artifact: SimplicityArtifact): DeployedContract {
    return new DeployedContract(this.config, artifact);
  }

  relayer(config: RelayerClientConfig): RelayerClient {
    return new RelayerClient(config);
  }

  private async gaslessTransfer(input: GaslessTransferInput): Promise<GaslessTransferResult> {
    const relayer = input.relayer ?? (this.config.relayer ? new RelayerClient({
      baseUrl: this.config.relayer.baseUrl,
      apiKey: this.config.relayer.apiKey ?? "",
    }) : null);
    if (!relayer) {
      throw new Error("Relayer config is required for gaslessTransfer");
    }
    const request = await relayer.requestPset({
      amount: input.amount,
      toAddress: input.toAddress,
      fromLabel: input.fromLabel,
    });
    const walletResult = await this.rpc.call<{ psbt: string }>(
      "walletprocesspsbt",
      [request.psetBase64, true, "ALL", true],
      input.userWallet
    );
    const signedPsetBase64 = walletResult.psbt;
    const submit = await relayer.submitSignedPset({
      psetId: request.psetId,
      signedPsetBase64,
    });
    return { request, signedPsetBase64, submit };
  }
}

export function createSimplicityClient(config: SimplicityClientConfig): SimplicityClient {
  return new SimplicityClient(config);
}
