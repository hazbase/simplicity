import { createExampleClient, requireEnv } from "./shared";

async function main() {
  const sdk = createExampleClient();

  const compiled = await sdk.compileFromPreset({
    preset: "htlc",
    params: {
      EXPECTED_HASH: "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925",
      RECIPIENT_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      SENDER_XONLY: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
      TIMEOUT_HEIGHT: 1000,
    },
  });

  const result = await compiled.at().execute({
    wallet: "simplicity-test",
    toAddress: "tex1example",
    signer: { type: "schnorrPrivkeyHex", privkeyHex: requireEnv("SIMPLICITY_PRIMARY_PRIVKEY") },
    witness: {
      values: {
        COMPLETE_OR_CANCEL: {
          type: "Either<(u256, Signature), Signature>",
          value: "Left((0x0000000000000000000000000000000000000000000000000000000000000000, ${SIGNATURE}))",
        },
      },
    },
  });

  console.log(result.summaryHash);
}

main().catch(console.error);
