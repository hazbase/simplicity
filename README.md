# @hazbase/simplicity
[![npm version](https://badge.fury.io/js/@hazbase%2Fsimplicity.svg)](https://badge.fury.io/js/@hazbase%2Fsimplicity)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@hazbase/simplicity` is a Node.js / TypeScript SDK for working with Simplicity contracts on Liquid with an EVM-like developer workflow. It lets you compile SimplicityHL (`.simf`) contracts, derive the contract address, fund that address, inspect the spend you are about to make, execute the contract, and optionally run fee-sponsored flows through a sponsor wallet or relayer. It also ships with built-in presets so you can start from known-good contract templates before moving to custom `.simf` code.

This SDK is designed to help Node developers get productive quickly, but it is still opinionated and early-stage:
- SimplicityHL is still upstream work-in-progress and is not production-ready.
- This SDK currently optimizes for explicit / unblinded success paths first.
- Gasless support exists, but it comes in multiple modes with different tradeoffs.

Consumer validation note:
- The published npm package has been validated from a fresh external Node.js project using `npm install @hazbase/simplicity`.
- Verified flows include preset-based contract execution, custom `.simf` execution, and relayer-backed gasless execution on `liquidtestnet`.

## Validated Scenarios

The published package has been exercised from a blank external consumer project. For the full reproducible fixture, see [docs/consumer-validation/README.md](./docs/consumer-validation/README.md).

| Scenario | Status | Notes |
| --- | --- | --- |
| Fresh install + JS import | Success | `npm install @hazbase/simplicity` and `import { createSimplicityClient } from "@hazbase/simplicity"` both worked |
| CLI smoke | Success | `npx simplicity-cli presets list` worked from the external project |
| Preset flow (`p2pkLockHeight`) | Success | compile -> fund -> inspect -> execute(`broadcast=true`) |
| Custom `.simf` flow | Success | `compileFromFile(...)` -> fund -> inspect -> execute(`broadcast=true`) |
| Relayer-backed gasless flow | Success | `executeGasless(...)` succeeded from the external project |

## Who This Is For

This README is for you if:
- you are comfortable with Node.js / TypeScript,
- you want to experiment with Simplicity on Liquid without building everything from scratch,
- you want a clear path from `compile` to `fund` to `inspect` to `execute`,
- you want to understand how presets, custom contracts, witnesses, and gasless execution fit together.

This README is not assuming you already know Simplicity well. It will explain the model first, then show the happy path, then move into advanced topics.

## Mental Model First

Before touching the API, it helps to anchor on how Simplicity on Liquid differs from an EVM contract.

- A **Simplicity contract** is a spend condition that can be tied to a contract address.
- **Deploying** a contract is not a separate bytecode deployment transaction. In practice, you compile the contract, get its derived address, and fund that address with a UTXO.
- An **artifact** is the compile output plus the metadata you need later to inspect and execute that contract again.
- **Executing** a contract means consuming the contract UTXO and building a new transaction that satisfies the contract's witness rules.
- **Inspecting** a contract call means building the spend first and reviewing what will happen before broadcasting.
- **Gasless** means the fee is paid by a sponsor wallet or relayer instead of by the contract caller directly.

If you come from Ethereum, a helpful translation is:
- EVM `deploy contract` -> Simplicity `compile contract and fund its address`
- EVM `call contract` -> Simplicity `spend a contract UTXO with the correct witness`
- EVM `transaction preview / wallet confirmation` -> Simplicity `inspectCall()` / summary hash review

## What You Can Build With This SDK

With the current SDK you can build and test flows such as:
- single-sig contract spends,
- single-sig spends gated by block height,
- HTLC-style contracts,
- cooperative transfer with unilateral timeout recovery,
- relayer-backed fee-sponsored contract execution,
- custom `.simf` contract workflows driven from TypeScript or CLI.

You can also design more advanced systems such as ERC20-like token behavior, but the model is different from Ethereum. On Liquid/Simplicity, you usually represent state transitions as UTXO transitions instead of account storage updates. So the SDK can support that kind of application, but it does not mean you port Solidity account logic 1:1.

## Trusted Definition JSON

When your contract depends on off-chain business metadata such as a bond definition, coupon schedule, note terms, or asset terms, you usually do not want to trust a plain JSON file by itself. This SDK now supports a **hash-anchor** model for definition JSON.

What that means:
- the SDK canonicalizes the JSON using stable key ordering,
- computes `sha256(canonicalJson)`,
- stores that hash in the artifact as a definition anchor,
- injects `DEFINITION_HASH` and `DEFINITION_ID` into compile-time template vars when a definition is provided,
- lets you verify later that the JSON you are reading still matches the contract/artifact it was compiled against.

There are now two anchor modes:
- `artifact-hash-anchor`: the JSON hash is anchored in the artifact and verified later against that artifact.
- `on-chain-constant-committed`: the JSON hash is anchored in the artifact and also committed into executed contract logic, so it materially affects the compiled program, CMR, and contract address.

Today, `on-chain-constant-committed` is guaranteed for custom `.simf` contracts that include the blessed `require_definition_anchor()` helper pattern. Built-in presets still default to artifact-only anchors for now.
The SDK does **not** trust artifact JSON alone for this verdict. `trust.onChainAnchorVerified` only becomes `true` when the SDK can read the source file again and re-detect the blessed helper pattern. If the source file is unavailable, the claimed mode may still be `on-chain-constant-committed`, but `onChainAnchorVerified` will remain `false`.

Minimal TypeScript flow:

```ts
const definition = await sdk.loadDefinition({
  type: "bond",
  id: "BOND-2026-001",
  jsonPath: "./docs/definitions/bond-definition.json",
});

const compiled = await sdk.compileFromFile({
  simfPath: "./docs/definitions/bond-anchor.simf",
  templateVars: {
    MIN_HEIGHT: 2344430,
    SIGNER_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  },
  definition: {
    type: definition.definitionType,
    id: definition.definitionId,
    schemaVersion: definition.schemaVersion,
    jsonPath: definition.sourcePath,
    anchorMode: "on-chain-constant-committed",
  },
  artifactPath: "./bond.artifact.json",
});

const verification = await sdk.verifyDefinitionAgainstArtifact({
  artifactPath: "./bond.artifact.json",
  jsonPath: "./docs/definitions/bond-definition.json",
  type: "bond",
  id: "BOND-2026-001",
});

console.log(verification.ok);
console.log(verification.trust.effectiveMode);
```

CLI equivalents:

```bash
simplicity-cli definition show \
  --type bond \
  --id BOND-2026-001 \
  --json-path ./docs/definitions/bond-definition.json

simplicity-cli definition verify \
  --artifact ./bond.artifact.json \
  --type bond \
  --id BOND-2026-001 \
  --json-path ./docs/definitions/bond-definition.json
```

For a bond-oriented walkthrough, see [docs/definitions/README.md](./docs/definitions/README.md).

## Install

You need three things:
1. the npm package,
2. a local Simplicity toolchain,
3. a reachable Elements / Liquid RPC endpoint.

### Package

```bash
npm install @hazbase/simplicity
```

### Runtime assumptions

The current SDK assumes you have access to:
- `simc`
- `hal-simplicity`
- an Elements-compatible RPC endpoint
- a wallet-enabled RPC when you want to inspect or execute spends

### Node version

- Node.js `>= 20`

## Quickstart: First Working Contract

This section is the shortest path to a real success case. We will:
1. create a client,
2. compile the built-in `p2pkLockHeight` preset,
3. get the contract address,
4. fund it,
5. confirm the contract UTXO exists,
6. inspect the call,
7. execute it.

We use `p2pkLockHeight` first because it has a simple witness model and is the easiest way to understand how the SDK works end to end.

### Step 1: Create a client

This is the main entrypoint for the SDK.

```ts
import { createSimplicityClient } from "@hazbase/simplicity";

const sdk = createSimplicityClient({
  network: "liquidtestnet",
  rpc: {
    url: process.env.ELEMENTS_RPC_URL || "http://127.0.0.1:18884",
    username: process.env.ELEMENTS_RPC_USER || "<rpc-user>",
    password: process.env.ELEMENTS_RPC_PASSWORD || "<rpc-password>",
    wallet: process.env.ELEMENTS_RPC_WALLET || "simplicity-test",
  },
  toolchain: {
    simcPath: process.env.SIMC_PATH || "simc",
    halSimplicityPath: process.env.HAL_SIMPLICITY_PATH || "hal-simplicity",
    elementsCliPath: process.env.ELEMENTS_CLI_PATH || "eltc",
  },
});
```

If you are wondering whether a public RPC endpoint is enough: usually not for full execution flows. Public RPC endpoints often do not expose wallet methods such as `walletprocesspsbt`, so for real `inspect` / `execute` flows you should assume a trusted, authenticated RPC.

CLI equivalent for discovery starts here:

```bash
simplicity-cli presets list
simplicity-cli presets show --preset p2pkLockHeight
```

### Step 2: Compile a preset

Now compile the built-in preset and save an artifact.

```ts
const compiled = await sdk.compileFromPreset({
  preset: "p2pkLockHeight",
  params: {
    MIN_HEIGHT: 2344430,
    SIGNER_XONLY: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  },
  artifactPath: "./artifact.json",
});

console.log(compiled.deployment());
```

What you get back:
- a `CompiledContract`,
- a deployable contract address,
- the CMR,
- the internal key,
- an artifact you can reload later.

CLI equivalent:

```bash
simplicity-cli preset compile \
  --preset p2pkLockHeight \
  --param MIN_HEIGHT=2344430 \
  --param SIGNER_XONLY=79be... \
  --artifact ./artifact.json
```

### Step 3: Understand the deployment output

`compiled.deployment()` tells you where to send funds and what contract you just created.

The most important fields are:
- `contractAddress`: where you send L-BTC to make the contract live,
- `cmr`: the commitment merkle root for the compiled contract,
- `internalKey`: the internal taproot key used in the address derivation.

This is the point where Simplicity differs from EVM most clearly: **you are not broadcasting a separate deployment transaction here**. You are preparing a spend condition and then making it live by funding the resulting address.

### Step 4: Fund the contract

Send L-BTC to the `contractAddress` from your Liquid wallet.

Example with `eltc`:

```bash
eltc -rpcwallet=simplicity-test sendtoaddress "<contract-address>" 0.00002
```

You can then wait for the UTXO from TypeScript:

```ts
const contract = compiled.at();

await contract.waitForFunding({
  minAmountSat: 1000,
  pollIntervalMs: 5000,
  timeoutMs: 120000,
});
```

Or inspect the artifact status from the CLI:

```bash
simplicity-cli artifact show --artifact ./artifact.json
```

What `artifact show` tells you:
- whether the contract is unfunded,
- whether only unconfirmed UTXOs are visible,
- whether it is executable,
- which contract UTXOs are currently visible.

The state you usually want before calling `execute` is:
- `status: executable`
- `ready: yes`

### Step 5: Inspect before broadcast

Before broadcasting a contract spend, build it and inspect it.

```ts
const inspectResult = await contract.inspectCall({
  wallet: "simplicity-test",
  toAddress: "tex1...",
  signer: {
    type: "schnorrPrivkeyHex",
    privkeyHex: process.env.SIMPLICITY_PRIMARY_PRIVKEY || "<primary-privkey-hex>",
  },
});

console.log(inspectResult.summaryHash);
console.log(inspectResult.summary);
```

Why this matters:
- you see the candidate transaction before broadcasting,
- you can inspect inputs, outputs, and fee behavior,
- you can log or verify the `summaryHash` in higher-level applications.

CLI equivalent:

```bash
simplicity-cli contract inspect \
  --artifact ./artifact.json \
  --wallet simplicity-test \
  --privkey <primary-privkey-hex> \
  --to-address tex1...
```

A practical rule: use `inspect` first, especially when you are still learning the contract or changing witness logic.

### Step 6: Execute

Once you are satisfied with the preview, execute the spend.

A safe first step is to build the final raw transaction without broadcasting:

```ts
const executeResult = await contract.execute({
  wallet: "simplicity-test",
  toAddress: "tex1...",
  signer: {
    type: "schnorrPrivkeyHex",
    privkeyHex: process.env.SIMPLICITY_PRIMARY_PRIVKEY || "<primary-privkey-hex>",
  },
  broadcast: false,
});

console.log(executeResult.rawTxHex);
```

Then switch to broadcast mode when you are ready:

```ts
const broadcastResult = await contract.execute({
  wallet: "simplicity-test",
  toAddress: "tex1...",
  signer: {
    type: "schnorrPrivkeyHex",
    privkeyHex: process.env.SIMPLICITY_PRIMARY_PRIVKEY || "<primary-privkey-hex>",
  },
  broadcast: true,
});

console.log(broadcastResult.txId);
```

CLI equivalent:

```bash
simplicity-cli contract execute \
  --artifact ./artifact.json \
  --wallet simplicity-test \
  --privkey <primary-privkey-hex> \
  --to-address tex1... \
  --broadcast
```

Recommended habit:
1. compile
2. fund
3. artifact check
4. inspect
5. execute with `broadcast: false`
6. execute with `broadcast: true`

## Step-by-Step Walkthrough

This section explains the same flow in terms of the SDK types and responsibilities.

### Create a Client

Use `createSimplicityClient(config)` to define three pieces of infrastructure:
- which Liquid network you are targeting,
- which RPC endpoint and wallet you will use,
- where the local toolchain binaries live.

This client is the root object for both JS/TS flows and relayer integrations.

### Compile a Built-in Preset

Use `sdk.compileFromPreset(...)` when you want the fastest route to a working contract.

Use it when:
- you are learning Simplicity with the SDK,
- your contract matches a built-in pattern,
- you want a known witness schema and a stable example path.

The return value is a `CompiledContract`, which gives you:
- `deployment()`
- `saveArtifact(path)`
- `at()` to turn it into a deployed contract handle.

### Understand Deployment

`deployment()` gives you the metadata you need to make the contract live:
- `contractAddress`
- `cmr`
- `internalKey`
- `instructions`

This is the point where the README should change your mental model: **compiling does not put anything on chain yet**. Funding the derived address is what makes the contract usable.

### Fund the Contract

A compiled contract becomes executable only after a UTXO exists at its address.

Helpful SDK / CLI tools here:
- `contract.waitForFunding(...)`
- `contract.findUtxos()`
- `simplicity-cli artifact show --artifact ...`

Use `artifact show` when you want a human-readable view of:
- address,
- compile source,
- linked preset,
- live UTXO status.

### Inspect Before Broadcast

`inspectCall()` is the safe preview path.

It answers:
- which UTXO is being spent,
- where the outputs go,
- what fee output exists,
- what summary hash represents the proposed spend.

This is especially important if you intend to build signing UX or higher-level approval logic later.

### Execute

`execute()` is the direct contract spend path.

Use:
- `broadcast: false` when you want to generate and inspect the final raw transaction,
- `broadcast: true` when you actually want to submit the spend.

For beginners, the safest practice is:
- inspect first,
- dry-run execute second,
- broadcast last.

## Common Workflow Patterns

This section helps you choose the right path for real work.

### Pattern A: Start from a preset

Best for:
- first experiments,
- demos,
- validating a toolchain setup,
- learning witness behavior.

Use:
- `p2pkLockHeight` first,
- then `p2pk` if you do not need a timelock.

### Pattern B: Move to custom `.simf`

Best for:
- your own contract logic,
- app-specific spend rules,
- moving from prototype to product-specific behavior.

Use:
- `sdk.compileFromFile(...)`
- `templateVars`
- `artifactPath`

A common progression is:
1. start from a preset,
2. inspect the preset's witness model,
3. write your own `.simf`,
4. keep the same artifact / inspect / execute lifecycle.

### Pattern C: Multi-witness contracts

Best for:
- HTLC-style logic,
- cooperative spends,
- timeout recovery,
- flows where multiple branches of witness data are possible.

Relevant SDK features:
- `witness.values`
- `witness.signers`
- witness schema validation

Relevant presets:
- `htlc`
- `transferWithTimeout`

### Pattern D: Gasless execution

Best for:
- developer experience where the caller should not manage fees directly,
- fee-sponsored app flows,
- relayer-backed applications.

There are three different gasless-style paths in this SDK, and they are not interchangeable:
- standard L-BTC transfer through a relayer,
- local sponsor wallet mode for Simplicity contract execution,
- relayer-backed Simplicity execution.

## Presets Overview

These presets are built into the SDK and are the best place to start.

| Preset | What it does | When to use it | Custom witness? | Relayer execute? | Best first use |
| --- | --- | --- | --- | --- | --- |
| `p2pkLockHeight` | Single signer spend gated by block height | First end-to-end tutorial, timelocked tests | No | Yes | Yes |
| `p2pk` | Basic single key spend | Minimal happy path | No | Yes | Yes |
| `htlc` | Hash/time based branch contract | Preimage or timeout experiments | Yes | Yes | After presets without custom witness |
| `transferWithTimeout` | Cooperative transfer with unilateral timeout fallback | Multi-witness and branch logic | Yes | Yes | After HTLC basics |

Use the CLI to inspect presets interactively:

```bash
simplicity-cli presets list
simplicity-cli presets show --preset transferWithTimeout
simplicity-cli presets scaffold --preset transferWithTimeout --write-dir ./transfer-timeout-scaffold
```

## Custom `.simf` Contracts

When built-in presets are no longer enough, move to your own `.simf` file.

```ts
const compiled = await sdk.compileFromFile({
  simfPath: "./contracts/my-contract.simf",
  templateVars: {
    ADMIN_XONLY: "79be...",
    MIN_HEIGHT: 2344430,
  },
  artifactPath: "./artifacts/my-contract.artifact.json",
});
```

Use custom `.simf` when:
- your business logic is not represented by a preset,
- you need your own parameterization,
- you want to build app-specific wrappers on top of the generic SDK.

A real external-consumer validation of this path has been completed with:
- a fresh project created outside this repo,
- a local `contract.simf` file owned by that project,
- `compileFromFile(...)`,
- funding + inspect + `broadcast: true` execution.

Recommended path:
- learn the lifecycle with a preset first,
- then move to `compileFromFile(...)` once the model is clear.

## Witnesses Explained

A **witness** is the runtime data needed to satisfy a Simplicity contract spend.

### Auto-generated witness

For the simplest presets, you usually do not need to build witness data manually.

Examples:
- `p2pkLockHeight`
- `p2pk`

These rely on the default signature path and use the primary signer you pass to `inspectCall()` or `execute()`.

### `witness.values`

Use `witness.values` when the contract needs structured runtime data in addition to the primary signer.

Example:

```ts
witness: {
  values: {
    COMPLETE_OR_CANCEL: {
      type: "Either<(u256, Signature), Signature>",
      value: "Left((0x0000000000000000000000000000000000000000000000000000000000000000, ${SIGNATURE}))",
    },
  },
}
```

### `${SIGNATURE}`

`${SIGNATURE}` is replaced by the SDK with the actual Simplicity signature for the current contract input.

This means you can express witness templates declaratively while letting the SDK calculate the actual signature material.

### `${SIGNATURE:NAME}` and `witness.signers`

Use named signer placeholders when a contract requires more than one signature source.

Example:

```ts
witness: {
  signers: {
    RECIPIENT: {
      type: "schnorrPrivkeyHex",
      privkeyHex: "<recipient-privkey-hex>",
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
}
```

### Validation rules

The SDK validates preset witness usage before calling `simc`.

That means it can reject mistakes such as:
- missing required witness fields,
- mismatched witness type strings,
- a named signature placeholder without a matching signer entry.

### Which presets need custom witness?

- `p2pkLockHeight`: no
- `p2pk`: no
- `htlc`: yes
- `transferWithTimeout`: yes

## Gasless Modes Explained

Gasless support exists in three forms, and it is important to understand the difference.

### 1. Standard gasless transfer

Use this when you want a relayer to sponsor a normal L-BTC payment flow.

```ts
const result = await sdk.payments.gaslessTransfer({
  relayer: sdk.relayer({
    baseUrl: process.env.SIMPLICITY_RELAYER_URL || "http://127.0.0.1:3000",
    apiKey: process.env.SIMPLICITY_RELAYER_API_KEY || "<relayer-api-key>",
  }),
  amount: 0.0001,
  toAddress: "tex1...",
  fromLabel: "user-1",
  userWallet: "userwallet",
});
```

Use it when:
- you want fee sponsorship,
- you are sending L-BTC,
- you are not executing a Simplicity contract input.

### 2. Local sponsor wallet mode

Use this when the contract spend is local, but another wallet on the same system should pay the fee.

```ts
const result = await compiled.at().executeGasless({
  wallet: "simplicity-test",
  sponsorWallet: "sponsorwallet",
  toAddress: "tex1...",
  signer: {
    type: "schnorrPrivkeyHex",
    privkeyHex: process.env.SIMPLICITY_PRIMARY_PRIVKEY || "<primary-privkey-hex>",
  },
  broadcast: true,
});
```

Use it when:
- you control both wallets,
- you do not need a separate external relayer service,
- you want a local fee-sponsored contract execution path.

### 3. Relayer-backed Simplicity execution

Use this when a separate relayer service should sponsor and submit the Simplicity execution.

```ts
const relayer = sdk.relayer({
  baseUrl: process.env.SIMPLICITY_RELAYER_URL || "http://127.0.0.1:3000",
  apiKey: process.env.SIMPLICITY_RELAYER_API_KEY || "<relayer-api-key>",
});

const result = await compiled.at().executeGasless({
  relayer,
  fromLabel: "demo-user",
  wallet: "simplicity-test",
  toAddress: "tex1...",
  signer: {
    type: "schnorrPrivkeyHex",
    privkeyHex: process.env.SIMPLICITY_PRIMARY_PRIVKEY || "<primary-privkey-hex>",
  },
});
```

Use it when:
- your app has a relayer backend,
- users should not manage fees directly,
- you want contract execution plus fee sponsorship.

## CLI Guide

If you prefer the CLI, the same lifecycle is available there.

### Discover

```bash
simplicity-cli presets list
simplicity-cli presets show --preset p2pkLockHeight
simplicity-cli presets show --preset htlc
```

### Scaffold

```bash
simplicity-cli presets scaffold --preset transferWithTimeout
simplicity-cli presets scaffold --preset transferWithTimeout --write-dir ./transfer-timeout-scaffold
```

Use scaffold when you want a starting bundle with:
- params JSON,
- witness JSON,
- compile / execute command examples,
- `.env.example`,
- a small TypeScript example.

### Compile and deploy

```bash
simplicity-cli preset compile \
  --preset p2pkLockHeight \
  --param MIN_HEIGHT=2344430 \
  --param SIGNER_XONLY=79be... \
  --artifact ./artifact.json

simplicity-cli artifact show --artifact ./artifact.json
```

### Execute

```bash
simplicity-cli contract inspect \
  --artifact ./artifact.json \
  --wallet simplicity-test \
  --privkey <primary-privkey-hex> \
  --to-address tex1...

simplicity-cli contract execute \
  --artifact ./artifact.json \
  --wallet simplicity-test \
  --privkey <primary-privkey-hex> \
  --to-address tex1... \
  --broadcast

simplicity-cli contract execute-gasless \
  --artifact ./artifact.json \
  --wallet simplicity-test \
  --relayer http://127.0.0.1:3000 \
  --api-key <relayer-api-key> \
  --from-label demo-user \
  --privkey <primary-privkey-hex> \
  --to-address tex1...
```

### Gasless transfer

```bash
simplicity-cli gasless request \
  --relayer http://127.0.0.1:3000 \
  --api-key <relayer-api-key> \
  --from-label user-1 \
  --to-address tex1... \
  --amount 0.0001
```

## Examples Map

These examples are included to help you jump to the right workflow quickly.

- [compile-custom.ts](./examples/compile-custom.ts): compile a custom `.simf` file.
- [compile-preset.ts](./examples/compile-preset.ts): compile a built-in preset.
- [inspect-contract.ts](./examples/inspect-contract.ts): inspect a contract spend before broadcast.
- [execute-contract.ts](./examples/execute-contract.ts): execute a contract directly.
- [execute-contract-gasless.ts](./examples/execute-contract-gasless.ts): execute with a local sponsor wallet paying fees.
- [execute-contract-gasless-relayer.ts](./examples/execute-contract-gasless-relayer.ts): execute through a relayer-backed gasless flow.
- [execute-htlc.ts](./examples/execute-htlc.ts): HTLC preset with custom witness values.
- [execute-transfer-with-timeout-cooperative.ts](./examples/execute-transfer-with-timeout-cooperative.ts): cooperative multi-witness timeout flow.
- [gasless-transfer.ts](./examples/gasless-transfer.ts): standard relayer-backed gasless L-BTC transfer.
- [define-bond.ts](./examples/define-bond.ts): compile a bond example with a trusted definition hash anchor.
- [show-bond-definition.ts](./examples/show-bond-definition.ts): verify and retrieve a trusted bond definition from JSON + artifact.

In addition to the in-repo examples, the package has also been validated from a blank external consumer project with:
- `npm install @hazbase/simplicity`
- JS/TS import of `createSimplicityClient`
- preset compile -> fund -> inspect -> execute
- custom `.simf` compile -> fund -> inspect -> execute
- relayer-backed gasless execution

## FAQ / Practical Notes

### Can I use a public RPC endpoint?

Sometimes for read-only or light inspection flows, but usually not for full execution. Many public endpoints do not expose wallet RPC methods, and this SDK relies on wallet-aware flows for inspect / execute in practical setups.

### What does “deploy” mean here?

It means: compile the contract, derive its address, then fund that address with a UTXO. There is no separate EVM-style bytecode deployment transaction.

### What is an artifact?

An artifact is the contract's compile output plus the metadata needed to reload, inspect, and execute it later. Think of it as the bridge between compilation time and on-chain execution time.

When you compile with `definition: { ... }`, the artifact also carries:
- `definitionType`
- `definitionId`
- `schemaVersion`
- `hash`
- `trustMode`
- `anchorMode`

That is what allows the SDK and CLI to verify that an off-chain JSON definition still matches the contract you compiled.

### When should I use a preset instead of a custom `.simf` file?

Use a preset first when you are learning the lifecycle or your use case already matches a built-in contract. Move to custom `.simf` when your business rules are app-specific.

### Does gasless mean the contract itself is free?

No. It means someone else pays the transaction fee. The transaction still has a fee; the caller just does not provide it directly.

### Can I build an ERC20-like token with this SDK?

Yes, but not by copying the EVM account model directly. On Liquid/Simplicity, you usually model token logic as UTXO state transitions rather than storage mappings. The SDK can support that workflow, but the contract design is different from Solidity.

## Practical Limitations

Be aware of these current constraints:
- SimplicityHL is still upstream work-in-progress.
- The SDK currently prioritizes explicit / unblinded paths.
- Public RPC endpoints are usually not enough for full wallet-based execution.
- Gasless support exists in multiple modes and should be chosen deliberately.
- This is not a browser SDK.
- Full confidential / blinded support is not the current success path.

## E2E Note

The repository also includes an E2E script for relayer-backed Simplicity execution:

```bash
PATH="/tmp:$PATH" npm run e2e:simplicity-relayer
```

Helpful env vars include:
- `SIMPLICITY_ARTIFACT`
- `SIMPLICITY_RELAYER_PORT`
- `SIMPLICITY_RELAYER_API_KEY`
- `SIMPLICITY_RELAYER_DIR`
- `SIMPLICITY_FROM_LABEL`
- `SIMPLICITY_PRIVKEY`
- `ELEMENTS_RPC_URL`
- `ELEMENTS_RPC_USER`
- `ELEMENTS_RPC_PASSWORD`
- `ELEMENTS_RPC_WALLET`

You do not need this script to understand the SDK, but it is useful once you want to validate relayer-backed flows end to end.

## License

Apache-2.0
