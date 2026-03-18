import path from "node:path";
import { schnorr } from "@noble/curves/secp256k1.js";
import { createSimplicityClient } from "../src";

export function exampleValue(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function deriveXonlyFromPrivkeyHex(privkeyHex: string): string {
  return Buffer.from(schnorr.getPublicKey(Buffer.from(privkeyHex, "hex"))).toString("hex");
}

export function resolveExamplePath(defaultRelativePath: string, envName: string): string {
  return process.env[envName] || path.resolve(process.cwd(), defaultRelativePath);
}

export function createExampleClient() {
  return createSimplicityClient({
    network: "liquidtestnet",
    rpc: {
      url: exampleValue("ELEMENTS_RPC_URL", "http://127.0.0.1:18884"),
      username: exampleValue("ELEMENTS_RPC_USER", "<rpc-user>"),
      password: exampleValue("ELEMENTS_RPC_PASSWORD", "<rpc-password>"),
      wallet: process.env.ELEMENTS_RPC_WALLET || "simplicity-test",
    },
    toolchain: {
      simcPath: process.env.SIMC_PATH || "simc",
      halSimplicityPath: process.env.HAL_SIMPLICITY_PATH || "hal-simplicity",
      elementsCliPath: process.env.ELEMENTS_CLI_PATH || "eltc",
    },
  });
}
