import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeArtifact, saveArtifact, SDK_PACKAGE_VERSION } from "./artifact";
import { buildArtifactDefinitionMetadata, detectOnChainDefinitionAnchor, loadDefinitionInput } from "./definition";
import { CompilerError, UnsupportedFeatureError, ValidationError } from "./errors";
import { getPresetOrThrow, validatePresetParams } from "./presets";
import { renderTemplate } from "./templating";
import { runCommand, runHalInfo, runSimcCompile } from "./toolchain";
import { CompileFromFileInput, CompileFromPresetInput, SimplicityArtifact, SimplicityClientConfig } from "./types";

function parseSimcProgram(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("Program:")) {
      const rest = line.slice("Program:".length).trim();
      if (rest) return rest;
    }
  }
  const nextLineIndex = lines.findIndex((line) => line === "Program:");
  if (nextLineIndex >= 0 && lines[nextLineIndex + 1]) {
    return lines[nextLineIndex + 1];
  }
  throw new CompilerError("Could not parse Program from simc output", { output });
}

async function buildArtifact(input: {
  config: SimplicityClientConfig;
  renderedSimfPath: string;
  sourceMode: "file" | "preset";
  sourceSimfPath?: string;
  preset?: string;
  templateVars?: Record<string, string | number>;
  definition?: {
    definitionType: string;
    definitionId: string;
    schemaVersion: string;
    canonicalJson: string;
    hash: string;
    sourcePath?: string;
    anchorMode?: "artifact-hash-anchor" | "on-chain-constant-committed";
    onChainAnchor?: {
      helper: "nonzero-eq_256";
      templateVar: "DEFINITION_HASH";
      sourceVerified: boolean;
    };
  };
}): Promise<SimplicityArtifact> {
  const compileOutput = await runSimcCompile(input.config.toolchain.simcPath, input.renderedSimfPath);
  const program = parseSimcProgram(compileOutput);
  const info = (await runHalInfo(
    input.config.toolchain.halSimplicityPath,
    program
  )) as Record<string, string>;

  const cmr = info.cmr;
  const contractAddress = info.liquid_testnet_address_unconf ?? info.liquid_address_unconf;
  const internalKey =
    info.internal_key ?? "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";
  if (!cmr || !contractAddress || !internalKey) {
    throw new CompilerError("Missing fields in hal-simplicity info response", info);
  }

  const halVersion = await runCommand(input.config.toolchain.halSimplicityPath, ["--version"]);

  return normalizeArtifact(
    {
      version: 6,
      kind: "simplicity-artifact",
      createdAt: new Date().toISOString(),
      network: input.config.network,
      source: {
        mode: input.sourceMode,
        simfPath: input.sourceSimfPath,
        preset: input.preset,
        templateVars: input.templateVars,
      },
      compiled: {
        program,
        cmr,
        internalKey,
        contractAddress,
      },
      toolchain: {
        simcPath: input.config.toolchain.simcPath,
        halSimplicity: halVersion.stdout || input.config.toolchain.halSimplicityPath,
      },
      metadata: {
        sdkVersion: SDK_PACKAGE_VERSION,
        notes: null,
      },
      definition: input.definition
        ? buildArtifactDefinitionMetadata(input.definition, {
            anchorMode: input.definition.anchorMode,
            onChainAnchor: input.definition.onChainAnchor,
          })
        : undefined,
      legacy: {
        simfTemplatePath: input.sourceSimfPath,
        params: {
          minHeight: typeof input.templateVars?.MIN_HEIGHT === "number" ? input.templateVars.MIN_HEIGHT : undefined,
          signerXonly: typeof input.templateVars?.SIGNER_XONLY === "string" ? input.templateVars.SIGNER_XONLY : undefined,
        },
      },
    },
    input.config.network
  );
}

export async function compileFromFile(
  config: SimplicityClientConfig,
  input: CompileFromFileInput
): Promise<SimplicityArtifact> {
  const definition = input.definition ? await loadDefinitionInput(input.definition) : undefined;
  if (definition && input.templateVars?.DEFINITION_HASH !== undefined) {
    throw new ValidationError(
      "DEFINITION_HASH must not be provided explicitly when definition metadata is supplied",
      { code: "DEFINITION_HASH_OVERRIDE_FORBIDDEN" }
    );
  }
  if (definition && input.templateVars?.DEFINITION_ID !== undefined) {
    throw new ValidationError(
      "DEFINITION_ID must not be provided explicitly when definition metadata is supplied",
      { code: "DEFINITION_ID_OVERRIDE_FORBIDDEN" }
    );
  }
  const rawSource = await readFile(input.simfPath, "utf8");
  let onChainAnchor: { helper: "nonzero-eq_256"; templateVar: "DEFINITION_HASH"; sourceVerified: boolean } | undefined;
  if (input.definition?.anchorMode === "on-chain-constant-committed") {
    const detection = detectOnChainDefinitionAnchor(rawSource);
    if (!rawSource.includes("{{DEFINITION_HASH}}")) {
      throw new ValidationError(
        "Requested on-chain constant-committed definition anchor, but the .simf source does not contain {{DEFINITION_HASH}}",
        { code: "DEFINITION_HASH_PLACEHOLDER_MISSING" }
      );
    }
    if (!detection.sourceVerified || !detection.helper) {
      const code = detection.reason?.includes("called")
        ? "DEFINITION_ONCHAIN_HELPER_NOT_CALLED"
        : "DEFINITION_ONCHAIN_HELPER_MISSING";
      throw new ValidationError(
        `Requested on-chain constant-committed definition anchor, but the .simf source does not contain the required anchor helper pattern: ${detection.reason ?? "unknown reason"}`,
        { code }
      );
    }
    onChainAnchor = {
      helper: detection.helper,
      templateVar: "DEFINITION_HASH",
      sourceVerified: true,
    };
  }
  const templateVars = {
    ...(input.templateVars ?? {}),
    ...(definition && input.templateVars?.DEFINITION_HASH === undefined ? { DEFINITION_HASH: definition.hash } : {}),
    ...(definition && input.templateVars?.DEFINITION_ID === undefined ? { DEFINITION_ID: definition.definitionId } : {}),
  };
  const rendered = renderTemplate(rawSource, templateVars);
  const workDir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-compile-"));
  const renderedPath = path.join(workDir, path.basename(input.simfPath));
  await writeFile(renderedPath, rendered, "utf8");
  const artifact = await buildArtifact({
    config,
    renderedSimfPath: renderedPath,
    sourceMode: "file",
    sourceSimfPath: input.simfPath,
    templateVars,
    definition: definition
      ? {
          ...definition,
          anchorMode: input.definition?.anchorMode ?? "artifact-hash-anchor",
          onChainAnchor,
        }
      : undefined,
  });
  if (input.artifactPath) {
    await saveArtifact(input.artifactPath, artifact);
  }
  return artifact;
}

export async function compileFromPreset(
  config: SimplicityClientConfig,
  input: CompileFromPresetInput
): Promise<SimplicityArtifact> {
  const preset = getPresetOrThrow(input.preset);
  if (input.definition?.anchorMode === "on-chain-constant-committed") {
    throw new UnsupportedFeatureError(
      `Preset '${preset.id}' does not yet support on-chain constant-committed definition anchors`,
      { code: "DEFINITION_ANCHOR_MODE_UNSUPPORTED_FOR_PRESET", preset: preset.id }
    );
  }
  const definition = input.definition ? await loadDefinitionInput(input.definition) : undefined;
  if (definition && input.params.DEFINITION_HASH !== undefined) {
    throw new ValidationError(
      "DEFINITION_HASH must not be provided explicitly when definition metadata is supplied",
      { code: "DEFINITION_HASH_OVERRIDE_FORBIDDEN" }
    );
  }
  if (definition && input.params.DEFINITION_ID !== undefined) {
    throw new ValidationError(
      "DEFINITION_ID must not be provided explicitly when definition metadata is supplied",
      { code: "DEFINITION_ID_OVERRIDE_FORBIDDEN" }
    );
  }
  const params = {
    ...validatePresetParams(preset, input.params),
    ...(definition && input.params.DEFINITION_HASH === undefined ? { DEFINITION_HASH: definition.hash } : {}),
    ...(definition && input.params.DEFINITION_ID === undefined ? { DEFINITION_ID: definition.definitionId } : {}),
  };
  const rawSource = await readFile(preset.simfTemplatePath, "utf8");
  const rendered = renderTemplate(rawSource, params);
  const workDir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-preset-"));
  const renderedPath = path.join(workDir, `${preset.id}.simf`);
  await writeFile(renderedPath, rendered, "utf8");
  const artifact = await buildArtifact({
    config,
    renderedSimfPath: renderedPath,
    sourceMode: "preset",
    sourceSimfPath: preset.simfTemplatePath,
    preset: preset.id,
    templateVars: params,
    definition: definition
      ? {
          ...definition,
          anchorMode: input.definition?.anchorMode ?? "artifact-hash-anchor",
        }
      : undefined,
  });
  if (input.artifactPath) {
    await saveArtifact(input.artifactPath, artifact);
  }
  return artifact;
}
