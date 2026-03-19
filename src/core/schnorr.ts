import { schnorr } from "@noble/curves/secp256k1.js";
import { ValidationError } from "./errors";

type SchnorrModule = typeof import("@noble/curves/secp256k1.js");

// Keep native dynamic import intact under CommonJS output so Node can load the ESM-only noble package.
const nativeImport = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<unknown>;

let schnorrPromise: Promise<SchnorrModule["schnorr"]> | undefined;

async function loadSchnorr() {
  schnorrPromise ??= nativeImport("@noble/curves/secp256k1.js").then((module) => {
    const typed = module as SchnorrModule;
    return typed.schnorr;
  });
  return schnorrPromise;
}

function assertHex(value: string, byteLength: number | null, code: string, message: string): void {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new ValidationError(message, { code });
  }
  if (byteLength !== null && value.length !== byteLength * 2) {
    throw new ValidationError(message, { code });
  }
}

export function hexToBytes(hex: string, byteLength: number | null = null): Uint8Array {
  const normalized = hex.trim().toLowerCase().replace(/^0x/, "");
  assertHex(normalized, byteLength, "SCHNORR_HEX_INVALID", "Expected a valid hex string");
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export async function schnorrPublicKeyFromPrivkeyHex(privkeyHex: string): Promise<string> {
  const schnorr = await loadSchnorr();
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privkeyHex, 32)));
}

export async function schnorrSignHex(messageHashHex: string, privkeyHex: string): Promise<string> {
  const schnorr = await loadSchnorr();
  return bytesToHex(schnorr.sign(hexToBytes(messageHashHex, 32), hexToBytes(privkeyHex, 32)));
}

export async function schnorrVerifyHex(
  signatureHex: string,
  messageHashHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  const schnorr = await loadSchnorr();
  return schnorr.verify(
    hexToBytes(signatureHex, 64),
    hexToBytes(messageHashHex, 32),
    hexToBytes(publicKeyHex, 32),
  );
}
