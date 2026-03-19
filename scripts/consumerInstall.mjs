import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

export function buildConsumerNpmEnv(workDir) {
  return {
    ...process.env,
    NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? path.join(workDir, ".npm-cache"),
    NPM_CONFIG_AUDIT: process.env.NPM_CONFIG_AUDIT ?? "false",
    NPM_CONFIG_FUND: process.env.NPM_CONFIG_FUND ?? "false",
  };
}

export async function installPackedSdkForConsumer({ repoRoot, workDir, npmEnv }) {
  const { stdout: packedName } = await execFileAsync("npm", ["pack", "--pack-destination", workDir], {
    cwd: repoRoot,
    env: npmEnv,
  });
  const tarballName = packedName.trim().split("\n").filter(Boolean).at(-1);
  if (!tarballName) {
    throw new Error("npm pack did not return a tarball name");
  }
  const tarballPath = path.join(workDir, tarballName);
  const localHashesPath = path.join(repoRoot, "node_modules", "@noble", "hashes");
  const localCurvesPath = path.join(repoRoot, "node_modules", "@noble", "curves");
  const packageJsonPath = path.join(workDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const localDependencies = {
    "@hazbase/simplicity": `file:${tarballPath}`,
    "@noble/hashes": `file:${localHashesPath}`,
    "@noble/curves": `file:${localCurvesPath}`,
  };

  packageJson.dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...localDependencies,
  };
  packageJson.overrides = {
    ...(packageJson.overrides ?? {}),
    ...localDependencies,
  };

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  await execFileAsync(
    "npm",
    [
      "install",
      "--no-audit",
      "--fund=false",
      "--prefer-offline",
    ],
    {
      cwd: workDir,
      env: npmEnv,
    },
  );

  return { tarballPath };
}
