import { schnorr } from "@noble/curves/secp256k1.js";

function normalizeHex(hex) {
  return String(hex).trim().toLowerCase().replace(/^0x/, "");
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function hexToBytes(hex) {
  return Uint8Array.from(Buffer.from(normalizeHex(hex), "hex"));
}

export function randomSchnorrPrivkeyHex() {
  return bytesToHex(schnorr.utils.randomSecretKey());
}

export function schnorrXonlyFromPrivkeyHex(privkeyHex) {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privkeyHex)));
}

export function resolveRuntimeKeyPair(input) {
  const explicitPrivkey = input.explicitPrivkey ? normalizeHex(input.explicitPrivkey) : "";
  const explicitXonly = input.explicitXonly ? normalizeHex(input.explicitXonly) : "";
  const state = input.runtimeState ?? null;
  const privkeyStateKey = input.privkeyStateKey;
  const xonlyStateKey = input.xonlyStateKey;

  let privkeyHex = explicitPrivkey || (state && state[privkeyStateKey]) || "";
  let xonly = explicitXonly || (state && state[xonlyStateKey]) || "";

  if (privkeyHex) {
    const derivedXonly = schnorrXonlyFromPrivkeyHex(privkeyHex);
    if (xonly && xonly !== derivedXonly) {
      throw new Error(`${input.label} xonly does not match ${input.label} privkey`);
    }
    xonly = derivedXonly;
  } else if (xonly) {
    throw new Error(`${input.label} privkey is required when ${input.label} xonly is supplied`);
  } else {
    privkeyHex = randomSchnorrPrivkeyHex();
    xonly = schnorrXonlyFromPrivkeyHex(privkeyHex);
  }

  if (state) {
    state[privkeyStateKey] = privkeyHex;
    state[xonlyStateKey] = xonly;
  }

  return {
    privkeyHex,
    xonly,
  };
}
