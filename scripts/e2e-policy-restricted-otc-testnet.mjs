function setDefaultEnv(name, value) {
  if (!process.env[name]) {
    process.env[name] = value;
  }
}

const bindingMode = process.env.POLICY_OUTPUT_BINDING_MODE || "descriptor-bound";

setDefaultEnv("POLICY_OUTPUT_BINDING_MODE", bindingMode);
setDefaultEnv("POLICY_SCENARIO", "restricted-otc");
setDefaultEnv("POLICY_LOCK_DISTANCE_BLOCKS", "2");
setDefaultEnv("POLICY_AMOUNT_SAT", "6000");
setDefaultEnv(
  "POLICY_NEXT_RECIPIENT_XONLY",
  "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
);

if (bindingMode === "descriptor-bound") {
  setDefaultEnv("POLICY_ASSET_ID", "bitcoin");
  setDefaultEnv(
    "POLICY_NEXT_OUTPUT_FORM_JSON",
    JSON.stringify({
      assetForm: "explicit",
      amountForm: "explicit",
      nonceForm: "null",
      rangeProofForm: "empty",
    }),
  );
  setDefaultEnv("POLICY_NEXT_RAW_OUTPUT_AUTO", "explicit-v1-hash-backed");
} else {
  setDefaultEnv("POLICY_ASSET_ID", "bitcoin");
}

const missingRpcEnv = ["ELEMENTS_RPC_URL", "ELEMENTS_RPC_USER", "ELEMENTS_RPC_PASSWORD"].filter(
  (name) => !process.env[name],
);

if (missingRpcEnv.length > 0) {
  console.log(JSON.stringify({
    skipped: true,
    scenario: "restricted-otc",
    reason: "Elements RPC environment is required for npm run e2e:policy-restricted-otc-testnet",
    missingEnv: missingRpcEnv,
    enforcement: "direct-hop",
    bindingMode,
  }, null, 2));
  process.exit(0);
}

await import("./e2e-policy-testnet.mjs");
