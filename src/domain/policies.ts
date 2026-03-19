import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { SimplicityClient } from "../client/SimplicityClient";
import type {
  BondOutputBindingMode,
  OutputRawFields,
  PolicyOutputAmountForm,
  PolicyOutputAssetForm,
  PolicyEvidenceBundle,
  PolicyEvidenceBundleSchemaVersion,
  PolicyOutputBindingReasonCode,
  PolicyOutputBindingSupportedForm,
  PolicyOutputDescriptor,
  PolicyOutputNonceForm,
  PolicyReceiver,
  PolicyOutputRangeProofForm,
  PolicyState,
  PolicyTemplateDocument,
  PolicyTemplateManifest,
  PolicyTemplateManifestValidationResult,
  PolicyTemplateManifestVersion,
  PolicyTemplateInput,
  PolicyTransferDescriptor,
  PolicyVerificationReport,
  PolicyVerificationReportSchemaVersion,
  PropagationMode,
  SimplicityArtifact,
} from "../core/types";
import { sha256HexUtf8, stableStringify } from "../core/summary";
import { ValidationError } from "../core/errors";
import {
  analyzeOutputRawFields,
  computeExplicitV1OutputHash,
  computeRawOutputV1Hash,
  getScriptPubKeyHexViaRpc,
  hashHexBytes,
  isExplicitV1OutputForm,
  normalizeOutputForm,
  normalizeOutputRawFields,
  resolveExplicitAssetHex,
  resolveOutputBindingDecision,
} from "../core/outputBinding";
import { buildVerificationTrustSummary } from "../core/reporting";

function resolvePolicyDocsAsset(filename: string): string {
  const cwdCandidate = path.resolve(process.cwd(), "docs/definitions", filename);
  if (existsSync(cwdCandidate)) {
    return cwdCandidate;
  }
  const bundledCandidate = path.resolve(__dirname, "../docs/definitions", filename);
  if (existsSync(bundledCandidate)) {
    return bundledCandidate;
  }
  return cwdCandidate;
}

export const POLICY_TEMPLATE_MANIFEST_SCHEMA_VERSION: PolicyTemplateManifestVersion = "policy-template-manifest/v1";
export const POLICY_VERIFICATION_REPORT_SCHEMA_VERSION: PolicyVerificationReportSchemaVersion =
  "policy-verification-report/v1";
export const POLICY_EVIDENCE_BUNDLE_SCHEMA_VERSION: PolicyEvidenceBundleSchemaVersion =
  "policy-evidence-bundle/v1";

const POLICY_TEMPLATE_MANIFESTS: Record<string, Omit<PolicyTemplateManifest, "stateSimfPath" | "directStateSimfPath"> & {
  stateSimfFilename: string;
  directStateSimfFilename?: string;
}> = {
  "recursive-delay-required": {
    templateId: "recursive-delay-required",
    manifestVersion: POLICY_TEMPLATE_MANIFEST_SCHEMA_VERSION,
    title: "Recursive Delay (Required)",
    description: "1tx recursive delay covenant that requires the next hop to remain policy-aware.",
    stateSimfFilename: "recursive-delay-required.simf",
    directStateSimfFilename: "recursive-delay-required.simf",
    parameterSchema: { lockDistanceBlocks: "number" },
    supportedBindingModes: ["script-bound", "descriptor-bound"],
    supportsPlainExit: false,
    defaultPropagationMode: "required",
  },
  "recursive-delay-optional": {
    templateId: "recursive-delay-optional",
    manifestVersion: POLICY_TEMPLATE_MANIFEST_SCHEMA_VERSION,
    title: "Recursive Delay (Optional)",
    description: "1tx recursive delay covenant that can plain-exit or continue into the next policy-aware hop.",
    stateSimfFilename: "recursive-delay-optional.simf",
    directStateSimfFilename: "recursive-delay-required.simf",
    parameterSchema: { lockDistanceBlocks: "number" },
    supportedBindingModes: ["none", "script-bound", "descriptor-bound"],
    supportsPlainExit: true,
    defaultPropagationMode: "optional",
  },
};

function resolveManifestKey(templateId: string, propagationMode?: PropagationMode): string {
  if (templateId in POLICY_TEMPLATE_MANIFESTS) return templateId;
  if (templateId === "recursive-delay") {
    return propagationMode === "required" ? "recursive-delay-required" : "recursive-delay-optional";
  }
  throw new ValidationError(`Unknown policy template: ${templateId}`, {
    code: "POLICY_TEMPLATE_UNKNOWN",
  });
}

function materializeBuiltInManifest(
  manifest: typeof POLICY_TEMPLATE_MANIFESTS[string],
): PolicyTemplateManifest {
  return {
    templateId: manifest.templateId,
    manifestVersion: manifest.manifestVersion,
    title: manifest.title,
    description: manifest.description,
    stateSimfPath: resolvePolicyDocsAsset(manifest.stateSimfFilename),
    ...(manifest.directStateSimfFilename
      ? { directStateSimfPath: resolvePolicyDocsAsset(manifest.directStateSimfFilename) }
      : {}),
    parameterSchema: manifest.parameterSchema,
    supportedBindingModes: manifest.supportedBindingModes,
    supportsPlainExit: manifest.supportsPlainExit,
    defaultPropagationMode: manifest.defaultPropagationMode,
  };
}

export function listPolicyTemplates(): PolicyTemplateManifest[] {
  return Object.values(POLICY_TEMPLATE_MANIFESTS).map((manifest) => materializeBuiltInManifest(manifest));
}

export function describePolicyTemplate(input: { templateId: string; propagationMode?: PropagationMode }): PolicyTemplateManifest {
  const manifest = POLICY_TEMPLATE_MANIFESTS[resolveManifestKey(input.templateId, input.propagationMode)];
  return materializeBuiltInManifest(manifest);
}

export function validatePolicyTemplateManifest(input: {
  manifestValue: unknown;
}): PolicyTemplateManifestValidationResult {
  const value = input.manifestValue;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      reasonCode: "MANIFEST_FIELD_REQUIRED",
      reason: "Policy template manifest must be an object",
    };
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.manifestVersion !== POLICY_TEMPLATE_MANIFEST_SCHEMA_VERSION) {
    return {
      ok: false,
      reasonCode: "MANIFEST_VERSION_UNSUPPORTED",
      reason: `manifestVersion must be ${POLICY_TEMPLATE_MANIFEST_SCHEMA_VERSION}`,
    };
  }
  if (typeof manifest.templateId !== "string" || manifest.templateId.trim().length === 0) {
    return {
      ok: false,
      reasonCode: "MANIFEST_FIELD_REQUIRED",
      reason: "templateId must be a non-empty string",
    };
  }
  if (typeof manifest.title !== "string" || manifest.title.trim().length === 0) {
    return {
      ok: false,
      reasonCode: "MANIFEST_FIELD_REQUIRED",
      reason: "title must be a non-empty string",
    };
  }
  if (typeof manifest.description !== "string" || manifest.description.trim().length === 0) {
    return {
      ok: false,
      reasonCode: "MANIFEST_FIELD_REQUIRED",
      reason: "description must be a non-empty string",
    };
  }
  if (typeof manifest.stateSimfPath !== "string" || manifest.stateSimfPath.trim().length === 0) {
    return {
      ok: false,
      reasonCode: "MANIFEST_FIELD_REQUIRED",
      reason: "stateSimfPath must be a non-empty string",
    };
  }
  if (
    manifest.directStateSimfPath !== undefined
    && (typeof manifest.directStateSimfPath !== "string" || manifest.directStateSimfPath.trim().length === 0)
  ) {
    return {
      ok: false,
      reasonCode: "MANIFEST_FIELD_INVALID",
      reason: "directStateSimfPath must be a non-empty string when provided",
    };
  }
  if (!manifest.parameterSchema || typeof manifest.parameterSchema !== "object" || Array.isArray(manifest.parameterSchema)) {
    return {
      ok: false,
      reasonCode: "MANIFEST_PARAMETER_SCHEMA_INVALID",
      reason: "parameterSchema must be an object",
    };
  }
  for (const [key, kind] of Object.entries(manifest.parameterSchema as Record<string, unknown>)) {
    if (!["string", "number", "boolean"].includes(String(kind))) {
      return {
        ok: false,
        reasonCode: "MANIFEST_PARAMETER_SCHEMA_INVALID",
        reason: `parameterSchema.${key} must be string, number, or boolean`,
      };
    }
  }
  if (!Array.isArray(manifest.supportedBindingModes) || manifest.supportedBindingModes.length === 0) {
    return {
      ok: false,
      reasonCode: "MANIFEST_BINDING_MODE_INVALID",
      reason: "supportedBindingModes must be a non-empty array",
    };
  }
  for (const mode of manifest.supportedBindingModes) {
    if (!["none", "script-bound", "descriptor-bound"].includes(String(mode))) {
      return {
        ok: false,
        reasonCode: "MANIFEST_BINDING_MODE_INVALID",
        reason: `Unsupported binding mode: ${String(mode)}`,
      };
    }
  }
  if (typeof manifest.supportsPlainExit !== "boolean") {
    return {
      ok: false,
      reasonCode: "MANIFEST_FIELD_INVALID",
      reason: "supportsPlainExit must be a boolean",
    };
  }
  if (!["required", "optional", "none"].includes(String(manifest.defaultPropagationMode))) {
    return {
      ok: false,
      reasonCode: "MANIFEST_PROPAGATION_MODE_INVALID",
      reason: "defaultPropagationMode must be required, optional, or none",
    };
  }
  return {
    ok: true,
    reasonCode: "OK",
    manifest: {
      templateId: manifest.templateId as string,
      manifestVersion: manifest.manifestVersion as PolicyTemplateManifestVersion,
      title: manifest.title as string,
      description: manifest.description as string,
      stateSimfPath: manifest.stateSimfPath as string,
      ...(manifest.directStateSimfPath ? { directStateSimfPath: manifest.directStateSimfPath as string } : {}),
      parameterSchema: manifest.parameterSchema as Record<string, "string" | "number" | "boolean">,
      supportedBindingModes: manifest.supportedBindingModes as BondOutputBindingMode[],
      supportsPlainExit: manifest.supportsPlainExit as boolean,
      defaultPropagationMode: manifest.defaultPropagationMode as PropagationMode,
    },
  };
}

export async function loadPolicyTemplateManifest(input: {
  templateId?: string;
  propagationMode?: PropagationMode;
  manifestPath?: string;
  manifestValue?: unknown;
}): Promise<PolicyTemplateManifest> {
  if (input.manifestValue !== undefined) {
    const validated = validatePolicyTemplateManifest({ manifestValue: input.manifestValue });
    if (!validated.ok || !validated.manifest) {
      throw new ValidationError(validated.reason ?? "Policy template manifest is invalid", {
        code: validated.reasonCode,
      });
    }
    return validated.manifest;
  }
  if (input.manifestPath) {
    const raw = await readFile(input.manifestPath, "utf8");
    const validated = validatePolicyTemplateManifest({ manifestValue: JSON.parse(raw) });
    if (!validated.ok || !validated.manifest) {
      throw new ValidationError(validated.reason ?? "Policy template manifest is invalid", {
        code: validated.reasonCode,
      });
    }
    return validated.manifest;
  }
  if (!input.templateId) {
    throw new ValidationError("templateId or manifestPath/manifestValue is required", {
      code: "POLICY_TEMPLATE_MANIFEST_REQUIRED",
    });
  }
  return describePolicyTemplate({
    templateId: input.templateId,
    propagationMode: input.propagationMode,
  });
}

function resolveValueOrPath<T>(options: { pathValue?: string; objectValue?: T }): { jsonPath?: string; value?: T } {
  if (options.pathValue) return { jsonPath: options.pathValue };
  if (options.objectValue !== undefined) return { value: options.objectValue };
  return {};
}

function validatePropagationMode(mode: PropagationMode): PropagationMode {
  if (mode !== "required" && mode !== "optional" && mode !== "none") {
    throw new ValidationError("propagationMode must be required, optional, or none", {
      code: "POLICY_PROPAGATION_MODE_INVALID",
    });
  }
  return mode;
}

function validateReceiver(receiver: PolicyReceiver): PolicyReceiver {
  if (receiver.mode === "plain") {
    if (!receiver.address || receiver.address.trim().length === 0) {
      throw new ValidationError("plain receiver requires a non-empty address", {
        code: "POLICY_RECEIVER_ADDRESS_REQUIRED",
      });
    }
    return receiver;
  }
  if (!receiver.recipientXonly || receiver.recipientXonly.trim().length === 0) {
    throw new ValidationError("policy receiver requires recipientXonly", {
      code: "POLICY_RECEIVER_XONLY_REQUIRED",
    });
  }
  return receiver;
}

function validatePolicyTemplateDocument(value: unknown, templateId: string): PolicyTemplateDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { policyTemplateId: templateId };
  }
  const record = value as Record<string, unknown>;
  const policyTemplateId = typeof record.policyTemplateId === "string" && record.policyTemplateId.trim().length > 0
    ? record.policyTemplateId
    : templateId;
  return {
    policyTemplateId,
    ...(typeof record.description === "string" ? { description: record.description } : {}),
    ...(record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? { metadata: record.metadata as Record<string, unknown> }
      : {}),
  };
}

function summarizePolicyTemplateDocument(doc: PolicyTemplateDocument): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(doc);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

function normalizeParams(params: Record<string, string | number | boolean> | undefined): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(params ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function validatePolicyTemplateParams(input: {
  templateId?: string;
  manifestValue?: PolicyTemplateManifest;
  params?: Record<string, string | number | boolean>;
  propagationMode?: PropagationMode;
}): Record<string, string | number | boolean> {
  const manifest = input.manifestValue
    ? input.manifestValue
    : describePolicyTemplate({
        templateId: input.templateId ?? "recursive-delay",
        propagationMode: input.propagationMode,
      });
  const params = normalizeParams(input.params);
  for (const [key, value] of Object.entries(params)) {
    const expected = manifest.parameterSchema[key];
    if (!expected) {
      throw new ValidationError(`Unknown policy parameter: ${key}`, {
        code: "POLICY_PARAM_UNKNOWN",
      });
    }
    if (expected === "number" && !(typeof value === "number" && Number.isFinite(value))) {
      throw new ValidationError(`Policy parameter ${key} must be a number`, {
        code: "POLICY_PARAM_TYPE_INVALID",
      });
    }
    if (expected === "string" && typeof value !== "string") {
      throw new ValidationError(`Policy parameter ${key} must be a string`, {
        code: "POLICY_PARAM_TYPE_INVALID",
      });
    }
    if (expected === "boolean" && typeof value !== "boolean") {
      throw new ValidationError(`Policy parameter ${key} must be a boolean`, {
        code: "POLICY_PARAM_TYPE_INVALID",
      });
    }
  }
  return params;
}

function summarizePolicyHash(input: {
  template: PolicyTemplateDocument;
  recipient: string;
  params: Record<string, string | number | boolean>;
  propagationMode: PropagationMode;
}): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify({
    policyTemplateId: input.template.policyTemplateId,
    recipient: input.recipient,
    params: normalizeParams(input.params),
    propagationMode: input.propagationMode,
  });
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function summarizePolicyState(state: PolicyState): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify({
    policyTemplateId: state.policyTemplateId,
    policyHash: state.policyHash,
    recipient: state.recipient,
    amountSat: state.amountSat,
    assetId: state.assetId,
    params: normalizeParams(state.params),
    propagationMode: state.propagationMode,
    previousStateHash: state.previousStateHash ?? null,
    hop: state.hop,
    status: state.status,
  });
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function validatePolicyState(state: PolicyState): PolicyState {
  if (!state.policyTemplateId || state.policyTemplateId.trim().length === 0) {
    throw new ValidationError("policyTemplateId must be a non-empty string", { code: "POLICY_TEMPLATE_ID_REQUIRED" });
  }
  if (!/^[0-9a-f]{64}$/i.test(state.policyHash)) {
    throw new ValidationError("policyHash must be a 64-character hex string", { code: "POLICY_HASH_INVALID" });
  }
  if (!state.recipient || state.recipient.trim().length === 0) {
    throw new ValidationError("recipient must be a non-empty string", { code: "POLICY_RECIPIENT_REQUIRED" });
  }
  if (!Number.isInteger(state.amountSat) || state.amountSat <= 0) {
    throw new ValidationError("amountSat must be a positive integer", { code: "POLICY_AMOUNT_INVALID" });
  }
  if (!state.assetId || state.assetId.trim().length === 0) {
    throw new ValidationError("assetId must be a non-empty string", { code: "POLICY_ASSET_REQUIRED" });
  }
  validatePropagationMode(state.propagationMode);
  if (!Number.isInteger(state.hop) || state.hop < 0) {
    throw new ValidationError("hop must be a non-negative integer", { code: "POLICY_HOP_INVALID" });
  }
  if (state.status !== "LOCKED" && state.status !== "SPENT") {
    throw new ValidationError("status must be LOCKED or SPENT", { code: "POLICY_STATUS_INVALID" });
  }
  return state;
}

export function summarizePolicyOutputDescriptor(descriptor: PolicyOutputDescriptor): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify({
    assetId: descriptor.assetId,
    feeIndex: descriptor.feeIndex,
    maxFeeSat: descriptor.maxFeeSat,
    nextAmountSat: descriptor.nextAmountSat,
    nextContractAddress: descriptor.nextContractAddress,
    nextOutputHash: descriptor.nextOutputHash ?? null,
    nextOutputScriptHash: descriptor.nextOutputScriptHash ?? null,
    nextOutputIndex: descriptor.nextOutputIndex,
    requestedOutputBindingMode: descriptor.requestedOutputBindingMode ?? descriptor.outputBindingMode,
    outputForm: descriptor.outputForm ?? normalizeOutputForm(),
    rawOutput: normalizeOutputRawFields(descriptor.rawOutput) ?? null,
    outputBindingMode: descriptor.outputBindingMode,
  });
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function validatePolicyOutputDescriptor(descriptor: PolicyOutputDescriptor): PolicyOutputDescriptor {
  if (!descriptor.nextContractAddress || descriptor.nextContractAddress.trim().length === 0) {
    throw new ValidationError("nextContractAddress must be a non-empty string", {
      code: "POLICY_NEXT_CONTRACT_REQUIRED",
    });
  }
  if (!Number.isInteger(descriptor.nextAmountSat) || descriptor.nextAmountSat <= 0) {
    throw new ValidationError("nextAmountSat must be a positive integer", { code: "POLICY_NEXT_AMOUNT_INVALID" });
  }
  if (!descriptor.assetId || descriptor.assetId.trim().length === 0) {
    throw new ValidationError("assetId must be a non-empty string", { code: "POLICY_OUTPUT_ASSET_REQUIRED" });
  }
  if (!Number.isInteger(descriptor.feeIndex) || descriptor.feeIndex < 0) {
    throw new ValidationError("feeIndex must be a non-negative integer", { code: "POLICY_FEE_INDEX_INVALID" });
  }
  if (!Number.isInteger(descriptor.nextOutputIndex) || descriptor.nextOutputIndex < 0) {
    throw new ValidationError("nextOutputIndex must be a non-negative integer", { code: "POLICY_NEXT_OUTPUT_INDEX_INVALID" });
  }
  if (!Number.isInteger(descriptor.maxFeeSat) || descriptor.maxFeeSat < 0) {
    throw new ValidationError("maxFeeSat must be a non-negative integer", { code: "POLICY_MAX_FEE_INVALID" });
  }
  if (!["none", "script-bound", "descriptor-bound"].includes(descriptor.outputBindingMode)) {
    throw new ValidationError("outputBindingMode must be none, script-bound, or descriptor-bound", {
      code: "POLICY_OUTPUT_BINDING_MODE_INVALID",
    });
  }
  if (
    descriptor.requestedOutputBindingMode
    && !["none", "script-bound", "descriptor-bound"].includes(descriptor.requestedOutputBindingMode)
  ) {
    throw new ValidationError("requestedOutputBindingMode must be none, script-bound, or descriptor-bound", {
      code: "POLICY_REQUESTED_OUTPUT_BINDING_MODE_INVALID",
    });
  }
  if (descriptor.nextOutputScriptHash && !/^[0-9a-f]{64}$/i.test(descriptor.nextOutputScriptHash)) {
    throw new ValidationError("nextOutputScriptHash must be a 64-character hex string", {
      code: "POLICY_NEXT_OUTPUT_SCRIPT_HASH_INVALID",
    });
  }
  if (descriptor.nextOutputHash && !/^[0-9a-f]{64}$/i.test(descriptor.nextOutputHash)) {
    throw new ValidationError("nextOutputHash must be a 64-character hex string", {
      code: "POLICY_NEXT_OUTPUT_HASH_INVALID",
    });
  }
  descriptor.rawOutput = normalizeOutputRawFields(descriptor.rawOutput);
  const outputForm = normalizeOutputForm(descriptor.outputForm);
  descriptor.outputForm = outputForm;
  descriptor.requestedOutputBindingMode = descriptor.requestedOutputBindingMode ?? descriptor.outputBindingMode;
  return descriptor;
}

export function summarizePolicyTransferDescriptor(descriptor: PolicyTransferDescriptor): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify({
    policyTemplateId: descriptor.policyTemplateId,
    previousPolicyHash: descriptor.previousPolicyHash,
    nextPolicyHash: descriptor.nextPolicyHash ?? null,
    previousStateHash: descriptor.previousStateHash,
    nextStateHash: descriptor.nextStateHash ?? null,
    propagationMode: descriptor.propagationMode,
    plainExitAddress: descriptor.plainExitAddress ?? null,
    outputDescriptor: descriptor.outputDescriptor
      ? JSON.parse(summarizePolicyOutputDescriptor(descriptor.outputDescriptor).canonicalJson)
      : null,
  });
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}

export function validatePolicyTransferDescriptor(descriptor: PolicyTransferDescriptor): PolicyTransferDescriptor {
  if (!descriptor.policyTemplateId || descriptor.policyTemplateId.trim().length === 0) {
    throw new ValidationError("policyTemplateId must be a non-empty string", {
      code: "POLICY_TRANSFER_TEMPLATE_ID_REQUIRED",
    });
  }
  if (!/^[0-9a-f]{64}$/i.test(descriptor.previousPolicyHash)) {
    throw new ValidationError("previousPolicyHash must be a 64-character hex string", {
      code: "POLICY_TRANSFER_PREVIOUS_HASH_INVALID",
    });
  }
  if (!/^[0-9a-f]{64}$/i.test(descriptor.previousStateHash)) {
    throw new ValidationError("previousStateHash must be a 64-character hex string", {
      code: "POLICY_TRANSFER_PREVIOUS_STATE_HASH_INVALID",
    });
  }
  if (descriptor.nextPolicyHash && !/^[0-9a-f]{64}$/i.test(descriptor.nextPolicyHash)) {
    throw new ValidationError("nextPolicyHash must be a 64-character hex string", {
      code: "POLICY_TRANSFER_NEXT_HASH_INVALID",
    });
  }
  if (descriptor.nextStateHash && !/^[0-9a-f]{64}$/i.test(descriptor.nextStateHash)) {
    throw new ValidationError("nextStateHash must be a 64-character hex string", {
      code: "POLICY_TRANSFER_NEXT_STATE_HASH_INVALID",
    });
  }
  validatePropagationMode(descriptor.propagationMode);
  if (descriptor.outputDescriptor) {
    validatePolicyOutputDescriptor(descriptor.outputDescriptor);
  }
  return descriptor;
}

function satToBtcAmount(sat: number): number {
  return Number((sat / 1e8).toFixed(8));
}

function resolvePolicySequence(state: PolicyState): number | undefined {
  const raw = state.params.lockDistanceBlocks;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
    return raw;
  }
  return undefined;
}

function buildPolicyMachineWitness(prepared: Awaited<ReturnType<typeof prepareTransfer>>) {
  return {
    values: {
      NEXT_POLICY_HASH: {
        type: "u256",
        value: `0x${prepared.transferDescriptor.nextPolicyHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      NEXT_OUTPUT_DESCRIPTOR_HASH: {
        type: "u256",
        value: `0x${prepared.transferSummary.hash}`,
      },
      EXPECTED_NEXT_OUTPUT_HASH: {
        type: "u256",
        value: `0x${prepared.transferDescriptor.outputDescriptor?.nextOutputHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      EXPECTED_NEXT_OUTPUT_SCRIPT_HASH: {
        type: "u256",
        value: `0x${prepared.transferDescriptor.outputDescriptor?.nextOutputScriptHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      OUTPUT_BINDING_MODE: {
        type: "u8",
        value:
          prepared.transferDescriptor.outputDescriptor?.outputBindingMode === "descriptor-bound"
            ? "0x01"
            : prepared.transferDescriptor.outputDescriptor?.outputBindingMode === "script-bound"
              ? "0x02"
              : "0x03",
      },
    },
  };
}

function buildPolicyDirectWitness(prepared: Awaited<ReturnType<typeof prepareDirectTransfer>>) {
  return {
    values: {
      NEXT_POLICY_HASH: {
        type: "u256",
        value: `0x${prepared.transferDescriptor.nextPolicyHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      NEXT_OUTPUT_DESCRIPTOR_HASH: {
        type: "u256",
        value: `0x${prepared.transferSummary.hash}`,
      },
      EXPECTED_NEXT_OUTPUT_HASH: {
        type: "u256",
        value: `0x${prepared.transferDescriptor.outputDescriptor?.nextOutputHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      EXPECTED_NEXT_OUTPUT_SCRIPT_HASH: {
        type: "u256",
        value: `0x${prepared.transferDescriptor.outputDescriptor?.nextOutputScriptHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      OUTPUT_BINDING_MODE: {
        type: "u8",
        value:
          prepared.transferDescriptor.outputDescriptor?.outputBindingMode === "descriptor-bound"
            ? "0x01"
            : prepared.transferDescriptor.outputDescriptor?.outputBindingMode === "script-bound"
              ? "0x02"
              : "0x03",
      },
    },
  };
}

function buildPolicyRecursiveWitness(prepared: {
  transferDescriptor: PolicyTransferDescriptor;
  transferSummary: { canonicalJson: string; hash: string };
}) {
  return {
    values: {
      NEXT_POLICY_HASH: {
        type: "u256",
        value: `0x${prepared.transferDescriptor.nextPolicyHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      NEXT_OUTPUT_DESCRIPTOR_HASH: {
        type: "u256",
        value: `0x${prepared.transferSummary.hash}`,
      },
      EXPECTED_NEXT_OUTPUT_HASH: {
        type: "u256",
        value: `0x${prepared.transferDescriptor.outputDescriptor?.nextOutputHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      EXPECTED_NEXT_OUTPUT_SCRIPT_HASH: {
        type: "u256",
        value: `0x${prepared.transferDescriptor.outputDescriptor?.nextOutputScriptHash ?? "0000000000000000000000000000000000000000000000000000000000000000"}`,
      },
      OUTPUT_BINDING_MODE: {
        type: "u8",
        value:
          prepared.transferDescriptor.outputDescriptor?.outputBindingMode === "descriptor-bound"
            ? "0x01"
            : prepared.transferDescriptor.outputDescriptor?.outputBindingMode === "script-bound"
              ? "0x02"
              : "0x03",
      },
    },
  };
}

function camelToUpperSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function buildPolicyTemplateVars(input: {
  recipientXonly: string;
  policyHash: string;
  params: Record<string, string | number | boolean>;
  propagationMode?: PropagationMode;
  outputBindingMode?: BondOutputBindingMode;
  previousPolicyHash?: string;
  nextPolicyHash?: string;
  nextOutputDescriptorHash?: string;
  nextOutputHash?: string;
  nextOutputScriptHash?: string;
}): Record<string, string | number> {
  const vars: Record<string, string | number> = {
    SIGNER_XONLY: input.recipientXonly,
    RECIPIENT_XONLY: input.recipientXonly,
    POLICY_HASH: input.policyHash,
  };

  for (const [key, value] of Object.entries(input.params)) {
    const templateKey = camelToUpperSnake(key);
    vars[templateKey] = typeof value === "boolean" ? (value ? 1 : 0) : value;
    if (key === "lockDistanceBlocks") {
      vars.LOCK_DISTANCE = typeof value === "boolean" ? (value ? 1 : 0) : value;
    }
  }

  if (input.propagationMode) {
    vars.PROPAGATION_MODE_8 = input.propagationMode === "required" ? 1 : input.propagationMode === "optional" ? 2 : 3;
    vars.ALLOW_PLAIN_EXIT_8 = input.propagationMode === "optional" || input.propagationMode === "none" ? 1 : 0;
    vars.REQUIRE_RECURSIVE_NEXT_8 = input.propagationMode === "required" ? 1 : 0;
    vars.REQUIRE_MACHINE_HOP_8 = input.propagationMode === "required" ? 1 : 0;
  }
  if (input.outputBindingMode) {
    vars.OUTPUT_BINDING_MODE_8 =
      input.outputBindingMode === "descriptor-bound"
        ? 1
        : input.outputBindingMode === "script-bound"
          ? 2
          : 3;
  }
  if (input.previousPolicyHash) vars.PREVIOUS_POLICY_HASH = input.previousPolicyHash;
  if (input.nextPolicyHash) vars.NEXT_POLICY_HASH = input.nextPolicyHash;
  if (input.nextOutputDescriptorHash) vars.NEXT_OUTPUT_DESCRIPTOR_HASH = input.nextOutputDescriptorHash;
  vars.EXPECTED_NEXT_OUTPUT_HASH_256 =
    input.nextOutputHash ?? "0000000000000000000000000000000000000000000000000000000000000000";
  vars.EXPECTED_NEXT_OUTPUT_SCRIPT_HASH_256 =
    input.nextOutputScriptHash ?? "0000000000000000000000000000000000000000000000000000000000000000";
  vars.ROUTER_MACHINE_SCRIPT_HASH_256 =
    input.nextOutputScriptHash ?? "0000000000000000000000000000000000000000000000000000000000000000";
  return vars;
}

async function resolveTemplateDocument(
  sdk: SimplicityClient,
  input: PolicyTemplateInput,
  propagationMode?: PropagationMode,
): Promise<{
  document: PolicyTemplateDocument;
  summary: { canonicalJson: string; hash: string };
  manifest: PolicyTemplateManifest;
  stateSimfPath: string;
  directStateSimfPath: string;
  transferMachineSimfPath: string;
}> {
  const manifest = await loadPolicyTemplateManifest({
    templateId: input.templateId,
    propagationMode,
    manifestPath: input.manifestPath,
    manifestValue: input.manifestValue,
  });
  const definitionSource = resolveValueOrPath({
    pathValue: input.jsonPath,
    objectValue: input.value as PolicyTemplateDocument | undefined,
  });
  const templateId = input.templateId ?? manifest.templateId;
  const definition = await sdk.loadDefinition({
    type: "policy-template",
    id: templateId,
    ...(definitionSource.jsonPath || definitionSource.value
      ? definitionSource
      : { value: { policyTemplateId: templateId } }),
  });
  const document = validatePolicyTemplateDocument(JSON.parse(definition.canonicalJson), templateId);
  return {
    document,
    summary: summarizePolicyTemplateDocument(document),
    manifest,
    stateSimfPath: input.stateSimfPath ?? manifest.stateSimfPath,
    directStateSimfPath: input.directStateSimfPath ?? manifest.directStateSimfPath ?? manifest.stateSimfPath,
    transferMachineSimfPath: input.transferMachineSimfPath ?? resolvePolicyDocsAsset("recursive-policy-transfer-machine.simf"),
  };
}

function createPolicyState(input: {
  template: PolicyTemplateDocument;
  recipientXonly: string;
  amountSat: number;
  assetId: string;
  params: Record<string, string | number | boolean>;
  propagationMode: PropagationMode;
  previousStateHash?: string | null;
  hop: number;
}): PolicyState {
  const policySummary = summarizePolicyHash({
    template: input.template,
    recipient: input.recipientXonly,
    params: input.params,
    propagationMode: input.propagationMode,
  });
  return validatePolicyState({
    policyTemplateId: input.template.policyTemplateId,
    policyHash: policySummary.hash,
    recipient: input.recipientXonly,
    amountSat: input.amountSat,
    assetId: input.assetId,
    params: normalizeParams(input.params),
    propagationMode: input.propagationMode,
    previousStateHash: input.previousStateHash ?? null,
    hop: input.hop,
    status: "LOCKED",
  });
}

function resolvePolicyEnforcementMode(input: {
  currentPropagationMode: PropagationMode;
  nextReceiverMode?: PolicyReceiver["mode"];
}): PolicyVerificationReport["enforcement"] {
  if (input.currentPropagationMode === "required") {
    return "direct-hop";
  }
  if (input.currentPropagationMode === "optional" && input.nextReceiverMode === "policy") {
    return "conditional-hop";
  }
  return "sdk-path";
}

function assertDirectArtifactCompatibility(
  artifact: SimplicityArtifact,
  template: Awaited<ReturnType<typeof resolveTemplateDocument>>,
) {
  const actual = artifact.source.simfPath ? path.basename(artifact.source.simfPath) : undefined;
  const expected = path.basename(template.directStateSimfPath);
  if (actual !== expected) {
    throw new ValidationError(`Current artifact is not using the direct-hop state contract (${expected})`, {
      code: "POLICY_DIRECT_HOP_ARTIFACT_REQUIRED",
    });
  }
}

async function compilePolicyStateContractInternal(
  sdk: SimplicityClient,
  input: {
    template: PolicyTemplateInput;
    stateValue: PolicyState;
    routerMachineScriptHash?: string;
    nextPolicyHash?: string;
    nextOutputDescriptorHash?: string;
    nextOutputScriptHash?: string;
    artifactPath?: string;
  },
) {
  const template = await resolveTemplateDocument(sdk, input.template);
  return sdk.compileFromFile({
    simfPath: input.stateValue.propagationMode === "required"
      ? template.directStateSimfPath
      : template.stateSimfPath,
    templateVars: buildPolicyTemplateVars({
      recipientXonly: input.stateValue.recipient,
      policyHash: input.stateValue.policyHash,
      params: input.stateValue.params,
      propagationMode: input.stateValue.propagationMode,
      nextPolicyHash: input.nextPolicyHash,
      nextOutputDescriptorHash: input.nextOutputDescriptorHash,
      outputBindingMode: input.stateValue.propagationMode === "required" || input.stateValue.propagationMode === "optional"
        ? "script-bound"
        : undefined,
      nextOutputScriptHash: input.stateValue.propagationMode === "required"
        ? input.nextOutputScriptHash
        : input.stateValue.propagationMode === "optional"
          ? input.nextOutputScriptHash
          : input.routerMachineScriptHash,
    }),
    definition: {
      type: "policy-template",
      id: template.document.policyTemplateId,
      value: template.document,
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: "policy-state",
      id: `${input.stateValue.policyTemplateId}-${input.stateValue.hop}`,
      value: input.stateValue,
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });
}

async function compilePolicyRouterMachineInternal(
  sdk: SimplicityClient,
  input: {
    template: PolicyTemplateInput;
    currentState: PolicyState;
    artifactPath?: string;
  },
) {
  const template = await resolveTemplateDocument(sdk, input.template);
  return sdk.compileFromFile({
    simfPath: template.transferMachineSimfPath,
    templateVars: buildPolicyTemplateVars({
      recipientXonly: input.currentState.recipient,
      policyHash: input.currentState.policyHash,
      params: input.currentState.params,
      propagationMode: input.currentState.propagationMode,
      outputBindingMode: "none",
      previousPolicyHash: input.currentState.policyHash,
      nextPolicyHash: input.currentState.policyHash,
      nextOutputDescriptorHash: "0000000000000000000000000000000000000000000000000000000000000000",
    }),
    definition: {
      type: "policy-template",
      id: template.document.policyTemplateId,
      value: template.document,
      anchorMode: "on-chain-constant-committed",
    },
    state: {
      type: "policy-state",
      id: `${input.currentState.policyTemplateId}-${input.currentState.hop}`,
      value: input.currentState,
      anchorMode: "on-chain-constant-committed",
    },
    artifactPath: input.artifactPath,
  });
}

async function getPolicyRouterMachineScriptHash(
  sdk: SimplicityClient,
  input: {
    template: PolicyTemplateInput;
    currentState: PolicyState;
  },
): Promise<string> {
  const router = await compilePolicyRouterMachineInternal(sdk, {
    template: input.template,
    currentState: input.currentState,
  });
  const scriptPubKeyHex = await getScriptPubKeyHexViaRpc(sdk, router.contractAddress);
  return hashHexBytes(scriptPubKeyHex);
}

export async function compilePolicyStateContract(
  sdk: SimplicityClient,
  input: {
    template: PolicyTemplateInput;
    stateValue: PolicyState;
    artifactPath?: string;
  },
) {
  const routerMachineScriptHash = input.stateValue.propagationMode !== "none"
    ? await getPolicyRouterMachineScriptHash(sdk, {
        template: input.template,
        currentState: input.stateValue,
      })
    : undefined;
  return compilePolicyStateContractInternal(sdk, {
    ...input,
    routerMachineScriptHash,
  });
}

export async function issue(
  sdk: SimplicityClient,
  input: {
    recipient: PolicyReceiver;
    template: PolicyTemplateInput;
    params?: Record<string, string | number | boolean>;
    amountSat: number;
    assetId: string;
    propagationMode?: PropagationMode;
    artifactPath?: string;
  },
) {
  const recipient = validateReceiver(input.recipient);
  if (recipient.mode !== "policy") {
    throw new ValidationError("issue requires a policy receiver", { code: "POLICY_ISSUE_RECEIVER_MODE_INVALID" });
  }
  const propagationMode = validatePropagationMode(input.propagationMode ?? "required");
  const template = await resolveTemplateDocument(sdk, input.template, propagationMode);
  const params = validatePolicyTemplateParams({
    templateId: template.manifest.templateId,
    params: { ...(recipient.defaultParams ?? {}), ...(input.params ?? {}) },
    propagationMode,
  });
  const stateValue = createPolicyState({
    template: template.document,
    recipientXonly: recipient.recipientXonly!,
    amountSat: input.amountSat,
    assetId: input.assetId,
    params,
    propagationMode,
    hop: 0,
  });
  const routerMachineScriptHash = propagationMode !== "none"
    ? await getPolicyRouterMachineScriptHash(sdk, {
        template: input.template,
        currentState: stateValue,
      })
    : undefined;
  const compiled = await compilePolicyStateContractInternal(sdk, {
    template: input.template,
    stateValue,
    routerMachineScriptHash,
    artifactPath: input.artifactPath,
  });
  return {
    compiled,
    state: stateValue,
    policyTemplate: template.document,
    policyHash: stateValue.policyHash,
  };
}

export async function verifyState(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    template?: PolicyTemplateInput;
    statePath?: string;
    stateValue?: PolicyState;
  },
) {
  const artifact = input.artifact ?? (input.artifactPath ? (await sdk.loadArtifact(input.artifactPath)).artifact : undefined);
  if (!artifact) {
    throw new ValidationError("artifactPath or artifact is required", { code: "POLICY_ARTIFACT_REQUIRED" });
  }
  const templateInput: PolicyTemplateInput = input.template ?? { templateId: artifact.definition?.definitionId ?? "recursive-delay" };
  const template = await resolveTemplateDocument(sdk, templateInput);
  const definitionVerification = await sdk.verifyDefinitionAgainstArtifact({
    artifact,
    type: "policy-template",
    id: template.document.policyTemplateId,
    value: template.document,
  });
  const stateVerification = await sdk.verifyStateAgainstArtifact({
    artifact,
    type: "policy-state",
    id: artifact.state?.stateId,
    ...(input.statePath ? { jsonPath: input.statePath } : input.stateValue ? { value: input.stateValue } : {}),
  });
  const state = validatePolicyState(JSON.parse(stateVerification.state.canonicalJson) as PolicyState);
  const expectedPolicyHash = summarizePolicyHash({
    template: template.document,
    recipient: state.recipient,
    params: state.params,
    propagationMode: state.propagationMode,
  }).hash;
  const policyHashMatches = expectedPolicyHash === state.policyHash;
  const report = {
    schemaVersion: POLICY_VERIFICATION_REPORT_SCHEMA_VERSION,
    templateTrust: definitionVerification.trust,
    stateTrust: stateVerification.trust,
    propagationMode: state.propagationMode,
    nextPolicyRequired: state.propagationMode === "required",
    nextPolicyPresent: false,
    plainExitAllowed: state.propagationMode !== "required",
    enforcement: resolvePolicyEnforcementMode({
      currentPropagationMode: state.propagationMode,
      nextReceiverMode: state.propagationMode === "required" ? "policy" : undefined,
    }),
  } satisfies PolicyVerificationReport;
  return {
    ok: definitionVerification.ok && stateVerification.ok && policyHashMatches,
    reason: policyHashMatches ? undefined : "Policy hash does not match template + params + recipient",
    artifact,
    template: definitionVerification,
    state: stateVerification,
    stateValue: state,
    policyHashMatches,
    report,
    trustSummary: buildVerificationTrustSummary({
      definitionTrust: definitionVerification.trust,
      stateTrust: stateVerification.trust,
      bindingMode: "none",
    }),
  };
}

export async function buildPolicyOutputDescriptor(
  sdk: SimplicityClient,
  input: {
    nextCompiledContractAddress: string;
    nextAmountSat: number;
    assetId: string;
    maxFeeSat?: number;
    nextOutputIndex?: number;
    feeIndex?: number;
    nextOutputHash?: string;
    outputForm?: {
      assetForm?: PolicyOutputAssetForm;
      amountForm?: PolicyOutputAmountForm;
      nonceForm?: PolicyOutputNonceForm;
      rangeProofForm?: PolicyOutputRangeProofForm;
    };
    rawOutput?: Partial<OutputRawFields>;
    outputBindingMode?: BondOutputBindingMode;
  },
) {
  const nextScriptPubKeyHex = await getScriptPubKeyHexViaRpc(sdk, input.nextCompiledContractAddress);
  const nextOutputScriptHash = hashHexBytes(nextScriptPubKeyHex);
  const requestedBindingMode = input.outputBindingMode ?? "script-bound";
  const outputForm = normalizeOutputForm(input.outputForm);
  const rawOutput = normalizeOutputRawFields(input.rawOutput);
  const rawOutputAnalysis = analyzeOutputRawFields(rawOutput);
  const explicitAssetHex = requestedBindingMode !== "none" && isExplicitV1OutputForm(outputForm)
    ? await resolveExplicitAssetHex(sdk, input.assetId)
    : undefined;
  const autoDerivedNextOutputHash = requestedBindingMode === "descriptor-bound" && !input.nextOutputHash
    ? rawOutputAnalysis.valid && rawOutputAnalysis.normalized
      ? computeRawOutputV1Hash(rawOutputAnalysis.normalized)
      : explicitAssetHex
        ? computeExplicitV1OutputHash({
            assetHex: explicitAssetHex,
            nextAmountSat: input.nextAmountSat,
            nextOutputScriptHash,
          })
        : undefined
    : undefined;
  const nextOutputHash = input.nextOutputHash ?? autoDerivedNextOutputHash;
  const bindingResolution = resolveOutputBindingDecision({
    requestedBindingMode,
    nextOutputHash,
    nextOutputScriptHash,
    autoDerivedNextOutputHash: Boolean(autoDerivedNextOutputHash && !input.nextOutputHash),
    explicitAssetSupported: Boolean(explicitAssetHex),
    outputForm,
    rawOutput,
  });
  const descriptor = validatePolicyOutputDescriptor({
    nextContractAddress: input.nextCompiledContractAddress,
    nextOutputHash: bindingResolution.outputBindingMode === "descriptor-bound" ? nextOutputHash : undefined,
    nextOutputScriptHash: bindingResolution.outputBindingMode !== "none" ? nextOutputScriptHash : undefined,
    nextAmountSat: input.nextAmountSat,
    assetId: input.assetId,
    requestedOutputBindingMode: requestedBindingMode,
    outputForm,
    rawOutput,
    feeIndex: input.feeIndex ?? 1,
    nextOutputIndex: input.nextOutputIndex ?? 0,
    maxFeeSat: input.maxFeeSat ?? 100,
    outputBindingMode: bindingResolution.outputBindingMode,
  });
  return {
    descriptor,
    summary: summarizePolicyOutputDescriptor(descriptor),
    supportedForm: bindingResolution.supportedForm,
    autoDerivedNextOutputHash: bindingResolution.autoDerived,
    reasonCode: bindingResolution.reasonCode,
    fallbackReason: bindingResolution.fallbackReason,
    bindingInputs: {
      assetId: descriptor.assetId,
      assetForm: descriptor.outputForm?.assetForm ?? "explicit",
      amountForm: descriptor.outputForm?.amountForm ?? "explicit",
      nonceForm: descriptor.outputForm?.nonceForm ?? "null",
      rangeProofForm: descriptor.outputForm?.rangeProofForm ?? "empty",
      nextAmountSat: descriptor.nextAmountSat,
      nextOutputIndex: descriptor.nextOutputIndex,
      feeIndex: descriptor.feeIndex,
      maxFeeSat: descriptor.maxFeeSat,
      ...(rawOutputAnalysis.valid && rawOutputAnalysis.normalized
        ? {
            rawOutputComponents: {
              scriptPubKey: rawOutputAnalysis.normalized.scriptComponentSource,
              rangeProof: rawOutputAnalysis.normalized.rangeProofComponentSource,
            },
          }
        : {}),
    },
  };
}

function buildPolicyOutputBindingReport(input: {
  descriptor?: PolicyOutputDescriptor;
  sdkVerified: boolean;
  supportedForm?: PolicyOutputBindingSupportedForm;
  autoDerived?: boolean;
  reasonCode?: PolicyOutputBindingReasonCode;
  fallbackReason?: string;
  bindingInputs?: {
    assetId: string;
    assetForm: PolicyOutputAssetForm;
    amountForm: PolicyOutputAmountForm;
    nonceForm: PolicyOutputNonceForm;
    rangeProofForm: PolicyOutputRangeProofForm;
    nextAmountSat: number;
    nextOutputIndex: number;
    feeIndex: number;
    maxFeeSat: number;
  };
}): PolicyVerificationReport["outputBinding"] | undefined {
  if (!input.descriptor) return undefined;
  return {
    mode: input.descriptor.outputBindingMode,
    supportedForm: input.supportedForm ?? "unsupported",
    committed: true,
    runtimeBound: input.descriptor.outputBindingMode !== "none",
    sdkVerified: input.sdkVerified,
    amountRuntimeBound: input.descriptor.outputBindingMode === "descriptor-bound",
    nextOutputHashRuntimeBound: input.descriptor.outputBindingMode === "descriptor-bound",
    nextOutputScriptRuntimeBound: input.descriptor.outputBindingMode === "script-bound",
    reasonCode:
      input.reasonCode
      ?? (input.descriptor.outputBindingMode === "descriptor-bound" ? "OK_MANUAL_HASH" : input.descriptor.outputBindingMode === "script-bound" ? "OK_SCRIPT_BOUND" : "OK_NONE"),
    nextOutputHash: input.descriptor.nextOutputHash,
    autoDerived: input.autoDerived,
    fallbackReason: input.fallbackReason,
    bindingInputs:
        input.bindingInputs
      ?? {
          assetId: input.descriptor.assetId,
          assetForm: input.descriptor.outputForm?.assetForm ?? "explicit",
          amountForm: input.descriptor.outputForm?.amountForm ?? "explicit",
          nonceForm: input.descriptor.outputForm?.nonceForm ?? "null",
          rangeProofForm: input.descriptor.outputForm?.rangeProofForm ?? "empty",
          nextAmountSat: input.descriptor.nextAmountSat,
          nextOutputIndex: input.descriptor.nextOutputIndex,
          feeIndex: input.descriptor.feeIndex,
          maxFeeSat: input.descriptor.maxFeeSat,
        },
  };
}

async function resolvePolicyOutputBindingVerificationContext(
  sdk: SimplicityClient,
  descriptor?: PolicyOutputDescriptor,
): Promise<{
  supportedForm?: PolicyOutputBindingSupportedForm;
  reasonCode?: PolicyOutputBindingReasonCode;
  autoDerived?: boolean;
  fallbackReason?: string;
  bindingInputs?: {
    assetId: string;
    assetForm: PolicyOutputAssetForm;
    amountForm: PolicyOutputAmountForm;
    nonceForm: PolicyOutputNonceForm;
    rangeProofForm: PolicyOutputRangeProofForm;
    nextAmountSat: number;
    nextOutputIndex: number;
    feeIndex: number;
    maxFeeSat: number;
    rawOutputComponents?: {
      scriptPubKey: "raw-bytes" | "hash";
      rangeProof: "raw-bytes" | "hash";
    };
  };
}> {
  if (!descriptor) return {};
  const rawOutput = normalizeOutputRawFields(descriptor.rawOutput);
  const rawOutputAnalysis = analyzeOutputRawFields(rawOutput);
  const bindingInputs = {
    assetId: descriptor.assetId,
    assetForm: descriptor.outputForm?.assetForm ?? "explicit",
    amountForm: descriptor.outputForm?.amountForm ?? "explicit",
    nonceForm: descriptor.outputForm?.nonceForm ?? "null",
    rangeProofForm: descriptor.outputForm?.rangeProofForm ?? "empty",
    nextAmountSat: descriptor.nextAmountSat,
    nextOutputIndex: descriptor.nextOutputIndex,
    feeIndex: descriptor.feeIndex,
    maxFeeSat: descriptor.maxFeeSat,
    ...(rawOutputAnalysis.valid && rawOutputAnalysis.normalized
      ? {
          rawOutputComponents: {
            scriptPubKey: rawOutputAnalysis.normalized.scriptComponentSource,
            rangeProof: rawOutputAnalysis.normalized.rangeProofComponentSource,
          },
        }
      : {}),
  };
  const requestedBindingMode = descriptor.requestedOutputBindingMode ?? descriptor.outputBindingMode;
  const outputForm = normalizeOutputForm(descriptor.outputForm);
  const outputFormSupported = isExplicitV1OutputForm(outputForm);
  const explicitAssetHex = !rawOutputAnalysis.valid && outputFormSupported
    ? await resolveExplicitAssetHex(sdk, descriptor.assetId)
    : undefined;
  const decision = resolveOutputBindingDecision({
    requestedBindingMode,
    nextOutputHash: descriptor.nextOutputHash,
    nextOutputScriptHash: descriptor.nextOutputScriptHash,
    autoDerivedNextOutputHash: false,
    explicitAssetSupported: Boolean(explicitAssetHex),
    outputForm,
    rawOutput,
  });

  if (descriptor.outputBindingMode === "none" || requestedBindingMode === "none") {
    return {
      supportedForm: decision.supportedForm,
      reasonCode: "OK_NONE",
      bindingInputs,
    };
  }

  if (descriptor.outputBindingMode === "script-bound") {
    return {
      supportedForm: decision.supportedForm,
      reasonCode: requestedBindingMode === "descriptor-bound" ? decision.reasonCode : "OK_SCRIPT_BOUND",
      fallbackReason: requestedBindingMode === "descriptor-bound" ? decision.fallbackReason : undefined,
      bindingInputs,
    };
  }

  if (!descriptor.nextOutputHash) {
    return {
      supportedForm: decision.supportedForm,
      reasonCode: decision.reasonCode,
      fallbackReason: decision.fallbackReason ?? "descriptor-bound artifact is missing nextOutputHash",
      bindingInputs,
    };
  }

  if (rawOutputAnalysis.valid && rawOutputAnalysis.normalized) {
    const derivedNextOutputHash = computeRawOutputV1Hash(rawOutputAnalysis.normalized);
    const autoDerived = derivedNextOutputHash === descriptor.nextOutputHash;
    return {
      supportedForm: "raw-output-v1",
      reasonCode: autoDerived ? "OK_RAW_OUTPUT" : "OK_MANUAL_HASH",
      autoDerived,
      bindingInputs,
    };
  }

  if (!outputFormSupported) {
    return {
      supportedForm: decision.supportedForm,
      reasonCode: "OK_MANUAL_HASH",
      bindingInputs,
    };
  }

  if (!explicitAssetHex || !descriptor.nextOutputScriptHash) {
    return {
      supportedForm: explicitAssetHex ? "explicit-v1" : "unsupported",
      reasonCode: !explicitAssetHex ? "OK_MANUAL_HASH" : "FALLBACK_UNSUPPORTED_OUTPUT_FORM",
      ...(explicitAssetHex
        ? {
            fallbackReason:
              "descriptor-bound output hash could not be auto-verified because the descriptor is missing the explicit-v1 output shape inputs",
          }
        : {}),
      bindingInputs,
    };
  }

  const derivedNextOutputHash = computeExplicitV1OutputHash({
    assetHex: explicitAssetHex,
    nextAmountSat: descriptor.nextAmountSat,
    nextOutputScriptHash: descriptor.nextOutputScriptHash,
  });
  const autoDerived = derivedNextOutputHash === descriptor.nextOutputHash;
  return {
    supportedForm: "explicit-v1",
    reasonCode: autoDerived ? "OK_EXPLICIT" : "OK_MANUAL_HASH",
    autoDerived,
    bindingInputs,
  };
}

export async function prepareTransfer(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    template: PolicyTemplateInput;
    currentStatePath?: string;
    currentStateValue?: PolicyState;
    nextReceiver: PolicyReceiver;
    nextAmountSat: number;
    nextParams?: Record<string, string | number | boolean>;
    propagationMode?: PropagationMode;
    nextArtifactPath?: string;
    machineArtifactPath?: string;
    nextOutputHash?: string;
    nextOutputForm?: {
      assetForm?: PolicyOutputAssetForm;
      amountForm?: PolicyOutputAmountForm;
      nonceForm?: PolicyOutputNonceForm;
      rangeProofForm?: PolicyOutputRangeProofForm;
    };
    nextRawOutput?: Partial<OutputRawFields>;
    outputBindingMode?: BondOutputBindingMode;
  },
) {
  const verifiedCurrent = await verifyState(sdk, {
    artifactPath: input.currentArtifactPath,
    artifact: input.currentArtifact,
    template: input.template,
    statePath: input.currentStatePath,
    stateValue: input.currentStateValue,
  });
  if (!verifiedCurrent.ok) {
    throw new ValidationError(verifiedCurrent.reason ?? "Current policy state verification failed", {
      code: "POLICY_CURRENT_STATE_INVALID",
    });
  }
  const currentState = verifiedCurrent.stateValue;
  const nextPropagationMode = validatePropagationMode(input.propagationMode ?? currentState.propagationMode);
  const nextReceiver = validateReceiver(input.nextReceiver);

  if (currentState.propagationMode === "required" && nextReceiver.mode === "plain") {
    throw new ValidationError("required propagation mode does not allow a plain-address exit", {
      code: "POLICY_REQUIRED_PROPAGATION_PLAIN_EXIT_FORBIDDEN",
    });
  }
  if (nextPropagationMode === "none" && nextReceiver.mode === "policy") {
    throw new ValidationError("propagationMode none does not create a next policy state", {
      code: "POLICY_NONE_MODE_POLICY_RECEIVER_FORBIDDEN",
    });
  }

  if (currentState.propagationMode === "required") {
    return prepareDirectTransfer(sdk, input as Parameters<typeof prepareDirectTransfer>[1]);
  }

  if (nextReceiver.mode === "plain") {
    const descriptor = validatePolicyTransferDescriptor({
      policyTemplateId: currentState.policyTemplateId,
      previousPolicyHash: currentState.policyHash,
      previousStateHash: summarizePolicyState(currentState).hash,
      propagationMode: currentState.propagationMode,
      plainExitAddress: nextReceiver.address,
    });
    const summary = summarizePolicyTransferDescriptor(descriptor);
    return {
      current: verifiedCurrent,
      nextState: null,
      nextCompiled: null,
      machineArtifact: null,
      transferDescriptor: descriptor,
      transferSummary: summary,
      verificationReport: {
        ...verifiedCurrent.report,
        nextPolicyPresent: false,
        plainExitAllowed: true,
        enforcement: resolvePolicyEnforcementMode({
          currentPropagationMode: currentState.propagationMode,
          nextReceiverMode: "plain",
        }),
      } satisfies PolicyVerificationReport,
    };
  }

  const template = await resolveTemplateDocument(sdk, input.template, nextPropagationMode);
  const nextParams = validatePolicyTemplateParams({
    templateId: template.manifest.templateId,
    params: { ...(nextReceiver.defaultParams ?? {}), ...(input.nextParams ?? currentState.params) },
    propagationMode: nextPropagationMode,
  });
  const nextState = createPolicyState({
    template: template.document,
    recipientXonly: nextReceiver.recipientXonly!,
    amountSat: input.nextAmountSat,
    assetId: currentState.assetId,
    params: nextParams,
    propagationMode: nextPropagationMode,
    previousStateHash: summarizePolicyState(currentState).hash,
    hop: currentState.hop + 1,
  });
  const nextCompiled = await compilePolicyStateContractInternal(sdk, {
    template: input.template,
    stateValue: nextState,
  });
  const outputDescriptor = await buildPolicyOutputDescriptor(sdk, {
    nextCompiledContractAddress: nextCompiled.contractAddress,
    nextAmountSat: input.nextAmountSat,
    assetId: nextState.assetId,
    maxFeeSat: 100,
    nextOutputHash: input.nextOutputHash,
    outputForm: input.nextOutputForm,
    rawOutput: input.nextRawOutput,
    outputBindingMode: input.outputBindingMode ?? "script-bound",
  });
  const previousStateSummary = summarizePolicyState(currentState);
  const nextStateSummary = summarizePolicyState(nextState);
  const transferDescriptor = validatePolicyTransferDescriptor({
    policyTemplateId: currentState.policyTemplateId,
    previousPolicyHash: currentState.policyHash,
    nextPolicyHash: nextState.policyHash,
    previousStateHash: previousStateSummary.hash,
    nextStateHash: nextStateSummary.hash,
    propagationMode: currentState.propagationMode,
    outputDescriptor: outputDescriptor.descriptor,
  });
  const transferSummary = summarizePolicyTransferDescriptor(transferDescriptor);
  if (input.nextArtifactPath) {
    await nextCompiled.saveArtifact(input.nextArtifactPath);
  }
  return {
    current: verifiedCurrent,
    nextState,
    nextCompiled,
    machineArtifact: null,
    transferDescriptor,
    transferSummary,
      verificationReport: {
        ...verifiedCurrent.report,
        nextPolicyPresent: true,
        outputBinding: buildPolicyOutputBindingReport({
          descriptor: outputDescriptor.descriptor,
          sdkVerified: true,
          supportedForm: outputDescriptor.supportedForm,
          autoDerived: outputDescriptor.autoDerivedNextOutputHash,
          reasonCode: outputDescriptor.reasonCode,
          fallbackReason: outputDescriptor.fallbackReason,
          bindingInputs: outputDescriptor.bindingInputs,
        }),
      enforcement: resolvePolicyEnforcementMode({
        currentPropagationMode: currentState.propagationMode,
        nextReceiverMode: "policy",
      }),
    } satisfies PolicyVerificationReport,
  };
}

export async function prepareDirectTransfer(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    template: PolicyTemplateInput;
    currentStatePath?: string;
    currentStateValue?: PolicyState;
    nextReceiver: PolicyReceiver;
    nextAmountSat: number;
    nextParams?: Record<string, string | number | boolean>;
    propagationMode?: PropagationMode;
    nextArtifactPath?: string;
    nextOutputHash?: string;
    nextOutputForm?: {
      assetForm?: PolicyOutputAssetForm;
      amountForm?: PolicyOutputAmountForm;
      nonceForm?: PolicyOutputNonceForm;
      rangeProofForm?: PolicyOutputRangeProofForm;
    };
    nextRawOutput?: Partial<OutputRawFields>;
    outputBindingMode?: BondOutputBindingMode;
  },
) {
  const verifiedCurrent = await verifyState(sdk, {
    artifactPath: input.currentArtifactPath,
    artifact: input.currentArtifact,
    template: input.template,
    statePath: input.currentStatePath,
    stateValue: input.currentStateValue,
  });
  if (!verifiedCurrent.ok) {
    throw new ValidationError(verifiedCurrent.reason ?? "Current policy state verification failed", {
      code: "POLICY_CURRENT_STATE_INVALID",
    });
  }

  const currentState = verifiedCurrent.stateValue;
  if (currentState.propagationMode !== "required") {
    throw new ValidationError("Direct transfer is only available for required propagation mode", {
      code: "POLICY_DIRECT_HOP_REQUIRES_REQUIRED_MODE",
    });
  }

  const template = await resolveTemplateDocument(sdk, input.template, currentState.propagationMode);
  assertDirectArtifactCompatibility(verifiedCurrent.artifact, template);

  const nextReceiver = validateReceiver(input.nextReceiver);
  if (nextReceiver.mode !== "policy") {
    throw new ValidationError("Direct transfer requires a policy receiver", {
      code: "POLICY_DIRECT_HOP_POLICY_RECEIVER_REQUIRED",
    });
  }

  const nextPropagationMode = validatePropagationMode(input.propagationMode ?? currentState.propagationMode);
  if (nextPropagationMode !== "required") {
    throw new ValidationError("Direct transfer currently requires the next hop to remain in required mode", {
      code: "POLICY_DIRECT_HOP_NEXT_MODE_INVALID",
    });
  }

  const nextParams = validatePolicyTemplateParams({
    templateId: template.manifest.templateId,
    params: { ...(nextReceiver.defaultParams ?? {}), ...(input.nextParams ?? currentState.params) },
    propagationMode: nextPropagationMode,
  });
  const nextState = createPolicyState({
    template: template.document,
    recipientXonly: nextReceiver.recipientXonly!,
    amountSat: input.nextAmountSat,
    assetId: currentState.assetId,
    params: nextParams,
    propagationMode: nextPropagationMode,
    previousStateHash: summarizePolicyState(currentState).hash,
    hop: currentState.hop + 1,
  });
  const nextCompiled = await compilePolicyStateContractInternal(sdk, {
    template: input.template,
    stateValue: nextState,
  });
  const outputDescriptor = await buildPolicyOutputDescriptor(sdk, {
    nextCompiledContractAddress: nextCompiled.contractAddress,
    nextAmountSat: input.nextAmountSat,
    assetId: nextState.assetId,
    maxFeeSat: 100,
    nextOutputHash: input.nextOutputHash,
    outputForm: input.nextOutputForm,
    rawOutput: input.nextRawOutput,
    outputBindingMode: input.outputBindingMode ?? "script-bound",
  });
  const previousStateSummary = summarizePolicyState(currentState);
  const nextStateSummary = summarizePolicyState(nextState);
  const transferDescriptor = validatePolicyTransferDescriptor({
    policyTemplateId: currentState.policyTemplateId,
    previousPolicyHash: currentState.policyHash,
    nextPolicyHash: nextState.policyHash,
    previousStateHash: previousStateSummary.hash,
    nextStateHash: nextStateSummary.hash,
    propagationMode: currentState.propagationMode,
    outputDescriptor: outputDescriptor.descriptor,
  });
  const transferSummary = summarizePolicyTransferDescriptor(transferDescriptor);

  if (input.nextArtifactPath) {
    await nextCompiled.saveArtifact(input.nextArtifactPath);
  }

  return {
    current: verifiedCurrent,
    nextState,
    nextCompiled,
    machineArtifact: null,
    transferDescriptor,
    transferSummary,
    verificationReport: {
      ...verifiedCurrent.report,
      nextPolicyPresent: true,
      plainExitAllowed: false,
      outputBinding: buildPolicyOutputBindingReport({
        descriptor: outputDescriptor.descriptor,
        sdkVerified: true,
        supportedForm: outputDescriptor.supportedForm,
        autoDerived: outputDescriptor.autoDerivedNextOutputHash,
        reasonCode: outputDescriptor.reasonCode,
        fallbackReason: outputDescriptor.fallbackReason,
        bindingInputs: outputDescriptor.bindingInputs,
      }),
      enforcement: resolvePolicyEnforcementMode({
        currentPropagationMode: currentState.propagationMode,
        nextReceiverMode: "policy",
      }),
    } satisfies PolicyVerificationReport,
  };
}

export async function verifyDirectTransfer(
  sdk: SimplicityClient,
  input: {
    template: PolicyTemplateInput;
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    currentStatePath?: string;
    currentStateValue?: PolicyState;
    transferDescriptorValue?: PolicyTransferDescriptor;
    nextStatePath?: string;
    nextStateValue?: PolicyState;
  },
) {
  const prepared = await verifyState(sdk, {
    artifactPath: input.currentArtifactPath,
    artifact: input.currentArtifact,
    template: input.template,
    statePath: input.currentStatePath,
    stateValue: input.currentStateValue,
  });
  const template = await resolveTemplateDocument(sdk, input.template);
  assertDirectArtifactCompatibility(prepared.artifact, template);
  const currentState = prepared.stateValue;
  const transfer = input.transferDescriptorValue ? validatePolicyTransferDescriptor(input.transferDescriptorValue) : undefined;
  const nextState = input.nextStateValue ? validatePolicyState(input.nextStateValue) : undefined;
  const outputBindingContext = await resolvePolicyOutputBindingVerificationContext(sdk, transfer?.outputDescriptor);
  const summary = transfer ? summarizePolicyTransferDescriptor(transfer) : undefined;
  const nextStateSummary = nextState ? summarizePolicyState(nextState) : undefined;
  const ok = currentState.propagationMode === "required" && (!transfer || (
    transfer.previousPolicyHash === currentState.policyHash
    && transfer.previousStateHash === summarizePolicyState(currentState).hash
    && Boolean(transfer.outputDescriptor?.nextOutputScriptHash)
    && (!nextState || transfer.nextPolicyHash === nextState.policyHash)
    && (!nextStateSummary || transfer.nextStateHash === nextStateSummary.hash)
  ));
  return {
    ok,
    reason: ok ? undefined : "Direct transfer descriptor does not match current/next policy state",
    current: prepared,
    transfer,
    transferSummary: summary,
    nextState,
    verificationReport: {
      ...prepared.report,
      nextPolicyPresent: Boolean(nextState),
      plainExitAllowed: false,
      outputBinding: buildPolicyOutputBindingReport({
        descriptor: transfer?.outputDescriptor,
        sdkVerified: ok,
        supportedForm: outputBindingContext.supportedForm,
        reasonCode: outputBindingContext.reasonCode,
        autoDerived: outputBindingContext.autoDerived,
        fallbackReason: outputBindingContext.fallbackReason,
        bindingInputs: outputBindingContext.bindingInputs,
      }),
      enforcement: resolvePolicyEnforcementMode({
        currentPropagationMode: currentState.propagationMode,
        nextReceiverMode: "policy",
      }),
    } satisfies PolicyVerificationReport,
  };
}

export async function inspectDirectTransfer(
  sdk: SimplicityClient,
  input: Parameters<typeof executeDirectTransfer>[1],
) {
  const prepared = await prepareDirectTransfer(sdk, input);
  const currentArtifact = input.currentArtifact
    ?? (input.currentArtifactPath ? (await sdk.loadArtifact(input.currentArtifactPath)).artifact : undefined);
  if (!currentArtifact) {
    throw new ValidationError("currentArtifactPath or currentArtifact is required", {
      code: "POLICY_CURRENT_ARTIFACT_REQUIRED",
    });
  }
  const currentContract = sdk.fromArtifact(currentArtifact);
  const inspect = await currentContract.inspectCall({
    wallet: input.wallet,
    toAddress: prepared.nextCompiled.contractAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(input.nextAmountSat),
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    sequence: resolvePolicySequence(prepared.current.stateValue),
    witness: buildPolicyDirectWitness(prepared),
  });
  return {
    mode: "direct-hop" as const,
    prepared,
    inspect,
  };
}

export async function executeDirectTransfer(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    template: PolicyTemplateInput;
    currentStatePath?: string;
    currentStateValue?: PolicyState;
    nextReceiver: PolicyReceiver;
    nextAmountSat: number;
    nextParams?: Record<string, string | number | boolean>;
    propagationMode?: PropagationMode;
    nextArtifactPath?: string;
    nextOutputHash?: string;
    nextOutputForm?: {
      assetForm?: PolicyOutputAssetForm;
      amountForm?: PolicyOutputAmountForm;
      nonceForm?: PolicyOutputNonceForm;
      rangeProofForm?: PolicyOutputRangeProofForm;
    };
    nextRawOutput?: Partial<OutputRawFields>;
    outputBindingMode?: BondOutputBindingMode;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    broadcast?: boolean;
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  },
) {
  const prepared = await prepareDirectTransfer(sdk, input);
  const currentArtifact = input.currentArtifact
    ?? (input.currentArtifactPath ? (await sdk.loadArtifact(input.currentArtifactPath)).artifact : undefined);
  if (!currentArtifact) {
    throw new ValidationError("currentArtifactPath or currentArtifact is required", {
      code: "POLICY_CURRENT_ARTIFACT_REQUIRED",
    });
  }
  const currentContract = sdk.fromArtifact(currentArtifact);
  const execution = await currentContract.execute({
    wallet: input.wallet,
    toAddress: prepared.nextCompiled.contractAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(input.nextAmountSat),
    feeSat: input.feeSat,
    broadcast: input.broadcast,
    utxoPolicy: input.utxoPolicy,
    sequence: resolvePolicySequence(prepared.current.stateValue),
    witness: buildPolicyDirectWitness(prepared),
  });
  return {
    mode: "direct-hop" as const,
    prepared,
    execution,
  };
}

export async function verifyTransfer(
  sdk: SimplicityClient,
  input: {
    template: PolicyTemplateInput;
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    currentStatePath?: string;
    currentStateValue?: PolicyState;
    transferDescriptorValue?: PolicyTransferDescriptor;
    nextStatePath?: string;
    nextStateValue?: PolicyState;
  },
) {
  const prepared = await verifyState(sdk, {
    artifactPath: input.currentArtifactPath,
    artifact: input.currentArtifact,
    template: input.template,
    statePath: input.currentStatePath,
    stateValue: input.currentStateValue,
  });
  const currentState = prepared.stateValue;
  const transfer = input.transferDescriptorValue ? validatePolicyTransferDescriptor(input.transferDescriptorValue) : undefined;
  const nextState = input.nextStateValue ? validatePolicyState(input.nextStateValue) : undefined;
  const outputBindingContext = await resolvePolicyOutputBindingVerificationContext(sdk, transfer?.outputDescriptor);
  const summary = transfer ? summarizePolicyTransferDescriptor(transfer) : undefined;
  const nextStateSummary = nextState ? summarizePolicyState(nextState) : undefined;
  const ok = !transfer || (
    transfer.previousPolicyHash === currentState.policyHash
    && transfer.previousStateHash === summarizePolicyState(currentState).hash
    && (!nextState || transfer.nextPolicyHash === nextState.policyHash)
    && (!nextStateSummary || transfer.nextStateHash === nextStateSummary.hash)
  );
  const verificationReport = {
    ...prepared.report,
    nextPolicyPresent: Boolean(nextState),
    plainExitAllowed: currentState.propagationMode !== "required",
    outputBinding: buildPolicyOutputBindingReport({
      descriptor: transfer?.outputDescriptor,
      sdkVerified: ok,
      supportedForm: outputBindingContext.supportedForm,
      reasonCode: outputBindingContext.reasonCode,
      autoDerived: outputBindingContext.autoDerived,
      fallbackReason: outputBindingContext.fallbackReason,
      bindingInputs: outputBindingContext.bindingInputs,
    }),
    enforcement: resolvePolicyEnforcementMode({
      currentPropagationMode: currentState.propagationMode,
      nextReceiverMode: nextState ? "policy" : "plain",
    }),
  } satisfies PolicyVerificationReport;
  return {
    ok,
    reason: ok ? undefined : "Policy transfer descriptor does not match current/next policy state",
    current: prepared,
    transfer,
    transferSummary: summary,
    nextState,
    verificationReport,
    trustSummary: buildVerificationTrustSummary({
      definitionTrust: verificationReport.templateTrust,
      stateTrust: verificationReport.stateTrust,
      bindingMode: verificationReport.outputBinding?.mode ?? "none",
    }),
  };
}

export async function inspectTransfer(
  sdk: SimplicityClient,
  input: Parameters<typeof executeTransfer>[1] & {
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  },
) {
  const prepared = await prepareTransfer(sdk, input);
  const currentArtifact = input.currentArtifact
    ?? (input.currentArtifactPath ? (await sdk.loadArtifact(input.currentArtifactPath)).artifact : undefined);
  if (!currentArtifact) {
    throw new ValidationError("currentArtifactPath or currentArtifact is required", {
      code: "POLICY_CURRENT_ARTIFACT_REQUIRED",
    });
  }
  const currentContract = sdk.fromArtifact(currentArtifact);

  if (!prepared.nextCompiled) {
    const inspect = await currentContract.inspectCall({
      wallet: input.wallet,
      toAddress: input.nextReceiver.address!,
      signer: input.signer,
      sendAmount: satToBtcAmount(input.nextAmountSat),
      feeSat: input.feeSat,
      utxoPolicy: input.utxoPolicy,
      sequence: resolvePolicySequence(prepared.current.stateValue),
      witness: buildPolicyRecursiveWitness(prepared),
    });
    return {
      mode: "plain-exit" as const,
      prepared,
      inspect,
    };
  }

  const inspect = await currentContract.inspectCall({
    wallet: input.wallet,
    toAddress: prepared.nextCompiled.contractAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(input.nextAmountSat),
    feeSat: input.feeSat,
    utxoPolicy: input.utxoPolicy,
    sequence: resolvePolicySequence(prepared.current.stateValue),
    witness: buildPolicyRecursiveWitness(prepared),
  });

  return {
    mode: prepared.verificationReport.enforcement,
    prepared,
    inspect,
  };
}

export async function executeTransfer(
  sdk: SimplicityClient,
  input: {
    currentArtifactPath?: string;
    currentArtifact?: SimplicityArtifact;
    template: PolicyTemplateInput;
    currentStatePath?: string;
    currentStateValue?: PolicyState;
    nextReceiver: PolicyReceiver;
    nextAmountSat: number;
    nextParams?: Record<string, string | number | boolean>;
    propagationMode?: PropagationMode;
    nextArtifactPath?: string;
    nextOutputHash?: string;
    nextOutputForm?: {
      assetForm?: PolicyOutputAssetForm;
      amountForm?: PolicyOutputAmountForm;
      nonceForm?: PolicyOutputNonceForm;
      rangeProofForm?: PolicyOutputRangeProofForm;
    };
    nextRawOutput?: Partial<OutputRawFields>;
    outputBindingMode?: BondOutputBindingMode;
    wallet: string;
    signer: { type: "schnorrPrivkeyHex"; privkeyHex: string };
    broadcast?: boolean;
    feeSat?: number;
    utxoPolicy?: "smallest_over" | "largest" | "newest";
  },
) {
  const prepared = await prepareTransfer(sdk, input);
  const currentArtifact = input.currentArtifact
    ?? (input.currentArtifactPath ? (await sdk.loadArtifact(input.currentArtifactPath)).artifact : undefined);
  if (!currentArtifact) {
    throw new ValidationError("currentArtifactPath or currentArtifact is required", {
      code: "POLICY_CURRENT_ARTIFACT_REQUIRED",
    });
  }
  const currentContract = sdk.fromArtifact(currentArtifact);

  if (!prepared.nextCompiled) {
    const execution = await currentContract.execute({
      wallet: input.wallet,
      toAddress: input.nextReceiver.address!,
      signer: input.signer,
      sendAmount: satToBtcAmount(input.nextAmountSat),
      feeSat: input.feeSat,
      broadcast: input.broadcast,
      utxoPolicy: input.utxoPolicy,
      sequence: resolvePolicySequence(prepared.current.stateValue),
      witness: buildPolicyRecursiveWitness(prepared),
    });
    return {
      mode: "plain-exit" as const,
      prepared,
      execution,
    };
  }

  const execution = await currentContract.execute({
    wallet: input.wallet,
    toAddress: prepared.nextCompiled.contractAddress,
    signer: input.signer,
    sendAmount: satToBtcAmount(input.nextAmountSat),
    feeSat: input.feeSat,
    broadcast: input.broadcast,
    utxoPolicy: input.utxoPolicy,
    sequence: resolvePolicySequence(prepared.current.stateValue),
    witness: buildPolicyRecursiveWitness(prepared),
  });
  return {
    mode: prepared.verificationReport.enforcement,
    prepared,
    execution,
  };
}

export async function exportEvidence(
  sdk: SimplicityClient,
  input: {
    artifactPath?: string;
    artifact?: SimplicityArtifact;
    template: PolicyTemplateInput;
    statePath?: string;
    stateValue?: PolicyState;
    transferDescriptorValue?: PolicyTransferDescriptor;
  },
): Promise<PolicyEvidenceBundle> {
  const verified = await verifyState(sdk, {
    artifactPath: input.artifactPath,
    artifact: input.artifact,
    template: input.template,
    statePath: input.statePath,
    stateValue: input.stateValue,
  });
  const transferVerification = input.transferDescriptorValue
    ? await verifyTransfer(sdk, {
        template: input.template,
        currentArtifact: verified.artifact,
        currentStateValue: verified.stateValue,
        transferDescriptorValue: input.transferDescriptorValue,
      })
    : undefined;
  const template = await resolveTemplateDocument(sdk, input.template, verified.stateValue.propagationMode);
  const stateSummary = summarizePolicyState(verified.stateValue);
  const artifact = verified.artifact;
  const renderedSourceHash = artifact.source.simfPath && existsSync(artifact.source.simfPath)
    ? sha256HexUtf8(await readFile(artifact.source.simfPath, "utf8"))
    : undefined;
  return {
    schemaVersion: POLICY_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    artifact,
    template: template.summary,
    state: stateSummary,
    ...(input.transferDescriptorValue ? { transfer: summarizePolicyTransferDescriptor(input.transferDescriptorValue) } : {}),
    report: transferVerification?.verificationReport ?? verified.report,
    trustSummary: transferVerification?.trustSummary
      ?? verified.trustSummary
      ?? buildVerificationTrustSummary({
        definitionTrust: verified.report.templateTrust,
        stateTrust: verified.report.stateTrust,
        bindingMode: "none",
      }),
    renderedSourceHash,
    sourceVerificationMode: renderedSourceHash ? "source-reloaded" : "artifact-only",
    compiled: {
      program: artifact.compiled.program,
      cmr: artifact.compiled.cmr,
      contractAddress: artifact.compiled.contractAddress,
    },
  };
}
