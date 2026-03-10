import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArtifactError, ValidationError } from "./errors";
import { AnyArtifact, ArtifactV5, SimplicityArtifact } from "./types";

export const SDK_ARTIFACT_VERSION = 6;
export const SDK_PACKAGE_VERSION = "0.1.0";

function isArtifactV5(value: AnyArtifact): value is ArtifactV5 {
  return value.version === 5;
}

export function normalizeArtifact(
  artifact: AnyArtifact,
  networkDefault: SimplicityArtifact["network"] = "liquidtestnet"
): SimplicityArtifact {
  if (artifact.version === SDK_ARTIFACT_VERSION) {
    const current = artifact as SimplicityArtifact;
    return {
      ...current,
      definition: current.definition
        ? {
            ...current.definition,
            anchorMode: current.definition.anchorMode ?? "artifact-hash-anchor",
          }
        : undefined,
    };
  }
  if (!isArtifactV5(artifact)) {
    throw new ArtifactError("Unsupported artifact version", artifact);
  }

  const compiled = artifact.compiled ?? {};
  if (!compiled.program || !compiled.cmr || !compiled.internalKey || !compiled.contractAddress) {
    throw new ArtifactError("Artifact v5 is missing compiled fields", artifact);
  }

  return {
    version: SDK_ARTIFACT_VERSION,
    kind: "simplicity-artifact",
    createdAt: artifact.createdAt,
    network: networkDefault,
    source: {
      mode: "file",
      simfPath: artifact.simfTemplatePath,
      templateVars: artifact.params
        ? {
            MIN_HEIGHT: artifact.params.minHeight ?? "",
            SIGNER_XONLY: artifact.params.signerXonly ?? "",
          }
        : undefined,
    },
    compiled: {
      program: compiled.program,
      cmr: compiled.cmr,
      internalKey: compiled.internalKey,
      contractAddress: compiled.contractAddress,
    },
    toolchain: {
      simcPath: artifact.toolchain?.simcPath ?? "simc",
      halSimplicity: artifact.toolchain?.halSimplicity ?? "hal-simplicity",
    },
    metadata: {
      sdkVersion: SDK_PACKAGE_VERSION,
      notes: null,
    },
    definition: undefined,
    legacy: {
      simfTemplatePath: artifact.simfTemplatePath,
      params: artifact.params,
    },
  };
}

export async function loadArtifact(
  artifactPath: string,
  networkDefault: SimplicityArtifact["network"] = "liquidtestnet"
): Promise<SimplicityArtifact> {
  const raw = await readFile(artifactPath, "utf8");
  let parsed: AnyArtifact;
  try {
    parsed = JSON.parse(raw) as AnyArtifact;
  } catch (error) {
    throw new ArtifactError(`Failed to parse artifact JSON at ${artifactPath}`, error);
  }
  const normalized = normalizeArtifact(parsed, networkDefault);
  const artifactDir = path.dirname(path.resolve(artifactPath));
  const sourceSimfPath = normalized.source.simfPath
    ? path.resolve(artifactDir, normalized.source.simfPath)
    : normalized.source.simfPath;
  const legacySimfTemplatePath = normalized.legacy?.simfTemplatePath
    ? path.resolve(artifactDir, normalized.legacy.simfTemplatePath)
    : normalized.legacy?.simfTemplatePath;
  return {
    ...normalized,
    source: {
      ...normalized.source,
      simfPath: sourceSimfPath,
    },
    legacy: normalized.legacy
      ? {
          ...normalized.legacy,
          simfTemplatePath: legacySimfTemplatePath,
        }
      : undefined,
    definition: normalized.definition,
  };
}

export async function saveArtifact(artifactPath: string, artifact: SimplicityArtifact): Promise<void> {
  if (!path.isAbsolute(artifactPath) && artifactPath.trim().length === 0) {
    throw new ValidationError("artifactPath must not be empty");
  }
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
}
