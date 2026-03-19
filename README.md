# @hazbase/simplicity
[![npm version](https://badge.fury.io/js/@hazbase%2Fsimplicity.svg)](https://badge.fury.io/js/@hazbase%2Fsimplicity)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

`@hazbase/simplicity` is a Node.js / TypeScript SDK for working with Simplicity contracts on Liquid with an EVM-like developer workflow. It gives developers a practical settlement toolkit for compiling SimplicityHL (`.simf`) contracts, funding and executing constrained outputs, and exporting verification, evidence, finality, and lineage reports for permissioned policy, bond, fund, and receivable flows. It also ships with built-in presets so you can start from known-good contract templates before moving to custom `.simf` code.

This SDK is designed to help Node developers get productive quickly, but it is still opinionated and early-stage:
- SimplicityHL is still upstream work-in-progress and is not production-ready.
- This SDK currently optimizes for explicit / unblinded success paths first.
- Gasless support exists, but it comes in multiple modes with different tradeoffs.
- Bond, fund, and receivable evidence/finality exports now also carry a shared lightweight `trustSummary`, including lineage fields when canonical history is provided.

Consumer validation note:
- The published npm package has been validated from a fresh external Node.js project using `npm install @hazbase/simplicity`.
- Verified flows include preset-based contract execution, custom `.simf` execution, relayer-backed gasless execution, bond/fund lineage-aware business flows, receivable repayment-first claim verification, and LP-fund validation on `liquidtestnet`.

## Recursive Policy SDK

The SDK now also exposes a generic `sdk.policies` domain for **parametric recursive covenants**.

That means you can model a UTXO as:
- a policy template definition,
- a concrete policy state for the current recipient,
- and a next constrained output that can re-apply the same `.simf` template to the next hop.

Initial reference implementation:
- `recursive-delay-required.simf`
- `recursive-delay-optional.simf`

Main entrypoints:
- `sdk.outputBinding.describeSupport()`
- `sdk.outputBinding.evaluateSupport(...)`
- `sdk.policies.describeTemplate(...)`
- `sdk.policies.validateTemplateParams(...)`
- `sdk.policies.issue(...)`
- `sdk.policies.prepareTransfer(...)`
- `sdk.policies.inspectTransfer(...)`
- `sdk.policies.executeTransfer(...)`
- `sdk.policies.verifyState(...)`
- `sdk.policies.verifyTransfer(...)`
- `sdk.policies.exportEvidence(...)`

Policy evidence bundles now also export a lightweight `trustSummary`, so policy, bond, and fund flows all expose the same “full report + compact trust summary” shape.

Reference examples:
- [describe-policy-template.ts](./examples/describe-policy-template.ts)
- [custom-recursive-delay-required.manifest.json](./examples/custom-recursive-delay-required.manifest.json)
- [show-required-policy-transfer.ts](./examples/show-required-policy-transfer.ts)
- [show-optional-policy-transfer.ts](./examples/show-optional-policy-transfer.ts)
- [execute-required-policy-transfer.ts](./examples/execute-required-policy-transfer.ts)
- [execute-optional-policy-transfer.ts](./examples/execute-optional-policy-transfer.ts)

### Policy Quickstart

The shortest happy path is:
1. Describe the template and validate params
2. Issue the first policy-aware UTXO
3. Prepare, inspect, execute, and verify the next transfer

Required 1tx recursive hop:

```ts
const templates = sdk.policies.listTemplates();
const bindingSupport = sdk.outputBinding.describeSupport();
const bindingEvaluation = sdk.outputBinding.evaluateSupport({
  assetId: "bitcoin",
  requestedBindingMode: "descriptor-bound",
  outputForm: { amountForm: "confidential" },
});

const manifest = sdk.policies.describeTemplate({
  templateId: "recursive-delay",
  propagationMode: "required",
});

const params = sdk.policies.validateTemplateParams({
  templateId: manifest.templateId,
  propagationMode: "required",
  params: { lockDistanceBlocks: 2 },
});

const externalManifest = await sdk.policies.loadTemplateManifest({
  manifestPath: "./examples/custom-recursive-delay-required.manifest.json",
});

const issued = await sdk.policies.issue({
  recipient: { mode: "policy", recipientXonly: currentRecipientXonly },
  template: { templateId: "recursive-delay", value: { policyTemplateId: "recursive-delay" } },
  params,
  amountSat: 6000,
  assetId: "bitcoin",
  propagationMode: "required",
});

const prepared = await sdk.policies.prepareTransfer({
  currentArtifact: issued.compiled.artifact,
  template: { templateId: "recursive-delay", value: { policyTemplateId: "recursive-delay" } },
  currentStateValue: issued.state,
  nextReceiver: { mode: "policy", recipientXonly: nextRecipientXonly },
  nextAmountSat: 6000,
  nextParams: { lockDistanceBlocks: 2 },
  outputBindingMode: "descriptor-bound",
});
```

`sdk.outputBinding.describeSupport()` is the public support matrix for generalized binding. It tells you:
- which output forms can be auto-derived today,
- when manual `nextOutputHash` is still allowed,
- when `descriptor-bound` falls back to `script-bound`,
- and which runtime paths are validated locally vs on testnet.

`sdk.outputBinding.evaluateSupport(...)` is the quick deterministic answer for a specific scenario. It tells you:
- the requested binding mode,
- the resolved binding mode,
- the reason code,
- which unsupported features are blocking auto-derive,
- and whether the manual-hash path would keep `descriptor-bound` available.

If you want the `optional` branch instead, swap:
- `propagationMode: "optional"`
- `nextReceiver: { mode: "plain", address: ... }` for plain exit, or keep `mode: "policy"` for the recursive branch

The matching CLI flow is:
- `policy list-templates`
- `binding describe-support`
- `binding evaluate-support`
- `policy describe-template`
- `policy validate-template-params`
- `policy issue`
- `policy build-output-descriptor`
- `policy prepare-transfer`
- `policy inspect-transfer`
- `policy execute-transfer`
- `policy verify-state`
- `policy verify-transfer`
- `policy export-evidence`

For a testnet runtime example that spends an already-funded current policy UTXO, see:
- [execute-required-policy-transfer.ts](./examples/execute-required-policy-transfer.ts)
- [execute-optional-policy-transfer.ts](./examples/execute-optional-policy-transfer.ts)

The intended model is:
- `propagationMode: "required"`: next hop must remain policy-aware
- `propagationMode: "optional"`: next hop may remain policy-aware or exit to a plain address
- `propagationMode: "none"`: the policy ends at this hop

In `required` mode, the current state uses a **1tx direct hop**. The contract checks the current recipient, the relative timelock, the fee output shape, and the next constrained output script hash in the same spend.
In `optional` mode, the same current state can either:
- exit to a plain address, or
- bind the next constrained output in the same transaction
and the verification report marks the recursive branch as `conditional-hop`.

Current policy enforcement labels:
- `direct-hop`: `required` 1tx current -> next constrained output
- `conditional-hop`: `optional` mode when the recursive branch is chosen
- `sdk-path`: plain exit / no recursive enforcement

If a caller can supply `nextOutputHash`, both recursive policy templates can also take the stronger `descriptor-bound` path and compare `output_hash(0)` at runtime. In that case the amount becomes runtime-bound together with the rest of the output descriptor.
To make that path easier to use from the public policy API, the SDK now also exposes `sdk.policies.buildOutputDescriptor(...)` and the CLI command `policy build-output-descriptor`. These help derive the next constrained output address, script hash, and canonical descriptor summary before the transfer call.
The public binding paths are now:
- `explicit-v1`: `buildOutputDescriptor(...)` auto-derives `nextOutputHash` from high-level inputs when the asset is supplied as `bitcoin` or as a 64-character asset id
- `raw-output-v1`: advanced callers pass `assetBytesHex`, `amountBytesHex`, `nonceBytesHex`, plus either `scriptPubKeyHex` or `scriptPubKeyHashHex`, and either `rangeProofHex` or `rangeProofHashHex`, and the SDK derives `output_hash(0)` deterministically
- `manual-hash`: callers supply `nextOutputHash` directly and keep `descriptor-bound` even when auto-derive is unavailable or intentionally bypassed
- unsupported: the SDK falls back to `script-bound` and records the reason explicitly
Advanced callers can also pass output-form hints (`assetForm`, `amountForm`, `nonceForm`, `rangeProofForm`) to make confidential/generalized shapes explicit in the descriptor metadata.
Elements excludes surjection proofs from `output_hash(0)`, so the current generalized binding surface does not require `surjectionProofHex`.
If that auto-derivation is not available, the SDK now falls back to `script-bound` and records the fallback reason in the verification report instead of silently pretending the stronger mode succeeded.
The descriptor build result, transfer verification report, and evidence bundle now all carry the same derivation metadata:
- `supportedForm`
- `reasonCode`
- `autoDerived`
- `fallbackReason`
- `bindingInputs`

The policy verification and evidence JSON shapes are now versioned:
- `PolicyVerificationReport.schemaVersion = "policy-verification-report/v1"`
- `PolicyEvidenceBundle.schemaVersion = "policy-evidence-bundle/v1"`
and built-in/external template manifests use:
- `PolicyTemplateManifest.manifestVersion = "policy-template-manifest/v1"`

For relative timelocks, the public policy flow now also derives the contract input sequence from `lockDistanceBlocks`, so `check_lock_distance(...)` can be exercised on testnet without dropping back to the default spend sequence.

The public verification report now uses the same trust vocabulary across policy flows:
- `committed`
- `runtimeBound`
- `sdkVerified`

When an output binding is present, the report can also include:
- `supportedForm`
- `reasonCode`
- `nextOutputHash`
- `autoDerived`
- `fallbackReason`
- `bindingInputs`

This is intentionally explicit about current scope:
- `explicit-v1`:
  - explicit asset
  - explicit amount
  - null nonce
  - empty range proof
  - asset input as `bitcoin` or a 64-character asset id
- `raw-output-v1`:
  - caller provides raw output field bytes
  - SDK derives `output_hash(0)` from those bytes deterministically
- `manual-hash`:
  - caller provides `nextOutputHash` directly
- not yet treated as a default path:
  - wallet/RPC-driven confidential output reconstruction

Public policy confidence commands:
- `npm run e2e:policy-local`
- `npm run e2e:policy-restricted-otc-local`
- `npm run e2e:policy-restricted-otc-testnet`
- `POLICY_OUTPUT_BINDING_MODE=script-bound npm run e2e:policy-testnet`
- `POLICY_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:policy-testnet`
- `npm run e2e:policy-consumer`

## LP Fund Settlement Layer

The SDK now also exposes `sdk.funds` as a dedicated business layer for **LP fund settlement on Liquid**.

Security-first vNext model:
- capital calls are explicit `open -> rollover -> refund-only`
- manager claim exists only on the `open` artifact
- LP refund exists only on the `refund-only` artifact
- `LPPositionReceipt` is an off-chain canonical document wrapped in a manager-attested envelope
- closing accepts only a definition-bound attested receipt envelope and, for `sequence > 0`, its immediate predecessor
- full receipt-chain verification can additionally validate the entire attested lineage from `sequence=0` to the latest envelope

This layer is intentionally narrower than a full fund-admin system. It focuses on:
- capital call funding / manager claim / rollover / LP refund
- signed `LPPositionReceiptEnvelope` generation and reconciliation
- later one-shot distribution claim contracts
- finality / close-out evidence

It does **not** introduce `sdk.rwas`. The public architecture remains centered on the same core layers plus one lightweight receivable domain:
- `sdk.outputBinding`: shared binding support / fallback contract
- `sdk.policies`: generic recursive covenant engine
- `sdk.bonds`: credit / bond business layer
- `sdk.funds`: LP fund settlement business layer
- `sdk.receivables`: repayment-first receivable business layer for lineage-aware pilots

## Receivable Business Layer

The SDK also now exposes `sdk.receivables` as a repayment-first business layer for permissioned receivable or invoice-style RWA flows.

Current scope:
- canonical receivable definition + state validation
- funding / repayment / write-off transition builders and verifiers
- runtime funding-claim descriptors, contracts, and payout inspection / execution helpers
- runtime repayment-claim descriptors, contracts, and payout inspection / execution helpers
- terminal closing descriptors for repaid or defaulted receivables
- full hash-linked state-history verification
- shared evidence / finality export with lightweight `trustSummary`
- a concrete reference pattern for future RWA domains that want the same `latest state + lineage + finality` model

Main entrypoints:
- `sdk.receivables.define(...)`
- `sdk.receivables.verify(...)`
- `sdk.receivables.load(...)`
- `sdk.receivables.prepareFunding(...)`
- `sdk.receivables.verifyFunding(...)`
- `sdk.receivables.prepareFundingClaim(...)`
- `sdk.receivables.inspectFundingClaim(...)`
- `sdk.receivables.executeFundingClaim(...)`
- `sdk.receivables.verifyFundingClaim(...)`
- `sdk.receivables.prepareRepayment(...)`
- `sdk.receivables.verifyRepayment(...)`
- `sdk.receivables.prepareRepaymentClaim(...)`
- `sdk.receivables.inspectRepaymentClaim(...)`
- `sdk.receivables.executeRepaymentClaim(...)`
- `sdk.receivables.verifyRepaymentClaim(...)`
- `sdk.receivables.prepareWriteOff(...)`
- `sdk.receivables.verifyWriteOff(...)`
- `sdk.receivables.prepareClosing(...)`
- `sdk.receivables.verifyClosing(...)`
- `sdk.receivables.verifyStateHistory(...)`
- `sdk.receivables.exportEvidence(...)`
- `sdk.receivables.exportFinalityPayload(...)`

Reference example:
- [show-receivable-lineage.ts](./examples/show-receivable-lineage.ts)
- [show-receivable-business-flow.ts](./examples/show-receivable-business-flow.ts)

Scope note:
- this is intentionally a lightweight domain layer today
- runtime scope is intentionally **repayment-first**
- `write-off` remains SDK-only in the current wave
- dedicated local and testnet runtime runners now exist, but fresh testnet txids still depend on an operator-supplied Elements RPC environment
- its main purpose is still to show how the shared lineage/reporting helpers extend cleanly into the next permissioned RWA case without pretending the whole servicing stack is on-chain

Matching CLI flow:
- `receivable define`
- `receivable verify`
- `receivable load`
- `receivable prepare-funding`
- `receivable verify-funding`
- `receivable prepare-funding-claim`
- `receivable inspect-funding-claim`
- `receivable execute-funding-claim`
- `receivable verify-funding-claim`
- `receivable prepare-repayment`
- `receivable verify-repayment`
- `receivable prepare-repayment-claim`
- `receivable inspect-repayment-claim`
- `receivable execute-repayment-claim`
- `receivable verify-repayment-claim`
- `receivable prepare-write-off`
- `receivable verify-write-off`
- `receivable prepare-closing`
- `receivable verify-closing`
- `receivable verify-state-history`
- `receivable export-evidence`
- `receivable export-finality-payload`

Public receivable confidence commands:
- `npm run e2e:receivable-consumer`
- `npm run e2e:receivable-local`
- `RECEIVABLE_OUTPUT_BINDING_MODE=script-bound npm run e2e:receivable-testnet`
- `RECEIVABLE_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:receivable-testnet`

Main entrypoints:
- `sdk.funds.define(...)`
- `sdk.funds.verify(...)`
- `sdk.funds.load(...)`
- `sdk.funds.prepareCapitalCall(...)`
- `sdk.funds.inspectCapitalCallClaim(...)`
- `sdk.funds.executeCapitalCallClaim(...)`
- `sdk.funds.inspectCapitalCallRollover(...)`
- `sdk.funds.executeCapitalCallRollover(...)`
- `sdk.funds.inspectCapitalCallRefund(...)`
- `sdk.funds.executeCapitalCallRefund(...)`
- `sdk.funds.verifyCapitalCall(...)`
- `sdk.funds.signPositionReceipt(...)`
- `sdk.funds.verifyPositionReceipt(...)`
- `sdk.funds.verifyPositionReceiptChain(...)`
- `sdk.funds.prepareDistribution(...)`
- `sdk.funds.inspectDistributionClaim(...)`
- `sdk.funds.executeDistributionClaim(...)`
- `sdk.funds.verifyDistribution(...)`
- `sdk.funds.reconcilePosition(...)`
- `sdk.funds.prepareClosing(...)`
- `sdk.funds.verifyClosing(...)`
- `sdk.funds.exportEvidence(...)`
- `sdk.funds.exportFinalityPayload(...)`

Reference examples:
- [show-fund-claim-close-flow.ts](./examples/show-fund-claim-close-flow.ts)
- [show-fund-refund-flow.ts](./examples/show-fund-refund-flow.ts)
- [fund-definition.json](./docs/definitions/fund-definition.json)
- [fund-capital-call-state.json](./docs/definitions/fund-capital-call-state.json)

### Fund Quickstart

The intended split for LP fund workflows is:

- off-chain:
  - KYC/AML
  - subscription docs
  - capital account / waterfall / NAV
  - allocation calculation
- on-chain SDK:
  - capital call funding / claim / rollover / refund
  - distribution payout
  - finality / close-out evidence

Minimal flow:

```ts
const capitalCall = await sdk.funds.prepareCapitalCall({
  definitionPath: "./docs/definitions/fund-definition.json",
  capitalCallPath: "./docs/definitions/fund-capital-call-state.json",
});

const initialReceipt = buildLPPositionReceipt({
  positionId: "POS-001",
  capitalCall: capitalCall.capitalCallValue,
  effectiveAt: "2026-03-18T00:00:00Z",
});

const signedInitialReceipt = await sdk.funds.signPositionReceipt({
  definitionPath: "./docs/definitions/fund-definition.json",
  positionReceiptValue: initialReceipt,
  signer: { type: "schnorrPrivkeyHex", privkeyHex: managerPrivkeyHex },
  signedAt: "2026-03-18T00:00:00Z",
});

const firstDistribution = await sdk.funds.prepareDistribution({
  definitionPath: "./docs/definitions/fund-definition.json",
  positionReceiptValue: signedInitialReceipt.positionReceiptEnvelope,
  distributionId: "DIST-001",
  assetId: capitalCall.capitalCallValue.currencyAssetId,
  amountSat: 2000,
  approvedAt: "2027-03-18T00:00:00Z",
});

const afterFirst = await sdk.funds.reconcilePosition({
  definitionPath: "./docs/definitions/fund-definition.json",
  positionReceiptValue: signedInitialReceipt.positionReceiptEnvelope,
  distributionValue: firstDistribution.distributionValue,
  signer: { type: "schnorrPrivkeyHex", privkeyHex: managerPrivkeyHex },
  signedAt: "2027-03-18T00:00:00Z",
});

const secondDistribution = await sdk.funds.prepareDistribution({
  definitionPath: "./docs/definitions/fund-definition.json",
  positionReceiptValue: afterFirst.reconciledReceiptEnvelope,
  distributionId: "DIST-002",
  assetId: capitalCall.capitalCallValue.currencyAssetId,
  amountSat: initialReceipt.fundedAmount - 2000,
  approvedAt: "2028-03-18T00:00:00Z",
});

const afterSecond = await sdk.funds.reconcilePosition({
  definitionPath: "./docs/definitions/fund-definition.json",
  positionReceiptValue: afterFirst.reconciledReceiptEnvelope,
  distributionValue: secondDistribution.distributionValue,
  signer: { type: "schnorrPrivkeyHex", privkeyHex: managerPrivkeyHex },
  signedAt: "2028-03-18T00:00:00Z",
});

const receiptChain = [
  signedInitialReceipt.positionReceiptEnvelope,
  afterFirst.reconciledReceiptEnvelope,
  afterSecond.reconciledReceiptEnvelope,
];

const closing = await sdk.funds.prepareClosing({
  definitionPath: "./docs/definitions/fund-definition.json",
  positionReceiptValue: afterSecond.reconciledReceiptEnvelope,
  previousPositionReceiptValue: afterFirst.reconciledReceiptEnvelope,
  positionReceiptChainValues: receiptChain,
  closingId: "CLOSE-001",
  finalDistributionHashes: [
    firstDistribution.distributionSummary.hash,
    secondDistribution.distributionSummary.hash,
  ],
  closedAt: "2029-03-18T00:00:00Z",
});
```

`verifyPositionReceipt(...)` gives the minimum latest-envelope check. When you pass the full attested chain, `sdk.funds.verifyPositionReceiptChain(...)`, `prepareClosing(...)`, `verifyClosing(...)`, `exportEvidence(...)`, and `exportFinalityPayload(...)` can all surface shared receipt-chain trust fields such as `fullLineageVerified` and `fullChainVerified`.

Example CLI summary:

```bash
npx simplicity-cli fund verify-position-receipt-chain \
  --definition-json ./docs/definitions/fund-definition.json \
  --position-receipt-chain-json ./tmp/receipt-0.json \
  --position-receipt-chain-json ./tmp/receipt-1.json \
  --position-receipt-chain-json ./tmp/receipt-2.json
```

```text
verified=true
positionId=POSITION-001
chainLength=3
latestSequence=2
latestOrdinal=2
startsAtGenesis=true
allHashLinksVerified=true
identityConsistent=true
fullLineageVerified=true
fullChainVerified=true
```

The split examples are:
- `show-fund-claim-close-flow.ts`: receipt envelope -> two distributions -> manager-attested reconciliation -> closing/finality
- `show-fund-refund-flow.ts`: open capital call -> rollover -> refund-only payout binding -> evidence/finality

The matching CLI flow is:
- `fund define`
- `fund verify`
- `fund prepare-capital-call`
- `fund inspect-capital-call-claim`
- `fund execute-capital-call-claim`
- `fund inspect-capital-call-rollover`
- `fund execute-capital-call-rollover`
- `fund inspect-capital-call-refund`
- `fund execute-capital-call-refund`
- `fund verify-capital-call`
- `fund sign-position-receipt`
- `fund verify-position-receipt`
- `fund verify-position-receipt-chain`
- `fund prepare-distribution`
- `fund inspect-distribution-claim`
- `fund execute-distribution-claim`
- `fund verify-distribution`
- `fund reconcile-position`
- `fund prepare-closing`
- `fund verify-closing`
- `fund export-evidence`
- `fund export-finality-payload`

Reproducible fund confidence commands:
- `npm run e2e:fund-local`
- `npm run e2e:fund-consumer`
- `FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet`
- `FUND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:fund-testnet`
- `FUND_FLOW_MODE=refund FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet`
- `FUND_OUTPUT_BINDING_MODE=script-bound FUND_DISTRIBUTION_AMOUNTS_SAT=2000,4000 FUND_DISTRIBUTION_IDS=DIST-...-1,DIST-...-2 FUND_APPROVED_ATS=2027-03-18T00:00:00Z,2028-03-18T00:00:00Z npm run e2e:fund-testnet`
- `FUND_OUTPUT_BINDING_MODE=descriptor-bound FUND_DISTRIBUTION_AMOUNTS_SAT=2000,4000 FUND_DISTRIBUTION_IDS=DIST-...-1,DIST-...-2 FUND_APPROVED_ATS=2027-03-18T00:00:00Z,2028-03-18T00:00:00Z npm run e2e:fund-testnet`

Security notes for `sdk.funds`:
- on-chain enforced:
  - `open` capital call allows manager claim only
  - `refund-only` capital call allows LP refund only, with optional payout output binding
  - cutoff height is committed into the `open` artifact
  - output binding uses the shared `script-bound` / `descriptor-bound` / `raw-output-v1` engine
- off-chain attested:
  - `LPPositionReceiptEnvelope`
  - manager attestation over receipt hash and sequence
- operationally enforced:
  - watcher/keeper monitors `open` capital calls through `claimCutoffHeight`
  - watcher/keeper submits rollover after cutoff
  - LP refund becomes operationally available only after rollover confirmation

Latest fund testnet reruns:

| Flow | Funding txid | Main execution txid(s) | Closing / receipt | Rerun command |
| --- | --- | --- | --- | --- |
| `script-bound` claim-close | `a7676264c0afab65d2357fd04f743cb3544bde24bb6839ffb21459fe08fb311b` | claim `d6cea7140e96d9db7cc803cdb382233e789ac1c79df5d616deb2e59502290bc7`; distribution `fa430a540723d5ea8799423ac03b3f66a69fd689e305fd15311f39d17ff0d0ef` | receipt `3288b9fe2ddea6a2cd801fcea63540e165fb2ee48e15c6a3e59fa236b8a3f807`; closing `1960560c3bec9865b94637191253b55622ef1e4f2ef97bd57e1d17196c8339fe`; `fullChainVerified=true` | `FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet` |
| `descriptor-bound` claim-close | `bf7b2fffbe83367a00b3dceaa0a603b74405ea04ea9eca040562f04817a5515d` | claim `fa393943bbe15432ac07ade5852f903bcc7bd489c5db6f76204110d1f4591b76`; distribution `47ba261ae2005661d4febf4b59b2fb812005c8ece65479a75b3d3a0e7fc68cb8` | receipt `3916dd1ad73bfbffd88fa66e61d82b369ba51ebac0c9d36141f04b727a517e42`; closing `9af65eb24d4226d899e6d26b01cb7e99d3921e49ce3cd2d955fa0c4bb5edb760`; `fullChainVerified=true` | `FUND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:fund-testnet` |
| `script-bound` refund | `4bc21f88e7fb03b3ee916de57647621a7d445f172a482481a7dceeddac6f1b56` | rollover `7f53e98ca0f935bd6a13781392acc2ff4257b0135e96fb19f81afc68947cd6a6`; refund `e11ebad54259c59e61e41b1cfd6f501490645eaab997661ff3854ca4cbc6e4ba` | refund-only settlement | `FUND_FLOW_MODE=refund FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet` |

Fund receipt-chain verification now uses the same shared lineage vocabulary as bond issuance history:
- `receiptChainTrust.lineageKind = receipt-chain`
- `receiptChainTrust.latestOrdinal`
- `receiptChainTrust.allHashLinksVerified`
- `receiptChainTrust.identityConsistent`
- `receiptChainTrust.fullLineageVerified = true`
- `receiptChainTrust.fullChainVerified = true`

Latest Bond testnet reruns:

| Mode | Funding txid | Execution txid | Rerun command |
| --- | --- | --- | --- |
| `script-bound` | `90f521bf3c457e0f919bc6876a9f4185fb4e095cda03130cdda640639fc9bcb2` | `2fd8b5ca82a8cb451d5305d3ec104f0f1864754db27c429d040ab054883eeac2` | `BOND_OUTPUT_BINDING_MODE=script-bound npm run e2e:bond-testnet` |
| `descriptor-bound` | `7e5bb2fedd562e977388b007d0901cf0334e802402bc6f2a85080571a84b348d` | `b3c2819edb4e55cbc311fb85e033b9528ae7fcb8de196301059ef98120eb8170` | `BOND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:bond-testnet` |

Latest Bond close-out reruns (`BOND_REDEEM_AMOUNT=1000000`):

| Mode | Funding txid | Execution txid | Closing hash | Rerun command |
| --- | --- | --- | --- | --- |
| `script-bound` | `5486ae5e47540f9d882cb5e080f40679051f913a69cf4414cb187effcca3820c` | `6db4b307ec5fb9e770cb6b506e281bde6415ed890f86bc08f67cce74b8211298` | `68ede25e5ea442eb182321c149002b4930f9ffca384e5e7e113f82346edcb5ae` | `BOND_OUTPUT_BINDING_MODE=script-bound BOND_REDEEM_AMOUNT=1000000 npm run e2e:bond-testnet` |
| `descriptor-bound` | `882e9c71b8c20c8a13a39b848d765a30965a8c2d43e9a5ea2883ef85b35a9869` | `d69a0c05eec79af34878bb07a7dcc42f445d6d8522c9452ba5673ea97d1a818b` | `b1a0605ad3a0063a837d00b39c6d1f9d7a62b588c5548f52ab38a6f67c1f5aab` | `BOND_OUTPUT_BINDING_MODE=descriptor-bound BOND_REDEEM_AMOUNT=1000000 npm run e2e:bond-testnet` |

Fresh bond reruns now persist a canonical issuance-history sidecar and surface the shared lineage vocabulary:
- `issuanceLineageTrust.lineageKind = state-history`
- `issuanceLineageTrust.latestOrdinal`
- `issuanceLineageTrust.allHashLinksVerified`
- `issuanceLineageTrust.identityConsistent`
- `issuanceLineageTrust.fullLineageVerified = true`
- `issuanceLineageTrust.fullHistoryVerified = true`

Bond lineage verification:
- `sdk.bonds.verifyIssuanceHistory(...)` can verify a canonical issuance-state history from the original `ISSUED` state through later redemption or closing states.
- CLI: `bond verify-issuance-history`
- evidence / finality export can also carry the shared lineage trust summary, including `fullLineageVerified`, when you pass the canonical issuance history.

Example CLI summary:

```bash
npx simplicity-cli bond verify-issuance-history \
  --definition-json ./docs/definitions/bond-definition.json \
  --issuance-history-json ./tmp/issuance-issued.json \
  --issuance-history-json ./tmp/issuance-redeemed.json \
  --issuance-history-json ./tmp/issuance-closed.json
```

```text
verified=true
issuanceId=BOND-2026-001-ISSUE-1
chainLength=3
latestStatus=CLOSED
latestOrdinal=2
startsAtGenesis=true
allHashLinksVerified=true
identityConsistent=true
fullLineageVerified=true
fullHistoryVerified=true
```

## Validated Scenarios

The published package has been exercised from a blank external consumer project through the public consumer smoke commands.

| Scenario | Status | Notes |
| --- | --- | --- |
| Fresh install + JS import | Success | `npm install @hazbase/simplicity` and `import { createSimplicityClient } from "@hazbase/simplicity"` both worked |
| CLI smoke | Success | `npx simplicity-cli presets list` worked from the external project |
| Preset flow (`p2pkLockHeight`) | Success | compile -> fund -> inspect -> execute(`broadcast=true`) |
| Custom `.simf` flow | Success | `compileFromFile(...)` -> fund -> inspect -> execute(`broadcast=true`) |
| Relayer-backed gasless flow | Success | `executeGasless(...)` succeeded from the external project |
| LP fund business flow | Success | packaged `sdk.funds` consumer smoke covers capital call, distribution, and finality |

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

## Trusted Issuance State JSON

The same hash-anchor model also applies to issuance state documents such as a bond issuance record.

This lets us say not only:
- "these are the bond terms,"

but also:
- "this bond was issued in this amount, with this outstanding principal, under this controller."

The SDK supports:
- loading and hashing a state JSON with `sdk.loadStateDocument(...)`,
- storing its hash in the artifact,
- committing `STATE_HASH` into custom `.simf` contract logic,
- verifying later that the issuance state JSON still matches the compiled contract.

The recommended Bond issuance shape still captures:
- `issuanceId`
- `bondId`
- `issuedPrincipal`
- `outstandingPrincipal`
- `redeemedPrincipal`
- `currencyAssetId`
- `controllerXonly`
- `issuedAt`
- `status`

## Public Architecture

The SDK is now organized around four core public layers plus one lightweight domain layer:
- `sdk.outputBinding`: cross-domain output-binding support matrix and fallback behavior
- `sdk.policies`: generic recursive covenant / transfer engine
- `sdk.bonds`: Bond business layer built on Policy Core primitives and shared output binding
- `sdk.funds`: LP fund settlement business layer for capital calls, distributions, closing, and finality
- `sdk.receivables`: receivable funding / repayment / write-off / closing layer with lineage and finality support

This means:
- use `sdk.policies` when you want a generic constrained-transfer engine,
- use `sdk.bonds` when you want bond definition / issuance / redemption / settlement / closing / evidence semantics,
- use `sdk.funds` when you want LP capital call / distribution / closing semantics,
- use `sdk.receivables` when you want a lightweight receivable business layer with state-history / evidence / finality support,
- use `sdk.outputBinding.describeSupport()` when you want the canonical explanation of supported forms, manual hash paths, and fallback behavior,
- use `sdk.outputBinding.evaluateSupport(...)` when you want the deterministic answer for one concrete output-form scenario.

## Bond Domain Layer

`sdk.bonds` is now intentionally a **thin business facade**.

Its public responsibility is:
- bond definition / issuance / settlement / closing schema and invariant handling,
- business event orchestration,
- audit / evidence / finality payload export.

Public Bond API:
- `sdk.bonds.define(...)`
- `sdk.bonds.verify(...)`
- `sdk.bonds.load(...)`
- `sdk.bonds.issue(...)`
- `sdk.bonds.prepareRedemption(...)`
- `sdk.bonds.inspectRedemption(...)`
- `sdk.bonds.executeRedemption(...)`
- `sdk.bonds.verifyRedemption(...)`
- `sdk.bonds.buildSettlement(...)`
- `sdk.bonds.verifySettlement(...)`
- `sdk.bonds.prepareClosing(...)`
- `sdk.bonds.inspectClosing(...)`
- `sdk.bonds.executeClosing(...)`
- `sdk.bonds.verifyClosing(...)`
- `sdk.bonds.exportEvidence(...)`
- `sdk.bonds.exportFinalityPayload(...)`

What is no longer part of the public Bond surface:
- machine / rollover / state-machine helpers,
- script-bound / descriptor-bound machine compile helpers,
- expected-output descriptor helpers as a standalone public API.

Those lower-level primitives are kept only for internal regression and protocol research under:
- `src/internal/experimental/bond.ts`
- `examples/internal/experimental/bonds/`

### Shared Output Binding

Bond settlement/build/verify now uses the same binding engine as Policy Core.
That means Bond and Policy return the same binding metadata vocabulary:
- `supportedForm`
- `reasonCode`
- `autoDerived`
- `fallbackReason`
- `bindingInputs`

Current practical behavior:
- `script-bound`: runtime binds next output script hash, output count, and fee output position
- `descriptor-bound`: runtime binds `output_hash(0)` when the output form is supported or when the caller supplies a manual `nextOutputHash`
- unsupported `descriptor-bound` requests fall back to `script-bound` with an explicit reason code
- supported advanced paths:
  - `explicit-v1`
  - `raw-output-v1`
  - `manual-hash`
- current generalized/confidential story is explicit on purpose:
  - unsupported high-level confidential forms still report why they fall back
  - `raw-output-v1` exists for callers that already know the output bytes or already know the SHA-256 hashes of the scriptPubKey / range proof
  - surjection proofs are intentionally outside this contract because Elements excludes them from `output_hash(0)`
  - wallet/RPC-backed confidential auto-reconstruction is still a non-goal in this phase

You can evaluate a concrete binding scenario before building a transfer:

```ts
const evaluation = sdk.outputBinding.evaluateSupport({
  assetId: "bitcoin",
  requestedBindingMode: "descriptor-bound",
  outputForm: { amountForm: "confidential" },
});

const rawEvaluation = sdk.outputBinding.evaluateSupport({
  assetId: "unsupported-asset-alias",
  requestedBindingMode: "descriptor-bound",
  rawOutput: {
    assetBytesHex: "01" + "22".repeat(32),
    amountBytesHex: "01000000000000076c",
    nonceBytesHex: "00",
    scriptPubKeyHex: "5120" + "11".repeat(32),
    rangeProofHex: "",
  },
});
```

### Bond Runtime Confidence

Latest fresh Bond testnet reruns:

| Binding | Funding txid | Execution txid | Rerun command |
| --- | --- | --- | --- |
| `script-bound` | `1c982864ef6c83da4eb7f8018edc4cbdff439db7c6366984b3f85ad4937e2c4f` | `d659c4bdce6b32650ff58ac37ccaa55209a9f04d5dc4595f956fad034089f580` | `BOND_OUTPUT_BINDING_MODE=script-bound npm run e2e:bond-testnet` |
| `descriptor-bound` | `72d0015b51a74c3cc81f7abb74a4f6f894c7f7bbd1e83647939459d7b40e504f` | `85e0830a7b2ba33ca37d5f11bd981938418fc472e98657095680ada71387974c` | `BOND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:bond-testnet` |

### Minimal Bond Flow

```ts
const compiled = await sdk.bonds.define({
  definitionPath: "./docs/definitions/bond-definition.json",
  issuancePath: "./docs/definitions/bond-issuance-state.json",
  simfPath: "./docs/definitions/bond-issuance-anchor.simf",
  artifactPath: "./bond-issuance.artifact.json",
});

const verified = await sdk.bonds.verify({
  artifactPath: "./bond-issuance.artifact.json",
  definitionPath: "./docs/definitions/bond-definition.json",
  issuancePath: "./docs/definitions/bond-issuance-state.json",
});

const redemption = await sdk.bonds.prepareRedemption({
  definitionPath: "./docs/definitions/bond-definition.json",
  previousIssuancePath: "./docs/definitions/bond-issuance-state.json",
  amount: 250000,
  redeemedAt: "2027-03-10T00:00:00Z",
  nextStateSimfPath: "./docs/definitions/bond-issuance-anchor.simf",
  nextAmountSat: 1900,
  outputBindingMode: "script-bound",
});

const settlement = await sdk.bonds.buildSettlement({
  definitionPath: "./docs/definitions/bond-definition.json",
  previousIssuancePath: "./docs/definitions/bond-issuance-state.json",
  nextIssuanceValue: redemption.preview.next,
  nextStateSimfPath: "./docs/definitions/bond-issuance-anchor.simf",
  nextAmountSat: 1900,
  outputBindingMode: "script-bound",
});

const closing = await sdk.bonds.prepareClosing({
  definitionPath: "./docs/definitions/bond-definition.json",
  redeemedIssuancePath: "./docs/definitions/bond-issuance-state-redeemed.json",
  settlementDescriptorValue: settlement.descriptor,
  closedAt: "2027-03-10T00:00:00Z",
});

const evidence = await sdk.bonds.exportEvidence({
  artifactPath: "./bond-issuance.artifact.json",
  definitionPath: "./docs/definitions/bond-definition.json",
  issuancePath: "./docs/definitions/bond-issuance-state.json",
  settlementDescriptorValue: settlement.descriptor,
});
```

### Bond CLI Flow

```bash
simplicity-cli bond define \
  --definition-json ./docs/definitions/bond-definition.json \
  --issuance-json ./docs/definitions/bond-issuance-state.json \
  --simf ./docs/definitions/bond-issuance-anchor.simf \
  --artifact ./bond-issuance.artifact.json

simplicity-cli bond verify \
  --artifact ./bond-issuance.artifact.json \
  --definition-json ./docs/definitions/bond-definition.json \
  --issuance-json ./docs/definitions/bond-issuance-state.json

simplicity-cli bond prepare-redemption \
  --definition-json ./docs/definitions/bond-definition.json \
  --previous-issuance-json ./docs/definitions/bond-issuance-state.json \
  --amount 250000 \
  --redeemed-at 2027-03-10T00:00:00Z \
  --next-state-simf ./docs/definitions/bond-issuance-anchor.simf \
  --next-amount-sat 1900 \
  --output-binding-mode script-bound \
  --next-issuance-out ./next-bond-issuance-state.json

simplicity-cli bond build-settlement \
  --definition-json ./docs/definitions/bond-definition.json \
  --previous-issuance-json ./docs/definitions/bond-issuance-state.json \
  --next-issuance-json ./next-bond-issuance-state.json \
  --next-state-simf ./docs/definitions/bond-issuance-anchor.simf \
  --next-amount-sat 1900 \
  --output-binding-mode script-bound

simplicity-cli bond prepare-closing \
  --definition-json ./docs/definitions/bond-definition.json \
  --redeemed-issuance-json ./docs/definitions/bond-issuance-state-redeemed.json \
  --settlement-descriptor-json ./bond-settlement.json \
  --closed-at 2027-03-10T00:00:00Z

simplicity-cli bond export-evidence \
  --artifact ./bond-issuance.artifact.json \
  --definition-json ./docs/definitions/bond-definition.json \
  --issuance-json ./docs/definitions/bond-issuance-state.json

simplicity-cli binding evaluate-support \
  --asset-id bitcoin \
  --output-binding-mode descriptor-bound \
  --amount-form confidential
```

Example `bond build-settlement` summary:

```text
descriptorHash=4d8f...
bindingMode=descriptor-bound
previousStateHash=8c3b...
nextStateHash=56ae...
nextContractAddress=tex1p...
nextAmountSat=1900
maxFeeSat=100
supportedForm=explicit-v1
reasonCode=OK_EXPLICIT
autoDerived=true
nextOutputHash=0b9a...
bindingInputs(asset=bitcoin, amountSat=1900, nextOutputIndex=0, feeIndex=1, maxFeeSat=100)
bindingInputForms(assetForm=explicit, amountForm=explicit, nonceForm=null, rangeProofForm=empty)
```

Example `bond verify-redemption` summary:

```text
phase=verify
mode=descriptor-bound
descriptorHash=4d8f...
nextStateHash=56ae...
nextAmountSat=1900
verified=true
bindingMode=descriptor-bound
supportedForm=explicit-v1
reasonCode=OK_EXPLICIT
autoDerived=true
nextOutputHash=0b9a...
outputBinding.mode=descriptor-bound
outputBinding.nextContractAddressCommitted=true
outputBinding.outputCountRuntimeBound=true
outputBinding.feeIndexRuntimeBound=true
outputBinding.nextOutputHashRuntimeBound=true
outputBinding.nextOutputScriptRuntimeBound=false
```

Important limitation:
- Bond finality is stronger than before, but still intentionally partial.
- `script-bound` currently runtime-binds output count, fee position, and next output script hash.
- `descriptor-bound` adds runtime `output_hash(0)` binding for supported explicit/manual-hash paths.
- exact next output amount is still not a fully generalized covenant across all output forms.
- unsupported confidential/generalized output forms fall back deterministically and report why.

For a Bond-oriented walkthrough that matches the current public surface, see [docs/definitions/README.md](./docs/definitions/README.md).
For a packaged external-consumer smoke of the public business flow, run `npm run e2e:bond-consumer`.

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

Core contract workflows:
- [compile-custom.ts](./examples/compile-custom.ts): compile a custom `.simf` file.
- [compile-preset.ts](./examples/compile-preset.ts): compile a built-in preset.
- [inspect-contract.ts](./examples/inspect-contract.ts): inspect a contract spend before broadcast.
- [execute-contract.ts](./examples/execute-contract.ts): execute a contract directly.
- [execute-contract-gasless.ts](./examples/execute-contract-gasless.ts): execute with a local sponsor wallet paying fees.
- [execute-contract-gasless-relayer.ts](./examples/execute-contract-gasless-relayer.ts): execute through a relayer-backed gasless flow.
- [execute-htlc.ts](./examples/execute-htlc.ts): HTLC preset with custom witness values.
- [execute-transfer-with-timeout-cooperative.ts](./examples/execute-transfer-with-timeout-cooperative.ts): cooperative multi-witness timeout flow.
- [gasless-transfer.ts](./examples/gasless-transfer.ts): standard relayer-backed gasless L-BTC transfer.

Policy Core examples:
- [describe-policy-template.ts](./examples/describe-policy-template.ts): inspect a public policy manifest and validate params.
- [show-required-policy-transfer.ts](./examples/show-required-policy-transfer.ts): preview a required 1tx recursive transfer.
- [show-optional-policy-transfer.ts](./examples/show-optional-policy-transfer.ts): preview an optional plain-or-recursive transfer.
- [show-policy-restricted-otc-transfer.ts](./examples/show-policy-restricted-otc-transfer.ts): preview a restricted OTC transfer that stays constrained to the approved next custodian.
- [execute-required-policy-transfer.ts](./examples/execute-required-policy-transfer.ts): execute a funded required policy UTXO.
- [execute-optional-policy-transfer.ts](./examples/execute-optional-policy-transfer.ts): execute an optional plain or recursive branch.
- [custom-recursive-delay-required.manifest.json](./examples/custom-recursive-delay-required.manifest.json): example external manifest for custom template loading.

Bond business-layer examples:
- [define-bond.ts](./examples/define-bond.ts): compile a bond definition anchor with the generic contract API.
- [show-bond-definition.ts](./examples/show-bond-definition.ts): verify and retrieve a trusted bond definition.
- [define-bond-issuance.ts](./examples/define-bond-issuance.ts): define a bond issuance artifact.
- [show-bond-issuance.ts](./examples/show-bond-issuance.ts): load a bond artifact with verified issuance state.
- [verify-bond-issuance.ts](./examples/verify-bond-issuance.ts): run bond invariant checks against artifact + JSON inputs.
- [show-bond-business-flow.ts](./examples/show-bond-business-flow.ts): walk the business-layer flow from definition through finality payload export.
- [redeem-bond-issuance.ts](./examples/redeem-bond-issuance.ts): prepare a bond redemption preview and next issuance state.
- [show-bond-settlement-payload.ts](./examples/show-bond-settlement-payload.ts): build a public settlement descriptor.
- [verify-bond-settlement.ts](./examples/verify-bond-settlement.ts): verify a settlement descriptor against bond inputs.

Internal / experimental Bond regressions:
- [examples/internal/experimental/bonds/README.md](./examples/internal/experimental/bonds/README.md): low-level machine / rollover / transition helpers retained for research and regression only.

In addition to the in-repo examples, the package has also been validated from a blank external consumer project with:
- `npm install @hazbase/simplicity`
- JS/TS import of `createSimplicityClient`
- preset compile -> fund -> inspect -> execute
- custom `.simf` compile -> fund -> inspect -> execute
- relayer-backed gasless execution
- policy quickstart smoke via `npm run e2e:policy-consumer`
- policy restricted OTC local scenario via `npm run e2e:policy-restricted-otc-local`
- policy restricted OTC testnet scenario via `npm run e2e:policy-restricted-otc-testnet`
- receivable business-flow smoke via `npm run e2e:receivable-consumer`

## Covenant Roadmap

If you want to see how the current bond lifecycle work can evolve toward stronger output binding, see [docs/design/full-covenant-output-binding.md](./docs/design/full-covenant-output-binding.md). That note captures what the local SimplicityHL examples appear to expose today and what the next realistic covenant milestones are.

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

When you also compile with `state: { ... }`, the artifact can additionally carry:
- `stateType`
- `stateId`
- `schemaVersion`
- `hash`
- `trustMode`
- `anchorMode`

That is what allows the SDK and CLI to verify that an off-chain issuance state document still matches the contract you compiled.

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
