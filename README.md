# @hazbase/simplicity
[![npm version](https://badge.fury.io/js/@hazbase%2Fsimplicity.svg)](https://badge.fury.io/js/@hazbase%2Fsimplicity)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## What This SDK Is

`@hazbase/simplicity` is a Node.js / TypeScript SDK for building and validating Simplicity-based flows on Liquid.

Today, the SDK is best understood as a **permissioned settlement / lineage / finality toolkit**. It helps developers compile and fund Simplicity contracts, execute constrained payouts, verify off-chain definitions and state documents, and export evidence or finality payloads for higher-level review.

It is intentionally narrower than a full market stack. It does **not** try to be a full investor registry, KYC/AML system, fund-admin platform, market-ops layer, or open retail trading protocol.

This SDK is designed to help Node developers get productive quickly, but it is still opinionated, early-stage, and best suited today to permissioned settlement pilots on Liquid.

## What You Can Build

With the current public SDK you can build and test:
- constrained transfers with explicit next-hop rules
- output binding with public support/fallback reporting
- bond redemption / settlement / close-out flows
- LP fund capital call / distribution / close-out flows
- receivable repayment-first funding / partial repayment / closing flows
- RWA delivery-versus-payment flows over Liquid PSETs and Liquid x402
- atomic Liquid DvP proposals where service delivery and buyer payment settle in one PSET
- evidence, trust summary, lineage, and finality exports

## Public Architecture

The public SDK is organized into domain clients and lower-level payment helpers:
- `sdk.outputBinding`: shared output-binding support, evaluation, and fallback behavior
- `sdk.policies`: generic constrained transfer and recursive policy engine
- `sdk.bonds`: private bond / credit settlement business layer
- `sdk.funds`: LP fund settlement business layer
- `sdk.receivables`: repayment-first receivable business layer
- `sdk.rwaDvp`: RWA purchase terms, payment requirements, claim descriptors, and evidence
- `sdk.payments.x402`: Liquid x402 assets, PSET payment helpers, verification, and settlement

A useful mental model is:
- `sdk.outputBinding` + `sdk.policies` provide the shared settlement kernel
- `sdk.bonds`, `sdk.funds`, `sdk.receivables`, and `sdk.rwaDvp` build domain flows on top of that kernel
- `sdk.payments.x402` and the root-level `x402` exports provide the Liquid PSET payment layer used by those flows

## Quickstart

Install the package:

```bash
npm install @hazbase/simplicity
```

Create a client:

```ts
import { createSimplicityClient } from "@hazbase/simplicity";

const sdk = createSimplicityClient({
  network: "liquidtestnet",
  rpc: {
    url: process.env.ELEMENTS_RPC_URL ?? "http://127.0.0.1:18884",
    username: process.env.ELEMENTS_RPC_USER ?? "<rpc-user>",
    password: process.env.ELEMENTS_RPC_PASSWORD ?? "<rpc-password>",
    wallet: process.env.ELEMENTS_RPC_WALLET ?? "simplicity-test",
  },
  toolchain: {
    simcPath: process.env.SIMC_PATH ?? "simc",
    halSimplicityPath: process.env.HAL_SIMPLICITY_PATH ?? "hal-simplicity",
    elementsCliPath: process.env.ELEMENTS_CLI_PATH ?? "eltc",
  },
});

console.log(sdk.policies.listTemplates());
console.log(sdk.outputBinding.describeSupport());
```

Quick CLI checks:

```bash
npx simplicity-cli presets list
npx simplicity-cli binding describe-support
npx simplicity-cli --help
```

For richer walkthroughs and sample JSON / `.simf` files, use [`docs/definitions/README.md`](./docs/definitions/README.md).

## Domain Overview

### Policy

Use `sdk.policies` when you want constrained transfers, recursive next-hop rules, or restricted OTC-style settlement kernels.

Main entrypoints:
- `sdk.policies.listTemplates(...)`
- `sdk.policies.describeTemplate(...)`
- `sdk.policies.issue(...)`
- `sdk.policies.prepareTransfer(...)`
- `sdk.policies.inspectTransfer(...)`
- `sdk.policies.executeTransfer(...)`
- `sdk.policies.verifyTransfer(...)`
- `sdk.policies.exportEvidence(...)`

Representative example:
- [show-policy-restricted-otc-transfer.ts](./examples/show-policy-restricted-otc-transfer.ts)

### Bonds

Use `sdk.bonds` for permissioned private bond or private credit flows where definition, issuance, settlement, closing, and lineage all matter.

Main entrypoints:
- `sdk.bonds.define(...)`
- `sdk.bonds.verify(...)`
- `sdk.bonds.verifyIssuanceHistory(...)`
- `sdk.bonds.prepareRedemption(...)`
- `sdk.bonds.buildSettlement(...)`
- `sdk.bonds.prepareClosing(...)`
- `sdk.bonds.verifyClosing(...)`
- `sdk.bonds.exportFinalityPayload(...)`

Representative example:
- [show-bond-business-flow.ts](./examples/show-bond-business-flow.ts)

### Funds

Use `sdk.funds` for LP fund settlement flows such as capital calls, rollover into refund-only, distributions, receipt reconciliation, and close-out.

Main entrypoints:
- `sdk.funds.define(...)`
- `sdk.funds.prepareCapitalCall(...)`
- `sdk.funds.executeCapitalCallClaim(...)`
- `sdk.funds.executeCapitalCallRollover(...)`
- `sdk.funds.executeCapitalCallRefund(...)`
- `sdk.funds.prepareDistribution(...)`
- `sdk.funds.verifyPositionReceiptChain(...)`
- `sdk.funds.exportFinalityPayload(...)`

Representative example:
- [show-fund-claim-close-flow.ts](./examples/show-fund-claim-close-flow.ts)

Operational note:
- [fund-cutoff-runbook.md](./docs/fund-cutoff-runbook.md)

### Receivables

Use `sdk.receivables` for repayment-first receivable or invoice-style pilots where you want canonical state transitions, role-aware runtime claim descriptors, partial repayment handling, lineage verification, and terminal closing.

By default, funding claims resolve against the originator claimant key and repayment claims resolve against the current holder claimant key, while `controllerXonly` remains the fallback for simpler pilots.

Main entrypoints:
- `sdk.receivables.define(...)`
- `sdk.receivables.prepareFunding(...)`
- `sdk.receivables.prepareFundingClaim(...)`
- `sdk.receivables.prepareRepayment(...)`
- `sdk.receivables.prepareRepaymentClaim(...)`
- `sdk.receivables.prepareClosing(...)`
- `sdk.receivables.verifyStateHistory(...)`
- `sdk.receivables.exportFinalityPayload(...)`

Representative example:
- [show-receivable-business-flow.ts](./examples/show-receivable-business-flow.ts)

### RWA DvP and Liquid x402

Use `sdk.rwaDvp` when a purchase flow needs a Liquid PSET payment request,
delivery/refund claim descriptors, and an evidence bundle that ties the Liquid
payment and delivery to an external lock or allocation record.

The EVM-side lock reference can describe the source asset being held for
settlement. Set `evmLock.tokenStandard` to `"ERC3475"`, `"ERC20"`, `"ERC721"`,
or `"ERC1155"` and include the token address / id fields used by your lock
manager. Existing callers that omit `tokenStandard` are treated as `"ERC3475"`
for backwards compatibility.

For standard Liquid assets, `payment.asset` can be `"lbtc"` or `"usdt"`. If a
testnet issuer or deployment uses a different USDt asset id, set
`payment.asset: "usdt"` and pass the explicit `payment.assetId`; the generated
payment requirements will preserve that asset id instead of replacing it with
the SDK's default registry id.

For policy-locked Liquid RWA positions, redemption can be represented as a
Liquid x402 request with `extra.redemptionSource.type:
"policy_locked_position"`. Wallets can use
`buildLiquidPolicyLockedRedemptionPaymentFromProposal(...)` when a service has
already prepared the Simplicity policy-spend PSET proposal. The helper binds the
custom RWA asset, policy position, vault output, expiry, and summary hash into
the `X-PAYMENT` payload, and rejects proposals that still require holder-side
Simplicity witness construction.

Services can prepare that policy-spend proposal with
`sdk.policies.inspectTransfer(...)` or `sdk.policies.executeTransfer(...)`.
When the current policy state carries a custom Liquid asset id, the policy
executor automatically uses the SDK multi-asset PSET path instead of the legacy
L-BTC-only spend path. Pass `extraInputs` for the L-BTC fee/sponsor inputs and
`contractInput` when the policy position UTXO should be selected by outpoint,
asset id, amount, blinding data, or sequence. If the policy UTXO amount is not
fully transferred, pass an explicit `changeAddress`; exact-position redemptions
do not need one.

Typical entrypoints:
- `sdk.rwaDvp.definePurchase(...)`
- `sdk.rwaDvp.buildPaymentRequirements(...)`
- `sdk.rwaDvp.verifyPaymentPset(...)`
- `sdk.rwaDvp.compileEscrowContract(...)`
- `sdk.rwaDvp.prepareDeliveryClaim(...)`
- `sdk.rwaDvp.inspectDeliveryClaim(...)`
- `sdk.rwaDvp.executeDeliveryClaim(...)`
- `sdk.rwaDvp.prepareRefundClaim(...)`
- `sdk.rwaDvp.inspectRefundClaim(...)`
- `sdk.rwaDvp.executeRefundClaim(...)`
- `sdk.rwaDvp.exportEvidence(...)`

For a delivery claim, the operator spends the funded escrow output and sends
the payment asset to the treasury while delivering the RWA asset to the buyer.
For a refund claim, the operator spends the same escrow output after the
configured timeout and returns the payment asset to the buyer. The inspect
methods build and validate the candidate spend without broadcasting it; the
execute methods finalize the Simplicity input, optionally test mempool
acceptance, and broadcast when `broadcast: true`.

The claim execution helpers assume the Elements wallet can provide any extra
inputs needed for RWA delivery and L-BTC fees. You can also pass explicit
`extraInputs` when the service wants deterministic coin selection. Script-bound
delivery/refund output checks are the practical default; descriptor-bound checks
should be used only when the caller can provide the exact output data required
by the descriptor.

#### Atomic Liquid DvP PSET helpers

For flows that should avoid a separate "buyer pays first, service delivers
later" step, the SDK also exposes lower-level atomic DvP helpers from the root
package:

- `buildLiquidAtomicDvpRequirements(...)`
- `prepareLiquidAtomicDvpLwkWasmMakerProposal(...)`
- `prepareLiquidAtomicDvpLwkWasmTakerPayment(...)`
- `buildLiquidAtomicDvpPaymentFromPset(...)`
- `verifyLiquidAtomicDvpPayment(...)`
- `encodeLiquidAtomicDvpPayment(...)`
- `decodeLiquidAtomicDvpPayment(...)`

These helpers model a Liquidex-style exchange:
- the service/maker selects an exact RWA delivery UTXO and creates a proposal
- the buyer/taker adds the required payment output and signs the combined PSET
- the resulting `X-PAYMENT` payload commits to both the payment output and the
  delivery output through a summary hash

When the delivered RWA output must go to a policy/Simplicity address instead of
the taker's normal wallet receive address, pass `takerDeliveryAddress` (or the
`deliveryAddress` alias) to `prepareLiquidAtomicDvpLwkWasmTakerPayment(...)`.
The loaded LWK module must expose a recipient-aware `liquidexTake` variant; if
it does not, the SDK fails explicitly instead of silently creating a PSET that
delivers to the wrong address.

The LWK convenience helpers dynamically load `lwk_node` or `lwk_wasm` from the
consuming application. Install one of them in the application that prepares or
takes proposals:

```bash
npm install lwk_node
```

Typical server-side shape:

```ts
import {
  buildLiquidAtomicDvpRequirements,
  prepareLiquidAtomicDvpLwkWasmMakerProposal,
  verifyLiquidAtomicDvpPayment,
} from "@hazbase/simplicity";

const requirements = buildLiquidAtomicDvpRequirements({
  network: "liquidtestnet",
  resource: "/v1/orders/<order-id>/liquid-atomic-pset",
  paymentToTreasury: {
    assetId: "<lbtc-or-usdt-asset-id>",
    amountAtomic: "10000",
    recipient: "<treasury-confidential-address>",
  },
  rwaToBuyer: {
    assetId: "<rwa-liquid-asset-id>",
    amountAtomic: "10",
    recipient: "<buyer-confidential-address>",
  },
  expiresAt: new Date(Date.now() + 15 * 60_000),
});

const maker = await prepareLiquidAtomicDvpLwkWasmMakerProposal({
  requirements,
  mnemonic: process.env.SERVICE_LIQUID_MNEMONIC!,
  descriptor: process.env.SERVICE_LIQUID_DESCRIPTOR!,
  electrumUrl: process.env.LIQUID_ELECTRUM_URL!,
});

// Store maker.proposalPsetBase64 with the order/payment requirements.
// When the buyer submits X-PAYMENT, verify it before broadcasting.
const verified = verifyLiquidAtomicDvpPayment({
  requirements,
  paymentPayload: buyerPaymentPayload,
});
if (!verified.ok) throw new Error(verified.reason);
```

The SDK-level payload check is intentionally lightweight: it verifies the
scheme, network, resource, expiry, PSET value, and summary hash. Production
settlement services should still decode the final PSET with their Liquid node or
wallet stack, verify the concrete payment and delivery outputs, and only then
broadcast.

## CLI and Confidence Commands

### Validation Surface

The public package is exercised through:
- unit / integration tests
- packaged consumer smoke runs
- public local / testnet e2e commands

Core confidence commands:

```bash
npm test
npm run e2e:policy-consumer
npm run e2e:bond-consumer
npm run e2e:fund-consumer
npm run e2e:receivable-consumer
```

Public runtime confidence commands:

```bash
npm run e2e:policy-local
npm run e2e:policy-restricted-otc-local
npm run e2e:policy-restricted-otc-testnet
POLICY_OUTPUT_BINDING_MODE=script-bound npm run e2e:policy-testnet
POLICY_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:policy-testnet

BOND_OUTPUT_BINDING_MODE=script-bound npm run e2e:bond-testnet
BOND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:bond-testnet

npm run e2e:fund-local
FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet
FUND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:fund-testnet
FUND_FLOW_MODE=refund FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet

npm run e2e:receivable-local
RECEIVABLE_OUTPUT_BINDING_MODE=script-bound npm run e2e:receivable-testnet
RECEIVABLE_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:receivable-testnet
```

Liquid x402 buyer smoke test:

```bash
npm install --no-save lwk_node@^0.17.1
npm run e2e:x402-lwk-address -- --generate
npm run e2e:x402-lwk-buyer -- https://share.example/v/slug --dry-run
LIQUID_X402_E2E_MNEMONIC="..." npm run e2e:x402-lwk-buyer -- https://share.example/v/slug --no-submit
LIQUID_X402_E2E_MNEMONIC="..." npm run e2e:x402-lwk-buyer -- https://share.example/v/slug --output unlocked.bin
```

The address script derives a confidential Liquid receive address for funding a
test buyer wallet. The buyer script then uses LWK locally to scan, build, sign,
and finalize a Liquid PSET, then sends the resulting `X-PAYMENT` header back to
the protected URL. `--dry-run` only inspects the 402 requirements, while
`--no-submit` signs a payment without broadcasting through the seller backend.

These commands are useful both as reproducible checks and as examples of the SDK's current validated surface.

## Where To Go Next

If you want to go deeper, use these entrypoints:
- [`docs/definitions/README.md`](./docs/definitions/README.md) for the public domain deep-dive and sample JSON / `.simf` assets
- [`examples/`](./examples) for runnable code samples across policy, bond, fund, and receivable flows
- `npx simplicity-cli --help` for the full CLI surface

A good next path is:
1. read the architecture and flow notes in [`docs/definitions/README.md`](./docs/definitions/README.md)
2. run one representative example from [`examples/`](./examples)
3. run one consumer smoke or local/testnet e2e command that matches your target domain

## Practical Notes / FAQ

### What does “deploy” mean here?

In the Simplicity-on-Liquid model, “deploy” means compile a contract, derive its contract address, and fund that address with a UTXO. There is no separate EVM-style bytecode deployment transaction.

### What is an artifact?

An artifact is the SDK's durable compile output plus the metadata needed to reload, inspect, verify, and execute a contract later. It is the bridge between contract definition time and spend time.

### What do I need locally?

For practical usage you typically need:
- Node.js 20+
- the npm package itself
- a local Simplicity toolchain (`simc`, `hal-simplicity`, and usually `eltc`)
- a reachable Elements / Liquid RPC endpoint

Some commands are SDK-only and work without live spends. Local and testnet e2e flows need the toolchain and, for broadcasted flows, an RPC environment.

The dedicated restricted OTC testnet runner clean-skips when RPC credentials are missing so it can stay in public CI and local verification scripts without turning missing env into a hard failure.
