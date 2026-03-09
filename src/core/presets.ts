import path from "node:path";
import { ValidationError } from "./errors";
import { PresetManifestEntry } from "./types";

const PRESET_DIR = path.resolve(__dirname, "..", "presets");

export const PRESET_MANIFEST: Record<string, PresetManifestEntry> = {
  p2pkLockHeight: {
    id: "p2pkLockHeight",
    title: "P2PK + Lock Height",
    description: "Single signer contract gated by block height.",
    simfTemplatePath: path.join(PRESET_DIR, "p2pkLockHeight.simf.tmpl"),
    parameterSchema: {
      MIN_HEIGHT: "number",
      SIGNER_XONLY: "string",
    },
    witnessSchema: {
      SIGNER_SIGNATURE: {
        type: "Signature",
        description: "Primary signer signature over sig_all_hash.",
      },
    },
    exampleWitness: {
      values: {
        SIGNER_SIGNATURE: {
          type: "Signature",
          value: "${SIGNATURE}",
        },
      },
    },
    executionProfile: {
      witnessMode: "inlineSignature",
      supportsGasless: true,
      supportsDirectExecute: true,
      supportsRelayerExecute: true,
      requiredWitnessFields: ["SIGNER_SIGNATURE"],
      defaultFeeSat: 100,
      recommendedUtxoPolicy: "smallest_over",
    },
    exampleParams: {
      MIN_HEIGHT: 2344430,
      SIGNER_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
  },
  p2pk: {
    id: "p2pk",
    title: "P2PK",
    description: "Single key spend preset.",
    simfTemplatePath: path.join(PRESET_DIR, "p2pk.simf.tmpl"),
    parameterSchema: {
      SIGNER_XONLY: "string",
    },
    witnessSchema: {
      SIGNER_SIGNATURE: {
        type: "Signature",
        description: "Primary signer signature over sig_all_hash.",
      },
    },
    exampleWitness: {
      values: {
        SIGNER_SIGNATURE: {
          type: "Signature",
          value: "${SIGNATURE}",
        },
      },
    },
    executionProfile: {
      witnessMode: "inlineSignature",
      supportsGasless: true,
      supportsDirectExecute: true,
      supportsRelayerExecute: true,
      requiredWitnessFields: ["SIGNER_SIGNATURE"],
      defaultFeeSat: 100,
      recommendedUtxoPolicy: "smallest_over",
    },
    exampleParams: {
      SIGNER_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
  },
  htlc: {
    id: "htlc",
    title: "HTLC",
    description: "Template placeholder around upstream HTLC example.",
    simfTemplatePath: path.join(PRESET_DIR, "htlc.simf.tmpl"),
    parameterSchema: {
      EXPECTED_HASH: "string",
      RECIPIENT_XONLY: "string",
      SENDER_XONLY: "string",
      TIMEOUT_HEIGHT: "number",
    },
    witnessSchema: {
      COMPLETE_OR_CANCEL: {
        type: "Either<(u256, Signature), Signature>",
        description: "Use Left((preimage, recipient signature)) for claim or Right(sender signature) for timeout.",
      },
    },
    exampleWitness: {
      values: {
        COMPLETE_OR_CANCEL: {
          type: "Either<(u256, Signature), Signature>",
          value: "Left((0x0000000000000000000000000000000000000000000000000000000000000000, ${SIGNATURE}))",
        },
      },
    },
    executionProfile: {
      witnessMode: "inlineSignature",
      supportsGasless: true,
      supportsDirectExecute: true,
      supportsRelayerExecute: true,
      requiredWitnessFields: ["COMPLETE_OR_CANCEL"],
      defaultFeeSat: 100,
      recommendedUtxoPolicy: "smallest_over",
    },
    exampleParams: {
      EXPECTED_HASH: "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925",
      RECIPIENT_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      SENDER_XONLY: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
      TIMEOUT_HEIGHT: 1000,
    },
  },
  transferWithTimeout: {
    id: "transferWithTimeout",
    title: "Transfer With Timeout",
    description: "Cooperative transfer path plus unilateral timeout recovery path.",
    simfTemplatePath: path.join(PRESET_DIR, "transferWithTimeout.simf.tmpl"),
    parameterSchema: {
      SENDER_XONLY: "string",
      RECIPIENT_XONLY: "string",
      TIMEOUT_HEIGHT: "number",
    },
    witnessSchema: {
      SENDER_SIG: {
        type: "Signature",
        description: "Sender signature over sig_all_hash.",
      },
      TRANSFER_OR_TIMEOUT: {
        type: "Option<Signature>",
        signerAlias: "RECIPIENT",
        description: "Use Some(recipient signature) for cooperative spend or None for timeout recovery.",
      },
    },
    exampleWitness: {
      signers: {
        RECIPIENT: {
          type: "schnorrPrivkeyHex",
          privkeyHex: "<recipient-privkey-hex>",
        },
      },
      values: {
        SENDER_SIG: {
          type: "Signature",
          value: "${SIGNATURE}",
        },
        TRANSFER_OR_TIMEOUT: {
          type: "Option<Signature>",
          value: "Some(${SIGNATURE:RECIPIENT})",
        },
      },
    },
    executionProfile: {
      witnessMode: "inlineSignature",
      supportsGasless: true,
      supportsDirectExecute: true,
      supportsRelayerExecute: true,
      requiredWitnessFields: ["SENDER_SIG", "TRANSFER_OR_TIMEOUT"],
      defaultFeeSat: 100,
      recommendedUtxoPolicy: "smallest_over",
    },
    exampleParams: {
      SENDER_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      RECIPIENT_XONLY: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
      TIMEOUT_HEIGHT: 1000,
    },
  },
};

export function listPresets(): PresetManifestEntry[] {
  return Object.values(PRESET_MANIFEST);
}

export function getPresetOrThrow(preset: string): PresetManifestEntry {
  const entry = PRESET_MANIFEST[preset];
  if (!entry) {
    throw new ValidationError(`Unknown preset: ${preset}`);
  }
  return entry;
}

export function validatePresetParams(
  preset: PresetManifestEntry,
  params: Record<string, string | number>
): Record<string, string | number> {
  const normalized: Record<string, string | number> = {};
  for (const [key, kind] of Object.entries(preset.parameterSchema)) {
    const value = params[key];
    if (value === undefined) {
      throw new ValidationError(`Missing preset parameter: ${key}`);
    }
    if (kind === "number") {
      const asNumber = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(asNumber)) {
        throw new ValidationError(`Preset parameter ${key} must be a number`);
      }
      normalized[key] = asNumber;
      continue;
    }
    normalized[key] = String(value);
  }
  return normalized;
}

export function describePreset(preset: PresetManifestEntry): Record<string, unknown> {
  return {
    id: preset.id,
    title: preset.title,
    description: preset.description,
    parameterSchema: preset.parameterSchema,
    witnessSchema: preset.witnessSchema ?? {},
    exampleParams: preset.exampleParams,
    exampleWitness: preset.exampleWitness ?? null,
    executionProfile: preset.executionProfile,
  };
}

export function validateWitnessConfig(
  preset: PresetManifestEntry,
  witness:
    | {
        values?: Record<string, { type: string; value: string }>;
        signers?: Record<string, { type: "schnorrPrivkeyHex"; privkeyHex: string }>;
      }
    | undefined
): void {
  const schema = preset.witnessSchema ?? {};
  const values = witness?.values ?? {};
  const signers = witness?.signers ?? {};

  for (const field of preset.executionProfile.requiredWitnessFields) {
    if (!(field in values) && field !== "SIGNER_SIGNATURE") {
      throw new ValidationError(`Missing witness value for preset '${preset.id}': ${field}`);
    }
  }

  for (const [name, entry] of Object.entries(values)) {
    const spec = schema[name];
    if (!spec) {
      throw new ValidationError(`Unexpected witness field for preset '${preset.id}': ${name}`);
    }
    if (entry.type !== spec.type) {
      throw new ValidationError(
        `Witness field '${name}' for preset '${preset.id}' must use type '${spec.type}'`
      );
    }
  }

  for (const [name, spec] of Object.entries(schema)) {
    if (!spec.signerAlias) continue;
    const placeholder = `\${SIGNATURE:${spec.signerAlias}}`;
    if ((values[name]?.value ?? "").includes(placeholder) && !signers[spec.signerAlias]) {
      throw new ValidationError(
        `Witness field '${name}' references ${placeholder} but signer '${spec.signerAlias}' was not provided`
      );
    }
  }
}
