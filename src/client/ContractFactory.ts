import { saveArtifact } from "../core/artifact";
import { DeploymentInfo, SimplicityArtifact, SimplicityClientConfig } from "../core/types";
import { DeployedContract } from "./DeployedContract";

export class CompiledContract {
  constructor(
    private readonly config: SimplicityClientConfig,
    public readonly artifact: SimplicityArtifact
  ) {}

  get contractAddress(): string {
    return this.artifact.compiled.contractAddress;
  }

  get cmr(): string {
    return this.artifact.compiled.cmr;
  }

  get program(): string {
    return this.artifact.compiled.program;
  }

  deployment(): DeploymentInfo {
    return {
      contractAddress: this.artifact.compiled.contractAddress,
      internalKey: this.artifact.compiled.internalKey,
      cmr: this.artifact.compiled.cmr,
      network: this.artifact.network,
      instructions: [
        `Fund the contract by sending L-BTC to ${this.artifact.compiled.contractAddress}`,
        "Wait for the contract UTXO to appear before calling inspect/execute.",
      ],
    };
  }

  async saveArtifact(path: string): Promise<void> {
    await saveArtifact(path, this.artifact);
  }

  at(addressOverride?: string): DeployedContract {
    const artifact =
      addressOverride && addressOverride !== this.artifact.compiled.contractAddress
        ? {
            ...this.artifact,
            compiled: {
              ...this.artifact.compiled,
              contractAddress: addressOverride,
            },
          }
        : this.artifact;
    return new DeployedContract(this.config, artifact, artifact.compiled.contractAddress);
  }
}
