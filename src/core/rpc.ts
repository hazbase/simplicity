import { Buffer } from "node:buffer";
import { RpcConfig } from "./types";
import { ExecutionError } from "./errors";

export class ElementsRpcClient {
  constructor(private readonly config: RpcConfig) {}

  private endpoint(wallet?: string): string {
    if (!wallet && !this.config.wallet) return this.config.url;
    const selectedWallet = wallet ?? this.config.wallet;
    return `${this.config.url}/wallet/${selectedWallet}`;
  }

  async call<T>(method: string, params: unknown[] = [], wallet?: string): Promise<T> {
    const basicAuth = Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64");
    const response = await fetch(this.endpoint(wallet), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({ jsonrpc: "1.0", id: method, method, params }),
    });

    const payload = (await response.json()) as {
      result?: T;
      error?: { code?: number; message?: string } | null;
    };

    if (!response.ok || payload.error) {
      const rpcMessage = payload.error?.message ? `: ${payload.error.message}` : "";
      const rpcCode = payload.error?.code === undefined ? "" : ` (code ${payload.error.code})`;
      throw new ExecutionError(`RPC ${method} failed${rpcCode}${rpcMessage}`, {
        status: response.status,
        error: payload.error,
      });
    }
    return payload.result as T;
  }
}
