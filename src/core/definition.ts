import { readFile } from "node:fs/promises";
import path from "node:path";
import { DefinitionError } from "./errors";
import {
  ArtifactDefinitionMetadata,
  DefinitionDescriptor,
  DefinitionInput,
  DefinitionVerificationResult,
  SimplicityArtifact,
} from "./types";
import { stableStringify, sha256HexUtf8 } from "./summary";

const DEFAULT_SCHEMA_VERSION = "1";

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

export function buildArtifactDefinitionMetadata(definition: DefinitionDescriptor): ArtifactDefinitionMetadata {
  return {
    definitionType: definition.definitionType,
    definitionId: definition.definitionId,
    schemaVersion: definition.schemaVersion,
    hash: definition.hash,
    trustMode: "hash-anchor",
  };
}

export function verifyDefinitionDescriptorAgainstArtifact(
  definition: DefinitionDescriptor,
  artifactDefinition?: ArtifactDefinitionMetadata,
  expectedType?: string,
  expectedId?: string
): DefinitionVerificationResult {
  if (expectedType && expectedType !== definition.definitionType) {
    return {
      ok: false,
      reason: `Definition type mismatch: expected=${expectedType} actual=${definition.definitionType}`,
      definition,
      artifactDefinition,
    };
  }
  if (expectedId && expectedId !== definition.definitionId) {
    return {
      ok: false,
      reason: `Definition id mismatch: expected=${expectedId} actual=${definition.definitionId}`,
      definition,
      artifactDefinition,
    };
  }
  if (!artifactDefinition) {
    return {
      ok: false,
      reason: "Artifact does not contain definition metadata",
      definition,
    };
  }
  if (artifactDefinition.definitionType !== definition.definitionType) {
    return {
      ok: false,
      reason: `Definition type mismatch: artifact=${artifactDefinition.definitionType} actual=${definition.definitionType}`,
      definition,
      artifactDefinition,
    };
  }
  if (artifactDefinition.definitionId !== definition.definitionId) {
    return {
      ok: false,
      reason: `Definition id mismatch: artifact=${artifactDefinition.definitionId} actual=${definition.definitionId}`,
      definition,
      artifactDefinition,
    };
  }
  if (artifactDefinition.schemaVersion !== definition.schemaVersion) {
    return {
      ok: false,
      reason: `Definition schemaVersion mismatch: artifact=${artifactDefinition.schemaVersion} actual=${definition.schemaVersion}`,
      definition,
      artifactDefinition,
    };
  }
  if (artifactDefinition.hash !== definition.hash) {
    return {
      ok: false,
      reason: `Definition hash mismatch: artifact=${artifactDefinition.hash} actual=${definition.hash}`,
      definition,
      artifactDefinition,
    };
  }
  return { ok: true, definition, artifactDefinition };
}

export async function verifyDefinitionAgainstArtifact(input: {
  artifact: SimplicityArtifact;
  definition: DefinitionInput;
  expectedType?: string;
  expectedId?: string;
}): Promise<DefinitionVerificationResult> {
  const definition = await loadDefinitionInput(input.definition);
  return verifyDefinitionDescriptorAgainstArtifact(
    definition,
    input.artifact.definition,
    input.expectedType,
    input.expectedId
  );
}
