import { readFile } from "node:fs/promises";
import path from "node:path";
import { DefinitionError } from "./errors";
import {
  ArtifactDefinitionMetadata,
  DefinitionAnchorMode,
  DefinitionDescriptor,
  DefinitionInput,
  DefinitionVerificationResult,
  SimplicityArtifact,
} from "./types";
import { stableStringify, sha256HexUtf8 } from "./summary";

const DEFAULT_SCHEMA_VERSION = "1";
const DEFAULT_ANCHOR_MODE: DefinitionAnchorMode = "artifact-hash-anchor";
const ZERO_HASH_256 = "0x0000000000000000000000000000000000000000000000000000000000000000";

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function extractFunctionBody(source: string, functionName: string): string | null {
  const marker = `fn ${functionName}()`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const braceStart = source.indexOf("{", start);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart + 1, i);
      }
    }
  }
  return null;
}

function assertNonEmpty(value: string | undefined, fieldName: string): string {
  if (!value || value.trim().length === 0) {
    throw new DefinitionError(`${fieldName} must not be empty`);
  }
  return value;
}

function ensureSerializable(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (value === undefined) {
    throw new DefinitionError("Definition JSON must not contain undefined values");
  }
  if (value === null) return;
  if (typeof value === "bigint") {
    throw new DefinitionError("Definition JSON must not contain bigint values");
  }
  if (value instanceof Date) {
    throw new DefinitionError("Definition JSON must not contain Date objects; normalize them first");
  }
  if (Array.isArray(value)) {
    for (const entry of value) ensureSerializable(entry, seen);
    return;
  }
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (seen.has(objectValue)) {
      throw new DefinitionError("Definition JSON must not contain circular references");
    }
    seen.add(objectValue);
    for (const entry of Object.values(objectValue)) ensureSerializable(entry, seen);
  }
}

async function resolveDefinitionValue(input: DefinitionInput): Promise<{ value: unknown; sourcePath?: string }> {
  if ((input.jsonPath ? 1 : 0) + (input.value !== undefined ? 1 : 0) !== 1) {
    throw new DefinitionError("Exactly one of jsonPath or value must be provided");
  }
  if (input.jsonPath) {
    const sourcePath = path.resolve(input.jsonPath);
    const raw = await readFile(sourcePath, "utf8");
    try {
      return { value: JSON.parse(raw), sourcePath };
    } catch (error) {
      throw new DefinitionError(`Failed to parse definition JSON at ${sourcePath}`, error);
    }
  }
  return { value: input.value };
}

export async function loadDefinitionInput(input: DefinitionInput): Promise<DefinitionDescriptor> {
  const definitionType = assertNonEmpty(input.type, "definition.type");
  const definitionId = assertNonEmpty(input.id, "definition.id");
  const schemaVersion = assertNonEmpty(input.schemaVersion ?? DEFAULT_SCHEMA_VERSION, "definition.schemaVersion");
  const { value, sourcePath } = await resolveDefinitionValue(input);
  ensureSerializable(value);
  const canonicalJson = stableStringify(value);
  return {
    definitionType,
    definitionId,
    schemaVersion,
    canonicalJson,
    hash: sha256HexUtf8(canonicalJson),
    sourcePath,
  };
}

export function detectOnChainDefinitionAnchor(simfSource: string): {
  sourceVerified: boolean;
  helper?: "nonzero-eq_256";
  reason?: string;
} {
  const source = stripComments(simfSource.replace(/\r\n/g, "\n"));
  if (!source.includes("{{DEFINITION_HASH}}")) {
    return { sourceVerified: false, reason: "DEFINITION_HASH placeholder is missing" };
  }
  const helperBody = extractFunctionBody(source, "require_definition_anchor");
  if (!helperBody) {
    return { sourceVerified: false, reason: "Required anchor helper function is missing" };
  }
  if (!helperBody.includes("let anchored_definition_hash: u256 = 0x{{DEFINITION_HASH}};")) {
    return { sourceVerified: false, reason: "Required anchored_definition_hash assignment is missing" };
  }
  if (!helperBody.includes(`let zero_hash: u256 = ${ZERO_HASH_256};`)) {
    return { sourceVerified: false, reason: "Required zero_hash assignment is missing" };
  }
  if (!helperBody.includes("assert!(not(jet::eq_256(anchored_definition_hash, zero_hash)));")) {
    return { sourceVerified: false, reason: "Required eq_256 assertion is missing" };
  }
  const mainBody = extractFunctionBody(source, "main");
  if (!mainBody) {
    return { sourceVerified: false, reason: "main function is missing" };
  }
  if (!mainBody.includes("require_definition_anchor();")) {
    return { sourceVerified: false, reason: "require_definition_anchor() is not called from main" };
  }
  return { sourceVerified: true, helper: "nonzero-eq_256" };
}

export function buildArtifactDefinitionMetadata(
  definition: DefinitionDescriptor,
  options?: {
    anchorMode?: DefinitionAnchorMode;
    onChainAnchor?: ArtifactDefinitionMetadata["onChainAnchor"];
  }
): ArtifactDefinitionMetadata {
  return {
    definitionType: definition.definitionType,
    definitionId: definition.definitionId,
    schemaVersion: definition.schemaVersion,
    hash: definition.hash,
    trustMode: "hash-anchor",
    anchorMode: options?.anchorMode ?? DEFAULT_ANCHOR_MODE,
    onChainAnchor: options?.onChainAnchor,
  };
}

export function verifyDefinitionDescriptorAgainstArtifact(
  definition: DefinitionDescriptor,
  artifactDefinition?: ArtifactDefinitionMetadata,
  expectedType?: string,
  expectedId?: string
): DefinitionVerificationResult {
  const noDefinitionTrust: DefinitionVerificationResult["trust"] = {
    artifactMatch: false,
    onChainAnchorPresent: false,
    onChainAnchorVerified: false,
    effectiveMode: "none",
  };
  if (expectedType && expectedType !== definition.definitionType) {
    return {
      ok: false,
      reason: `Definition type mismatch: expected=${expectedType} actual=${definition.definitionType}`,
      definition,
      artifactDefinition,
      trust: noDefinitionTrust,
    };
  }
  if (expectedId && expectedId !== definition.definitionId) {
    return {
      ok: false,
      reason: `Definition id mismatch: expected=${expectedId} actual=${definition.definitionId}`,
      definition,
      artifactDefinition,
      trust: noDefinitionTrust,
    };
  }
  if (!artifactDefinition) {
    return {
      ok: false,
      reason: "Artifact does not contain definition metadata",
      definition,
      trust: noDefinitionTrust,
    };
  }
  const trust = {
    artifactMatch: false,
    onChainAnchorPresent: artifactDefinition.anchorMode === "on-chain-constant-committed",
    onChainAnchorVerified: false,
    effectiveMode: artifactDefinition.anchorMode,
  } satisfies DefinitionVerificationResult["trust"];
  if (artifactDefinition.definitionType !== definition.definitionType) {
    return {
      ok: false,
      reason: `Definition type mismatch: artifact=${artifactDefinition.definitionType} actual=${definition.definitionType}`,
      definition,
      artifactDefinition,
      trust,
    };
  }
  if (artifactDefinition.definitionId !== definition.definitionId) {
    return {
      ok: false,
      reason: `Definition id mismatch: artifact=${artifactDefinition.definitionId} actual=${definition.definitionId}`,
      definition,
      artifactDefinition,
      trust,
    };
  }
  if (artifactDefinition.schemaVersion !== definition.schemaVersion) {
    return {
      ok: false,
      reason: `Definition schemaVersion mismatch: artifact=${artifactDefinition.schemaVersion} actual=${definition.schemaVersion}`,
      definition,
      artifactDefinition,
      trust,
    };
  }
  if (artifactDefinition.hash !== definition.hash) {
    return {
      ok: false,
      reason: `Definition hash mismatch: artifact=${artifactDefinition.hash} actual=${definition.hash}`,
      definition,
      artifactDefinition,
      trust,
    };
  }
  return {
    ok: true,
    definition,
    artifactDefinition,
    trust: {
      ...trust,
      artifactMatch: true,
    },
  };
}

async function resolveDefinitionTrust(
  artifact: SimplicityArtifact,
  baseTrust: DefinitionVerificationResult["trust"]
): Promise<DefinitionVerificationResult["trust"]> {
  if (!artifact.definition) {
    return {
      artifactMatch: false,
      onChainAnchorPresent: false,
      onChainAnchorVerified: false,
      effectiveMode: "none",
    };
  }
  if (artifact.definition.anchorMode !== "on-chain-constant-committed") {
    return baseTrust;
  }
  if (artifact.source.mode !== "file" || !artifact.source.simfPath) {
    return {
      ...baseTrust,
      onChainAnchorPresent: true,
      onChainAnchorVerified: false,
      effectiveMode: "on-chain-constant-committed",
    };
  }
  try {
    const source = await readFile(artifact.source.simfPath, "utf8");
    const detection = detectOnChainDefinitionAnchor(source);
    return {
      ...baseTrust,
      onChainAnchorPresent: true,
      onChainAnchorVerified: detection.sourceVerified === true,
      effectiveMode: "on-chain-constant-committed",
    };
  } catch {
    return {
      ...baseTrust,
      onChainAnchorPresent: true,
      onChainAnchorVerified: false,
      effectiveMode: "on-chain-constant-committed",
    };
  }
}

export async function verifyDefinitionAgainstArtifact(input: {
  artifact: SimplicityArtifact;
  definition: DefinitionInput;
  expectedType?: string;
  expectedId?: string;
}): Promise<DefinitionVerificationResult> {
  const definition = await loadDefinitionInput(input.definition);
  const result = verifyDefinitionDescriptorAgainstArtifact(
    definition,
    input.artifact.definition,
    input.expectedType,
    input.expectedId
  );
  return {
    ...result,
    trust: await resolveDefinitionTrust(input.artifact, result.trust),
  };
}
