import { createExampleClient, exampleValue } from "./shared";

async function main() {
  const sdk = createExampleClient();
  const templateId = exampleValue("POLICY_TEMPLATE_ID", "recursive-delay");
  const propagationMode = exampleValue("POLICY_PROPAGATION_MODE", "required") as "required" | "optional" | "none";

  const manifest = sdk.policies.describeTemplate({
    templateId,
    propagationMode,
  });
  const validatedParams = sdk.policies.validateTemplateParams({
    templateId,
    propagationMode,
    params: {
      lockDistanceBlocks: Number(exampleValue("POLICY_LOCK_DISTANCE_BLOCKS", "2")),
    },
  });

  console.log(JSON.stringify({ manifest, validatedParams }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
