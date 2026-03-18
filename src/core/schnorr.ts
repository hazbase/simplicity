import { schnorr } from "@noble/curves/secp256k1.js";
import { ValidationError } from "./errors";

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

export function schnorrPublicKeyFromPrivkeyHex(privkeyHex: string): string {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privkeyHex, 32)));
}

export function schnorrSignHex(messageHashHex: string, privkeyHex: string): string {
  return bytesToHex(schnorr.sign(hexToBytes(messageHashHex, 32), hexToBytes(privkeyHex, 32)));
}

export function schnorrVerifyHex(signatureHex: string, messageHashHex: string, publicKeyHex: string): boolean {
  return schnorr.verify(
    hexToBytes(signatureHex, 64),
    hexToBytes(messageHashHex, 32),
    hexToBytes(publicKeyHex, 32),
  );
}
