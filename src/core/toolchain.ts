import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ToolchainError } from "./errors";

const execFileP = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileP(command, args, {
      cwd: options.cwd,
      maxBuffer: 1024 * 1024 * 50,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const cause = error as { message?: string; stdout?: string; stderr?: string };
    const details = [
      cause.message ? `message=${cause.message}` : "",
      cause.stderr ? `stderr=${cause.stderr.trim()}` : "",
      cause.stdout ? `stdout=${cause.stdout.trim()}` : "",
    ].filter(Boolean);
    throw new ToolchainError(
      `Command failed: ${command} ${args.slice(0, 3).join(" ")}${details.length ? ` | ${details.join(" | ")}` : ""}`,
      error,
    );
  }
}

export async function runSimcCompile(simcPath: string, simfPath: string): Promise<string> {
  const result = await runCommand(simcPath, [simfPath]);
  return result.stdout;
}

export async function runSimcWithWitness(
  simcPath: string,
  simfPath: string,
  witnessPath: string
): Promise<string> {
  const result = await runCommand(simcPath, [simfPath, witnessPath]);
  return result.stdout;
}

export async function runHalInfo(halPath: string, program: string): Promise<unknown> {
  const result = await runCommand(halPath, ["simplicity", "info", program]);
  return JSON.parse(result.stdout);
}

export async function runHalUpdateInput(
  halPath: string,
  pset: string,
  inputIndex: number,
  utxoSpec: string,
  cmr: string,
  internalKey: string
): Promise<unknown> {
  const result = await runCommand(halPath, [
    "simplicity",
    "pset",
    "update-input",
    "--liquid",
    pset,
    String(inputIndex),
    "-i",
    utxoSpec,
    "-c",
    cmr,
    "-p",
    internalKey,
  ]);
  return JSON.parse(result.stdout);
}

export async function runHalCreatePset(
  halPath: string,
  inputs: Array<{ txid: string; vout: number; sequence?: number }>,
  outputs: Array<{ address: string; asset: string; amount: number }>
): Promise<unknown> {
  const result = await runCommand(halPath, [
    "simplicity",
    "pset",
    "create",
    "--liquid",
    JSON.stringify(inputs),
    JSON.stringify(outputs),
  ]);
  return JSON.parse(result.stdout);
}

export async function runSimplicityCreatePset(
  halPath: string,
  inputs: Array<{ txid: string; vout: number; sequence?: number }>,
  outputs: Array<{ address: string; asset: string; amount: number; blinderIndex?: number }>
): Promise<unknown> {
  const helperPath = process.env.HAZBASE_SIMPLICITY_CREATE_PATH ?? "hazbase-simplicity-create";
  try {
    const helper = await runCommand(helperPath, [
      "--liquid",
      JSON.stringify(inputs),
      JSON.stringify(outputs),
    ]);
    return JSON.parse(helper.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("ENOENT")) {
      return {
        error: message,
      };
    }
  }
  return runHalCreatePset(halPath, inputs, outputs);
}

export async function runSimplicityUpdateInput(
  halPath: string,
  pset: string,
  inputIndex: number,
  inputUtxo: string,
  cmr: string,
  internalKey: string
): Promise<unknown> {
  const helperPath = process.env.HAZBASE_SIMPLICITY_UPDATE_INPUT_PATH ?? "hazbase-simplicity-update-input";
  try {
    const helper = await runCommand(helperPath, [
      "--liquid",
      pset,
      String(inputIndex),
      internalKey,
      cmr,
    ]);
    return JSON.parse(helper.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("ENOENT")) {
      return {
        error: message,
      };
    }
  }
  return runHalUpdateInput(halPath, pset, inputIndex, inputUtxo, cmr, internalKey);
}

export async function runSimplicityBlindPset(
  pset: string,
  inputSecrets: Array<Record<string, unknown>>
): Promise<unknown> {
  const helperPath = process.env.HAZBASE_SIMPLICITY_BLIND_PSET_PATH ?? "hazbase-simplicity-blind-pset";
  const helper = await runCommand(helperPath, [
    "--liquid",
    pset,
    JSON.stringify(inputSecrets),
  ]);
  return JSON.parse(helper.stdout);
}

export async function runHalSighash(
  halPath: string,
  pset: string,
  inputIndex: number,
  cmr: string,
  privkeyHex: string
): Promise<unknown> {
  const result = await runCommand(halPath, [
    "simplicity",
    "sighash",
    "--liquid",
    pset,
    String(inputIndex),
    cmr,
    "-x",
    privkeyHex,
  ]);
  return JSON.parse(result.stdout);
}

export async function runHalFinalize(
  halPath: string,
  pset: string,
  inputIndex: number,
  program: string,
  witness: string
): Promise<unknown> {
  const result = await runCommand(halPath, [
    "simplicity",
    "pset",
    "finalize",
    "--liquid",
    pset,
    String(inputIndex),
    program,
    witness,
  ]);
  return JSON.parse(result.stdout);
}

export async function runSimplicityFinalize(
  halPath: string,
  pset: string,
  inputIndex: number,
  program: string,
  witness: string,
  options: { redeemProgram?: string } = {},
): Promise<unknown> {
  const helperPath = process.env.HAZBASE_SIMPLICITY_FINALIZE_PATH ?? "hazbase-simplicity-finalize";
  if (options.redeemProgram) {
    try {
      const helper = await runCommand(helperPath, [
        "--liquid",
        pset,
        String(inputIndex),
        options.redeemProgram,
        witness,
      ]);
      return JSON.parse(helper.stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ENOENT")) {
        const halFallback = await runHalFinalize(halPath, pset, inputIndex, program, witness);
        if ((halFallback as { pset?: string }).pset) return halFallback;
        return {
          ...(halFallback as Record<string, unknown>),
          helperError: message,
        };
      }
    }
  }
  return runHalFinalize(halPath, pset, inputIndex, program, witness);
}

export async function runHalExtract(halPath: string, pset: string): Promise<string> {
  const result = await runCommand(halPath, ["simplicity", "pset", "extract", "--liquid", pset]);
  return result.stdout;
}
