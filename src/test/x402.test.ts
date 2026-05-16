import test from "node:test";
import assert from "node:assert/strict";
import {
  LIQUID_X402_ASSETS,
  buildLiquidPsetSummaryHash,
  buildLiquidX402Requirements,
  decodeLiquidXPayment,
  encodeLiquidXPayment,
  listLiquidX402Assets,
  prepareLiquidX402PsetPayment,
  resolveLiquidX402Asset,
  settleLiquidX402Payment,
  verifyLiquidX402Payment,
} from "../x402";

const decodedPset = {
  outputs: [
    {
      amount: 1.23456789,
      asset: LIQUID_X402_ASSETS.liquidtestnet.usdt.assetId,
      script: {
        address: "tlq1payto",
        hex: "0014abcdef",
      },
    },
  ],
  fees: {
    bitcoin: 0.000001,
  },
};

function buildRequirement() {
  return buildLiquidX402Requirements({
    paymentRequestId: "payreq_liquid_1",
    resource: "https://seller.example/report",
    payTo: "tlq1payto",
    amountAtomic: "123456789",
    network: "liquidtestnet",
    asset: "usdt",
    expiresAt: "2099-01-01T00:00:00.000Z",
    maxFeeSat: "1200",
  });
}

test("Liquid x402 registry resolves testnet and mainnet USDt", () => {
  assert.equal(resolveLiquidX402Asset("usdt", "liquidtestnet").assetId, LIQUID_X402_ASSETS.liquidtestnet.usdt.assetId);
  assert.equal(resolveLiquidX402Asset("usdt", "liquidv1").assetId, LIQUID_X402_ASSETS.liquidv1.usdt.assetId);
  assert.equal(resolveLiquidX402Asset("bitcoin", "liquidtestnet").key, "lbtc");
  assert.equal(listLiquidX402Assets("liquidtestnet").length, 2);
});

test("Liquid x402 requirements and payment header round-trip", () => {
  const requirements = buildRequirement();
  assert.equal(requirements.scheme, "exact-liquid-pset");
  assert.equal(requirements.network, "liquidtestnet");
  assert.equal(requirements.asset, LIQUID_X402_ASSETS.liquidtestnet.usdt.assetId);
  assert.equal(requirements.extra.asset, "usdt");

  const payload = {
    scheme: "exact-liquid-pset" as const,
    network: "liquidtestnet" as const,
    paymentRequestId: requirements.extra.paymentRequestId,
    asset: "usdt" as const,
    assetId: requirements.asset,
    amountAtomic: requirements.maxAmountRequired,
    payTo: requirements.payTo,
    psetBase64: "cHNldA",
    summaryHash: "summary",
    payer: "liquid:buyer",
    expiresAt: requirements.extra.expiresAt,
  };
  assert.deepEqual(decodeLiquidXPayment(encodeLiquidXPayment(payload)), payload);
});

test("Liquid x402 verify validates fields and does not broadcast", async () => {
  const requirements = buildRequirement();
  const summaryHash = buildLiquidPsetSummaryHash(decodedPset, requirements);
  const calls: string[] = [];
  const rpc = {
    call: async (method: string) => {
      calls.push(method);
      assert.equal(method, "decodepsbt");
      return decodedPset;
    },
  };

  const result = await verifyLiquidX402Payment(rpc as any, {
    requirements,
    paymentPayload: {
      scheme: "exact-liquid-pset",
      network: "liquidtestnet",
      paymentRequestId: requirements.extra.paymentRequestId,
      asset: "usdt",
      assetId: requirements.asset,
      amountAtomic: requirements.maxAmountRequired,
      payTo: requirements.payTo,
      psetBase64: "signed-pset",
      summaryHash,
      expiresAt: requirements.extra.expiresAt,
    },
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(result.isValid, true);
  assert.deepEqual(calls, ["decodepsbt"]);
});

test("Liquid x402 verify rejects tampered summary and expired payloads", async () => {
  const requirements = buildRequirement();
  const expired = await verifyLiquidX402Payment(null, {
    requirements,
    paymentPayload: {
      scheme: "exact-liquid-pset",
      network: "liquidtestnet",
      paymentRequestId: requirements.extra.paymentRequestId,
      asset: "usdt",
      assetId: requirements.asset,
      amountAtomic: requirements.maxAmountRequired,
      payTo: requirements.payTo,
      psetBase64: "signed-pset",
      summaryHash: "wrong",
      expiresAt: "2020-01-01T00:00:00.000Z",
    },
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(expired.isValid, false);
  assert.equal(expired.invalidReason, "payment_expired");

  const rpc = { call: async () => decodedPset };
  const tampered = await verifyLiquidX402Payment(rpc as any, {
    requirements,
    paymentPayload: {
      scheme: "exact-liquid-pset",
      network: "liquidtestnet",
      paymentRequestId: requirements.extra.paymentRequestId,
      asset: "usdt",
      assetId: requirements.asset,
      amountAtomic: requirements.maxAmountRequired,
      payTo: requirements.payTo,
      psetBase64: "signed-pset",
      summaryHash: "wrong",
      expiresAt: requirements.extra.expiresAt,
    },
  });
  assert.equal(tampered.isValid, false);
  assert.equal(tampered.invalidReason, "pset_summary_mismatch");

  const expensiveDecoded = { ...decodedPset, fees: { bitcoin: 0.00002 } };
  const expensiveSummary = buildLiquidPsetSummaryHash(expensiveDecoded, requirements);
  const expensiveRpc = { call: async () => expensiveDecoded };
  const highFee = await verifyLiquidX402Payment(expensiveRpc as any, {
    requirements,
    paymentPayload: {
      scheme: "exact-liquid-pset",
      network: "liquidtestnet",
      paymentRequestId: requirements.extra.paymentRequestId,
      asset: "usdt",
      assetId: requirements.asset,
      amountAtomic: requirements.maxAmountRequired,
      payTo: requirements.payTo,
      psetBase64: "signed-pset",
      summaryHash: expensiveSummary,
      expiresAt: requirements.extra.expiresAt,
    },
  });
  assert.equal(highFee.isValid, false);
  assert.equal(highFee.invalidReason, "fee_too_high");
});

test("Liquid x402 prepare builds a signed payment payload", async () => {
  const requirements = buildRequirement();
  const calls: string[] = [];
  const rpc = {
    call: async (method: string) => {
      calls.push(method);
      if (method === "createpsbt") return "base-pset";
      if (method === "utxoupdatepsbt") return "updated-pset";
      if (method === "walletprocesspsbt") return { psbt: "signed-pset" };
      if (method === "decodepsbt") return decodedPset;
      throw new Error(`unexpected method: ${method}`);
    },
  };

  const result = await prepareLiquidX402PsetPayment(rpc as any, {
    requirements,
    wallet: "buyer",
    payer: "liquid:buyer",
  });
  assert.equal(result.paymentPayload.psetBase64, "signed-pset");
  assert.equal(result.paymentPayload.payer, "liquid:buyer");
  assert.deepEqual(calls, ["createpsbt", "utxoupdatepsbt", "walletprocesspsbt", "decodepsbt"]);
  assert.deepEqual(decodeLiquidXPayment(result.xPayment), result.paymentPayload);
});

test("Liquid x402 settle finalizes, mempool-checks, and broadcasts", async () => {
  const requirements = buildRequirement();
  const summaryHash = buildLiquidPsetSummaryHash(decodedPset, requirements);
  const calls: string[] = [];
  const rpc = {
    call: async (method: string) => {
      calls.push(method);
      if (method === "decodepsbt") return decodedPset;
      if (method === "finalizepsbt") return { complete: true, hex: "00" };
      if (method === "testmempoolaccept") return [{ allowed: true }];
      if (method === "sendrawtransaction") return "txid-liquid";
      throw new Error(`unexpected method: ${method}`);
    },
  };

  const result = await settleLiquidX402Payment(rpc as any, {
    requirements,
    paymentPayload: {
      scheme: "exact-liquid-pset",
      network: "liquidtestnet",
      paymentRequestId: requirements.extra.paymentRequestId,
      asset: "usdt",
      assetId: requirements.asset,
      amountAtomic: requirements.maxAmountRequired,
      payTo: requirements.payTo,
      psetBase64: "signed-pset",
      summaryHash,
      expiresAt: requirements.extra.expiresAt,
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.transactionHash, "txid-liquid");
  assert.deepEqual(calls, ["decodepsbt", "finalizepsbt", "testmempoolaccept", "sendrawtransaction"]);
});
