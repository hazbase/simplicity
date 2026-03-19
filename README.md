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
- receivable repayment-first funding / repayment / closing flows
- evidence, trust summary, lineage, and finality exports

## Public Architecture

The public SDK is organized into five layers:
- `sdk.outputBinding`: shared output-binding support, evaluation, and fallback behavior
- `sdk.policies`: generic constrained transfer and recursive policy engine
- `sdk.bonds`: private bond / credit settlement business layer
- `sdk.funds`: LP fund settlement business layer
- `sdk.receivables`: repayment-first receivable business layer

A useful mental model is:
- `sdk.outputBinding` + `sdk.policies` provide the shared settlement kernel
- `sdk.bonds`, `sdk.funds`, and `sdk.receivables` build domain flows on top of that kernel

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

### Receivables

Use `sdk.receivables` for repayment-first receivable or invoice-style pilots where you want canonical state transitions, runtime claim descriptors, lineage verification, and terminal closing.

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
