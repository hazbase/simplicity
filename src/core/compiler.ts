import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeArtifact, saveArtifact, SDK_PACKAGE_VERSION } from "./artifact";
import { CompilerError } from "./errors";
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
  const rawSource = await readFile(input.simfPath, "utf8");
  const rendered = renderTemplate(rawSource, input.templateVars ?? {});
  const workDir = await mkdtemp(path.join(tmpdir(), "simplicity-sdk-compile-"));
  const renderedPath = path.join(workDir, path.basename(input.simfPath));
  await writeFile(renderedPath, rendered, "utf8");
  const artifact = await buildArtifact({
    config,
    renderedSimfPath: renderedPath,
    sourceMode: "file",
    sourceSimfPath: input.simfPath,
    templateVars: input.templateVars,
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
  const params = validatePresetParams(preset, input.params);
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
  });
  if (input.artifactPath) {
    await saveArtifact(input.artifactPath, artifact);
  }
  return artifact;
}
