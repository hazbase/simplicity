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
    throw new ToolchainError(`Command failed: ${command} ${args.join(" ")}`, error);
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
    pset,
    String(inputIndex),
    program,
    witness,
  ]);
  return JSON.parse(result.stdout);
}

export async function runHalExtract(halPath: string, pset: string): Promise<string> {
  const result = await runCommand(halPath, ["simplicity", "pset", "extract", pset]);
  return result.stdout;
}
