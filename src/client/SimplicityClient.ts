import { loadArtifact } from "../core/artifact";
import { compileFromFile, compileFromPreset } from "../core/compiler";
import { loadDefinitionInput, verifyDefinitionAgainstArtifact } from "../core/definition";
import { loadStateInput, verifyStateAgainstArtifact } from "../core/state";
import { ValidationError } from "../core/errors";
import { describeOutputBindingSupport, evaluateOutputBindingSupport } from "../core/outputBinding";
import { ElementsRpcClient } from "../core/rpc";
import {
  BondEvidenceBundle,
  OutputBindingSupportEvaluation,
  OutputBindingSupportMatrix,
  PolicyEvidenceBundle,
  PolicyTemplateManifestValidationResult,
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
import {
  prepareRedemption,
  prepareClosing,
  exportFinalityPayload,
  buildSettlement,
  verifySettlement,
  define,
  executeClosing,
  executeRedemption,
  exportEvidence,
  inspectClosing,
  inspectRedemption,
  issue,
  load,
  verify,
  verifyClosing,
  verifyRedemption,
} from "../domain/bond";
import {
  buildPolicyOutputDescriptor,
  describePolicyTemplate,
  listPolicyTemplates,
  loadPolicyTemplateManifest,
  executeTransfer as executePolicyTransfer,
  exportEvidence as exportPolicyEvidence,
  inspectTransfer as inspectPolicyTransfer,
  issue as issuePolicy,
  prepareTransfer as preparePolicyTransfer,
  validatePolicyTemplateManifest,
  validatePolicyTemplateParams,
  verifyState as verifyPolicyState,
  verifyTransfer as verifyPolicyTransfer,
} from "../domain/policies";

export class SimplicityClient {
  public readonly rpc: ElementsRpcClient;
  public readonly payments: {
    gaslessTransfer: (input: GaslessTransferInput) => Promise<GaslessTransferResult>;
  };
  public readonly outputBinding: {
    describeSupport: () => OutputBindingSupportMatrix;
    evaluateSupport: (input: Parameters<typeof evaluateOutputBindingSupport>[0]) => OutputBindingSupportEvaluation;
  };
  public readonly policies: {
    listTemplates: () => ReturnType<typeof listPolicyTemplates>;
    describeTemplate: (input: Parameters<typeof describePolicyTemplate>[0]) => ReturnType<typeof describePolicyTemplate>;
    loadTemplateManifest: (input: Parameters<typeof loadPolicyTemplateManifest>[0]) => ReturnType<typeof loadPolicyTemplateManifest>;
    validateTemplateManifest: (input: Parameters<typeof validatePolicyTemplateManifest>[0]) => PolicyTemplateManifestValidationResult;
    validateTemplateParams: (input: Parameters<typeof validatePolicyTemplateParams>[0]) => ReturnType<typeof validatePolicyTemplateParams>;
    buildOutputDescriptor: (input: Parameters<typeof buildPolicyOutputDescriptor>[1]) => ReturnType<typeof buildPolicyOutputDescriptor>;
    issue: (input: Parameters<typeof issuePolicy>[1]) => ReturnType<typeof issuePolicy>;
    prepareTransfer: (input: Parameters<typeof preparePolicyTransfer>[1]) => ReturnType<typeof preparePolicyTransfer>;
    inspectTransfer: (input: Parameters<typeof inspectPolicyTransfer>[1]) => ReturnType<typeof inspectPolicyTransfer>;
    executeTransfer: (input: Parameters<typeof executePolicyTransfer>[1]) => ReturnType<typeof executePolicyTransfer>;
    verifyState: (input: Parameters<typeof verifyPolicyState>[1]) => ReturnType<typeof verifyPolicyState>;
    verifyTransfer: (input: Parameters<typeof verifyPolicyTransfer>[1]) => ReturnType<typeof verifyPolicyTransfer>;
    exportEvidence: (input: Parameters<typeof exportPolicyEvidence>[1]) => Promise<PolicyEvidenceBundle>;
  };
  public readonly bonds: {
    define: (input: Parameters<typeof define>[1]) => ReturnType<typeof define>;
    verify: (input: Parameters<typeof verify>[1]) => ReturnType<typeof verify>;
    load: (input: Parameters<typeof load>[1]) => ReturnType<typeof load>;
    issue: (input: Parameters<typeof issue>[1]) => ReturnType<typeof issue>;
    prepareRedemption: (input: Parameters<typeof prepareRedemption>[1]) => ReturnType<typeof prepareRedemption>;
    inspectRedemption: (input: Parameters<typeof inspectRedemption>[1]) => ReturnType<typeof inspectRedemption>;
    executeRedemption: (input: Parameters<typeof executeRedemption>[1]) => ReturnType<typeof executeRedemption>;
    verifyRedemption: (input: Parameters<typeof verifyRedemption>[1]) => ReturnType<typeof verifyRedemption>;
    buildSettlement: (input: Parameters<typeof buildSettlement>[1]) => ReturnType<typeof buildSettlement>;
    verifySettlement: (input: Parameters<typeof verifySettlement>[1]) => ReturnType<typeof verifySettlement>;
    prepareClosing: (input: Parameters<typeof prepareClosing>[1]) => ReturnType<typeof prepareClosing>;
    inspectClosing: (input: Parameters<typeof inspectClosing>[1]) => ReturnType<typeof inspectClosing>;
    executeClosing: (input: Parameters<typeof executeClosing>[1]) => ReturnType<typeof executeClosing>;
    verifyClosing: (input: Parameters<typeof verifyClosing>[1]) => ReturnType<typeof verifyClosing>;
    exportEvidence: (input: Parameters<typeof exportEvidence>[1]) => Promise<BondEvidenceBundle>;
    exportFinalityPayload: (input: Parameters<typeof exportFinalityPayload>[1]) => ReturnType<typeof exportFinalityPayload>;
  };

  constructor(public readonly config: SimplicityClientConfig) {
    this.rpc = new ElementsRpcClient(config.rpc);
    this.payments = {
      gaslessTransfer: async (input) => this.gaslessTransfer(input),
    };
    this.outputBinding = {
      describeSupport: () => describeOutputBindingSupport(),
      evaluateSupport: (input) => evaluateOutputBindingSupport(input),
    };
    this.policies = {
      listTemplates: () => listPolicyTemplates(),
      describeTemplate: (input) => describePolicyTemplate(input),
      loadTemplateManifest: async (input) => loadPolicyTemplateManifest(input),
      validateTemplateManifest: (input) => validatePolicyTemplateManifest(input),
      validateTemplateParams: (input) => validatePolicyTemplateParams(input),
      buildOutputDescriptor: async (input) => buildPolicyOutputDescriptor(this, input),
      issue: async (input) => issuePolicy(this, input),
      prepareTransfer: async (input) => preparePolicyTransfer(this, input),
      inspectTransfer: async (input) => inspectPolicyTransfer(this, input),
      executeTransfer: async (input) => executePolicyTransfer(this, input),
      verifyState: async (input) => verifyPolicyState(this, input),
      verifyTransfer: async (input) => verifyPolicyTransfer(this, input),
      exportEvidence: async (input) => exportPolicyEvidence(this, input),
    };
    this.bonds = {
      define: async (input) => define(this, input),
      verify: async (input) => verify(this, input),
      load: async (input) => load(this, input),
      issue: async (input) => issue(this, input),
      prepareRedemption: async (input) => prepareRedemption(this, input),
      inspectRedemption: async (input) => inspectRedemption(this, input),
      executeRedemption: async (input) => executeRedemption(this, input),
      verifyRedemption: async (input) => verifyRedemption(this, input),
      buildSettlement: async (input) => buildSettlement(this, input),
      verifySettlement: async (input) => verifySettlement(this, input),
      prepareClosing: async (input) => prepareClosing(this, input),
      inspectClosing: async (input) => inspectClosing(this, input),
      executeClosing: async (input) => executeClosing(this, input),
      verifyClosing: async (input) => verifyClosing(this, input),
      exportEvidence: async (input) => exportEvidence(this, input),
      exportFinalityPayload: async (input) => exportFinalityPayload(this, input),
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
