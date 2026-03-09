import { createExampleClient, requireEnv } from "./shared";

async function main() {
  const sdk = createExampleClient();

  const compiled = await sdk.compileFromPreset({
    preset: "transferWithTimeout",
    params: {
      SENDER_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      RECIPIENT_XONLY: "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
      TIMEOUT_HEIGHT: 1000,
    },
  });

  const result = await compiled.at().execute({
    wallet: "simplicity-test",
    toAddress: "tex1example",
    signer: { type: "schnorrPrivkeyHex", privkeyHex: requireEnv("SIMPLICITY_PRIMARY_PRIVKEY") },
    witness: {
      signers: {
        RECIPIENT: {
          type: "schnorrPrivkeyHex",
          privkeyHex: requireEnv("SIMPLICITY_RECIPIENT_PRIVKEY"),
        },
      },
      values: {
        SENDER_SIG: {
          type: "Signature",
          value: "${SIGNATURE}",
        },
        TRANSFER_OR_TIMEOUT: {
          type: "Option<Signature>",
          value: "Some(${SIGNATURE:RECIPIENT})",
        },
      },
    },
  });

  console.log(result.summaryHash);
}

main().catch(console.error);
