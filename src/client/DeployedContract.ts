import { executeContractCall, findContractUtxos, inspectContractCall } from "../core/executor";
import { verifyDefinitionAgainstArtifact } from "../core/definition";
import {
  ArtifactDefinitionMetadata,
  ContractUtxo,
  DefinitionInput,
  ExecuteCallInput,
  ExecuteResult,
  GaslessExecuteInput,
  GaslessExecuteResult,
  InspectCallInput,
  InspectResult,
  SimplicityArtifact,
  SimplicityClientConfig,
  WaitForFundingInput,
} from "../core/types";
import { executeGaslessContractCall } from "../core/executor";

export class DeployedContract {
  constructor(
    private readonly config: SimplicityClientConfig,
    public readonly artifact: SimplicityArtifact,
    public readonly contractAddress: string = artifact.compiled.contractAddress
  ) {}

  async findUtxos(): Promise<ContractUtxo[]> {
    return findContractUtxos(this.config, this.artifact);
  }

  async waitForFunding(input: WaitForFundingInput = {}): Promise<ContractUtxo[]> {
    const minAmountSat = input.minAmountSat ?? 1;
    const pollIntervalMs = input.pollIntervalMs ?? 10_000;
    const timeoutMs = input.timeoutMs ?? 120_000;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const utxos = await this.findUtxos();
      const filtered = utxos.filter((utxo) => utxo.sat >= minAmountSat);
      if (filtered.length > 0) {
        return filtered;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Timed out waiting for funding at ${this.contractAddress}`);
  }

  async inspectCall(input: InspectCallInput): Promise<InspectResult> {
    return inspectContractCall(this.config, this.artifact, input);
  }

  async execute(input: ExecuteCallInput): Promise<ExecuteResult> {
    return executeContractCall(this.config, this.artifact, input);
  }

  async executeGasless(input: GaslessExecuteInput): Promise<GaslessExecuteResult> {
    return executeGaslessContractCall(this.config, this.artifact, input);
  }

  async getTrustedDefinition(input: {
    jsonPath?: string;
    value?: unknown;
    type?: string;
    id?: string;
    schemaVersion?: string;
  }): Promise<{
    verified: boolean;
    definition: Awaited<ReturnType<typeof verifyDefinitionAgainstArtifact>>["definition"];
    artifactDefinition: ArtifactDefinitionMetadata | null;
    reason?: string;
    trust: Awaited<ReturnType<typeof verifyDefinitionAgainstArtifact>>["trust"];
  }> {
    const verification = await verifyDefinitionAgainstArtifact({
      artifact: this.artifact,
      definition: {
        type: input.type ?? this.artifact.definition?.definitionType ?? "",
        id: input.id ?? this.artifact.definition?.definitionId ?? "",
        schemaVersion: input.schemaVersion,
        jsonPath: input.jsonPath,
        value: input.value,
      } satisfies DefinitionInput,
      expectedType: this.artifact.definition?.definitionType,
      expectedId: this.artifact.definition?.definitionId,
    });
    return {
      verified: verification.ok,
      definition: verification.definition,
      artifactDefinition: verification.artifactDefinition ?? null,
      reason: verification.reason,
      trust: verification.trust,
    };
  }
}
