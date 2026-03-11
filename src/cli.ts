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
      const asNumber = Number(raw);
      return [key, Number.isFinite(asNumber) && String(asNumber) === raw ? asNumber : raw];
    })
  );
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
    throw new Error("Usage: simplicity-cli <compile|presets|preset|contract|artifact|definition|state|bond|gasless> ...");
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
    const result = await sdk.bonds.defineBond({
      definitionPath: getArg("definition-json"),
      issuancePath: getArg("issuance-json"),
      simfPath: getArg("simf"),
      artifactPath: getArg("artifact"),
    });
    printJson({ artifact: result.artifact, deployment: result.deployment() });
    return;
  }

  if (command === "bond" && subcommand === "verify") {
    const result = await sdk.bonds.verifyBond({
      artifactPath: requireArg("artifact"),
      definitionPath: getArg("definition-json"),
      issuancePath: getArg("issuance-json"),
    });
    printJson(result);
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
