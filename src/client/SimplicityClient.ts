import { loadArtifact } from "../core/artifact";
import { compileFromFile, compileFromPreset } from "../core/compiler";
import { ElementsRpcClient } from "../core/rpc";
import {
  CompileFromFileInput,
  CompileFromPresetInput,
  SimplicityArtifact,
  SimplicityClientConfig,
} from "../core/types";
import { RelayerClient } from "../gasless/RelayerClient";
import { GaslessTransferInput, GaslessTransferResult, RelayerClientConfig } from "../gasless/types";
import { CompiledContract } from "./ContractFactory";
import { DeployedContract } from "./DeployedContract";

export class SimplicityClient {
  public readonly rpc: ElementsRpcClient;
  public readonly payments: {
    gaslessTransfer: (input: GaslessTransferInput) => Promise<GaslessTransferResult>;
  };

  constructor(public readonly config: SimplicityClientConfig) {
    this.rpc = new ElementsRpcClient(config.rpc);
    this.payments = {
      gaslessTransfer: async (input) => this.gaslessTransfer(input),
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
