function setDefaultEnv(name, value) {
  if (!process.env[name]) {
    process.env[name] = value;
  }
}

const bindingMode = process.env.POLICY_OUTPUT_BINDING_MODE || "descriptor-bound";

setDefaultEnv("POLICY_SCENARIO", "restricted-otc");
setDefaultEnv("POLICY_LOCK_DISTANCE_BLOCKS", "2");
setDefaultEnv("POLICY_AMOUNT_SAT", "6000");
setDefaultEnv(
  "POLICY_NEXT_RECIPIENT_XONLY",
  "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
);

if (bindingMode === "descriptor-bound") {
  setDefaultEnv("POLICY_ASSET_ID", "unsupported-asset-alias");
  setDefaultEnv(
    "POLICY_NEXT_OUTPUT_FORM_JSON",
    JSON.stringify({
      assetForm: "confidential",
      amountForm: "confidential",
      nonceForm: "confidential",
      rangeProofForm: "non-empty",
    }),
  );
  setDefaultEnv(
    "POLICY_NEXT_RAW_OUTPUT_JSON",
    JSON.stringify({
      assetBytesHex: `01${"22".repeat(32)}`,
      amountBytesHex: "010000000000001770",
      nonceBytesHex: "00",
      scriptPubKeyHashHex: "33".repeat(32),
      rangeProofHashHex: "44".repeat(32),
    }),
  );
} else {
  setDefaultEnv("POLICY_ASSET_ID", "bitcoin");
}

await import("./e2e-policy-testnet.mjs");
