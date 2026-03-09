import test from "node:test";
import assert from "node:assert/strict";
import { getPresetOrThrow, listPresets, validatePresetParams, validateWitnessConfig } from "../core/presets";
import { ValidationError } from "../core/errors";

test("listPresets exposes built-in catalog", () => {
  const presets = listPresets();
  assert.ok(presets.some((entry) => entry.id === "p2pkLockHeight"));
});

test("validatePresetParams coerces numeric params", () => {
  const preset = getPresetOrThrow("p2pkLockHeight");
  const params = validatePresetParams(preset, {
    MIN_HEIGHT: "123",
    SIGNER_XONLY: "79be",
  });
  assert.equal(params.MIN_HEIGHT, 123);
});

test("unknown preset throws ValidationError", () => {
  assert.throws(() => getPresetOrThrow("missing"), ValidationError);
});

test("p2pk is marked as relayer-executable", () => {
  const preset = getPresetOrThrow("p2pk");
  assert.equal(preset.executionProfile.supportsRelayerExecute, true);
  assert.deepEqual(preset.executionProfile.requiredWitnessFields, ["SIGNER_SIGNATURE"]);
});

test("htlc declares custom witness requirements", () => {
  const preset = getPresetOrThrow("htlc");
  assert.equal(preset.executionProfile.supportsDirectExecute, true);
  assert.equal(preset.executionProfile.supportsRelayerExecute, true);
  assert.deepEqual(preset.executionProfile.requiredWitnessFields, ["COMPLETE_OR_CANCEL"]);
});

test("transferWithTimeout exposes multi-witness execution support", () => {
  const preset = getPresetOrThrow("transferWithTimeout");
  assert.equal(preset.executionProfile.supportsDirectExecute, true);
  assert.equal(preset.executionProfile.supportsRelayerExecute, true);
  assert.deepEqual(preset.executionProfile.requiredWitnessFields, ["SENDER_SIG", "TRANSFER_OR_TIMEOUT"]);
});

test("validateWitnessConfig accepts cooperative transferWithTimeout witness", () => {
  const preset = getPresetOrThrow("transferWithTimeout");
  assert.doesNotThrow(() =>
    validateWitnessConfig(preset, {
      signers: {
        RECIPIENT: {
          type: "schnorrPrivkeyHex",
          privkeyHex: "02".padStart(64, "0"),
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
    })
  );
});

test("validateWitnessConfig rejects missing named signer", () => {
  const preset = getPresetOrThrow("transferWithTimeout");
  assert.throws(
    () =>
      validateWitnessConfig(preset, {
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
      }),
    ValidationError
  );
});
