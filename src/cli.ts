#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadArtifact } from "./core/artifact";
import { loadDefinitionInput } from "./core/definition";
import { loadStateInput } from "./core/state";
import { describePreset, getPresetOrThrow, listPresets } from "./core/presets";
import { SimplicitySdkError } from "./core/errors";
import { createSimplicityClient } from "./client/SimplicityClient";
import {
  ContractUtxo,
  DefinitionInput,
  PresetManifestEntry,
  SimplicityClientConfig,
  StateDocumentInput,
} from "./core/types";

function getArg(name: string, defaultValue?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return defaultValue;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return defaultValue;
  return value;
}

function getMultiArgs(name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}`) {
      const value = process.argv[i + 1];
      if (value && !value.startsWith("--")) values.push(value);
    }
  }
  return values;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function requireArg(name: string): string {
  const value = getArg(name);
  if (!value) throw new Error(`Missing required arg: --${name}`);
  return value;
}

function parseAssignments(values: string[]): Record<string, string | number> {
  return Object.fromEntries(
    values.map((entry) => {
      const [key, raw] = entry.split("=", 2);
      if (raw === "true") return [key, true as unknown as string | number];
      if (raw === "false") return [key, false as unknown as string | number];
      const asNumber = Number(raw);
      return [key, Number.isFinite(asNumber) && String(asNumber) === raw ? asNumber : raw];
    })
  );
}

function parsePolicyReceiver(prefix: string): Record<string, unknown> {
  const mode = getArg(`${prefix}-mode`) ?? (getArg(`${prefix}-address`) ? "plain" : "policy");
  if (mode === "plain") {
    return { mode: "plain", address: requireArg(`${prefix}-address`) };
  }
  return {
    mode: "policy",
    recipientXonly: requireArg(`${prefix}-recipient-xonly`),
  };
}

function parsePolicyOutputForm(): Record<string, unknown> | undefined {
  const assetForm = getArg("asset-form");
  const amountForm = getArg("amount-form");
  const nonceForm = getArg("nonce-form");
  const rangeProofForm = getArg("range-proof-form");
  if (!assetForm && !amountForm && !nonceForm && !rangeProofForm) {
    return undefined;
  }
  return {
    ...(assetForm ? { assetForm } : {}),
    ...(amountForm ? { amountForm } : {}),
    ...(nonceForm ? { nonceForm } : {}),
    ...(rangeProofForm ? { rangeProofForm } : {}),
  };
}

function parseRawOutputFields(): Record<string, unknown> | undefined {
  const assetBytesHex = getArg("asset-bytes-hex");
  const amountBytesHex = getArg("amount-bytes-hex");
  const nonceBytesHex = getArg("nonce-bytes-hex");
  const scriptPubKeyHex = getArg("script-pubkey-hex");
  const scriptPubKeyHashHex = getArg("script-pubkey-hash-hex");
  const rangeProofHex = getArg("range-proof-hex-raw");
  const rangeProofHashHex = getArg("range-proof-hash-hex");
  if (
    !assetBytesHex
    && !amountBytesHex
    && !nonceBytesHex
    && !scriptPubKeyHex
    && !scriptPubKeyHashHex
    && !rangeProofHex
    && !rangeProofHashHex
  ) {
    return undefined;
  }
  return {
    ...(assetBytesHex ? { assetBytesHex } : {}),
    ...(amountBytesHex ? { amountBytesHex } : {}),
    ...(nonceBytesHex ? { nonceBytesHex } : {}),
    ...(scriptPubKeyHex !== undefined ? { scriptPubKeyHex } : {}),
    ...(scriptPubKeyHashHex ? { scriptPubKeyHashHex } : {}),
    ...(rangeProofHex !== undefined ? { rangeProofHex } : {}),
    ...(rangeProofHashHex ? { rangeProofHashHex } : {}),
  };
}

function parsePolicyTemplateInput(): Record<string, unknown> {
  const templateId = getArg("template-id");
  const templateManifest = getArg("template-manifest");
  const templateManifestValue = getArg("template-manifest-value");
  if (!templateId && !templateManifest && !templateManifestValue) {
    throw new Error("Missing required arg: --template-id or --template-manifest or --template-manifest-value");
  }
  const templateJson = getArg("template-json");
  const parsedManifestValue = templateManifestValue ? JSON.parse(templateManifestValue) : undefined;
  return {
    ...(templateId ? { templateId } : {}),
    ...(templateManifest ? { manifestPath: templateManifest } : {}),
    ...(parsedManifestValue ? { manifestValue: parsedManifestValue } : {}),
    ...(templateJson ? { jsonPath: templateJson } : templateId ? { value: { policyTemplateId: templateId } } : {}),
    ...(getArg("state-simf") ? { stateSimfPath: getArg("state-simf") } : {}),
    ...(getArg("direct-state-simf") ? { directStateSimfPath: getArg("direct-state-simf") } : {}),
    ...(getArg("machine-simf") ? { transferMachineSimfPath: getArg("machine-simf") } : {}),
  };
}

function parseWitnessAssignments(values: string[]): Record<string, { type: string; value: string }> {
  return Object.fromEntries(
    values.map((entry) => {
      const [left, value] = entry.split("=", 2);
      const [name, type] = left.split(":", 2);
      if (!name || !type || value === undefined) {
        throw new Error(`Invalid --witness-value format: ${entry}`);
      }
      return [name, { type, value }];
    })
  );
}

function parseWitnessSigners(values: string[]): Record<string, { type: "schnorrPrivkeyHex"; privkeyHex: string }> {
  return Object.fromEntries(
    values.map((entry) => {
      const [name, privkeyHex] = entry.split("=", 2);
      if (!name || !privkeyHex) {
        throw new Error(`Invalid --witness-signer format: ${entry}`);
      }
      return [name, { type: "schnorrPrivkeyHex", privkeyHex }];
    })
  );
}

function parseDefinitionInput(): DefinitionInput | undefined {
  const type = getArg("definition-type");
  const id = getArg("definition-id");
  const jsonPath = getArg("definition-json");
  const valueJson = getArg("definition-value");
  const schemaVersion = getArg("definition-schema-version");
  const anchorMode = getArg("definition-anchor-mode") as DefinitionInput["anchorMode"] | undefined;
  if (!type && !id && !jsonPath && !valueJson && !schemaVersion && !anchorMode) {
    return undefined;
  }
  return {
    type: type ?? "",
    id: id ?? "",
    schemaVersion: schemaVersion ?? undefined,
    jsonPath,
    value: valueJson ? JSON.parse(valueJson) : undefined,
    anchorMode,
  };
}

function parseStateInput(): StateDocumentInput | undefined {
  const type = getArg("state-type");
  const id = getArg("state-id");
  const jsonPath = getArg("state-json");
  const valueJson = getArg("state-value");
  const schemaVersion = getArg("state-schema-version");
  const anchorMode = getArg("state-anchor-mode") as StateDocumentInput["anchorMode"] | undefined;
  if (!type && !id && !jsonPath && !valueJson && !schemaVersion && !anchorMode) {
    return undefined;
  }
  return {
    type: type ?? "",
    id: id ?? "",
    schemaVersion: schemaVersion ?? undefined,
    jsonPath,
    value: valueJson ? JSON.parse(valueJson) : undefined,
    anchorMode,
  };
}

function resolveConfig(): SimplicityClientConfig {
  return {
    network: (getArg("network", "liquidtestnet") as SimplicityClientConfig["network"]),
    rpc: {
      url: getArg("rpc-url", process.env.ELEMENTS_RPC_URL ?? "http://127.0.0.1:18884")!,
      username: getArg("rpc-user", process.env.ELEMENTS_RPC_USER ?? "<rpc-user>")!,
      password: getArg("rpc-password", process.env.ELEMENTS_RPC_PASSWORD ?? "<rpc-password>")!,
      wallet: getArg("wallet", process.env.ELEMENTS_RPC_WALLET),
    },
    toolchain: {
      simcPath: getArg("simc-path", process.env.SIMC_PATH ?? "simc")!,
      halSimplicityPath: getArg("hal-path", process.env.HAL_SIMPLICITY_PATH ?? "hal-simplicity")!,
      elementsCliPath: getArg("elements-cli-path", process.env.ELEMENTS_CLI_PATH ?? "eltc"),
    },
    relayer: getArg("relayer")
      ? {
          baseUrl: getArg("relayer")!,
          apiKey: getArg("api-key"),
        }
      : undefined,
  };
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatPolicyOutputBindingSummary(outputBinding: {
  mode: string;
  committed: boolean;
  runtimeBound: boolean;
  sdkVerified: boolean;
  amountRuntimeBound: boolean;
  nextOutputHashRuntimeBound: boolean;
  nextOutputScriptRuntimeBound: boolean;
  supportedForm?: string;
  reasonCode?: string;
  nextOutputHash?: string;
  autoDerived?: boolean;
  fallbackReason?: string;
  bindingInputs?: {
    assetId: string;
    assetForm: string;
    amountForm: string;
    nonceForm: string;
    rangeProofForm: string;
    nextAmountSat: number;
    nextOutputIndex: number;
    feeIndex: number;
    maxFeeSat: number;
    rawOutputComponents?: {
      scriptPubKey: "raw-bytes" | "hash";
      rangeProof: "raw-bytes" | "hash";
    };
  };
}): string {
  const lines = [
    `mode=${outputBinding.mode}`,
    `committed=${outputBinding.committed}`,
    `runtimeBound=${outputBinding.runtimeBound}`,
    `sdkVerified=${outputBinding.sdkVerified}`,
    `amountRuntimeBound=${outputBinding.amountRuntimeBound}`,
    `nextOutputHashRuntimeBound=${outputBinding.nextOutputHashRuntimeBound}`,
    `nextOutputScriptRuntimeBound=${outputBinding.nextOutputScriptRuntimeBound}`,
  ];
  if (outputBinding.supportedForm) lines.push(`supportedForm=${outputBinding.supportedForm}`);
  if (outputBinding.reasonCode) lines.push(`reasonCode=${outputBinding.reasonCode}`);
  if (outputBinding.nextOutputHash) lines.push(`nextOutputHash=${outputBinding.nextOutputHash}`);
  if (outputBinding.autoDerived !== undefined) lines.push(`autoDerived=${outputBinding.autoDerived}`);
  if (outputBinding.fallbackReason) lines.push(`fallbackReason=${outputBinding.fallbackReason}`);
  if (outputBinding.bindingInputs) {
    lines.push(
      `bindingInputs(asset=${outputBinding.bindingInputs.assetId}, amountSat=${outputBinding.bindingInputs.nextAmountSat}, nextOutputIndex=${outputBinding.bindingInputs.nextOutputIndex}, feeIndex=${outputBinding.bindingInputs.feeIndex}, maxFeeSat=${outputBinding.bindingInputs.maxFeeSat})`,
      `bindingInputForms(assetForm=${outputBinding.bindingInputs.assetForm}, amountForm=${outputBinding.bindingInputs.amountForm}, nonceForm=${outputBinding.bindingInputs.nonceForm}, rangeProofForm=${outputBinding.bindingInputs.rangeProofForm})`,
    );
    if (outputBinding.bindingInputs.rawOutputComponents) {
      lines.push(
        `rawOutputComponents(scriptPubKey=${outputBinding.bindingInputs.rawOutputComponents.scriptPubKey}, rangeProof=${outputBinding.bindingInputs.rawOutputComponents.rangeProof})`,
      );
    }
  }
  return lines.join("\n");
}

function formatPolicyVerificationSummary(input: {
  ok?: boolean;
  reason?: string;
  propagationMode: string;
  enforcement: string;
  plainExitAllowed: boolean;
  nextPolicyRequired: boolean;
  nextPolicyPresent: boolean;
  outputBinding?: {
    mode: string;
    committed: boolean;
    runtimeBound: boolean;
    sdkVerified: boolean;
    amountRuntimeBound: boolean;
  nextOutputHashRuntimeBound: boolean;
  nextOutputScriptRuntimeBound: boolean;
  supportedForm?: string;
  reasonCode?: string;
  nextOutputHash?: string;
  autoDerived?: boolean;
  fallbackReason?: string;
    bindingInputs?: {
      assetId: string;
      assetForm: string;
      amountForm: string;
      nonceForm: string;
      rangeProofForm: string;
      nextAmountSat: number;
      nextOutputIndex: number;
      feeIndex: number;
      maxFeeSat: number;
    };
  };
}): string {
  const lines = [
    `ok=${input.ok ?? true}`,
    `propagationMode=${input.propagationMode}`,
    `enforcement=${input.enforcement}`,
    `plainExitAllowed=${input.plainExitAllowed}`,
    `nextPolicyRequired=${input.nextPolicyRequired}`,
    `nextPolicyPresent=${input.nextPolicyPresent}`,
  ];
  if (input.reason) lines.push(`reason=${input.reason}`);
  if (input.outputBinding) {
    lines.push("outputBinding:");
    lines.push(indent(formatPolicyOutputBindingSummary(input.outputBinding), 2));
  }
  return lines.join("\n");
}

function formatPolicyEvidenceSummary(input: {
  templateHash: string;
  stateHash: string;
  transferHash?: string | null;
  enforcement: string;
  outputBinding?: {
    mode: string;
    committed: boolean;
    runtimeBound: boolean;
    sdkVerified: boolean;
    amountRuntimeBound: boolean;
  nextOutputHashRuntimeBound: boolean;
  nextOutputScriptRuntimeBound: boolean;
  supportedForm?: string;
  reasonCode?: string;
  nextOutputHash?: string;
  autoDerived?: boolean;
  fallbackReason?: string;
    bindingInputs?: {
      assetId: string;
      assetForm: string;
      amountForm: string;
      nonceForm: string;
      rangeProofForm: string;
      nextAmountSat: number;
      nextOutputIndex: number;
      feeIndex: number;
      maxFeeSat: number;
    };
  } | null;
  sourceVerificationMode: string;
}): string {
  const lines = [
    `templateHash=${input.templateHash}`,
    `stateHash=${input.stateHash}`,
    `transferHash=${input.transferHash ?? "(none)"}`,
    `enforcement=${input.enforcement}`,
    `sourceVerificationMode=${input.sourceVerificationMode}`,
  ];
  if (input.outputBinding) {
    lines.push("outputBinding:");
    lines.push(indent(formatPolicyOutputBindingSummary(input.outputBinding), 2));
  }
  return lines.join("\n");
}

function formatPolicyInspectOrExecuteSummary(input: {
  mode: string;
  propagationMode: string;
  enforcement: string;
  plainExitAllowed: boolean;
  nextPolicyRequired: boolean;
  nextPolicyPresent: boolean;
  outputBinding?: {
    mode: string;
    committed: boolean;
    runtimeBound: boolean;
    sdkVerified: boolean;
    amountRuntimeBound: boolean;
    nextOutputHashRuntimeBound: boolean;
    nextOutputScriptRuntimeBound: boolean;
    nextOutputHash?: string;
    autoDerived?: boolean;
    fallbackReason?: string;
    bindingInputs?: {
      assetId: string;
      assetForm: string;
      amountForm: string;
      nonceForm: string;
      rangeProofForm: string;
      nextAmountSat: number;
      nextOutputIndex: number;
      feeIndex: number;
      maxFeeSat: number;
    };
  };
  txId?: string;
  broadcasted?: boolean;
  summaryHash?: string;
}): string {
  const lines = [
    `mode=${input.mode}`,
    `propagationMode=${input.propagationMode}`,
    `enforcement=${input.enforcement}`,
    `plainExitAllowed=${input.plainExitAllowed}`,
    `nextPolicyRequired=${input.nextPolicyRequired}`,
    `nextPolicyPresent=${input.nextPolicyPresent}`,
  ];
  if (input.summaryHash) lines.push(`summaryHash=${input.summaryHash}`);
  if (input.txId) lines.push(`txId=${input.txId}`);
  if (input.broadcasted !== undefined) lines.push(`broadcasted=${input.broadcasted}`);
  if (input.outputBinding) {
    lines.push("outputBinding:");
    lines.push(indent(formatPolicyOutputBindingSummary(input.outputBinding), 2));
  }
  return lines.join("\n");
}

function formatPolicyIssueSummary(input: {
  propagationMode: string;
  policyHash: string;
  contractAddress: string;
  amountSat: number;
  assetId: string;
  recipient: string;
}): string {
  return [
    `propagationMode=${input.propagationMode}`,
    `policyHash=${input.policyHash}`,
    `contractAddress=${input.contractAddress}`,
    `amountSat=${input.amountSat}`,
    `assetId=${input.assetId}`,
    `recipient=${input.recipient}`,
  ].join("\n");
}

function formatPolicyOutputDescriptorBuildSummary(input: {
  mode: string;
  nextContractAddress: string;
  nextOutputScriptHash?: string;
  nextOutputHash?: string;
  nextAmountSat: number;
  assetId: string;
  supportedForm?: string;
  reasonCode?: string;
  autoDerived?: boolean;
  fallbackReason?: string;
}): string {
  const lines = [
    `mode=${input.mode}`,
    `nextContractAddress=${input.nextContractAddress}`,
    `nextAmountSat=${input.nextAmountSat}`,
    `assetId=${input.assetId}`,
  ];
  if (input.supportedForm) lines.push(`supportedForm=${input.supportedForm}`);
  if (input.reasonCode) lines.push(`reasonCode=${input.reasonCode}`);
  if (input.nextOutputScriptHash) lines.push(`nextOutputScriptHash=${input.nextOutputScriptHash}`);
  if (input.nextOutputHash) lines.push(`nextOutputHash=${input.nextOutputHash}`);
  if (input.autoDerived !== undefined) lines.push(`autoDerived=${input.autoDerived}`);
  if (input.fallbackReason) lines.push(`fallbackReason=${input.fallbackReason}`);
  return lines.join("\n");
}

function formatPolicyBindingSupportSummary(input: {
  supportedForms: Array<{ form: string; description: string; autoDerived: boolean }>;
  unsupportedOutputFeatures?: Array<{
    feature: string;
    description: string;
    fallbackReasonCode: string;
    manualHashSupported: boolean;
  }>;
  outputBindingModes: Record<string, { description: string; runtimeBinding: string; fallbackBehavior: string }>;
  autoDeriveConditions: {
    assetInput: string[];
    amountForm: string;
    nonceForm: string;
    rangeProofForm: string;
    rawOutputFields?: string[];
    rawOutputFieldAlternatives?: Record<string, string[]>;
    outputHashExclusions?: string[];
  };
  manualHashPath: {
    supported: boolean;
    description: string;
  };
  fallbackBehavior: {
    defaultMode: string;
    reasonCodes: string[];
  };
  publicValidationMatrix: {
    local: string[];
    testnet: string[];
  };
  nonGoals: string[];
}): string {
  const lines = ["supportedForms:"];
  for (const form of input.supportedForms) {
    lines.push(
      indent(
        [
          `form=${form.form}`,
          `autoDerived=${form.autoDerived}`,
          `description=${form.description}`,
        ].join("\n"),
        2,
      ),
    );
  }
  if (input.unsupportedOutputFeatures && input.unsupportedOutputFeatures.length > 0) {
    lines.push("unsupportedOutputFeatures:");
    for (const feature of input.unsupportedOutputFeatures) {
      lines.push(
        indent(
          [
            `feature=${feature.feature}`,
            `fallbackReasonCode=${feature.fallbackReasonCode}`,
            `manualHashSupported=${feature.manualHashSupported}`,
            `description=${feature.description}`,
          ].join("\n"),
          2,
        ),
      );
    }
  }
  lines.push("outputBindingModes:");
  for (const [mode, details] of Object.entries(input.outputBindingModes)) {
    lines.push(
      indent(
        [
          `mode=${mode}`,
          `runtimeBinding=${details.runtimeBinding}`,
          `description=${details.description}`,
          `fallbackBehavior=${details.fallbackBehavior}`,
        ].join("\n"),
        2,
      ),
    );
  }
  lines.push(
    `autoDeriveConditions=assetInput(${input.autoDeriveConditions.assetInput.join(", ")}), amountForm=${input.autoDeriveConditions.amountForm}, nonceForm=${input.autoDeriveConditions.nonceForm}, rangeProofForm=${input.autoDeriveConditions.rangeProofForm}`,
  );
  if (input.autoDeriveConditions.rawOutputFields?.length) {
    lines.push(`rawOutputFields=${input.autoDeriveConditions.rawOutputFields.join(",")}`);
  }
  if (input.autoDeriveConditions.rawOutputFieldAlternatives) {
    for (const [name, fields] of Object.entries(input.autoDeriveConditions.rawOutputFieldAlternatives)) {
      lines.push(`rawOutputFieldAlternatives.${name}=${fields.join("|")}`);
    }
  }
  if (input.autoDeriveConditions.outputHashExclusions?.length) {
    lines.push(`outputHashExclusions=${input.autoDeriveConditions.outputHashExclusions.join(",")}`);
  }
  lines.push(`manualHashPath.supported=${input.manualHashPath.supported}`);
  lines.push(`manualHashPath.description=${input.manualHashPath.description}`);
  lines.push(`fallback.defaultMode=${input.fallbackBehavior.defaultMode}`);
  lines.push(`fallback.reasonCodes=${input.fallbackBehavior.reasonCodes.join(",")}`);
  lines.push(`validation.local=${input.publicValidationMatrix.local.join(" | ")}`);
  lines.push(`validation.testnet=${input.publicValidationMatrix.testnet.join(" | ")}`);
  if (input.nonGoals.length > 0) {
    lines.push("nonGoals:");
    for (const goal of input.nonGoals) {
      lines.push(indent(goal, 2));
    }
  }
  return lines.join("\n");
}

function formatOutputBindingSupportEvaluationSummary(input: {
  requestedBindingMode: string;
  resolvedBindingMode: string;
  supportedForm: string;
  reasonCode: string;
  autoDerived: boolean;
  fallbackReason?: string;
  assetId: string;
  outputForm: {
    assetForm: string;
    amountForm: string;
    nonceForm: string;
    rangeProofForm: string;
  };
  unsupportedFeatures: string[];
  explicitAssetInputSupported: boolean;
  manualHashSupplied: boolean;
  nextOutputScriptAvailable: boolean;
  rawOutputProvided?: boolean;
  rawOutputComponents?: {
    scriptPubKey: "raw-bytes" | "hash";
    rangeProof: "raw-bytes" | "hash";
  };
}): string {
  const lines = [
    `requestedBindingMode=${input.requestedBindingMode}`,
    `resolvedBindingMode=${input.resolvedBindingMode}`,
    `supportedForm=${input.supportedForm}`,
    `reasonCode=${input.reasonCode}`,
    `autoDerived=${input.autoDerived}`,
    `assetId=${input.assetId}`,
    `explicitAssetInputSupported=${input.explicitAssetInputSupported}`,
    `manualHashSupplied=${input.manualHashSupplied}`,
    `nextOutputScriptAvailable=${input.nextOutputScriptAvailable}`,
    `rawOutputProvided=${input.rawOutputProvided === true}`,
    `outputForm(assetForm=${input.outputForm.assetForm}, amountForm=${input.outputForm.amountForm}, nonceForm=${input.outputForm.nonceForm}, rangeProofForm=${input.outputForm.rangeProofForm})`,
  ];
  if (input.fallbackReason) lines.push(`fallbackReason=${input.fallbackReason}`);
  if (input.rawOutputComponents) {
    lines.push(
      `rawOutputComponents(scriptPubKey=${input.rawOutputComponents.scriptPubKey}, rangeProof=${input.rawOutputComponents.rangeProof})`,
    );
  }
  if (input.unsupportedFeatures.length > 0) {
    lines.push(`unsupportedFeatures=${input.unsupportedFeatures.join(",")}`);
  }
  return lines.join("\n");
}

function formatBondBindingMetadataSummary(input: {
  bindingMode?: string;
  supportedForm?: string;
  reasonCode?: string;
  nextOutputHash?: string;
  autoDerived?: boolean;
  fallbackReason?: string;
  bindingInputs?: {
    assetId: string;
    assetForm: string;
    amountForm: string;
    nonceForm: string;
    rangeProofForm: string;
    nextAmountSat: number;
    nextOutputIndex: number;
    feeIndex: number;
    maxFeeSat: number;
    rawOutputComponents?: {
      scriptPubKey: "raw-bytes" | "hash";
      rangeProof: "raw-bytes" | "hash";
    };
  };
}): string {
  const lines = [];
  if (input.bindingMode) lines.push(`bindingMode=${input.bindingMode}`);
  if (input.supportedForm) lines.push(`supportedForm=${input.supportedForm}`);
  if (input.reasonCode) lines.push(`reasonCode=${input.reasonCode}`);
  if (input.nextOutputHash) lines.push(`nextOutputHash=${input.nextOutputHash}`);
  if (input.autoDerived !== undefined) lines.push(`autoDerived=${input.autoDerived}`);
  if (input.fallbackReason) lines.push(`fallbackReason=${input.fallbackReason}`);
  if (input.bindingInputs) {
    lines.push(
      `bindingInputs(asset=${input.bindingInputs.assetId}, amountSat=${input.bindingInputs.nextAmountSat}, nextOutputIndex=${input.bindingInputs.nextOutputIndex}, feeIndex=${input.bindingInputs.feeIndex}, maxFeeSat=${input.bindingInputs.maxFeeSat})`,
      `bindingInputForms(assetForm=${input.bindingInputs.assetForm}, amountForm=${input.bindingInputs.amountForm}, nonceForm=${input.bindingInputs.nonceForm}, rangeProofForm=${input.bindingInputs.rangeProofForm})`,
    );
    if (input.bindingInputs.rawOutputComponents) {
      lines.push(
        `rawOutputComponents(scriptPubKey=${input.bindingInputs.rawOutputComponents.scriptPubKey}, rangeProof=${input.bindingInputs.rawOutputComponents.rangeProof})`,
      );
    }
  }
  return lines.join("\n");
}

function formatBondDefinitionOrVerificationSummary(input: {
  artifactPath?: string;
  contractAddress?: string;
  cmr?: string;
  definitionHash?: string;
  issuanceHash?: string;
  definitionOk?: boolean;
  issuanceOk?: boolean;
  principalInvariantValid?: boolean;
  definitionTrustMode?: string;
  issuanceTrustMode?: string;
}): string {
  return [
    input.contractAddress ? `contractAddress=${input.contractAddress}` : undefined,
    input.cmr ? `cmr=${input.cmr}` : undefined,
    input.artifactPath ? `artifactPath=${input.artifactPath}` : undefined,
    input.definitionHash ? `definitionHash=${input.definitionHash}` : undefined,
    input.issuanceHash ? `issuanceHash=${input.issuanceHash}` : undefined,
    input.definitionOk !== undefined ? `definitionOk=${input.definitionOk}` : undefined,
    input.issuanceOk !== undefined ? `issuanceOk=${input.issuanceOk}` : undefined,
    input.principalInvariantValid !== undefined
      ? `principalInvariantValid=${input.principalInvariantValid}`
      : undefined,
    input.definitionTrustMode ? `definitionTrustMode=${input.definitionTrustMode}` : undefined,
    input.issuanceTrustMode ? `issuanceTrustMode=${input.issuanceTrustMode}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatBondSettlementSummary(input: {
  ok?: boolean;
  reason?: string;
  descriptorHash: string;
  bindingMode: string;
  previousStateHash?: string;
  nextStateHash?: string;
  nextContractAddress?: string;
  nextAmountSat?: number;
  maxFeeSat?: number;
  supportedForm?: string;
  reasonCode?: string;
  autoDerived?: boolean;
  fallbackReason?: string;
  nextOutputHash?: string;
  bindingInputs?: {
    assetId: string;
    assetForm: string;
    amountForm: string;
    nonceForm: string;
    rangeProofForm: string;
    nextAmountSat: number;
    nextOutputIndex: number;
    feeIndex: number;
    maxFeeSat: number;
  };
}): string {
  const lines = [
    input.ok !== undefined ? `ok=${input.ok}` : undefined,
    input.reason ? `reason=${input.reason}` : undefined,
    `descriptorHash=${input.descriptorHash}`,
    `bindingMode=${input.bindingMode}`,
    input.previousStateHash ? `previousStateHash=${input.previousStateHash}` : undefined,
    input.nextStateHash ? `nextStateHash=${input.nextStateHash}` : undefined,
    input.nextContractAddress ? `nextContractAddress=${input.nextContractAddress}` : undefined,
    input.nextAmountSat !== undefined ? `nextAmountSat=${input.nextAmountSat}` : undefined,
    input.maxFeeSat !== undefined ? `maxFeeSat=${input.maxFeeSat}` : undefined,
  ].filter(Boolean) as string[];
  const binding = formatBondBindingMetadataSummary({
    bindingMode: input.bindingMode,
    supportedForm: input.supportedForm,
    reasonCode: input.reasonCode,
    autoDerived: input.autoDerived,
    fallbackReason: input.fallbackReason,
    nextOutputHash: input.nextOutputHash,
    bindingInputs: input.bindingInputs,
  });
  return binding ? `${lines.join("\n")}\n${binding}` : lines.join("\n");
}

function formatBondRedemptionSummary(input: {
  phase: "prepare" | "inspect" | "execute" | "verify";
  mode: string;
  nextStatus?: string;
  descriptorHash: string;
  nextStateHash?: string;
  nextContractAddress?: string;
  nextAmountSat?: number;
  summaryHash?: string;
  txId?: string;
  broadcasted?: boolean;
  verified?: boolean;
  bindingMetadata?: {
    bindingMode?: string;
    supportedForm?: string;
    reasonCode?: string;
    nextOutputHash?: string;
    autoDerived?: boolean;
    fallbackReason?: string;
    bindingInputs?: {
      assetId: string;
      assetForm: string;
      amountForm: string;
      nonceForm: string;
      rangeProofForm: string;
      nextAmountSat: number;
      nextOutputIndex: number;
      feeIndex: number;
      maxFeeSat: number;
    };
  };
  outputBindingTrust?: {
    mode: string;
    nextContractAddressCommitted: boolean;
    expectedOutputDescriptorCommitted?: boolean;
    settlementDescriptorCommitted?: boolean;
    outputCountRuntimeBound: boolean;
    feeIndexRuntimeBound: boolean;
    amountRuntimeBound: boolean;
    nextOutputHashRuntimeBound: boolean;
    nextOutputScriptRuntimeBound: boolean;
    supportedForm?: string;
    reasonCode?: string;
    nextOutputHash?: string;
    autoDerived?: boolean;
    fallbackReason?: string;
    bindingInputs?: {
      assetId: string;
      assetForm: string;
      amountForm: string;
      nonceForm: string;
      rangeProofForm: string;
      nextAmountSat: number;
      nextOutputIndex: number;
      feeIndex: number;
      maxFeeSat: number;
    };
  };
}): string {
  const lines = [
    `phase=${input.phase}`,
    `mode=${input.mode}`,
    input.nextStatus ? `nextStatus=${input.nextStatus}` : undefined,
    `descriptorHash=${input.descriptorHash}`,
    input.nextStateHash ? `nextStateHash=${input.nextStateHash}` : undefined,
    input.nextContractAddress ? `nextContractAddress=${input.nextContractAddress}` : undefined,
    input.nextAmountSat !== undefined ? `nextAmountSat=${input.nextAmountSat}` : undefined,
    input.summaryHash ? `summaryHash=${input.summaryHash}` : undefined,
    input.txId ? `txId=${input.txId}` : undefined,
    input.broadcasted !== undefined ? `broadcasted=${input.broadcasted}` : undefined,
    input.verified !== undefined ? `verified=${input.verified}` : undefined,
  ].filter(Boolean) as string[];
  if (input.bindingMetadata) {
    const bindingMetadata = formatBondBindingMetadataSummary(input.bindingMetadata);
    if (bindingMetadata) lines.push(bindingMetadata);
  }
  if (input.outputBindingTrust) {
    lines.push(
      [
        `outputBinding.mode=${input.outputBindingTrust.mode}`,
        `outputBinding.nextContractAddressCommitted=${input.outputBindingTrust.nextContractAddressCommitted}`,
        input.outputBindingTrust.expectedOutputDescriptorCommitted !== undefined
          ? `outputBinding.expectedOutputDescriptorCommitted=${input.outputBindingTrust.expectedOutputDescriptorCommitted}`
          : undefined,
        input.outputBindingTrust.settlementDescriptorCommitted !== undefined
          ? `outputBinding.settlementDescriptorCommitted=${input.outputBindingTrust.settlementDescriptorCommitted}`
          : undefined,
        `outputBinding.outputCountRuntimeBound=${input.outputBindingTrust.outputCountRuntimeBound}`,
        `outputBinding.feeIndexRuntimeBound=${input.outputBindingTrust.feeIndexRuntimeBound}`,
        `outputBinding.amountRuntimeBound=${input.outputBindingTrust.amountRuntimeBound}`,
        `outputBinding.nextOutputHashRuntimeBound=${input.outputBindingTrust.nextOutputHashRuntimeBound}`,
        `outputBinding.nextOutputScriptRuntimeBound=${input.outputBindingTrust.nextOutputScriptRuntimeBound}`,
        input.outputBindingTrust.supportedForm
          ? `outputBinding.supportedForm=${input.outputBindingTrust.supportedForm}`
          : undefined,
        input.outputBindingTrust.reasonCode
          ? `outputBinding.reasonCode=${input.outputBindingTrust.reasonCode}`
          : undefined,
        input.outputBindingTrust.nextOutputHash
          ? `outputBinding.nextOutputHash=${input.outputBindingTrust.nextOutputHash}`
          : undefined,
        input.outputBindingTrust.autoDerived !== undefined
          ? `outputBinding.autoDerived=${input.outputBindingTrust.autoDerived}`
          : undefined,
        input.outputBindingTrust.fallbackReason
          ? `outputBinding.fallbackReason=${input.outputBindingTrust.fallbackReason}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    if (input.outputBindingTrust.bindingInputs) {
      lines.push(
        `outputBinding.bindingInputs(asset=${input.outputBindingTrust.bindingInputs.assetId}, amountSat=${input.outputBindingTrust.bindingInputs.nextAmountSat}, nextOutputIndex=${input.outputBindingTrust.bindingInputs.nextOutputIndex}, feeIndex=${input.outputBindingTrust.bindingInputs.feeIndex}, maxFeeSat=${input.outputBindingTrust.bindingInputs.maxFeeSat})`,
        `outputBinding.bindingInputForms(assetForm=${input.outputBindingTrust.bindingInputs.assetForm}, amountForm=${input.outputBindingTrust.bindingInputs.amountForm}, nonceForm=${input.outputBindingTrust.bindingInputs.nonceForm}, rangeProofForm=${input.outputBindingTrust.bindingInputs.rangeProofForm})`,
      );
    }
  }
  return lines.join("\n");
}

function formatBondClosingSummary(input: {
  phase: "prepare" | "inspect" | "execute" | "verify";
  closingHash?: string;
  closedAt?: string;
  closingReason?: string;
  finalSettlementDescriptorHash?: string;
  summaryHash?: string;
  txId?: string;
  broadcasted?: boolean;
  verified?: boolean;
  checks?: Record<string, boolean>;
}): string {
  const lines = [
    `phase=${input.phase}`,
    input.closingHash ? `closingHash=${input.closingHash}` : undefined,
    input.closedAt ? `closedAt=${input.closedAt}` : undefined,
    input.closingReason ? `closingReason=${input.closingReason}` : undefined,
    input.finalSettlementDescriptorHash
      ? `finalSettlementDescriptorHash=${input.finalSettlementDescriptorHash}`
      : undefined,
    input.summaryHash ? `summaryHash=${input.summaryHash}` : undefined,
    input.txId ? `txId=${input.txId}` : undefined,
    input.broadcasted !== undefined ? `broadcasted=${input.broadcasted}` : undefined,
    input.verified !== undefined ? `verified=${input.verified}` : undefined,
  ].filter(Boolean) as string[];
  if (input.checks) {
    lines.push(
      `checks=${Object.entries(input.checks)
        .map(([key, value]) => `${key}:${value}`)
        .join(",")}`,
    );
  }
  return lines.join("\n");
}

function formatBondEvidenceSummary(input: {
  definitionHash: string;
  issuanceHash: string;
  settlementHash?: string | null;
  closingHash?: string | null;
  renderedSourceHash?: string | null;
  sourceVerificationMode?: string;
}): string {
  return [
    `definitionHash=${input.definitionHash}`,
    `issuanceHash=${input.issuanceHash}`,
    input.settlementHash ? `settlementHash=${input.settlementHash}` : undefined,
    input.closingHash ? `closingHash=${input.closingHash}` : undefined,
    input.renderedSourceHash ? `renderedSourceHash=${input.renderedSourceHash}` : undefined,
    input.sourceVerificationMode ? `sourceVerificationMode=${input.sourceVerificationMode}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatBondFinalityPayloadSummary(input: {
  bondId: string;
  issuanceId: string;
  definitionHash: string;
  issuanceStateHash: string;
  contractAddress: string;
  cmr: string;
  bindingMode: string;
  settlementDescriptorHash?: string | null;
  closingDescriptorHash?: string | null;
}): string {
  return [
    `bondId=${input.bondId}`,
    `issuanceId=${input.issuanceId}`,
    `definitionHash=${input.definitionHash}`,
    `issuanceStateHash=${input.issuanceStateHash}`,
    input.settlementDescriptorHash ? `settlementDescriptorHash=${input.settlementDescriptorHash}` : undefined,
    input.closingDescriptorHash ? `closingDescriptorHash=${input.closingDescriptorHash}` : undefined,
    `contractAddress=${input.contractAddress}`,
    `cmr=${input.cmr}`,
    `bindingMode=${input.bindingMode}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function indent(text: string, spaces = 2): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function formatParamArgs(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([key, value]) => `--param ${key}=${value}`)
    .join(" ");
}

function formatWitnessCliArgs(preset: PresetManifestEntry): string {
  const parts: string[] = [];
  for (const [name, signer] of Object.entries(preset.exampleWitness?.signers ?? {})) {
    parts.push(`--witness-signer ${name}=${signer.privkeyHex}`);
  }
  for (const [name, value] of Object.entries(preset.exampleWitness?.values ?? {})) {
    parts.push(`--witness-value '${name}:${value.type}=${value.value}'`);
  }
  return parts.join(" ");
}

function formatWitnessSchema(preset: PresetManifestEntry): string {
  const entries = Object.entries(preset.witnessSchema ?? {});
  if (entries.length === 0) return "  (none)";
  return entries
    .map(([name, spec]) => {
      const alias = spec.signerAlias ? ` [named signer: ${spec.signerAlias}]` : "";
      const description = spec.description ? ` - ${spec.description}` : "";
      return `  - ${name}: ${spec.type}${alias}${description}`;
    })
    .join("\n");
}

function formatParamSchema(preset: PresetManifestEntry): string {
  return Object.entries(preset.parameterSchema)
    .map(([name, kind]) => `  - ${name}: ${kind}`)
    .join("\n");
}

function formatExecuteSupport(preset: PresetManifestEntry): string {
  return [
    `  direct execute: ${preset.executionProfile.supportsDirectExecute ? "yes" : "no"}`,
    `  relayer execute: ${preset.executionProfile.supportsRelayerExecute ? "yes" : "no"}`,
    `  gasless: ${preset.executionProfile.supportsGasless ? "yes" : "no"}`,
    `  default fee sat: ${preset.executionProfile.defaultFeeSat}`,
    `  utxo policy: ${preset.executionProfile.recommendedUtxoPolicy}`,
  ].join("\n");
}

function formatPresetHelp(preset: PresetManifestEntry): string {
  const compileCommand = [
    "simplicity-cli preset compile",
    `--preset ${preset.id}`,
    formatParamArgs(preset.exampleParams),
    "--artifact ./artifact.json",
  ].join(" ");
  const executeCommand = [
    "simplicity-cli contract execute",
    "--artifact ./artifact.json",
    "--wallet simplicity-test",
    "--privkey <primary-privkey-hex>",
    "--to-address tex1...",
    formatWitnessCliArgs(preset),
  ]
    .filter(Boolean)
    .join(" ");
  const executeGaslessCommand = [
    "simplicity-cli contract execute-gasless",
    "--artifact ./artifact.json",
    "--wallet simplicity-test",
    "--relayer http://127.0.0.1:3000",
    "--api-key <relayer-api-key>",
    "--from-label demo-user",
    "--privkey <primary-privkey-hex>",
    "--to-address tex1...",
    formatWitnessCliArgs(preset),
  ]
    .filter(Boolean)
    .join(" ");
  const tsSnippet = [
    "const compiled = await sdk.compileFromPreset({",
    `  preset: "${preset.id}",`,
    "  params: " + JSON.stringify(preset.exampleParams, null, 2).replace(/\n/g, "\n  "),
    "});",
    "",
    "const result = await compiled.at().execute({",
    '  wallet: "simplicity-test",',
    '  toAddress: "tex1...",',
    '  signer: { type: "schnorrPrivkeyHex", privkeyHex: "<primary-privkey-hex>" },',
    preset.exampleWitness
      ? "  witness: " + JSON.stringify(preset.exampleWitness, null, 2).replace(/\n/g, "\n  ") + ","
      : "",
    "});",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    `${preset.title} (${preset.id})`,
    preset.description,
    "",
    "Parameters:",
    formatParamSchema(preset),
    "",
    "Witness:",
    formatWitnessSchema(preset),
    "",
    "Execution:",
    formatExecuteSupport(preset),
    "",
    "Example Params:",
    indent(JSON.stringify(preset.exampleParams, null, 2)),
    "",
    "Example Witness:",
    indent(JSON.stringify(preset.exampleWitness ?? {}, null, 2)),
    "",
    "Compile Command:",
    `  ${compileCommand}`,
    "",
    "Execute Command:",
    `  ${executeCommand}`,
    "",
    "Gasless Execute Command:",
    `  ${executeGaslessCommand}`,
    "",
    "TypeScript Snippet:",
    indent(tsSnippet),
  ].join("\n");
}

function buildScaffoldData(preset: PresetManifestEntry): {
  compileCommand: string;
  executeCommand: string;
  gaslessCommand: string;
  paramsJson: string;
  witnessJson: string;
  tsExample: string;
} {
  const compileCommand = [
    "simplicity-cli preset compile",
    `--preset ${preset.id}`,
    formatParamArgs(preset.exampleParams),
    "--artifact ./artifact.json",
  ].join(" ");
  const executeCommand = [
    "simplicity-cli contract execute",
    "--artifact ./artifact.json",
    "--wallet simplicity-test",
    "--privkey <primary-privkey-hex>",
    "--to-address tex1...",
    formatWitnessCliArgs(preset),
    "--broadcast",
  ]
    .filter(Boolean)
    .join(" ");
  const gaslessCommand = [
    "simplicity-cli contract execute-gasless",
    "--artifact ./artifact.json",
    "--wallet simplicity-test",
    "--relayer http://127.0.0.1:3000",
    "--api-key <relayer-api-key>",
    "--from-label demo-user",
    "--privkey <primary-privkey-hex>",
    "--to-address tex1...",
    formatWitnessCliArgs(preset),
    "--broadcast",
  ]
    .filter(Boolean)
    .join(" ");
  const paramsJson = JSON.stringify(preset.exampleParams, null, 2);
  const witnessJson = JSON.stringify(preset.exampleWitness ?? {}, null, 2);
  const tsExample = [
    'import { createSimplicityClient } from "@hazbase/simplicity";',
    "",
    "async function main() {",
    "  const sdk = createSimplicityClient({",
    '    network: "liquidtestnet",',
    "    rpc: {",
    '      url: "http://127.0.0.1:18884",',
    '      username: process.env.ELEMENTS_RPC_USER || "<rpc-user>",',
    '      password: process.env.ELEMENTS_RPC_PASSWORD || "<rpc-password>",',
    '      wallet: "simplicity-test",',
    "    },",
    "    toolchain: {",
    '      simcPath: "simc",',
    '      halSimplicityPath: "hal-simplicity",',
    '      elementsCliPath: "eltc",',
    "    },",
    "  });",
    "",
    "  const compiled = await sdk.compileFromPreset({",
    `    preset: "${preset.id}",`,
    `    params: ${paramsJson.replace(/\n/g, "\n    ")},`,
    "  });",
    "",
    "  const result = await compiled.at().execute({",
    '    wallet: "simplicity-test",',
    '    toAddress: "tex1...",',
    '    signer: { type: "schnorrPrivkeyHex", privkeyHex: "<primary-privkey-hex>" },',
    preset.exampleWitness ? `    witness: ${witnessJson.replace(/\n/g, "\n    ")},` : "",
    "  });",
    "",
    "  console.log(result.summaryHash);",
    "}",
    "",
    "main().catch(console.error);",
  ]
    .filter(Boolean)
    .join("\n");
  return { compileCommand, executeCommand, gaslessCommand, paramsJson, witnessJson, tsExample };
}

async function writeScaffoldFiles(writeDir: string, preset: PresetManifestEntry): Promise<string[]> {
  const dir = path.resolve(writeDir);
  await mkdir(dir, { recursive: true });
  const scaffold = buildScaffoldData(preset);
  const files: Array<[string, string]> = [
    ["params.example.json", `${scaffold.paramsJson}\n`],
    ["witness.example.json", `${scaffold.witnessJson}\n`],
    ["compile.command.txt", `${scaffold.compileCommand}\n`],
    ["execute.command.txt", `${scaffold.executeCommand}\n`],
    ["execute-gasless.command.txt", `${scaffold.gaslessCommand}\n`],
    [
      ".env.example",
      [
        "ELEMENTS_RPC_URL=http://127.0.0.1:18884",
        "ELEMENTS_RPC_USER=<rpc-user>",
        "ELEMENTS_RPC_PASSWORD=<rpc-password>",
        "ELEMENTS_RPC_WALLET=simplicity-test",
        "SIMPLICITY_RELAYER_URL=http://127.0.0.1:3000",
        "SIMPLICITY_RELAYER_API_KEY=<relayer-api-key>",
        "SIMPLICITY_PRIMARY_PRIVKEY=<primary-privkey-hex>",
      ].join("\n") + "\n",
    ],
    [
      "fund.command.txt",
      [
        "# Compile first to get artifact.json, then fund the contract address shown in deployment output.",
        'eltc -rpcwallet=simplicity-test sendtoaddress "<contract-address>" 0.00002',
      ].join("\n") + "\n",
    ],
    [`${preset.id}.example.ts`, `${scaffold.tsExample}\n`],
  ];
  await Promise.all(files.map(([name, content]) => writeFile(path.join(dir, name), content, "utf8")));
  return files.map(([name]) => path.join(dir, name));
}

function formatUtxoList(utxos: ContractUtxo[]): string {
  if (utxos.length === 0) return "  (none)";
  return utxos
    .map((utxo) => {
      const state = utxo.confirmed ? `confirmed@${utxo.height ?? "?"}` : "unconfirmed";
      return `  - ${utxo.txid}:${utxo.vout} amountSat=${utxo.sat} ${state}`;
    })
    .join("\n");
}

function classifyArtifactStatus(utxos: ContractUtxo[] | null): "rpc-unavailable" | "unfunded" | "unconfirmed-only" | "executable" {
  if (utxos === null) return "rpc-unavailable";
  if (utxos.length === 0) return "unfunded";
  if (utxos.some((utxo) => utxo.confirmed && utxo.sat > 0)) return "executable";
  return "unconfirmed-only";
}

function formatArtifactHelp(
  artifact: Awaited<ReturnType<typeof loadArtifact>>,
  preset: PresetManifestEntry | null,
  utxos: ContractUtxo[] | null
): string {
  const status = classifyArtifactStatus(utxos);
  const ready = status === "executable";
  const deployment = [
    `  contract address: ${artifact.compiled.contractAddress}`,
    `  cmr: ${artifact.compiled.cmr}`,
    `  internal key: ${artifact.compiled.internalKey}`,
    `  network: ${artifact.network}`,
    `  source mode: ${artifact.source.mode}`,
    `  preset: ${artifact.source.preset ?? "(custom file)"}`,
    `  status: ${status}`,
    `  ready: ${ready ? "yes" : "no"}`,
  ].join("\n");
  const definition = artifact.definition
    ? [
        `  type: ${artifact.definition.definitionType}`,
        `  id: ${artifact.definition.definitionId}`,
        `  schema version: ${artifact.definition.schemaVersion}`,
        `  hash: ${artifact.definition.hash}`,
        `  trust mode: ${artifact.definition.trustMode}`,
        `  anchor mode: ${artifact.definition.anchorMode}`,
        `  on-chain helper: ${artifact.definition.onChainAnchor?.helper ?? "(none)"}`,
        `  source verified: ${artifact.definition.onChainAnchor?.sourceVerified === true ? "yes" : "no"}`,
      ].join("\n")
    : "  (none)";
  const state = artifact.state
    ? [
        `  type: ${artifact.state.stateType}`,
        `  id: ${artifact.state.stateId}`,
        `  schema version: ${artifact.state.schemaVersion}`,
        `  hash: ${artifact.state.hash}`,
        `  trust mode: ${artifact.state.trustMode}`,
        `  anchor mode: ${artifact.state.anchorMode}`,
        `  on-chain helper: ${artifact.state.onChainAnchor?.helper ?? "(none)"}`,
        `  source verified: ${artifact.state.onChainAnchor?.sourceVerified === true ? "yes" : "no"}`,
      ].join("\n")
    : "  (none)";
  const compileSource = artifact.source.simfPath ?? artifact.legacy?.simfTemplatePath ?? "(unknown)";
  const templateVars = artifact.source.templateVars ?? {};
  const inspectCommand = `simplicity-cli contract inspect --artifact ./artifact.json --wallet simplicity-test --privkey <privkey-hex> --to-address tex1...`;
  const executeCommand = `simplicity-cli contract execute --artifact ./artifact.json --wallet simplicity-test --privkey <privkey-hex> --to-address tex1... --broadcast`;

  return [
    "Artifact",
    "",
    "Deployment:",
    deployment,
    "",
    "Source:",
    `  simf: ${compileSource}`,
    `  created at: ${artifact.createdAt}`,
    `  sdk version: ${artifact.metadata.sdkVersion}`,
    "",
    "Template Vars:",
    indent(JSON.stringify(templateVars, null, 2)),
    "",
    "Definition Anchor:",
    definition,
    "",
    "State Anchor:",
    state,
    "",
    "Suggested Commands:",
    `  ${inspectCommand}`,
    `  ${executeCommand}`,
    "",
    "On-chain UTXOs:",
    utxos ? formatUtxoList(utxos) : "  (unavailable: RPC lookup failed)",
    "",
    "Linked Preset:",
    preset ? indent(formatPresetHelp(preset)) : "  (none)",
  ].join("\n");
}

function formatScaffoldBundle(preset: PresetManifestEntry): string {
  const scaffold = buildScaffoldData(preset);

  return [
    `Scaffold for ${preset.title} (${preset.id})`,
    "",
    "Compile:",
    `  ${scaffold.compileCommand}`,
    "",
    "Direct Execute:",
    `  ${scaffold.executeCommand}`,
    "",
    "Gasless Execute:",
    `  ${scaffold.gaslessCommand}`,
    "",
    "Example Params JSON:",
    indent(scaffold.paramsJson),
    "",
    "Example Witness JSON:",
    indent(scaffold.witnessJson),
    "",
    "Support Files:",
    "  - .env.example",
    "  - fund.command.txt",
  ].join("\n");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const subcommand = process.argv[3];
  const sdk = createSimplicityClient(resolveConfig());

  if (!command) {
    throw new Error("Usage: simplicity-cli <compile|presets|preset|contract|artifact|definition|state|binding|policy|bond|gasless> ...");
  }

  if (command === "compile") {
    const result = await sdk.compileFromFile({
      simfPath: requireArg("simf"),
      templateVars: parseAssignments(getMultiArgs("template-var")),
      artifactPath: getArg("artifact"),
      definition: parseDefinitionInput(),
      state: parseStateInput(),
    });
    printJson({ artifact: result.artifact, deployment: result.deployment() });
    return;
  }

  if (command === "definition" && subcommand === "show") {
    const definition = await loadDefinitionInput({
      type: requireArg("type"),
      id: requireArg("id"),
      jsonPath: getArg("json-path"),
      value: getArg("value") ? JSON.parse(getArg("value")!) : undefined,
      schemaVersion: getArg("schema-version"),
    });
    printJson({
      ...definition,
      anchorRecommendation: "Use --definition-anchor-mode on-chain-constant-committed with a blessed custom .simf helper for on-chain enforcement",
    });
    return;
  }

  if (command === "definition" && subcommand === "verify") {
    const verification = await sdk.verifyDefinitionAgainstArtifact({
      artifactPath: requireArg("artifact"),
      type: getArg("type"),
      id: getArg("id"),
      expectedType: getArg("expected-type"),
      expectedId: getArg("expected-id"),
      jsonPath: getArg("json-path"),
      value: getArg("value") ? JSON.parse(getArg("value")!) : undefined,
      schemaVersion: getArg("schema-version"),
    });
    printJson({
      verified: verification.ok,
      reason: verification.reason,
      definition: verification.definition,
      artifactDefinition: verification.artifactDefinition ?? null,
      trust: verification.trust,
    });
    return;
  }

  if (command === "state" && subcommand === "show") {
    const state = await loadStateInput({
      type: requireArg("type"),
      id: requireArg("id"),
      jsonPath: getArg("json-path"),
      value: getArg("value") ? JSON.parse(getArg("value")!) : undefined,
      schemaVersion: getArg("schema-version"),
    });
    printJson({
      ...state,
      anchorRecommendation: "Use --state-anchor-mode on-chain-constant-committed with a blessed custom .simf helper for on-chain enforcement",
    });
    return;
  }

  if (command === "state" && subcommand === "verify") {
    const verification = await sdk.verifyStateAgainstArtifact({
      artifactPath: requireArg("artifact"),
      type: getArg("type"),
      id: getArg("id"),
      expectedType: getArg("expected-type"),
      expectedId: getArg("expected-id"),
      jsonPath: getArg("json-path"),
      value: getArg("value") ? JSON.parse(getArg("value")!) : undefined,
      schemaVersion: getArg("schema-version"),
    });
    printJson({
      verified: verification.ok,
      reason: verification.reason,
      state: verification.state,
      artifactState: verification.artifactState ?? null,
      trust: verification.trust,
    });
    return;
  }

  if (command === "policy" && subcommand === "issue") {
    const result = await sdk.policies.issue({
      recipient: parsePolicyReceiver("recipient") as any,
      template: parsePolicyTemplateInput() as any,
      params: parseAssignments(getMultiArgs("param")) as any,
      amountSat: Number(requireArg("amount-sat")),
      assetId: requireArg("asset-id"),
      propagationMode: (getArg("propagation-mode", "required") as "required" | "optional" | "none"),
      artifactPath: getArg("artifact"),
    });
    const stateOut = getArg("state-out");
    if (stateOut) {
      const resolved = path.resolve(stateOut);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, `${JSON.stringify(result.state, null, 2)}\n`, "utf8");
    }
    printJson({
      summary: {
        propagationMode: result.state.propagationMode,
        policyHash: result.policyHash,
        contractAddress: result.compiled.deployment().contractAddress,
        amountSat: result.state.amountSat,
        assetId: result.state.assetId,
        recipient: result.state.recipient,
      },
      summaryText: formatPolicyIssueSummary({
        propagationMode: result.state.propagationMode,
        policyHash: result.policyHash,
        contractAddress: result.compiled.deployment().contractAddress,
        amountSat: result.state.amountSat,
        assetId: result.state.assetId,
        recipient: result.state.recipient,
      }),
      artifact: result.compiled.artifact,
      deployment: result.compiled.deployment(),
      state: result.state,
      policyTemplate: result.policyTemplate,
      policyHash: result.policyHash,
      stateOut: stateOut ? path.resolve(stateOut) : undefined,
    });
    return;
  }

  if (command === "policy" && subcommand === "list-templates") {
    printJson(sdk.policies.listTemplates());
    return;
  }

  if (command === "binding" && subcommand === "describe-support") {
    const result = sdk.outputBinding.describeSupport();
    printJson({
      summaryText: formatPolicyBindingSupportSummary(result),
      ...result,
    });
    return;
  }

  if (command === "binding" && subcommand === "evaluate-support") {
    const result = sdk.outputBinding.evaluateSupport({
      assetId: requireArg("asset-id"),
      requestedBindingMode:
        (getArg("output-binding-mode") as "none" | "script-bound" | "descriptor-bound" | undefined) ?? "descriptor-bound",
      outputForm: parsePolicyOutputForm() as any,
      rawOutput: parseRawOutputFields() as any,
      nextOutputHash: getArg("next-output-hash") || undefined,
      nextOutputScriptAvailable: hasFlag("without-script-hash") ? false : true,
    });
    printJson({
      ...result,
      summaryText: formatOutputBindingSupportEvaluationSummary(result),
    });
    return;
  }

  if (command === "policy" && subcommand === "verify-state") {
    const result = await sdk.policies.verifyState({
      artifactPath: requireArg("artifact"),
      template: parsePolicyTemplateInput() as any,
      statePath: getArg("state-json"),
      stateValue: getArg("state-value") ? JSON.parse(getArg("state-value")!) : undefined,
    });
    printJson({
      summaryText: formatPolicyVerificationSummary({
        ok: result.ok,
        reason: result.reason,
        propagationMode: result.report.propagationMode,
        enforcement: result.report.enforcement,
        plainExitAllowed: result.report.plainExitAllowed,
        nextPolicyRequired: result.report.nextPolicyRequired,
        nextPolicyPresent: result.report.nextPolicyPresent,
        outputBinding: (result.report as { outputBinding?: Parameters<typeof formatPolicyVerificationSummary>[0]["outputBinding"] }).outputBinding,
      }),
      ...result,
    });
    return;
  }

  if (command === "policy" && subcommand === "describe-template") {
    const templateManifest = getArg("template-manifest");
    const templateManifestValue = getArg("template-manifest-value");
    const templateId = getArg("template-id");
    const result = templateManifest || templateManifestValue || !templateId
      ? await sdk.policies.loadTemplateManifest({
          templateId: templateId || undefined,
          propagationMode: (getArg("propagation-mode") as "required" | "optional" | "none" | undefined),
          manifestPath: templateManifest || undefined,
          manifestValue: templateManifestValue ? JSON.parse(templateManifestValue) : undefined,
        })
      : sdk.policies.describeTemplate({
          templateId,
          propagationMode: (getArg("propagation-mode") as "required" | "optional" | "none" | undefined),
        });
    printJson(result);
    return;
  }

  if (command === "policy" && subcommand === "validate-template-params") {
    const templateManifest = getArg("template-manifest");
    const templateManifestValue = getArg("template-manifest-value");
    const manifest = templateManifest || templateManifestValue
      ? await sdk.policies.loadTemplateManifest({
          templateId: getArg("template-id") || undefined,
          propagationMode: (getArg("propagation-mode") as "required" | "optional" | "none" | undefined),
          manifestPath: templateManifest || undefined,
          manifestValue: templateManifestValue ? JSON.parse(templateManifestValue) : undefined,
        })
      : undefined;
    const result = sdk.policies.validateTemplateParams({
      templateId: getArg("template-id") || manifest?.templateId,
      manifestValue: manifest,
      propagationMode: (getArg("propagation-mode") as "required" | "optional" | "none" | undefined),
      params: parseAssignments(getMultiArgs("param")) as any,
    });
    printJson({ ok: true, params: result });
    return;
  }

  if (command === "policy" && subcommand === "build-output-descriptor") {
    const result = await sdk.policies.buildOutputDescriptor({
      nextCompiledContractAddress: requireArg("next-contract-address"),
      nextAmountSat: Number(requireArg("next-amount-sat")),
      assetId: requireArg("asset-id"),
      maxFeeSat: getArg("max-fee-sat") ? Number(getArg("max-fee-sat")) : undefined,
      nextOutputIndex: getArg("next-output-index") ? Number(getArg("next-output-index")) : undefined,
      feeIndex: getArg("fee-index") ? Number(getArg("fee-index")) : undefined,
      nextOutputHash: getArg("next-output-hash") || undefined,
      outputForm: parsePolicyOutputForm() as any,
      rawOutput: parseRawOutputFields() as any,
      outputBindingMode: (getArg("output-binding-mode") as "none" | "script-bound" | "descriptor-bound" | undefined),
    });
    printJson({
      summary: {
        mode: result.descriptor.outputBindingMode,
        nextContractAddress: result.descriptor.nextContractAddress,
        nextOutputScriptHash: result.descriptor.nextOutputScriptHash ?? null,
        nextOutputHash: result.descriptor.nextOutputHash ?? null,
        nextAmountSat: result.descriptor.nextAmountSat,
        assetId: result.descriptor.assetId,
        supportedForm: result.supportedForm,
        reasonCode: result.reasonCode,
        autoDerived: result.autoDerivedNextOutputHash,
        fallbackReason: result.fallbackReason ?? null,
      },
      summaryText: formatPolicyOutputDescriptorBuildSummary({
        mode: result.descriptor.outputBindingMode,
        nextContractAddress: result.descriptor.nextContractAddress,
        nextOutputScriptHash: result.descriptor.nextOutputScriptHash,
        nextOutputHash: result.descriptor.nextOutputHash,
        nextAmountSat: result.descriptor.nextAmountSat,
        assetId: result.descriptor.assetId,
        supportedForm: result.supportedForm,
        reasonCode: result.reasonCode,
        autoDerived: result.autoDerivedNextOutputHash,
        fallbackReason: result.fallbackReason,
      }),
      descriptor: result.descriptor,
      descriptorSummary: result.summary,
      supportedForm: result.supportedForm,
      autoDerivedNextOutputHash: result.autoDerivedNextOutputHash,
      reasonCode: result.reasonCode,
      bindingInputs: result.bindingInputs,
      fallbackReason: result.fallbackReason ?? null,
    });
    return;
  }

  if (command === "policy" && subcommand === "prepare-transfer") {
    const result = await sdk.policies.prepareTransfer({
      currentArtifactPath: requireArg("current-artifact"),
      template: parsePolicyTemplateInput() as any,
      currentStatePath: getArg("current-state-json"),
      currentStateValue: getArg("current-state-value") ? JSON.parse(getArg("current-state-value")!) : undefined,
      nextReceiver: parsePolicyReceiver("next") as any,
      nextAmountSat: Number(requireArg("next-amount-sat")),
      nextParams: parseAssignments(getMultiArgs("next-param")) as any,
      propagationMode: (getArg("propagation-mode") as "required" | "optional" | "none" | undefined),
      nextArtifactPath: getArg("next-artifact"),
      nextOutputHash: getArg("next-output-hash") || undefined,
      nextOutputForm: parsePolicyOutputForm() as any,
      nextRawOutput: parseRawOutputFields() as any,
      outputBindingMode: (getArg("output-binding-mode") as "none" | "script-bound" | "descriptor-bound" | undefined),
    });
    const nextStateOut = getArg("next-state-out");
    if (nextStateOut && result.nextState) {
      const resolved = path.resolve(nextStateOut);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, `${JSON.stringify(result.nextState, null, 2)}\n`, "utf8");
    }
    const prepareOutputBinding = (
      result.verificationReport as {
        outputBinding?: Parameters<typeof formatPolicyInspectOrExecuteSummary>[0]["outputBinding"];
      }
    ).outputBinding;
    printJson({
      summary: {
        mode: "prepare",
        enforcement: result.verificationReport.enforcement,
        propagationMode: result.verificationReport.propagationMode,
        plainExitAllowed: result.verificationReport.plainExitAllowed,
        nextPolicyRequired: result.verificationReport.nextPolicyRequired,
        nextPolicyPresent: result.verificationReport.nextPolicyPresent,
        outputBinding: prepareOutputBinding ?? null,
        summaryHash: result.transferSummary.hash,
      },
      summaryText: formatPolicyInspectOrExecuteSummary({
        mode: "prepare",
        propagationMode: result.verificationReport.propagationMode,
        enforcement: result.verificationReport.enforcement,
        plainExitAllowed: result.verificationReport.plainExitAllowed,
        nextPolicyRequired: result.verificationReport.nextPolicyRequired,
        nextPolicyPresent: result.verificationReport.nextPolicyPresent,
        outputBinding: prepareOutputBinding,
        summaryHash: result.transferSummary.hash,
      }),
      ...result,
      nextStateOut: nextStateOut && result.nextState ? path.resolve(nextStateOut) : undefined,
    });
    return;
  }

  if (command === "policy" && subcommand === "verify-transfer") {
    const result = await sdk.policies.verifyTransfer({
      template: parsePolicyTemplateInput() as any,
      currentArtifactPath: requireArg("current-artifact"),
      currentStatePath: getArg("current-state-json"),
      currentStateValue: getArg("current-state-value") ? JSON.parse(getArg("current-state-value")!) : undefined,
      transferDescriptorValue: getArg("transfer-value") ? JSON.parse(getArg("transfer-value")!) : undefined,
      nextStatePath: getArg("next-state-json"),
      nextStateValue: getArg("next-state-value") ? JSON.parse(getArg("next-state-value")!) : undefined,
    });
    printJson({
      summary: {
        ok: result.ok,
        reason: result.reason,
        enforcement: result.verificationReport.enforcement,
        propagationMode: result.verificationReport.propagationMode,
        plainExitAllowed: result.verificationReport.plainExitAllowed,
        nextPolicyRequired: result.verificationReport.nextPolicyRequired,
        nextPolicyPresent: result.verificationReport.nextPolicyPresent,
        outputBinding: result.verificationReport.outputBinding ?? null,
      },
      summaryText: formatPolicyVerificationSummary({
        ok: result.ok,
        reason: result.reason,
        propagationMode: result.verificationReport.propagationMode,
        enforcement: result.verificationReport.enforcement,
        plainExitAllowed: result.verificationReport.plainExitAllowed,
        nextPolicyRequired: result.verificationReport.nextPolicyRequired,
        nextPolicyPresent: result.verificationReport.nextPolicyPresent,
        outputBinding: result.verificationReport.outputBinding,
      }),
      ...result,
    });
    return;
  }

  if (command === "policy" && subcommand === "inspect-transfer") {
    const result = await sdk.policies.inspectTransfer({
      currentArtifactPath: requireArg("current-artifact"),
      template: parsePolicyTemplateInput() as any,
      currentStatePath: getArg("current-state-json"),
      currentStateValue: getArg("current-state-value") ? JSON.parse(getArg("current-state-value")!) : undefined,
      nextReceiver: parsePolicyReceiver("next") as any,
      nextAmountSat: Number(requireArg("next-amount-sat")),
      nextParams: parseAssignments(getMultiArgs("next-param")) as any,
      propagationMode: (getArg("propagation-mode") as "required" | "optional" | "none" | undefined),
      nextArtifactPath: getArg("next-artifact"),
      nextOutputHash: getArg("next-output-hash") || undefined,
      nextOutputForm: parsePolicyOutputForm() as any,
      nextRawOutput: parseRawOutputFields() as any,
      outputBindingMode: (getArg("output-binding-mode") as "none" | "script-bound" | "descriptor-bound" | undefined),
      wallet: requireArg("wallet"),
      signer: { type: "schnorrPrivkeyHex", privkeyHex: requireArg("privkey") },
      feeSat: getArg("fee-sat") ? Number(getArg("fee-sat")) : undefined,
      utxoPolicy: (getArg("utxo-policy") as "smallest_over" | "largest" | "newest" | undefined),
    });
    const inspectOutputBinding = (
      result.prepared.verificationReport as {
        outputBinding?: Parameters<typeof formatPolicyInspectOrExecuteSummary>[0]["outputBinding"];
      }
    ).outputBinding;
    printJson({
      summary: {
        mode: result.mode,
        enforcement: result.prepared.verificationReport.enforcement,
        propagationMode: result.prepared.verificationReport.propagationMode,
        plainExitAllowed: result.prepared.verificationReport.plainExitAllowed,
        nextPolicyRequired: result.prepared.verificationReport.nextPolicyRequired,
        nextPolicyPresent: result.prepared.verificationReport.nextPolicyPresent,
        outputBinding: inspectOutputBinding ?? null,
        summaryHash: result.inspect.summaryHash,
      },
      summaryText: formatPolicyInspectOrExecuteSummary({
        mode: result.mode,
        propagationMode: result.prepared.verificationReport.propagationMode,
        enforcement: result.prepared.verificationReport.enforcement,
        plainExitAllowed: result.prepared.verificationReport.plainExitAllowed,
        nextPolicyRequired: result.prepared.verificationReport.nextPolicyRequired,
        nextPolicyPresent: result.prepared.verificationReport.nextPolicyPresent,
        outputBinding: inspectOutputBinding,
        summaryHash: result.inspect.summaryHash,
      }),
      ...result,
    });
    return;
  }

  if (command === "policy" && subcommand === "execute-transfer") {
    const result = await sdk.policies.executeTransfer({
      currentArtifactPath: requireArg("current-artifact"),
      template: parsePolicyTemplateInput() as any,
      currentStatePath: getArg("current-state-json"),
      currentStateValue: getArg("current-state-value") ? JSON.parse(getArg("current-state-value")!) : undefined,
      nextReceiver: parsePolicyReceiver("next") as any,
      nextAmountSat: Number(requireArg("next-amount-sat")),
      nextParams: parseAssignments(getMultiArgs("next-param")) as any,
      propagationMode: (getArg("propagation-mode") as "required" | "optional" | "none" | undefined),
      nextArtifactPath: getArg("next-artifact"),
      nextOutputHash: getArg("next-output-hash") || undefined,
      nextOutputForm: parsePolicyOutputForm() as any,
      nextRawOutput: parseRawOutputFields() as any,
      outputBindingMode: (getArg("output-binding-mode") as "none" | "script-bound" | "descriptor-bound" | undefined),
      wallet: requireArg("wallet"),
      signer: { type: "schnorrPrivkeyHex", privkeyHex: requireArg("privkey") },
      feeSat: getArg("fee-sat") ? Number(getArg("fee-sat")) : undefined,
      broadcast: hasFlag("broadcast"),
      utxoPolicy: (getArg("utxo-policy") as "smallest_over" | "largest" | "newest" | undefined),
    });
    const executeOutputBinding = (
      result.prepared.verificationReport as {
        outputBinding?: Parameters<typeof formatPolicyInspectOrExecuteSummary>[0]["outputBinding"];
      }
    ).outputBinding;
    printJson({
      summary: {
        mode: result.mode,
        enforcement: result.prepared.verificationReport.enforcement,
        propagationMode: result.prepared.verificationReport.propagationMode,
        plainExitAllowed: result.prepared.verificationReport.plainExitAllowed,
        nextPolicyRequired: result.prepared.verificationReport.nextPolicyRequired,
        nextPolicyPresent: result.prepared.verificationReport.nextPolicyPresent,
        outputBinding: executeOutputBinding ?? null,
        summaryHash: result.execution.summaryHash,
        txId: result.execution.txId ?? null,
        broadcasted: result.execution.broadcasted,
      },
      summaryText: formatPolicyInspectOrExecuteSummary({
        mode: result.mode,
        propagationMode: result.prepared.verificationReport.propagationMode,
        enforcement: result.prepared.verificationReport.enforcement,
        plainExitAllowed: result.prepared.verificationReport.plainExitAllowed,
        nextPolicyRequired: result.prepared.verificationReport.nextPolicyRequired,
        nextPolicyPresent: result.prepared.verificationReport.nextPolicyPresent,
        outputBinding: executeOutputBinding,
        summaryHash: result.execution.summaryHash,
        txId: result.execution.txId,
        broadcasted: result.execution.broadcasted,
      }),
      ...result,
    });
    return;
  }

  if (command === "policy" && subcommand === "export-evidence") {
    const result = await sdk.policies.exportEvidence({
      artifactPath: requireArg("artifact"),
      template: parsePolicyTemplateInput() as any,
      statePath: getArg("state-json"),
      stateValue: getArg("state-value") ? JSON.parse(getArg("state-value")!) : undefined,
      transferDescriptorValue: getArg("transfer-value") ? JSON.parse(getArg("transfer-value")!) : undefined,
    });
    printJson({
      summary: {
        templateHash: result.template.hash,
        stateHash: result.state.hash,
        transferHash: result.transfer?.hash ?? null,
        enforcement: result.report.enforcement,
        outputBinding: result.report.outputBinding ?? null,
        sourceVerificationMode: result.sourceVerificationMode,
      },
      summaryText: formatPolicyEvidenceSummary({
        templateHash: result.template.hash,
        stateHash: result.state.hash,
        transferHash: result.transfer?.hash ?? null,
        enforcement: result.report.enforcement,
        outputBinding: result.report.outputBinding ?? null,
        sourceVerificationMode: result.sourceVerificationMode,
      }),
      ...result,
    });
    return;
  }

  if (command === "presets" && subcommand === "list") {
    printJson(listPresets().map((preset) => describePreset(preset)));
    return;
  }

  if (command === "presets" && subcommand === "show") {
    const preset = getPresetOrThrow(requireArg("preset"));
    if (hasFlag("json")) {
      printJson(describePreset(preset));
      return;
    }
    process.stdout.write(`${formatPresetHelp(preset)}\n`);
    return;
  }

  if (command === "presets" && subcommand === "scaffold") {
    const preset = getPresetOrThrow(requireArg("preset"));
    const scaffold = buildScaffoldData(preset);
    const writeDir = getArg("write-dir");
    if (hasFlag("json")) {
      printJson({
        preset: describePreset(preset),
        compileCommand: scaffold.compileCommand,
        executeCommand: scaffold.executeCommand,
        gaslessCommand: scaffold.gaslessCommand,
      });
      return;
    }
    const writtenFiles = writeDir ? await writeScaffoldFiles(writeDir, preset) : [];
    process.stdout.write(`${formatScaffoldBundle(preset)}\n`);
    if (writtenFiles.length > 0) {
      process.stdout.write(`\nWritten Files:\n${writtenFiles.map((file) => `  ${file}`).join("\n")}\n`);
    }
    return;
  }

  if (command === "preset" && subcommand === "compile") {
    const params = parseAssignments(getMultiArgs("param"));
    if (params.minHeight !== undefined && params.MIN_HEIGHT === undefined) params.MIN_HEIGHT = params.minHeight;
    if (params.signerXonly !== undefined && params.SIGNER_XONLY === undefined) params.SIGNER_XONLY = params.signerXonly;
    if (params.refundXonly !== undefined && params.REFUND_XONLY === undefined) params.REFUND_XONLY = params.refundXonly;
    const result = await sdk.compileFromPreset({
      preset: requireArg("preset"),
      params,
      artifactPath: getArg("artifact"),
      definition: parseDefinitionInput(),
      state: parseStateInput(),
    });
    printJson({ artifact: result.artifact, deployment: result.deployment() });
    return;
  }

  if (command === "artifact" && subcommand === "show") {
    const artifact = await loadArtifact(requireArg("artifact"));
    const preset =
      artifact.source.mode === "preset" && artifact.source.preset
        ? getPresetOrThrow(artifact.source.preset)
        : null;
    let utxos: ContractUtxo[] | null = null;
    try {
      utxos = await sdk.fromArtifact(artifact).findUtxos();
    } catch {
      utxos = null;
    }
    if (!hasFlag("json")) {
      process.stdout.write(`${formatArtifactHelp(artifact, preset, utxos)}\n`);
      return;
    }
    printJson({
      artifact,
      preset,
      utxos,
      status: classifyArtifactStatus(utxos),
      ready: classifyArtifactStatus(utxos) === "executable",
    });
    return;
  }

  if (command === "bond" && subcommand === "define") {
    const result = await sdk.bonds.define({
      definitionPath: getArg("definition-json"),
      issuancePath: getArg("issuance-json"),
      simfPath: getArg("simf"),
      artifactPath: getArg("artifact"),
    });
    printJson({
      artifact: result.artifact,
      deployment: result.deployment(),
      summary: {
        artifactPath: getArg("artifact") ? path.resolve(getArg("artifact")!) : undefined,
        contractAddress: result.artifact.compiled.contractAddress,
        cmr: result.artifact.compiled.cmr,
        definitionHash: result.artifact.definition?.hash,
        issuanceHash: result.artifact.state?.hash,
      },
      summaryText: formatBondDefinitionOrVerificationSummary({
        artifactPath: getArg("artifact") ? path.resolve(getArg("artifact")!) : undefined,
        contractAddress: result.artifact.compiled.contractAddress,
        cmr: result.artifact.compiled.cmr,
        definitionHash: result.artifact.definition?.hash,
        issuanceHash: result.artifact.state?.hash,
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "issue") {
    const result = await sdk.bonds.issue({
      definitionPath: getArg("definition-json"),
      issuancePath: getArg("issuance-json"),
      simfPath: getArg("simf"),
      artifactPath: getArg("artifact"),
    });
    printJson({
      artifact: result.artifact,
      deployment: result.deployment(),
      summary: {
        artifactPath: getArg("artifact") ? path.resolve(getArg("artifact")!) : undefined,
        contractAddress: result.artifact.compiled.contractAddress,
        cmr: result.artifact.compiled.cmr,
        definitionHash: result.artifact.definition?.hash,
        issuanceHash: result.artifact.state?.hash,
      },
      summaryText: formatBondDefinitionOrVerificationSummary({
        artifactPath: getArg("artifact") ? path.resolve(getArg("artifact")!) : undefined,
        contractAddress: result.artifact.compiled.contractAddress,
        cmr: result.artifact.compiled.cmr,
        definitionHash: result.artifact.definition?.hash,
        issuanceHash: result.artifact.state?.hash,
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "verify") {
    const result = await sdk.bonds.verify({
      artifactPath: requireArg("artifact"),
      definitionPath: getArg("definition-json"),
      issuancePath: getArg("issuance-json"),
    });
    printJson({
      ...result,
      summary: {
        artifactPath: path.resolve(requireArg("artifact")),
        contractAddress: result.artifact.compiled.contractAddress,
        cmr: result.artifact.compiled.cmr,
        definitionHash: result.definition.definition.hash,
        issuanceHash: result.issuance.state.hash,
        definitionOk: result.definition.ok,
        issuanceOk: result.issuance.ok,
        principalInvariantValid: result.crossChecks.principalInvariantValid,
        definitionTrustMode: result.definition.trust.effectiveMode,
        issuanceTrustMode: result.issuance.trust.effectiveMode,
      },
      summaryText: formatBondDefinitionOrVerificationSummary({
        artifactPath: path.resolve(requireArg("artifact")),
        contractAddress: result.artifact.compiled.contractAddress,
        cmr: result.artifact.compiled.cmr,
        definitionHash: result.definition.definition.hash,
        issuanceHash: result.issuance.state.hash,
        definitionOk: result.definition.ok,
        issuanceOk: result.issuance.ok,
        principalInvariantValid: result.crossChecks.principalInvariantValid,
        definitionTrustMode: result.definition.trust.effectiveMode,
        issuanceTrustMode: result.issuance.trust.effectiveMode,
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "prepare-redemption") {
    const result = await sdk.bonds.prepareRedemption({
      definitionPath: getArg("definition-json"),
      previousIssuancePath: getArg("previous-issuance-json"),
      amount: Number(requireArg("amount")),
      redeemedAt: requireArg("redeemed-at"),
      nextStateSimfPath: getArg("next-state-simf"),
      nextAmountSat: Number(requireArg("next-amount-sat")),
      maxFeeSat: getArg("max-fee-sat") ? Number(getArg("max-fee-sat")) : undefined,
      nextOutputHash: getArg("next-output-hash") || undefined,
      outputForm: parsePolicyOutputForm() as any,
      rawOutput: parseRawOutputFields() as any,
      outputBindingMode: (getArg("output-binding-mode") as "none" | "script-bound" | "descriptor-bound" | undefined),
    });
    const nextIssuanceOut = getArg("next-issuance-out");
    if (nextIssuanceOut) {
      const resolved = path.resolve(nextIssuanceOut);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(`${resolved}`, `${JSON.stringify(result.preview.next, null, 2)}\n`, "utf8");
    }
    printJson({
      ...result,
      nextIssuanceState: result.preview.next,
      nextIssuanceOut: nextIssuanceOut ? path.resolve(nextIssuanceOut) : undefined,
      summary: {
        mode: result.settlement.descriptor.outputBindingMode,
        nextStatus: result.preview.next.status,
        descriptorHash: result.settlement.descriptorHash,
        nextStateHash: result.settlement.nextStateHash,
        nextContractAddress: result.settlement.nextContractAddress,
        nextAmountSat: result.settlement.nextAmountSat,
        supportedForm: result.settlement.supportedForm,
        reasonCode: result.settlement.reasonCode,
        autoDerived: result.settlement.autoDerivedNextOutputHash,
        fallbackReason: result.settlement.fallbackReason,
        nextOutputHash: result.settlement.expectedOutputDescriptor?.nextOutputHash,
        bindingInputs: result.settlement.bindingInputs ?? null,
      },
      summaryText: formatBondRedemptionSummary({
        phase: "prepare",
        mode: result.settlement.descriptor.outputBindingMode ?? "none",
        nextStatus: result.preview.next.status,
        descriptorHash: result.settlement.descriptorHash,
        nextStateHash: result.settlement.nextStateHash,
        nextContractAddress: result.settlement.nextContractAddress,
        nextAmountSat: result.settlement.nextAmountSat,
        bindingMetadata: {
          bindingMode: result.settlement.descriptor.outputBindingMode,
          supportedForm: result.settlement.supportedForm,
          reasonCode: result.settlement.reasonCode,
          nextOutputHash: result.settlement.expectedOutputDescriptor?.nextOutputHash,
          autoDerived: result.settlement.autoDerivedNextOutputHash,
          fallbackReason: result.settlement.fallbackReason,
          bindingInputs: result.settlement.bindingInputs,
        },
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "inspect-redemption") {
    const result = await sdk.bonds.inspectRedemption({
      currentArtifactPath: requireArg("current-artifact"),
      definitionPath: getArg("definition-json"),
      previousIssuancePath: getArg("previous-issuance-json"),
      nextIssuancePath: getArg("next-issuance-json"),
      nextStateSimfPath: getArg("next-state-simf"),
      machineSimfPath: getArg("machine-simf"),
      machineArtifactPath: getArg("machine-artifact"),
      nextAmountSat: getArg("next-amount-sat") ? Number(getArg("next-amount-sat")) : undefined,
      maxFeeSat: getArg("max-fee-sat") ? Number(getArg("max-fee-sat")) : undefined,
      nextOutputHash: getArg("next-output-hash") || undefined,
      outputForm: parsePolicyOutputForm() as any,
      rawOutput: parseRawOutputFields() as any,
      outputBindingMode: (getArg("output-binding-mode") as "none" | "script-bound" | "descriptor-bound" | undefined),
      wallet: requireArg("wallet"),
      signer: { type: "schnorrPrivkeyHex", privkeyHex: requireArg("privkey") },
      feeSat: getArg("fee-sat") ? Number(getArg("fee-sat")) : undefined,
      utxoPolicy: getArg("utxo-policy") as "smallest_over" | "largest" | "newest" | undefined,
    });
    printJson({
      ...result,
      summary: {
        mode: result.mode,
        nextStatus: result.settlement.descriptor.nextStatus,
        descriptorHash: result.settlement.descriptorHash,
        nextStateHash: result.settlement.nextStateHash,
        nextContractAddress: result.plan.nextContractAddress,
        nextAmountSat: result.settlement.nextAmountSat,
        summaryHash: result.inspect.summaryHash,
      },
      summaryText: formatBondRedemptionSummary({
        phase: "inspect",
        mode: result.mode,
        nextStatus: result.settlement.descriptor.nextStatus,
        descriptorHash: result.settlement.descriptorHash,
        nextStateHash: result.settlement.nextStateHash,
        nextContractAddress: result.plan.nextContractAddress,
        nextAmountSat: result.settlement.nextAmountSat,
        summaryHash: result.inspect.summaryHash,
        bindingMetadata: {
          bindingMode: result.settlement.descriptor.outputBindingMode,
          supportedForm: result.settlement.supportedForm,
          reasonCode: result.settlement.reasonCode,
          nextOutputHash: result.settlement.expectedOutputDescriptor?.nextOutputHash,
          autoDerived: result.settlement.autoDerivedNextOutputHash,
          fallbackReason: result.settlement.fallbackReason,
          bindingInputs: result.settlement.bindingInputs,
        },
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "execute-redemption") {
    const result = await sdk.bonds.executeRedemption({
      currentArtifactPath: requireArg("current-artifact"),
      definitionPath: getArg("definition-json"),
      previousIssuancePath: getArg("previous-issuance-json"),
      nextIssuancePath: getArg("next-issuance-json"),
      nextStateSimfPath: getArg("next-state-simf"),
      machineSimfPath: getArg("machine-simf"),
      machineArtifactPath: getArg("machine-artifact"),
      nextAmountSat: getArg("next-amount-sat") ? Number(getArg("next-amount-sat")) : undefined,
      maxFeeSat: getArg("max-fee-sat") ? Number(getArg("max-fee-sat")) : undefined,
      nextOutputHash: getArg("next-output-hash") || undefined,
      outputForm: parsePolicyOutputForm() as any,
      rawOutput: parseRawOutputFields() as any,
      outputBindingMode: (getArg("output-binding-mode") as "none" | "script-bound" | "descriptor-bound" | undefined),
      wallet: requireArg("wallet"),
      signer: { type: "schnorrPrivkeyHex", privkeyHex: requireArg("privkey") },
      feeSat: getArg("fee-sat") ? Number(getArg("fee-sat")) : undefined,
      utxoPolicy: getArg("utxo-policy") as "smallest_over" | "largest" | "newest" | undefined,
      broadcast: hasFlag("broadcast"),
    });
    printJson({
      ...result,
      summary: {
        mode: result.mode,
        nextStatus: result.settlement.descriptor.nextStatus,
        descriptorHash: result.settlement.descriptorHash,
        nextStateHash: result.settlement.nextStateHash,
        nextContractAddress: result.plan.nextContractAddress,
        nextAmountSat: result.settlement.nextAmountSat,
        txId: result.execution.txId ?? null,
        broadcasted: Boolean(result.execution.txId),
      },
      summaryText: formatBondRedemptionSummary({
        phase: "execute",
        mode: result.mode,
        nextStatus: result.settlement.descriptor.nextStatus,
        descriptorHash: result.settlement.descriptorHash,
        nextStateHash: result.settlement.nextStateHash,
        nextContractAddress: result.plan.nextContractAddress,
        nextAmountSat: result.settlement.nextAmountSat,
        txId: result.execution.txId,
        broadcasted: Boolean(result.execution.txId),
        bindingMetadata: {
          bindingMode: result.settlement.descriptor.outputBindingMode,
          supportedForm: result.settlement.supportedForm,
          reasonCode: result.settlement.reasonCode,
          nextOutputHash: result.settlement.expectedOutputDescriptor?.nextOutputHash,
          autoDerived: result.settlement.autoDerivedNextOutputHash,
          fallbackReason: result.settlement.fallbackReason,
          bindingInputs: result.settlement.bindingInputs,
        },
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "verify-redemption") {
    const result = await sdk.bonds.verifyRedemption({
      artifactPath: requireArg("artifact"),
      definitionPath: getArg("definition-json"),
      previousIssuancePath: getArg("previous-issuance-json"),
      nextIssuancePath: getArg("next-issuance-json"),
      nextStateSimfPath: getArg("next-state-simf"),
      nextAmountSat: getArg("next-amount-sat") ? Number(getArg("next-amount-sat")) : undefined,
      maxFeeSat: getArg("max-fee-sat") ? Number(getArg("max-fee-sat")) : undefined,
      nextOutputHash: getArg("next-output-hash") || undefined,
      outputForm: parsePolicyOutputForm() as any,
      rawOutput: parseRawOutputFields() as any,
      outputBindingMode: (getArg("output-binding-mode") as "none" | "script-bound" | "descriptor-bound" | undefined),
    });
    const outputBindingTrust = "outputBindingTrust" in result ? result.outputBindingTrust : undefined;
    printJson({
      ...result,
      summary: {
        verified: result.verified,
        mode: result.mode,
        descriptorHash: result.settlement.descriptorHash,
        nextStateHash: result.settlement.nextStateHash,
        nextAmountSat: result.settlement.nextAmountSat,
        supportedForm: result.outputBindingMetadata?.supportedForm ?? null,
        reasonCode: result.outputBindingMetadata?.reasonCode ?? null,
        autoDerived: result.outputBindingMetadata?.autoDerived ?? null,
        fallbackReason: result.outputBindingMetadata?.fallbackReason ?? null,
        nextOutputHash: result.settlement.expectedOutputDescriptor?.nextOutputHash ?? null,
        bindingInputs: result.outputBindingMetadata?.bindingInputs ?? null,
        outputBindingTrust: outputBindingTrust ?? null,
      },
      summaryText: formatBondRedemptionSummary({
        phase: "verify",
        mode: result.mode,
        descriptorHash: result.settlement.descriptorHash,
        nextStateHash: result.settlement.nextStateHash,
        nextAmountSat: result.settlement.nextAmountSat,
        verified: result.verified,
        bindingMetadata: {
          bindingMode: result.settlement.descriptor.outputBindingMode,
          supportedForm: result.outputBindingMetadata?.supportedForm,
          reasonCode: result.outputBindingMetadata?.reasonCode,
          nextOutputHash: result.settlement.expectedOutputDescriptor?.nextOutputHash,
          autoDerived: result.outputBindingMetadata?.autoDerived,
          fallbackReason: result.outputBindingMetadata?.fallbackReason,
          bindingInputs: result.outputBindingMetadata?.bindingInputs,
        },
        outputBindingTrust,
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "build-settlement") {
    const result = await sdk.bonds.buildSettlement({
      definitionPath: getArg("definition-json"),
      previousIssuancePath: getArg("previous-issuance-json"),
      nextIssuancePath: getArg("next-issuance-json"),
      nextStateSimfPath: getArg("next-state-simf"),
      nextOutputHash: getArg("next-output-hash") || undefined,
      nextAmountSat: Number(requireArg("next-amount-sat")),
      maxFeeSat: getArg("max-fee-sat") ? Number(getArg("max-fee-sat")) : undefined,
      outputForm: parsePolicyOutputForm() as any,
      rawOutput: parseRawOutputFields() as any,
      outputBindingMode: (getArg("output-binding-mode") as "none" | "script-bound" | "descriptor-bound" | undefined),
    });
    printJson({
      ...result,
      summary: {
        descriptorHash: result.descriptorHash,
        bindingMode: result.descriptor.outputBindingMode,
        previousStateHash: result.previousStateHash,
        nextStateHash: result.nextStateHash,
        nextContractAddress: result.nextContractAddress,
        nextAmountSat: result.nextAmountSat,
        maxFeeSat: result.maxFeeSat,
        supportedForm: result.supportedForm,
        reasonCode: result.reasonCode,
        autoDerived: result.autoDerivedNextOutputHash,
        fallbackReason: result.fallbackReason,
        nextOutputHash: result.expectedOutputDescriptor?.nextOutputHash,
        bindingInputs: result.bindingInputs ?? null,
      },
      summaryText: formatBondSettlementSummary({
        descriptorHash: result.descriptorHash,
        bindingMode: result.descriptor.outputBindingMode ?? "none",
        previousStateHash: result.previousStateHash,
        nextStateHash: result.nextStateHash,
        nextContractAddress: result.nextContractAddress,
        nextAmountSat: result.nextAmountSat,
        maxFeeSat: result.maxFeeSat,
        supportedForm: result.supportedForm,
        reasonCode: result.reasonCode,
        autoDerived: result.autoDerivedNextOutputHash,
        fallbackReason: result.fallbackReason,
        nextOutputHash: result.expectedOutputDescriptor?.nextOutputHash,
        bindingInputs: result.bindingInputs ?? undefined,
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "verify-settlement") {
    const result = await sdk.bonds.verifySettlement({
      descriptorPath: getArg("descriptor-json"),
      definitionPath: getArg("definition-json"),
      previousIssuancePath: getArg("previous-issuance-json"),
      nextIssuancePath: getArg("next-issuance-json"),
      nextStateSimfPath: getArg("next-state-simf"),
      nextOutputHash: getArg("next-output-hash") || undefined,
      nextAmountSat: getArg("next-amount-sat") ? Number(getArg("next-amount-sat")) : undefined,
      maxFeeSat: getArg("max-fee-sat") ? Number(getArg("max-fee-sat")) : undefined,
      outputForm: parsePolicyOutputForm() as any,
      rawOutput: parseRawOutputFields() as any,
    });
    printJson({
      ...result,
      summary: {
        ok: result.ok,
        reason: result.reason,
        descriptorHash: result.hash,
        bindingMode: result.descriptor.outputBindingMode,
        previousStateHash: result.descriptor.previousStateHash,
        nextStateHash: result.descriptor.nextStateHash,
        nextContractAddress: result.descriptor.nextContractAddress,
        nextAmountSat: result.descriptor.nextAmountSat,
        maxFeeSat: result.descriptor.maxFeeSat,
        supportedForm: result.supportedForm,
        reasonCode: result.reasonCode,
        autoDerived: result.autoDerivedNextOutputHash,
        fallbackReason: result.fallbackReason,
        bindingInputs: result.bindingInputs ?? null,
      },
      summaryText: formatBondSettlementSummary({
        ok: result.ok,
        reason: result.reason,
        descriptorHash: result.hash,
        bindingMode: result.descriptor.outputBindingMode ?? "none",
        previousStateHash: result.descriptor.previousStateHash,
        nextStateHash: result.descriptor.nextStateHash,
        nextContractAddress: result.descriptor.nextContractAddress,
        nextAmountSat: result.descriptor.nextAmountSat,
        maxFeeSat: result.descriptor.maxFeeSat,
        supportedForm: result.supportedForm,
        reasonCode: result.reasonCode,
        autoDerived: result.autoDerivedNextOutputHash,
        fallbackReason: result.fallbackReason,
        bindingInputs: result.bindingInputs ?? undefined,
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "prepare-closing") {
    const result = await sdk.bonds.prepareClosing({
      definitionPath: getArg("definition-json"),
      redeemedIssuancePath: getArg("redeemed-issuance-json"),
      settlementDescriptorPath: getArg("settlement-descriptor-json"),
      closedAt: requireArg("closed-at"),
      closingReason: getArg("closing-reason") as "REDEEMED" | "CANCELLED" | "MATURED_OUT" | undefined,
    });
    printJson({
      ...result,
      summary: {
        closingHash: result.closingHash,
        closedAt: result.closing.closedAt,
        closingReason: result.closing.closingReason,
        finalSettlementDescriptorHash: result.closing.finalSettlementDescriptorHash,
      },
      summaryText: formatBondClosingSummary({
        phase: "prepare",
        closingHash: result.closingHash,
        closedAt: result.closing.closedAt,
        closingReason: result.closing.closingReason,
        finalSettlementDescriptorHash: result.closing.finalSettlementDescriptorHash,
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "inspect-closing") {
    const result = await sdk.bonds.inspectClosing({
      currentArtifactPath: requireArg("current-artifact"),
      definitionPath: getArg("definition-json"),
      redeemedIssuancePath: getArg("redeemed-issuance-json"),
      settlementDescriptorPath: getArg("settlement-descriptor-json"),
      closedIssuanceSimfPath: getArg("closed-issuance-simf"),
      closingArtifactPath: getArg("closing-artifact"),
      closedAt: requireArg("closed-at"),
      closingReason: getArg("closing-reason") as "REDEEMED" | "CANCELLED" | "MATURED_OUT" | undefined,
      wallet: requireArg("wallet"),
      signer: { type: "schnorrPrivkeyHex", privkeyHex: requireArg("privkey") },
      feeSat: getArg("fee-sat") ? Number(getArg("fee-sat")) : undefined,
      utxoPolicy: getArg("utxo-policy") as "smallest_over" | "largest" | "newest" | undefined,
    });
    printJson({
      ...result,
      summary: {
        closingHash: result.plan.closingHash,
        closedAt: result.plan.closingDescriptor.closedAt,
        closingReason: result.plan.closingDescriptor.closingReason,
        finalSettlementDescriptorHash: result.plan.closingDescriptor.finalSettlementDescriptorHash,
        summaryHash: result.inspect.summaryHash,
      },
      summaryText: formatBondClosingSummary({
        phase: "inspect",
        closingHash: result.plan.closingHash,
        closedAt: result.plan.closingDescriptor.closedAt,
        closingReason: result.plan.closingDescriptor.closingReason,
        finalSettlementDescriptorHash: result.plan.closingDescriptor.finalSettlementDescriptorHash,
        summaryHash: result.inspect.summaryHash,
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "execute-closing") {
    const result = await sdk.bonds.executeClosing({
      currentArtifactPath: requireArg("current-artifact"),
      definitionPath: getArg("definition-json"),
      redeemedIssuancePath: getArg("redeemed-issuance-json"),
      settlementDescriptorPath: getArg("settlement-descriptor-json"),
      closedIssuanceSimfPath: getArg("closed-issuance-simf"),
      closingArtifactPath: getArg("closing-artifact"),
      closedAt: requireArg("closed-at"),
      closingReason: getArg("closing-reason") as "REDEEMED" | "CANCELLED" | "MATURED_OUT" | undefined,
      wallet: requireArg("wallet"),
      signer: { type: "schnorrPrivkeyHex", privkeyHex: requireArg("privkey") },
      feeSat: getArg("fee-sat") ? Number(getArg("fee-sat")) : undefined,
      utxoPolicy: getArg("utxo-policy") as "smallest_over" | "largest" | "newest" | undefined,
      broadcast: hasFlag("broadcast"),
    });
    printJson({
      ...result,
      summary: {
        closingHash: result.plan.closingHash,
        closedAt: result.plan.closingDescriptor.closedAt,
        closingReason: result.plan.closingDescriptor.closingReason,
        finalSettlementDescriptorHash: result.plan.closingDescriptor.finalSettlementDescriptorHash,
        txId: result.execution.txId ?? null,
        broadcasted: Boolean(result.execution.txId),
      },
      summaryText: formatBondClosingSummary({
        phase: "execute",
        closingHash: result.plan.closingHash,
        closedAt: result.plan.closingDescriptor.closedAt,
        closingReason: result.plan.closingDescriptor.closingReason,
        finalSettlementDescriptorHash: result.plan.closingDescriptor.finalSettlementDescriptorHash,
        txId: result.execution.txId,
        broadcasted: Boolean(result.execution.txId),
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "verify-closing") {
    const closedIssuancePath = getArg("closed-issuance-json");
    const closedIssuanceValue = getArg("closed-issuance-value")
      ? JSON.parse(getArg("closed-issuance-value")!)
      : undefined;
    const closingDescriptorValue = getArg("closing-descriptor-value")
      ? JSON.parse(getArg("closing-descriptor-value")!)
      : undefined;
    const result = await sdk.bonds.verifyClosing({
      definitionPath: getArg("definition-json"),
      redeemedIssuancePath: getArg("redeemed-issuance-json"),
      closedIssuancePath,
      closedIssuanceValue,
      settlementDescriptorPath: getArg("settlement-descriptor-json"),
      closingDescriptorValue,
    });
    printJson({
      ...result,
      summary: {
        verified: result.verified,
        closedAt: result.closed.closedAt,
        closingReason: result.closed.closingReason,
        finalSettlementDescriptorHash: result.closed.finalSettlementDescriptorHash,
        checks: result.checks,
      },
      summaryText: formatBondClosingSummary({
        phase: "verify",
        verified: result.verified,
        closedAt: result.closed.closedAt,
        closingReason: result.closed.closingReason,
        finalSettlementDescriptorHash: result.closed.finalSettlementDescriptorHash,
        checks: result.checks,
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "export-evidence") {
    const settlementDescriptorValue = getArg("settlement-descriptor-value")
      ? JSON.parse(getArg("settlement-descriptor-value")!)
      : undefined;
    const transitionValue = getArg("transition-value")
      ? JSON.parse(getArg("transition-value")!)
      : undefined;
    const result = await sdk.bonds.exportEvidence({
      artifactPath: requireArg("artifact"),
      definitionPath: getArg("definition-json"),
      issuancePath: getArg("issuance-json"),
      settlementDescriptorValue,
      transitionValue,
    });
    printJson({
      ...result,
      summary: {
        definitionHash: result.definition.hash,
        issuanceHash: result.issuance.hash,
        settlementHash: result.settlement?.hash ?? null,
        closingHash: result.closing?.hash ?? null,
        renderedSourceHash: result.renderedSourceHash ?? null,
        sourceVerificationMode: result.sourceVerificationMode,
      },
      summaryText: formatBondEvidenceSummary({
        definitionHash: result.definition.hash,
        issuanceHash: result.issuance.hash,
        settlementHash: result.settlement?.hash ?? null,
        closingHash: result.closing?.hash ?? null,
        renderedSourceHash: result.renderedSourceHash ?? null,
        sourceVerificationMode: result.sourceVerificationMode,
      }),
    });
    return;
  }

  if (command === "bond" && subcommand === "export-finality-payload") {
    const settlementDescriptorValue = getArg("settlement-descriptor-value")
      ? JSON.parse(getArg("settlement-descriptor-value")!)
      : undefined;
    const closingDescriptorValue = getArg("closing-descriptor-value")
      ? JSON.parse(getArg("closing-descriptor-value")!)
      : undefined;
    const result = await sdk.bonds.exportFinalityPayload({
      artifactPath: requireArg("artifact"),
      definitionPath: getArg("definition-json"),
      issuancePath: getArg("issuance-json"),
      settlementDescriptorValue,
      closingDescriptorValue,
    });
    printJson({
      ...result,
      summary: {
        bondId: result.payload.bondId,
        issuanceId: result.payload.issuanceId,
        definitionHash: result.payload.definitionHash,
        issuanceStateHash: result.payload.issuanceStateHash,
        settlementDescriptorHash: result.evidenceSummary.settlementHash,
        closingDescriptorHash: result.evidenceSummary.closingHash,
        contractAddress: result.payload.contractAddress,
        cmr: result.payload.cmr,
        bindingMode: result.bindingMode,
      },
      summaryText: formatBondFinalityPayloadSummary({
        bondId: result.payload.bondId,
        issuanceId: result.payload.issuanceId,
        definitionHash: result.payload.definitionHash,
        issuanceStateHash: result.payload.issuanceStateHash,
        settlementDescriptorHash: result.evidenceSummary.settlementHash,
        closingDescriptorHash: result.evidenceSummary.closingHash,
        contractAddress: result.payload.contractAddress,
        cmr: result.payload.cmr,
        bindingMode: result.bindingMode,
      }),
    });
    return;
  }

  if (command === "contract" && subcommand === "wait-funding") {
    const compiled = await sdk.loadArtifact(requireArg("artifact"));
    const utxos = await compiled.at().waitForFunding({
      minAmountSat: getArg("min-amount-sat") ? Number(getArg("min-amount-sat")) : undefined,
      pollIntervalMs: getArg("poll-interval-ms") ? Number(getArg("poll-interval-ms")) : undefined,
      timeoutMs: getArg("timeout-ms") ? Number(getArg("timeout-ms")) : undefined,
    });
    printJson(utxos);
    return;
  }

  if (
    command === "contract" &&
    (subcommand === "inspect" || subcommand === "execute" || subcommand === "execute-gasless")
  ) {
    const compiled = await sdk.loadArtifact(requireArg("artifact"));
    const contract = compiled.at();
    const witnessFile = getArg("witness-file");
    const witness = witnessFile || getMultiArgs("witness-value").length > 0
      ? {
          source: witnessFile ? await readFile(witnessFile, "utf8") : undefined,
          values: getMultiArgs("witness-value").length > 0 ? parseWitnessAssignments(getMultiArgs("witness-value")) : undefined,
          signers: getMultiArgs("witness-signer").length > 0 ? parseWitnessSigners(getMultiArgs("witness-signer")) : undefined,
        }
      : getMultiArgs("witness-signer").length > 0
        ? {
            signers: parseWitnessSigners(getMultiArgs("witness-signer")),
          }
        : undefined;
    const payload = {
      wallet: getArg("wallet", process.env.ELEMENTS_RPC_WALLET ?? "simplicity-test")!,
      toAddress: requireArg("to-address"),
      sendAmount: getArg("send-amount") ? Number(getArg("send-amount")) : undefined,
      feeSat: getArg("fee-sat") ? Number(getArg("fee-sat")) : undefined,
      expectedLiquidReceiver: getArg("expected-liquid-receiver"),
      purpose: getArg("purpose"),
      periodId: getArg("period-id"),
      bondDefinitionId: getArg("bond-definition-id"),
      utxoPolicy: (getArg("utxo-policy") as any) ?? undefined,
      signer: {
        type: "schnorrPrivkeyHex" as const,
        privkeyHex: requireArg("privkey"),
      },
      witness,
      broadcast: hasFlag("broadcast"),
      verbose: hasFlag("verbose"),
    };

    if (subcommand === "inspect") {
      const result = await contract.inspectCall(payload);
      printJson(result);
      return;
    }

    if (subcommand === "execute-gasless") {
      const relayerUrl = getArg("relayer");
      const result = await contract.executeGasless({
        wallet: getArg("wallet", process.env.ELEMENTS_RPC_WALLET ?? "simplicity-test")!,
        sponsorWallet: relayerUrl ? undefined : requireArg("sponsor-wallet"),
        relayer: relayerUrl
          ? sdk.relayer({
              baseUrl: relayerUrl,
              apiKey: requireArg("api-key"),
            })
          : undefined,
        fromLabel: getArg("from-label"),
        toAddress: requireArg("to-address"),
        sendAmount: getArg("send-amount") ? Number(getArg("send-amount")) : undefined,
        feeSat: getArg("fee-sat") ? Number(getArg("fee-sat")) : undefined,
        contractChangeAddress: getArg("contract-change-address"),
        sponsorChangeAddress: getArg("sponsor-change-address"),
        signer: {
          type: "schnorrPrivkeyHex",
          privkeyHex: requireArg("privkey"),
        },
        witness,
        utxoPolicy: (getArg("utxo-policy") as any) ?? undefined,
        broadcast: hasFlag("broadcast"),
      });
      printJson(result);
      return;
    }

    const result = await contract.execute(payload);
    printJson(result);
    return;
  }

  if (command === "gasless" && subcommand === "request") {
    const relayer = sdk.relayer({
      baseUrl: requireArg("relayer"),
      apiKey: requireArg("api-key"),
    });
    const result = await relayer.requestPset({
      amount: Number(requireArg("amount")),
      toAddress: requireArg("to-address"),
      fromLabel: requireArg("from-label"),
    });
    printJson(result);
    return;
  }

  if (command === "gasless" && subcommand === "submit") {
    const relayer = sdk.relayer({
      baseUrl: requireArg("relayer"),
      apiKey: requireArg("api-key"),
    });
    const result = await relayer.submitSignedPset({
      psetId: requireArg("pset-id"),
      signedPsetBase64: requireArg("signed-pset"),
    });
    printJson(result);
    return;
  }

  if (command === "gasless" && subcommand === "status") {
    const relayer = sdk.relayer({
      baseUrl: requireArg("relayer"),
      apiKey: requireArg("api-key"),
    });
    const result = await relayer.getPsetStatus(requireArg("pset-id"));
    printJson(result);
    return;
  }

  throw new Error(`Unknown command: ${command}${subcommand ? ` ${subcommand}` : ""}`);
}

main().catch((error) => {
  if (error instanceof SimplicitySdkError) {
    printJson({ error: { code: error.code, message: error.message, details: error.details } });
    process.exit(1);
  }
  printJson({ error: { code: "UNEXPECTED", message: String(error?.message ?? error) } });
  process.exit(1);
});
