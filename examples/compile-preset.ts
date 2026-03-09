import { createExampleClient } from "./shared";

async function main() {
  const sdk = createExampleClient();

  const compiled = await sdk.compileFromPreset({
    preset: "p2pkLockHeight",
    params: {
      MIN_HEIGHT: 2344430,
      SIGNER_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    },
  });

  console.log(compiled.artifact);
}

main().catch(console.error);
