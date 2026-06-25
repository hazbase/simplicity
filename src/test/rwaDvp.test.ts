import test from "node:test";
import assert from "node:assert/strict";
import { createSimplicityClient } from "../client/SimplicityClient";
import {
  exportEvidence,
  prepareDeliveryClaim,
  prepareRefundClaim,
  verifyDeliveryClaim,
  verifyRefundClaim,
} from "../domain/rwaDvp";
import { LIQUID_X402_ASSETS, buildLiquidPsetSummaryHash } from "../x402";

const TEST_CONFIG = {
  network: "liquidtestnet" as const,
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
  defaults: {
    feeSat: 1200,
  },
};

function buildPurchase() {
  const sdk = createSimplicityClient(TEST_CONFIG);
  return sdk.rwaDvp.definePurchase({
    purchaseId: "rwa-order-1",
    network: "liquidtestnet",
    evmLock: {
      chainId: 11155111,
      lockManager: "0x8C4686Fe684FB2eEc7aA2eEe4175EAc70206C881",
      orderKey: "0x" + "11".repeat(32),
      amountAtomic: "1000",
      token: "0x0ECFd1C6eA1F7DC9Bd89bd51b41B71Dbd57F1A17",
      classId: "1",
      nonceId: "1",
    },
    payment: {
      asset: "lbtc",
      amountAtomic: "50000",
      escrowAddress: "tlq1escrow",
      treasuryAddress: "tlq1treasury",
    },
    delivery: {
      assetId: "aa".repeat(32),
      amountAtomic: "1000",
      recipientAddress: "tlq1buyer",
    },
    refund: {
      recipientAddress: "tlq1refund",
      after: "2099-01-01T00:00:00.000Z",
    },
    expiresAt: "2099-01-01T00:30:00.000Z",
  });
}

test("sdk.rwaDvp prepares payment requirements and verifies a basic PSET payload", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const prepared = buildPurchase();
  assert.equal(prepared.definition.evmLock.tokenStandard, "ERC3475");
  const requirements = sdk.rwaDvp.buildPaymentRequirements({
    purchase: prepared.definition,
    resource: "https://settlement.example/v1/orders/rwa-order-1/payments/liquid-pset",
    maxFeeSat: "1200",
  });
  assert.equal(requirements.scheme, "exact-liquid-pset");
  assert.equal(requirements.payTo, "tlq1escrow");
  assert.equal(requirements.asset, LIQUID_X402_ASSETS.liquidtestnet.lbtc.assetId);
  assert.equal(requirements.extra.metadata?.termsHash, prepared.termsHash);

  const payload = {
    scheme: "exact-liquid-pset" as const,
    network: "liquidtestnet" as const,
    paymentRequestId: requirements.extra.paymentRequestId,
    asset: "lbtc" as const,
    assetId: requirements.asset,
    amountAtomic: requirements.maxAmountRequired,
    payTo: requirements.payTo,
    psetBase64: "cHNldA==",
    summaryHash: buildLiquidPsetSummaryHash({}, requirements),
    expiresAt: requirements.extra.expiresAt,
  };
  const verified = await sdk.rwaDvp.verifyPaymentPset({
    purchase: prepared.definition,
    requirements,
    paymentPayload: payload,
    verifyPsetOutputs: false,
  });
  assert.equal(verified.isValid, true);
  assert.equal(verified.paymentRequestId, "rwa-order-1");
});

test("sdk.rwaDvp preserves generic EVM token standards in purchase terms", () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const prepared = sdk.rwaDvp.definePurchase({
    purchaseId: "rwa-order-erc1155",
    network: "liquidtestnet",
    evmLock: {
      chainId: 11155111,
      lockManager: "0x8C4686Fe684FB2eEc7aA2eEe4175EAc70206C881",
      orderKey: "0x" + "12".repeat(32),
      tokenStandard: "ERC1155",
      token: "0x0000000000000000000000000000000000000015",
      classId: "7",
      nonceId: "0",
      amountAtomic: "1000",
    },
    payment: {
      asset: "lbtc",
      amountAtomic: "50000",
      escrowAddress: "tlq1escrow",
      treasuryAddress: "tlq1treasury",
    },
    delivery: {
      assetId: "aa".repeat(32),
      amountAtomic: "1000",
      recipientAddress: "tlq1buyer",
    },
    refund: {
      recipientAddress: "tlq1refund",
      after: "2099-01-01T00:00:00.000Z",
    },
    expiresAt: "2099-01-01T00:30:00.000Z",
  });

  assert.equal(prepared.definition.evmLock.tokenStandard, "ERC1155");
  assert.equal(prepared.definition.evmLock.classId, "7");
});

test("sdk.rwaDvp preserves explicit USDt asset ids in payment requirements", async () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const customUsdtAssetId = "2c73c81d00b38443b76b337095e58766ba91c0eaa5045d99f0721266a1620502";
  const prepared = sdk.rwaDvp.definePurchase({
    purchaseId: "rwa-order-usdt",
    network: "liquidtestnet",
    evmLock: {
      chainId: 11155111,
      lockManager: "0x8C4686Fe684FB2eEc7aA2eEe4175EAc70206C881",
      orderKey: "0x" + "12".repeat(32),
      amountAtomic: "1000",
    },
    payment: {
      asset: "usdt",
      assetId: customUsdtAssetId,
      amountAtomic: "50000",
      escrowAddress: "tlq1escrow",
      treasuryAddress: "tlq1treasury",
    },
    delivery: {
      assetId: "aa".repeat(32),
      amountAtomic: "1000",
      recipientAddress: "tlq1buyer",
    },
    refund: {
      recipientAddress: "tlq1refund",
      after: "2099-01-01T00:00:00.000Z",
    },
    expiresAt: "2099-01-01T00:30:00.000Z",
  });
  const requirements = sdk.rwaDvp.buildPaymentRequirements({
    purchase: prepared.definition,
    resource: "https://settlement.example/v1/orders/rwa-order-usdt/payments/liquid-pset",
  });

  assert.equal(prepared.definition.payment.assetId, customUsdtAssetId);
  assert.equal(requirements.asset, customUsdtAssetId);
  assert.equal(requirements.extra.asset, "usdt");
  assert.equal(requirements.extra.assetId, customUsdtAssetId);

  const payload = {
    scheme: "exact-liquid-pset" as const,
    network: "liquidtestnet" as const,
    paymentRequestId: requirements.extra.paymentRequestId,
    asset: "usdt" as const,
    assetId: customUsdtAssetId,
    amountAtomic: requirements.maxAmountRequired,
    payTo: requirements.payTo,
    psetBase64: "cHNldA==",
    summaryHash: buildLiquidPsetSummaryHash({}, requirements),
    expiresAt: requirements.extra.expiresAt,
  };
  const verified = await sdk.rwaDvp.verifyPaymentPset({
    purchase: prepared.definition,
    requirements,
    paymentPayload: payload,
    verifyPsetOutputs: false,
  });
  assert.equal(verified.isValid, true);
  assert.equal(payload.assetId, requirements.asset);
});

test("rwaDvp delivery and refund descriptors are deterministic and verifiable", () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  const prepared = buildPurchase();
  const delivery = sdk.rwaDvp.prepareDeliveryClaim({
    purchase: prepared.definition,
    fundingTxid: "22".repeat(32),
    paymentInput: {
      txid: "22".repeat(32),
      vout: 0,
      assetId: LIQUID_X402_ASSETS.liquidtestnet.lbtc.assetId,
      amountAtomic: "50000",
    },
    mode: "simplicity-multi-asset-claim",
  });
  assert.equal(delivery.verification.ok, true);
  assert.equal(delivery.descriptor.outputs.paymentToTreasury.assetId, LIQUID_X402_ASSETS.liquidtestnet.lbtc.assetId);
  assert.equal(delivery.descriptor.outputs.paymentToTreasury.recipientAddress, "tlq1treasury");
  assert.equal(delivery.descriptor.outputs.rwaToBuyer.recipientAddress, "tlq1buyer");
  assert.equal(verifyDeliveryClaim(sdk, { purchase: prepared.definition, descriptor: delivery.descriptor }).ok, true);

  const refund = prepareRefundClaim(sdk, {
    purchase: prepared.definition,
    paymentInput: {
      txid: "22".repeat(32),
      vout: 0,
      assetId: LIQUID_X402_ASSETS.liquidtestnet.lbtc.assetId,
      amountAtomic: "50000",
    },
  });
  assert.equal(refund.verification.ok, true);
  assert.equal(refund.descriptor.refundOutput.recipientAddress, "tlq1refund");
  assert.equal(verifyRefundClaim(sdk, { purchase: prepared.definition, descriptor: refund.descriptor }).ok, true);

  const evidence = exportEvidence(sdk, {
    purchase: prepared.definition,
    deliveryClaim: delivery.descriptor,
    deliveryVerification: delivery.verification,
    refundClaim: refund.descriptor,
    refundVerification: refund.verification,
    evm: {
      lockTxHash: "0xlock",
    },
    createdAt: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(evidence.schemaVersion, "rwa-dvp-evidence/v1");
  assert.equal(evidence.termsHash, prepared.termsHash);
});

test("rwaDvp client surface is exposed", () => {
  const sdk = createSimplicityClient(TEST_CONFIG);
  assert.equal(typeof sdk.rwaDvp.definePurchase, "function");
  assert.equal(typeof sdk.rwaDvp.compileEscrowContract, "function");
  assert.equal(typeof sdk.rwaDvp.prepareDeliveryClaim, "function");
  assert.equal(typeof sdk.rwaDvp.inspectDeliveryClaim, "function");
  assert.equal(typeof sdk.rwaDvp.executeDeliveryClaim, "function");
  assert.equal(typeof sdk.rwaDvp.prepareRefundClaim, "function");
  assert.equal(typeof sdk.rwaDvp.inspectRefundClaim, "function");
  assert.equal(typeof sdk.rwaDvp.executeRefundClaim, "function");
});
