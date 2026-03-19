import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { buildConsumerNpmEnv, installPackedSdkForConsumer } from "./consumerInstall.mjs";

const execFileAsync = promisify(execFile);

async function main() {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const workDir = await mkdtemp(path.join(tmpdir(), "simplicity-policy-consumer-"));
  const npmEnv = buildConsumerNpmEnv(workDir);

  await writeFile(
    path.join(workDir, "package.json"),
    JSON.stringify({
      name: "policy-consumer-smoke",
      private: true,
      type: "module",
    }, null, 2),
    "utf8",
  );

  await installPackedSdkForConsumer({ repoRoot, workDir, npmEnv });

  const manifestPath = path.join(workDir, "custom-policy.manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      templateId: "consumer-custom-delay-required",
      manifestVersion: "policy-template-manifest/v1",
      title: "Consumer Custom Delay (Required)",
      description: "External manifest smoke test.",
      stateSimfPath: "/tmp/consumer-custom-delay-required.simf",
      directStateSimfPath: "/tmp/consumer-custom-delay-required.simf",
      parameterSchema: { lockDistanceBlocks: "number" },
      supportedBindingModes: ["script-bound", "descriptor-bound"],
      supportsPlainExit: false,
      defaultPropagationMode: "required",
    }, null, 2),
    "utf8",
  );

  const smokePath = path.join(workDir, "consumer-smoke.mjs");
  await writeFile(
    smokePath,
    `
import { createSimplicityClient } from "@hazbase/simplicity";
import { createHash } from "node:crypto";

const sdk = createSimplicityClient({
  network: "liquidtestnet",
  rpc: {
    url: "http://127.0.0.1:18884",
    username: "user",
    password: "pass",
    wallet: "simplicity-test",
  },
  toolchain: {
    simcPath: "simc",
    halSimplicityPath: "hal-simplicity",
    elementsCliPath: "eltc",
  },
});

sdk.rpc.call = async (method) => {
  if (method === "getaddressinfo") return { scriptPubKey: "5120" + "11".repeat(32) };
  if (method === "getsidechaininfo") return { pegged_asset: "22".repeat(32) };
  throw new Error(\`unexpected rpc method: \${method}\`);
};

const list = sdk.policies.listTemplates();
const bindingSupport = sdk.outputBinding.describeSupport();
const scriptPubKeyHex = "5120" + "11".repeat(32);
const scriptPubKeyHashHex = createHash("sha256").update(Buffer.from(scriptPubKeyHex, "hex")).digest("hex");
const rangeProofHashHex = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
const bindingEvaluation = sdk.outputBinding.evaluateSupport({
  assetId: "bitcoin",
  requestedBindingMode: "descriptor-bound",
  outputForm: { amountForm: "confidential" },
});
const rawBindingEvaluation = sdk.outputBinding.evaluateSupport({
  assetId: "unsupported-asset-alias",
  requestedBindingMode: "descriptor-bound",
  rawOutput: {
    assetBytesHex: "01" + "22".repeat(32),
    amountBytesHex: "010000000000001770",
    nonceBytesHex: "00",
    scriptPubKeyHashHex,
    rangeProofHashHex,
  },
});
const described = sdk.policies.describeTemplate({ templateId: "recursive-delay", propagationMode: "required" });
const loaded = await sdk.policies.loadTemplateManifest({ manifestPath: ${JSON.stringify(manifestPath)} });
const validatedManifest = sdk.policies.validateTemplateManifest({ manifestValue: loaded });
const validatedParams = sdk.policies.validateTemplateParams({
  manifestValue: loaded,
  propagationMode: "required",
  params: { lockDistanceBlocks: 2 },
});
const descriptor = await sdk.policies.buildOutputDescriptor({
  nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
  nextAmountSat: 6000,
  assetId: "bitcoin",
  outputBindingMode: "descriptor-bound",
});
const rawDescriptor = await sdk.policies.buildOutputDescriptor({
  nextCompiledContractAddress: "tex1ptestcontractaddress00000000000000000000000000000000000000",
  nextAmountSat: 6000,
  assetId: "unsupported-asset-alias",
  rawOutput: {
    assetBytesHex: "01" + "22".repeat(32),
    amountBytesHex: "010000000000001770",
    nonceBytesHex: "00",
    scriptPubKeyHashHex,
    rangeProofHashHex,
  },
  outputBindingMode: "descriptor-bound",
});

console.log(JSON.stringify({
  listCount: list.length,
  bindingSupportDescriptorRuntime: bindingSupport.outputBindingModes["descriptor-bound"].runtimeBinding,
  bindingEvaluationResolvedMode: bindingEvaluation.resolvedBindingMode,
  bindingEvaluationReasonCode: bindingEvaluation.reasonCode,
  rawBindingEvaluationResolvedMode: rawBindingEvaluation.resolvedBindingMode,
  rawBindingEvaluationReasonCode: rawBindingEvaluation.reasonCode,
  rawBindingEvaluationScriptComponent: rawBindingEvaluation.rawOutputComponents?.scriptPubKey ?? null,
  describedTemplateId: described.templateId,
  loadedTemplateId: loaded.templateId,
  manifestValidationOk: validatedManifest.ok,
  validatedParams,
  descriptorMode: descriptor.descriptor.outputBindingMode,
  descriptorReasonCode: descriptor.reasonCode,
  descriptorSupportedForm: descriptor.supportedForm,
  rawDescriptorReasonCode: rawDescriptor.reasonCode,
  rawDescriptorSupportedForm: rawDescriptor.supportedForm,
  rawDescriptorScriptComponent: rawDescriptor.bindingInputs.rawOutputComponents?.scriptPubKey ?? null,
  nextOutputHash: descriptor.descriptor.nextOutputHash,
  rawNextOutputHash: rawDescriptor.descriptor.nextOutputHash,
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
