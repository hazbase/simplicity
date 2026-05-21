import test from "node:test";
import assert from "node:assert/strict";
import {
  LIQUID_X402_ASSETS,
  buildLiquidPsetSummaryHash,
  buildLiquidX402PaymentFromPset,
  buildLiquidX402Requirements,
  decodeLiquidXPayment,
  deriveLiquidX402LwkWasmAddress,
  encodeLiquidXPayment,
  listLiquidX402Assets,
  prepareLiquidX402LwkWasmPayment,
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
  assert.equal(resolveLiquidX402Asset(LIQUID_X402_ASSETS.liquidtestnet.lbtc.assetId, "liquidtestnet").key, "lbtc");
  assert.match(resolveLiquidX402Asset("lbtc", "liquidtestnet").assetId, /^[0-9a-f]{64}$/u);
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

test("Liquid x402 summary hash is stable across decoder-specific change outputs", () => {
  const requirements = buildRequirement();
  const withChangeOutput = {
    outputs: [
      ...decodedPset.outputs,
      {
        amount: 0.00042,
        asset: LIQUID_X402_ASSETS.liquidtestnet.lbtc.assetId,
        script: {
          address: "tlq1buyerchange",
          hex: "0014change",
        },
      },
    ],
    fees: {
      bitcoin: 0.0000042,
    },
  };

  assert.equal(
    buildLiquidPsetSummaryHash(decodedPset, requirements),
    buildLiquidPsetSummaryHash(withChangeOutput, requirements)
  );
});

test("Liquid x402 verify validates fields and does not broadcast", async () => {
  const requirements = buildRequirement();
  const summaryHash = buildLiquidPsetSummaryHash(decodedPset, requirements);
  const calls: string[] = [];
  const rpc = {
    call: async (method: string) => {
      calls.push(method);
      if (method === "validateaddress") {
        return {
          isvalid: true,
          address: "tlq1payto",
          scriptPubKey: "0014abcdef",
        };
      }
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
  assert.deepEqual(calls, ["validateaddress", "decodepsbt"]);
});

test("Liquid x402 verify accepts confidential payTo decoded as unconfidential output", async () => {
  const requirements = buildLiquidX402Requirements({
    paymentRequestId: "payreq_liquid_confidential",
    resource: "https://seller.example/confidential",
    payTo: "tlq1sellerconfidential",
    amountAtomic: "123456789",
    network: "liquidtestnet",
    asset: "usdt",
    expiresAt: "2099-01-01T00:00:00.000Z",
    maxFeeSat: "1200",
  });
  const decoded = {
    outputs: [{
      amount: 1.23456789,
      asset: LIQUID_X402_ASSETS.liquidtestnet.usdt.assetId,
      script: {
        address: "tex1sellerunconfidential",
        hex: "0014seller",
      },
    }],
    fees: { bitcoin: 0.000001 },
  };
  const calls: string[] = [];
  const rpc = {
    call: async (method: string) => {
      calls.push(method);
      if (method === "validateaddress") {
        return {
          isvalid: true,
          address: requirements.payTo,
          unconfidential: "tex1sellerunconfidential",
          scriptPubKey: "0014seller",
        };
      }
      if (method === "decodepsbt") return decoded;
      throw new Error(`unexpected method: ${method}`);
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
      psetBase64: "signed-confidential-pset",
      summaryHash: buildLiquidPsetSummaryHash(decoded, requirements),
      expiresAt: requirements.extra.expiresAt,
    },
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(result.isValid, true);
  assert.deepEqual(calls, ["validateaddress", "decodepsbt"]);
});

test("Liquid x402 verify accepts confidential payTo by script hex when decoded address is omitted", async () => {
  const requirements = buildLiquidX402Requirements({
    paymentRequestId: "payreq_liquid_confidential_script",
    resource: "https://seller.example/confidential-script",
    payTo: "tlq1sellerconfidential",
    amountAtomic: "123456789",
    network: "liquidtestnet",
    asset: "usdt",
    expiresAt: "2099-01-01T00:00:00.000Z",
    maxFeeSat: "1200",
  });
  const decoded = {
    outputs: [{
      amount: 1.23456789,
      asset: LIQUID_X402_ASSETS.liquidtestnet.usdt.assetId,
      script: {
        hex: "0014seller",
      },
    }],
    fees: { bitcoin: 0.000001 },
  };
  const rpc = {
    call: async (method: string) => {
      if (method === "validateaddress") {
        return {
          isvalid: true,
          address: requirements.payTo,
          unconfidential: "tex1sellerunconfidential",
          scriptPubKey: "0014seller",
        };
      }
      if (method === "decodepsbt") return decoded;
      throw new Error(`unexpected method: ${method}`);
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
      psetBase64: "signed-confidential-pset",
      summaryHash: buildLiquidPsetSummaryHash(decoded, requirements),
      expiresAt: requirements.extra.expiresAt,
    },
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(result.isValid, true);
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

test("Liquid x402 builds a payment payload from externally signed PSET", () => {
  const requirements = buildRequirement();
  const result = buildLiquidX402PaymentFromPset({
    requirements,
    psetBase64: "externally-signed-pset",
    decoded: decodedPset,
    payer: "liquid:agent",
  });

  assert.equal(result.paymentPayload.psetBase64, "externally-signed-pset");
  assert.equal(result.paymentPayload.payer, "liquid:agent");
  assert.equal(result.summaryHash, buildLiquidPsetSummaryHash(decodedPset, requirements));
  assert.deepEqual(decodeLiquidXPayment(result.xPayment), result.paymentPayload);
});

test("Liquid x402 canonicalizes L-BTC aliases in requirements", () => {
  const result = buildLiquidX402PaymentFromPset({
    requirements: {
      ...buildRequirement(),
      maxAmountRequired: "1000000",
      asset: "bitcoin",
      extra: {
        ...buildRequirement().extra,
        asset: "lbtc",
        assetId: "bitcoin",
      },
    },
    psetBase64: "externally-signed-lbtc-pset",
    summaryHash: "summary",
  });

  assert.equal(result.paymentPayload.asset, "lbtc");
  assert.equal(result.paymentPayload.assetId, LIQUID_X402_ASSETS.liquidtestnet.lbtc.assetId);
});

test("Liquid x402 can prepare a lightweight LWK/WASM payment", async () => {
  const requirements = buildRequirement();
  const calls: string[] = [];
  const fakeLwk = createFakeLwkWasm(calls);
  const result = await prepareLiquidX402LwkWasmPayment({
    requirements,
    mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    payer: "liquid:lwk-agent",
    feeRate: 0.1,
    lwk: fakeLwk as any,
  });

  assert.equal(result.paymentPayload.psetBase64, "lwk-signed-pset");
  assert.equal(result.paymentPayload.payer, "liquid:lwk-agent");
  assert.equal(result.descriptor, "ct(slip77,wpkh(fake-xpub))");
  assert.equal(result.dwid, "fake-dwid");
  assert.deepEqual(calls, [
    "Network.testnet",
    "Signer.wpkhSlip77Descriptor",
    "Esplora.fullScan",
    "Wollet.applyUpdate",
    "TxBuilder.feeRate:0.1",
    "Address.parse:tlq1payto",
    `AssetId.fromString:${LIQUID_X402_ASSETS.liquidtestnet.usdt.assetId}`,
    "TxBuilder.addRecipient:123456789",
    "TxBuilder.finish",
    "Signer.sign",
    "Wollet.finalize",
    "Wollet.psetDetails",
  ]);
  assert.deepEqual(decodeLiquidXPayment(result.xPayment), result.paymentPayload);
});

test("Liquid x402 uses explicit asset outputs for non-blinded LWK recipients", async () => {
  const calls: string[] = [];
  const fakeLwk = createFakeLwkWasm(calls);
  await prepareLiquidX402LwkWasmPayment({
    requirements: {
      ...buildRequirement(),
      payTo: "tex1payto",
    },
    mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    lwk: fakeLwk as any,
  });

  assert.ok(calls.includes("TxBuilder.addExplicitRecipient:123456789"));
  assert.equal(calls.includes("TxBuilder.addRecipient:123456789"), false);
});

test("Liquid x402 can derive a lightweight LWK/WASM funding address", async () => {
  const calls: string[] = [];
  const fakeLwk = createFakeLwkWasm(calls);
  const result = await deriveLiquidX402LwkWasmAddress({
    mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    network: "liquidtestnet",
    index: 2,
    lwk: fakeLwk as any,
  });

  assert.equal(result.network, "liquidtestnet");
  assert.equal(result.address, "tlq1funding2");
  assert.equal(result.unconfidentialAddress, "tlq1funding2-unconfidential");
  assert.equal(result.index, 2);
  assert.equal(result.isBlinded, true);
  assert.equal(result.descriptor, "ct(slip77,wpkh(fake-xpub))");
  assert.equal(result.dwid, "fake-dwid");
  assert.equal(result.policyAsset, "policy-asset");
  assert.deepEqual(calls, [
    "Network.testnet",
    "Signer.wpkhSlip77Descriptor",
    "Wollet.address:2",
  ]);
});

test("Liquid x402 settle finalizes, mempool-checks, and broadcasts", async () => {
  const requirements = buildRequirement();
  const summaryHash = buildLiquidPsetSummaryHash(decodedPset, requirements);
  const calls: string[] = [];
  const rpc = {
    call: async (method: string) => {
      calls.push(method);
      if (method === "validateaddress") {
        return {
          isvalid: true,
          address: "tlq1payto",
          scriptPubKey: "0014abcdef",
        };
      }
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
  assert.deepEqual(calls, ["validateaddress", "decodepsbt", "finalizepsbt", "testmempoolaccept", "sendrawtransaction"]);
});

function createFakeLwkWasm(calls: string[]) {
  class FakeAddress {
    constructor(private readonly value: string) {}
    static parse(value: string) {
      calls.push(`Address.parse:${value}`);
      return new FakeAddress(value);
    }
    toString() {
      return this.value;
    }
    toUnconfidential() {
      return new FakeAddress(`${this.value}-unconfidential`);
    }
    isBlinded() {
      return !this.value.startsWith("tex1");
    }
  }

  class FakeAssetId {
    constructor(private readonly value: string) {}
    static fromString(value: string) {
      calls.push(`AssetId.fromString:${value}`);
      return new FakeAssetId(value);
    }
    toString() {
      return this.value;
    }
  }

  class FakeMnemonic {
    constructor(readonly value: string) {}
  }

  class FakeNetwork {
    static mainnet() {
      calls.push("Network.mainnet");
      return new FakeNetwork();
    }
    static testnet() {
      calls.push("Network.testnet");
      return new FakeNetwork();
    }
    defaultEsploraClient() {
      return new FakeEsploraClient();
    }
    txBuilder() {
      return new FakeTxBuilder();
    }
    policyAsset() {
      return { toString: () => "policy-asset" };
    }
  }

  class FakeEsploraClient {
    async fullScan() {
      calls.push("Esplora.fullScan");
      return { height: 1 };
    }
  }

  class FakeSigner {
    constructor(readonly mnemonic: FakeMnemonic, readonly network: FakeNetwork) {}
    wpkhSlip77Descriptor() {
      calls.push("Signer.wpkhSlip77Descriptor");
      return { toString: () => "ct(slip77,wpkh(fake-xpub))" };
    }
    sign(pset: FakePset) {
      calls.push("Signer.sign");
      return pset;
    }
  }

  class FakeWollet {
    constructor(readonly network: FakeNetwork, readonly descriptor: { toString: () => string }) {}
    applyUpdate() {
      calls.push("Wollet.applyUpdate");
    }
    finalize(pset: FakePset) {
      calls.push("Wollet.finalize");
      return pset;
    }
    psetDetails() {
      calls.push("Wollet.psetDetails");
      return {
        balance: () => ({
          fee: () => 100n,
          recipients: () => [{
            value: () => 123456789n,
            asset: () => new FakeAssetId(LIQUID_X402_ASSETS.liquidtestnet.usdt.assetId),
            address: () => new FakeAddress("tlq1payto"),
          }],
        }),
      };
    }
    dwid() {
      return "fake-dwid";
    }
    address(index: number | null) {
      calls.push(`Wollet.address:${index ?? "next"}`);
      return {
        address: () => new FakeAddress(`tlq1funding${index ?? "next"}`),
        index: () => index ?? 0,
      };
    }
  }

  class FakeTxBuilder {
    private active = true;

    private consume() {
      if (!this.active) throw new Error("stale TxBuilder used");
      this.active = false;
      return new FakeTxBuilder();
    }

    feeRate(value: number) {
      calls.push(`TxBuilder.feeRate:${value}`);
      return this.consume();
    }
    addRecipient(_address: FakeAddress, amount: bigint, _asset: FakeAssetId) {
      calls.push(`TxBuilder.addRecipient:${amount}`);
      return this.consume();
    }
    addExplicitRecipient(_address: FakeAddress, amount: bigint, _asset: FakeAssetId) {
      calls.push(`TxBuilder.addExplicitRecipient:${amount}`);
      return this.consume();
    }
    addLbtcRecipient(_address: FakeAddress, amount: bigint) {
      calls.push(`TxBuilder.addLbtcRecipient:${amount}`);
      return this.consume();
    }
    finish() {
      if (!this.active) throw new Error("stale TxBuilder used");
      calls.push("TxBuilder.finish");
      return new FakePset();
    }
  }

  class FakePset {
    toString() {
      return "lwk-signed-pset";
    }
  }

  return {
    Address: FakeAddress,
    AssetId: FakeAssetId,
    EsploraClient: FakeEsploraClient,
    Mnemonic: FakeMnemonic,
    Network: FakeNetwork,
    Signer: FakeSigner,
    Wollet: FakeWollet,
  };
}
