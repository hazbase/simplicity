import { RelayerError } from "../core/errors";
import {
  PsetStatusResult,
  RelayerClientConfig,
  RequestPsetInput,
  RequestPsetResult,
  RequestSimplicityExecutionInput,
  RequestSimplicityExecutionResult,
  SimplicityStatusResult,
  SubmitSignedPsetInput,
  SubmitSignedPsetResult,
  SubmitSimplicityExecutionInput,
  SubmitSimplicityExecutionResult,
} from "./types";

export class RelayerClient {
  constructor(private readonly config: RelayerClientConfig) {}

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.config.apiKey,
    };
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new RelayerError(
        payload?.error?.message ?? `Relayer request failed with status ${response.status}`,
        payload,
        response.status
      );
    }
    return payload as T;
  }

  async requestPset(input: RequestPsetInput): Promise<RequestPsetResult> {
    const response = await fetch(`${this.config.baseUrl}/pset/request`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
    });
    return this.parseResponse<RequestPsetResult>(response);
  }

  async submitSignedPset(input: SubmitSignedPsetInput): Promise<SubmitSignedPsetResult> {
    const response = await fetch(`${this.config.baseUrl}/pset/submit`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
    });
    return this.parseResponse<SubmitSignedPsetResult>(response);
  }

  async getPsetStatus(psetId: string): Promise<PsetStatusResult> {
    const response = await fetch(`${this.config.baseUrl}/pset/${psetId}`, {
      method: "GET",
      headers: this.headers(),
    });
    return this.parseResponse<PsetStatusResult>(response);
  }

  async requestSimplicityExecution(
    input: RequestSimplicityExecutionInput
  ): Promise<RequestSimplicityExecutionResult> {
    const response = await fetch(`${this.config.baseUrl}/simplicity/request`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
    });
    return this.parseResponse<RequestSimplicityExecutionResult>(response);
  }

  async submitSimplicityExecution(
    input: SubmitSimplicityExecutionInput
  ): Promise<SubmitSimplicityExecutionResult> {
    const response = await fetch(`${this.config.baseUrl}/simplicity/submit`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(input),
    });
    return this.parseResponse<SubmitSimplicityExecutionResult>(response);
  }

  async getSimplicityStatus(requestId: string): Promise<SimplicityStatusResult> {
    const response = await fetch(`${this.config.baseUrl}/simplicity/${requestId}`, {
      method: "GET",
      headers: this.headers(),
    });
    return this.parseResponse<SimplicityStatusResult>(response);
  }
}
