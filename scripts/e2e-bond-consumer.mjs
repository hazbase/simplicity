import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

const execFileAsync = promisify(execFile);

async function hasBinary(name) {
  try {
    await execFileAsync("which", [name]);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const workDir = await mkdtemp(path.join(tmpdir(), "simplicity-bond-consumer-"));
  const npmEnv = {
    ...process.env,
    NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? path.join(workDir, ".npm-cache"),
  };

  const { stdout: packedName } = await execFileAsync("npm", ["pack", "--pack-destination", workDir], {
    cwd: repoRoot,
    env: npmEnv,
  });
  const tarballName = packedName.trim().split("\n").filter(Boolean).at(-1);
  if (!tarballName) {
    throw new Error("npm pack did not return a tarball name");
  }
  const tarballPath = path.join(workDir, tarballName);

  await writeFile(
    path.join(workDir, "package.json"),
    JSON.stringify({
      name: "bond-consumer-smoke",
      private: true,
      type: "module",
    }, null, 2),
    "utf8",
  );

  await execFileAsync("npm", ["install", tarballPath], {
    cwd: workDir,
    env: npmEnv,
  });

  const smokePath = path.join(workDir, "consumer-smoke.mjs");
  await writeFile(
    smokePath,
    `
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createSimplicityClient } from "@hazbase/simplicity";

const execFileAsync = promisify(execFile);

async function hasBinary(name) {
  try {
    await execFileAsync("which", [name]);
    return true;
  } catch {
    return false;
  }
}

const require = createRequire(import.meta.url);
const pkgRoot = path.dirname(require.resolve("@hazbase/simplicity/package.json"));
const docsRoot = path.join(pkgRoot, "dist", "docs", "definitions");
const simcPath = process.env.SIMC_PATH || "simc";
const halPath = process.env.HAL_SIMPLICITY_PATH || "hal-simplicity";
const elementsCliPath = process.env.ELEMENTS_CLI_PATH || "eltc";

if (!(await hasBinary(simcPath)) || !(await hasBinary(halPath))) {
  console.log(JSON.stringify({
    skipped: true,
    reason: "simc/hal-simplicity not available for bond consumer smoke",
  }, null, 2));
  process.exit(0);
}

const sdk = createSimplicityClient({
  network: "liquidtestnet",
  rpc: {
    url: "http://127.0.0.1:18884",
    username: "user",
    password: "pass",
    wallet: "simplicity-test",
  },
  toolchain: {
    simcPath,
    halSimplicityPath: halPath,
    elementsCliPath,
  },
});

sdk.rpc.call = async (method) => {
  if (method === "getaddressinfo") return { scriptPubKey: "5120" + "11".repeat(32) };
  if (method === "getsidechaininfo") return { pegged_asset: "22".repeat(32) };
  throw new Error(\`unexpected rpc method: \${method}\`);
};

const scriptPubKeyHex = "5120" + "11".repeat(32);
const scriptPubKeyHashHex = createHash("sha256").update(Buffer.from(scriptPubKeyHex, "hex")).digest("hex");
const rangeProofHashHex = createHash("sha256").update(Buffer.alloc(0)).digest("hex");

const tempDir = await mkdtemp(path.join(tmpdir(), "bond-consumer-artifact-"));
const artifactPath = path.join(tempDir, "bond-issuance.artifact.json");
const definitionPath = path.join(docsRoot, "bond-definition.json");
const issuancePath = path.join(docsRoot, "bond-issuance-state.json");
const redeemedIssuancePath = path.join(docsRoot, "bond-issuance-state-redeemed.json");
const simfPath = path.join(docsRoot, "bond-issuance-anchor.simf");

const defined = await sdk.bonds.define({
  definitionPath,
  issuancePath,
  simfPath,
  artifactPath,
});

const verified = await sdk.bonds.verify({
  artifactPath,
  definitionPath,
  issuancePath,
});

const redemption = await sdk.bonds.prepareRedemption({
  definitionPath,
  previousIssuancePath: issuancePath,
  amount: 250000,
  redeemedAt: "2027-03-10T00:00:00Z",
  nextStateSimfPath: simfPath,
  nextAmountSat: 1900,
  maxFeeSat: 100,
  outputBindingMode: "descriptor-bound",
});

const settlement = await sdk.bonds.buildSettlement({
  definitionPath,
  previousIssuancePath: issuancePath,
  nextIssuanceValue: redemption.preview.next,
  nextStateSimfPath: simfPath,
  nextAmountSat: redemption.settlement.nextAmountSat,
  maxFeeSat: redemption.settlement.maxFeeSat,
  outputBindingMode: redemption.settlement.descriptor.outputBindingMode,
});

const rawSettlement = await sdk.bonds.buildSettlement({
  definitionPath,
  previousIssuancePath: issuancePath,
  nextIssuanceValue: redemption.preview.next,
  nextStateSimfPath: simfPath,
  nextAmountSat: redemption.settlement.nextAmountSat,
  maxFeeSat: redemption.settlement.maxFeeSat,
  rawOutput: {
    assetBytesHex: "01" + "22".repeat(32),
    amountBytesHex: "01000000000000076c",
    nonceBytesHex: "00",
    scriptPubKeyHashHex,
    rangeProofHashHex,
  },
  outputBindingMode: "descriptor-bound",
});

const closing = await sdk.bonds.prepareClosing({
  definitionPath,
  redeemedIssuancePath,
  settlementDescriptorValue: settlement.descriptor,
  closedAt: "2027-03-10T00:00:00Z",
  closingReason: "REDEEMED",
});

const finality = await sdk.bonds.exportFinalityPayload({
  artifactPath,
  definitionPath,
  issuancePath,
  settlementDescriptorValue: settlement.descriptor,
  closingDescriptorValue: closing.closing,
});

console.log(JSON.stringify({
  skipped: false,
  contractAddress: defined.deployment().contractAddress,
  definitionOk: verified.definition.ok,
  issuanceOk: verified.issuance.ok,
  redemptionBindingMode: redemption.settlement.descriptor.outputBindingMode,
  settlementReasonCode: settlement.reasonCode,
  settlementSupportedForm: settlement.supportedForm,
  settlementNextOutputHash: settlement.expectedOutputDescriptor?.nextOutputHash ?? null,
  rawSettlementReasonCode: rawSettlement.reasonCode,
  rawSettlementSupportedForm: rawSettlement.supportedForm,
  rawSettlementScriptComponent: rawSettlement.bindingInputs.rawOutputComponents?.scriptPubKey ?? null,
  rawSettlementNextOutputHash: rawSettlement.expectedOutputDescriptor?.nextOutputHash ?? null,
  closingHash: closing.closingHash,
  finalityBindingMode: finality.bindingMode,
  finalityDefinitionHash: finality.payload.definitionHash,
}, null, 2));
`,
    "utf8",
  );

  const { stdout } = await execFileAsync("node", [smokePath], {
    cwd: workDir,
  });
  process.stdout.write(stdout);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
