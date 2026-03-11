import { readFile } from "node:fs/promises";
import path from "node:path";
import { DefinitionError } from "./errors";
import {
  ArtifactStateMetadata,
  DefinitionAnchorMode,
  SimplicityArtifact,
  StateDocumentDescriptor,
  StateDocumentInput,
  StateVerificationResult,
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
    throw new DefinitionError("State JSON must not contain undefined values");
  }
  if (value === null) return;
  if (typeof value === "bigint") {
    throw new DefinitionError("State JSON must not contain bigint values");
  }
  if (value instanceof Date) {
    throw new DefinitionError("State JSON must not contain Date objects; normalize them first");
  }
  if (Array.isArray(value)) {
    for (const entry of value) ensureSerializable(entry, seen);
    return;
  }
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (seen.has(objectValue)) {
      throw new DefinitionError("State JSON must not contain circular references");
    }
    seen.add(objectValue);
    for (const entry of Object.values(objectValue)) ensureSerializable(entry, seen);
  }
}

async function resolveStateValue(input: StateDocumentInput): Promise<{ value: unknown; sourcePath?: string }> {
  if ((input.jsonPath ? 1 : 0) + (input.value !== undefined ? 1 : 0) !== 1) {
    throw new DefinitionError("Exactly one of jsonPath or value must be provided");
  }
  if (input.jsonPath) {
    const sourcePath = path.resolve(input.jsonPath);
    const raw = await readFile(sourcePath, "utf8");
    try {
      return { value: JSON.parse(raw), sourcePath };
    } catch (error) {
      throw new DefinitionError(`Failed to parse state JSON at ${sourcePath}`, error);
    }
  }
  return { value: input.value };
}

export async function loadStateInput(input: StateDocumentInput): Promise<StateDocumentDescriptor> {
  const stateType = assertNonEmpty(input.type, "state.type");
  const stateId = assertNonEmpty(input.id, "state.id");
  const schemaVersion = assertNonEmpty(input.schemaVersion ?? DEFAULT_SCHEMA_VERSION, "state.schemaVersion");
  const { value, sourcePath } = await resolveStateValue(input);
  ensureSerializable(value);
  const canonicalJson = stableStringify(value);
  return {
    stateType,
    stateId,
    schemaVersion,
    canonicalJson,
    hash: sha256HexUtf8(canonicalJson),
    sourcePath,
  };
}

export function detectOnChainStateAnchor(simfSource: string): {
  sourceVerified: boolean;
  helper?: "nonzero-eq_256";
  reason?: string;
} {
  const source = stripComments(simfSource.replace(/\r\n/g, "\n"));
  if (!source.includes("{{STATE_HASH}}")) {
    return { sourceVerified: false, reason: "STATE_HASH placeholder is missing" };
  }
  const helperBody = extractFunctionBody(source, "require_state_anchor");
  if (!helperBody) {
    return { sourceVerified: false, reason: "Required state anchor helper function is missing" };
  }
  if (!helperBody.includes("let anchored_state_hash: u256 = 0x{{STATE_HASH}};")) {
    return { sourceVerified: false, reason: "Required anchored_state_hash assignment is missing" };
  }
  if (!helperBody.includes(`let zero_hash: u256 = ${ZERO_HASH_256};`)) {
    return { sourceVerified: false, reason: "Required zero_hash assignment is missing" };
  }
  if (!helperBody.includes("assert!(not(jet::eq_256(anchored_state_hash, zero_hash)));")) {
    return { sourceVerified: false, reason: "Required eq_256 assertion is missing" };
  }
  const mainBody = extractFunctionBody(source, "main");
  if (!mainBody) {
    return { sourceVerified: false, reason: "main function is missing" };
  }
  if (!mainBody.includes("require_state_anchor();")) {
    return { sourceVerified: false, reason: "require_state_anchor() is not called from main" };
  }
  return { sourceVerified: true, helper: "nonzero-eq_256" };
}

export function buildArtifactStateMetadata(
  state: StateDocumentDescriptor,
  options?: {
    anchorMode?: DefinitionAnchorMode;
    onChainAnchor?: ArtifactStateMetadata["onChainAnchor"];
  }
): ArtifactStateMetadata {
  return {
    stateType: state.stateType,
    stateId: state.stateId,
    schemaVersion: state.schemaVersion,
    hash: state.hash,
    trustMode: "hash-anchor",
    anchorMode: options?.anchorMode ?? DEFAULT_ANCHOR_MODE,
    onChainAnchor: options?.onChainAnchor,
  };
}

export function verifyStateDescriptorAgainstArtifact(
  state: StateDocumentDescriptor,
  artifactState?: ArtifactStateMetadata,
  expectedType?: string,
  expectedId?: string
): StateVerificationResult {
  const noStateTrust: StateVerificationResult["trust"] = {
    artifactMatch: false,
    onChainAnchorPresent: false,
    onChainAnchorVerified: false,
    effectiveMode: "none",
  };
  if (expectedType && expectedType !== state.stateType) {
    return {
      ok: false,
      reason: `State type mismatch: expected=${expectedType} actual=${state.stateType}`,
      state,
      artifactState,
      trust: noStateTrust,
    };
  }
  if (expectedId && expectedId !== state.stateId) {
    return {
      ok: false,
      reason: `State id mismatch: expected=${expectedId} actual=${state.stateId}`,
      state,
      artifactState,
      trust: noStateTrust,
    };
  }
  if (!artifactState) {
    return {
      ok: false,
      reason: "Artifact does not contain state metadata",
      state,
      trust: noStateTrust,
    };
  }
  const trust = {
    artifactMatch: false,
    onChainAnchorPresent: artifactState.anchorMode === "on-chain-constant-committed",
    onChainAnchorVerified: false,
    effectiveMode: artifactState.anchorMode,
  } satisfies StateVerificationResult["trust"];
  if (artifactState.stateType !== state.stateType) {
    return {
      ok: false,
      reason: `State type mismatch: artifact=${artifactState.stateType} actual=${state.stateType}`,
      state,
      artifactState,
      trust,
    };
  }
  if (artifactState.stateId !== state.stateId) {
    return {
      ok: false,
      reason: `State id mismatch: artifact=${artifactState.stateId} actual=${state.stateId}`,
      state,
      artifactState,
      trust,
    };
  }
  if (artifactState.schemaVersion !== state.schemaVersion) {
    return {
      ok: false,
      reason: `State schemaVersion mismatch: artifact=${artifactState.schemaVersion} actual=${state.schemaVersion}`,
      state,
      artifactState,
      trust,
    };
  }
  if (artifactState.hash !== state.hash) {
    return {
      ok: false,
      reason: `State hash mismatch: artifact=${artifactState.hash} actual=${state.hash}`,
      state,
      artifactState,
      trust,
    };
  }
  return {
    ok: true,
    state,
    artifactState,
    trust: {
      ...trust,
      artifactMatch: true,
    },
  };
}

async function resolveStateTrust(
  artifact: SimplicityArtifact,
  baseTrust: StateVerificationResult["trust"]
): Promise<StateVerificationResult["trust"]> {
  if (!artifact.state) {
    return {
      artifactMatch: false,
      onChainAnchorPresent: false,
      onChainAnchorVerified: false,
      effectiveMode: "none",
    };
  }
  if (artifact.state.anchorMode !== "on-chain-constant-committed") {
    return baseTrust;
  }
  const sourcePath = artifact.source.mode === "file" ? artifact.source.simfPath : undefined;
  if (!sourcePath) {
    return {
      ...baseTrust,
      onChainAnchorPresent: true,
      onChainAnchorVerified: false,
    };
  }
  try {
    const source = await readFile(sourcePath, "utf8");
    const detection = detectOnChainStateAnchor(source);
    return {
      ...baseTrust,
      onChainAnchorPresent: true,
      onChainAnchorVerified: detection.sourceVerified,
    };
  } catch {
    return {
      ...baseTrust,
      onChainAnchorPresent: true,
      onChainAnchorVerified: false,
    };
  }
}

export async function verifyStateAgainstArtifact(input: {
  artifact: SimplicityArtifact;
  state: StateDocumentInput;
  expectedType?: string;
  expectedId?: string;
}): Promise<StateVerificationResult> {
  const state = await loadStateInput(input.state);
  const base = verifyStateDescriptorAgainstArtifact(state, input.artifact.state, input.expectedType, input.expectedId);
  const trust = await resolveStateTrust(input.artifact, base.trust);
  return {
    ...base,
    trust,
  };
}
