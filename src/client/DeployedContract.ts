import { executeContractCall, findContractUtxos, inspectContractCall } from "../core/executor";
import {
  ContractUtxo,
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
}
