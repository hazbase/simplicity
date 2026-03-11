import { loadArtifact } from "../core/artifact";
import { compileFromFile, compileFromPreset } from "../core/compiler";
import { loadDefinitionInput, verifyDefinitionAgainstArtifact } from "../core/definition";
import { loadStateInput, verifyStateAgainstArtifact } from "../core/state";
import { ValidationError } from "../core/errors";
import { ElementsRpcClient } from "../core/rpc";
import {
  BondDefinition,
  BondIssuanceState,
  BondSettlementDescriptor,
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
  buildBondPayload,
  buildBondRedemption,
  buildBondTransitionPayload,
  buildBondRolloverPlan,
  buildBondMachineRolloverPlan,
  buildBondMachineSettlementPlan,
  buildBondSettlementDescriptor,
  buildBondSettlementPayload,
  compileBondRedemptionMachine,
  compileBondTransition,
  defineBond,
  executeBondStateRollover,
  executeBondMachineRollover,
  executeBondMachineSettlement,
  inspectBondStateRollover,
  inspectBondMachineRollover,
  inspectBondMachineSettlement,
  loadBond,
  redeemBond,
  verifyBond,
  verifyBondSettlementDescriptor,
  verifyBondRedemptionMachineArtifact,
  verifyBondTransition,
} from "../domain/bond";

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
    redeemBond: (input: {
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      amount: number;
      redeemedAt: string;
      simfPath?: string;
      artifactPath?: string;
    }) => ReturnType<typeof redeemBond>;
    verifyBondTransition: (input: {
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
    }) => ReturnType<typeof verifyBondTransition>;
    buildBondRedemption: (input: {
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      amount: number;
      redeemedAt: string;
    }) => ReturnType<typeof buildBondRedemption>;
    buildBondPayload: (input: {
      artifactPath?: string;
      artifact?: SimplicityArtifact;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      issuancePath?: string;
      issuanceValue?: BondIssuanceState;
    }) => ReturnType<typeof buildBondPayload>;
    buildBondTransitionPayload: (input: {
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
    }) => ReturnType<typeof buildBondTransitionPayload>;
    buildBondSettlementDescriptor: (input: {
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      nextStateSimfPath?: string;
      nextAmountSat: number;
      maxFeeSat?: number;
    }) => ReturnType<typeof buildBondSettlementDescriptor>;
    verifyBondSettlementDescriptor: (input: {
      descriptorPath?: string;
      descriptorValue?: BondSettlementDescriptor;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      nextStateSimfPath?: string;
      nextAmountSat?: number;
      maxFeeSat?: number;
    }) => ReturnType<typeof verifyBondSettlementDescriptor>;
    buildBondSettlementPayload: (input: {
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      nextStateSimfPath?: string;
      nextAmountSat: number;
      maxFeeSat?: number;
    }) => ReturnType<typeof buildBondSettlementPayload>;
    buildBondRolloverPlan: (input: {
      currentArtifactPath?: string;
      currentArtifact?: SimplicityArtifact;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      nextSimfPath?: string;
      nextArtifactPath?: string;
    }) => ReturnType<typeof buildBondRolloverPlan>;
    buildBondMachineRolloverPlan: (input: {
      currentArtifactPath?: string;
      currentArtifact?: SimplicityArtifact;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      nextStateSimfPath?: string;
      machineSimfPath?: string;
      machineArtifactPath?: string;
    }) => ReturnType<typeof buildBondMachineRolloverPlan>;
    buildBondMachineSettlementPlan: (input: {
      currentMachineArtifactPath?: string;
      currentMachineArtifact?: SimplicityArtifact;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      nextSimfPath?: string;
      nextArtifactPath?: string;
    }) => ReturnType<typeof buildBondMachineSettlementPlan>;
    compileBondTransition: (input: {
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      simfPath?: string;
      artifactPath?: string;
    }) => ReturnType<typeof compileBondTransition>;
    compileBondRedemptionMachine: (input: {
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      nextStateSimfPath?: string;
      nextAmountSat?: number;
      maxFeeSat?: number;
      simfPath?: string;
      artifactPath?: string;
    }) => ReturnType<typeof compileBondRedemptionMachine>;
    verifyBondRedemptionMachineArtifact: (input: {
      artifactPath?: string;
      artifact?: SimplicityArtifact;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      nextStateSimfPath?: string;
      nextAmountSat?: number;
      maxFeeSat?: number;
    }) => ReturnType<typeof verifyBondRedemptionMachineArtifact>;
    inspectBondStateRollover: (input: {
      currentArtifactPath?: string;
      currentArtifact?: SimplicityArtifact;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      nextSimfPath?: string;
      nextArtifactPath?: string;
      wallet: string;
      signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
      feeSat?: number;
      utxoPolicy?: "smallest_over" | "largest" | "newest";
    }) => ReturnType<typeof inspectBondStateRollover>;
    inspectBondMachineRollover: (input: {
      currentArtifactPath?: string;
      currentArtifact?: SimplicityArtifact;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      machineSimfPath?: string;
      machineArtifactPath?: string;
      wallet: string;
      signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
      feeSat?: number;
      utxoPolicy?: "smallest_over" | "largest" | "newest";
    }) => ReturnType<typeof inspectBondMachineRollover>;
    inspectBondMachineSettlement: (input: {
      currentMachineArtifactPath?: string;
      currentMachineArtifact?: SimplicityArtifact;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      nextSimfPath?: string;
      nextArtifactPath?: string;
      wallet: string;
      signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
      feeSat?: number;
      utxoPolicy?: "smallest_over" | "largest" | "newest";
    }) => ReturnType<typeof inspectBondMachineSettlement>;
    executeBondStateRollover: (input: {
      currentArtifactPath?: string;
      currentArtifact?: SimplicityArtifact;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      nextSimfPath?: string;
      nextArtifactPath?: string;
      wallet: string;
      signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
      feeSat?: number;
      utxoPolicy?: "smallest_over" | "largest" | "newest";
      broadcast?: boolean;
    }) => ReturnType<typeof executeBondStateRollover>;
    executeBondMachineRollover: (input: {
      currentArtifactPath?: string;
      currentArtifact?: SimplicityArtifact;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      machineSimfPath?: string;
      machineArtifactPath?: string;
      wallet: string;
      signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
      feeSat?: number;
      utxoPolicy?: "smallest_over" | "largest" | "newest";
      broadcast?: boolean;
    }) => ReturnType<typeof executeBondMachineRollover>;
    executeBondMachineSettlement: (input: {
      currentMachineArtifactPath?: string;
      currentMachineArtifact?: SimplicityArtifact;
      definitionPath?: string;
      definitionValue?: BondDefinition;
      previousIssuancePath?: string;
      previousIssuanceValue?: BondIssuanceState;
      nextIssuancePath?: string;
      nextIssuanceValue?: BondIssuanceState;
      nextSimfPath?: string;
      nextArtifactPath?: string;
      wallet: string;
      signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
      feeSat?: number;
      utxoPolicy?: "smallest_over" | "largest" | "newest";
      broadcast?: boolean;
    }) => ReturnType<typeof executeBondMachineSettlement>;
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
      redeemBond: async (input) => redeemBond(this, input),
      verifyBondTransition: async (input) => verifyBondTransition(this, input),
      buildBondRedemption: async (input) => buildBondRedemption(this, input),
      buildBondPayload: async (input) => buildBondPayload(this, input),
      buildBondTransitionPayload: async (input) => buildBondTransitionPayload(this, input),
      buildBondSettlementDescriptor: async (input) => buildBondSettlementDescriptor(this, input),
      verifyBondSettlementDescriptor: async (input) => verifyBondSettlementDescriptor(this, input),
      buildBondSettlementPayload: async (input) => buildBondSettlementPayload(this, input),
      buildBondRolloverPlan: async (input) => buildBondRolloverPlan(this, input),
      buildBondMachineRolloverPlan: async (input) => buildBondMachineRolloverPlan(this, input),
      buildBondMachineSettlementPlan: async (input) => buildBondMachineSettlementPlan(this, input),
      compileBondTransition: async (input) => compileBondTransition(this, input),
      compileBondRedemptionMachine: async (input) => compileBondRedemptionMachine(this, input),
      verifyBondRedemptionMachineArtifact: async (input) => verifyBondRedemptionMachineArtifact(this, input),
      inspectBondStateRollover: async (input) => inspectBondStateRollover(this, input),
      inspectBondMachineRollover: async (input) => inspectBondMachineRollover(this, input),
      inspectBondMachineSettlement: async (input) => inspectBondMachineSettlement(this, input),
      executeBondStateRollover: async (input) => executeBondStateRollover(this, input),
      executeBondMachineRollover: async (input) => executeBondMachineRollover(this, input),
      executeBondMachineSettlement: async (input) => executeBondMachineSettlement(this, input),
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
