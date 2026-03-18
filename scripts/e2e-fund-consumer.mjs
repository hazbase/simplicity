import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const MANAGER_PRIVKEY = "0000000000000000000000000000000000000000000000000000000000000001";

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
  const workDir = await mkdtemp(path.join(tmpdir(), "simplicity-fund-consumer-"));
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
      name: "fund-consumer-smoke",
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
import {
  buildClaimedCapitalCallState,
  buildLPPositionReceipt,
  createSimplicityClient,
  summarizeDistributionDescriptor,
} from "@hazbase/simplicity";

const execFileAsync = promisify(execFile);
const MANAGER_PRIVKEY = "${MANAGER_PRIVKEY}";

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
    reason: "simc/hal-simplicity not available for fund consumer smoke",
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

const tempDir = await mkdtemp(path.join(tmpdir(), "fund-consumer-artifact-"));
const definitionPath = path.join(docsRoot, "fund-definition.json");
const capitalCallPath = path.join(docsRoot, "fund-capital-call-state.json");

const prepared = await sdk.funds.prepareCapitalCall({
  definitionPath,
  capitalCallPath,
  openArtifactPath: path.join(tempDir, "capital-call-open.artifact.json"),
  refundOnlyArtifactPath: path.join(tempDir, "capital-call-refund-only.artifact.json"),
});

const capitalCallVerified = await sdk.funds.verifyCapitalCall({
  artifact: prepared.openCompiled.artifact,
  definitionPath,
  capitalCallValue: prepared.capitalCallValue,
});

const claimedCapitalCall = buildClaimedCapitalCallState({
  previous: prepared.capitalCallValue,
  claimedAt: "2026-03-18T00:00:00Z",
});

const initialReceipt = buildLPPositionReceipt({
  positionId: "POS-001",
  capitalCall: prepared.capitalCallValue,
  effectiveAt: "2026-03-18T00:00:00Z",
});
const signedInitialReceipt = await sdk.funds.signPositionReceipt({
  definitionPath,
  positionReceiptValue: initialReceipt,
  signer: { type: "schnorrPrivkeyHex", privkeyHex: MANAGER_PRIVKEY },
  signedAt: "2026-03-18T00:00:00Z",
});
const verifiedInitialReceipt = await sdk.funds.verifyPositionReceipt({
  definitionPath,
  positionReceiptValue: signedInitialReceipt.positionReceiptEnvelope,
});

const firstDistribution = await sdk.funds.prepareDistribution({
  definitionPath,
  positionReceiptValue: signedInitialReceipt.positionReceiptEnvelope,
  distributionId: "DIST-001",
  assetId: prepared.capitalCallValue.currencyAssetId,
  amountSat: 2000,
  approvedAt: "2027-03-18T00:00:00Z",
  artifactPath: path.join(tempDir, "distribution-1.artifact.json"),
});
const verifiedFirstDistribution = await sdk.funds.verifyDistribution({
  artifact: firstDistribution.compiled.artifact,
  definitionPath,
  positionReceiptValue: signedInitialReceipt.positionReceiptEnvelope,
  distributionValue: firstDistribution.distributionValue,
});
const afterFirst = await sdk.funds.reconcilePosition({
  definitionPath,
  positionReceiptValue: signedInitialReceipt.positionReceiptEnvelope,
  distributionValue: firstDistribution.distributionValue,
  signer: { type: "schnorrPrivkeyHex", privkeyHex: MANAGER_PRIVKEY },
  signedAt: "2027-03-18T00:00:00Z",
});

const secondDistribution = await sdk.funds.prepareDistribution({
  definitionPath,
  positionReceiptValue: afterFirst.reconciledReceiptEnvelope,
  distributionId: "DIST-002",
  assetId: prepared.capitalCallValue.currencyAssetId,
  amountSat: initialReceipt.fundedAmount - 2000,
  approvedAt: "2028-03-18T00:00:00Z",
  artifactPath: path.join(tempDir, "distribution-2.artifact.json"),
});
const verifiedSecondDistribution = await sdk.funds.verifyDistribution({
  artifact: secondDistribution.compiled.artifact,
  definitionPath,
  positionReceiptValue: afterFirst.reconciledReceiptEnvelope,
  distributionValue: secondDistribution.distributionValue,
});
const afterSecond = await sdk.funds.reconcilePosition({
  definitionPath,
  positionReceiptValue: afterFirst.reconciledReceiptEnvelope,
  distributionValue: secondDistribution.distributionValue,
  signer: { type: "schnorrPrivkeyHex", privkeyHex: MANAGER_PRIVKEY },
  signedAt: "2028-03-18T00:00:00Z",
});

const binding = sdk.outputBinding.evaluateSupport({
  assetId: prepared.capitalCallValue.currencyAssetId,
  requestedBindingMode: "descriptor-bound",
  rawOutput: {
    assetBytesHex: "01" + "22".repeat(32),
    amountBytesHex: "0100000000000009c4",
    nonceBytesHex: "00",
    scriptPubKeyHashHex: "33".repeat(32),
    rangeProofHashHex: "44".repeat(32),
  },
});

const closing = await sdk.funds.prepareClosing({
  definitionPath,
  positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
  closingId: "CLOSE-001",
  finalDistributionHashes: [
    summarizeDistributionDescriptor(firstDistribution.distributionValue).hash,
    summarizeDistributionDescriptor(secondDistribution.distributionValue).hash,
  ],
  closedAt: "2029-03-18T00:00:00Z",
});
const verifiedFinalReceipt = await sdk.funds.verifyPositionReceipt({
  definitionPath,
  positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
});
const verifiedClosing = await sdk.funds.verifyClosing({
  definitionPath,
  positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
  closingValue: closing.closingValue,
});

const finality = await sdk.funds.exportFinalityPayload({
  artifact: secondDistribution.compiled.artifact,
  definitionPath,
  capitalCallValue: claimedCapitalCall,
  positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
  distributionValues: [
    firstDistribution.distributionValue,
    secondDistribution.distributionValue,
  ],
  closingValue: closing.closingValue,
  verificationReportValue: {
    schemaVersion: "fund-verification-report/v1",
    capitalCallTrust: {
      capitalCallStage: "claimed",
      cutoffMode: "rollover-window",
    },
    receiptTrust: verifiedFinalReceipt.report.receiptTrust,
    closingTrust: verifiedClosing.report.closingTrust,
  },
});

console.log(JSON.stringify({
  skipped: false,
  capitalCallOk: capitalCallVerified.ok,
  receiptVerified: verifiedInitialReceipt.verified,
  distributionOk: verifiedFirstDistribution.ok && verifiedSecondDistribution.ok,
  openContractAddress: prepared.openCompiled.deployment().contractAddress,
  refundOnlyContractAddress: prepared.refundOnlyCompiled.deployment().contractAddress,
  finalReceiptSequence: afterSecond.reconciledReceiptValue.sequence,
  finalEnvelopeHash: afterSecond.reconciledReceiptEnvelopeSummary.hash,
  bindingReasonCode: binding.reasonCode,
  bindingSupportedForm: binding.supportedForm,
  closingHash: closing.closingHash,
  finalityPositionReceiptEnvelopeHash: finality.positionReceiptEnvelopeHash,
  settledDistributionCount: afterSecond.reconciledReceiptValue.distributionCount,
}, null, 2));
`,
    "utf8",
  );

  const { stdout } = await execFileAsync("node", [smokePath], { cwd: workDir });
  process.stdout.write(stdout);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
