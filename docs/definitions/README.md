# Trusted Definitions and Issuance State

This directory contains the reference JSON and `.simf` files used by the public Bond business flow, the public LP fund settlement flow, and the public recursive policy templates.

Files:
- `bond-definition.json`: off-chain bond definition document
- `bond-anchor.simf`: custom Simplicity contract that commits `DEFINITION_HASH`
- `bond-issuance-state.json`: off-chain issuance state document
- `bond-issuance-state-partial-redemption.json`: sample next-state document after a partial redemption
- `bond-issuance-state-redeemed.json`: sample fully redeemed state document
- `bond-issuance-anchor.simf`: custom Simplicity contract that commits both `DEFINITION_HASH` and `STATE_HASH`
- `fund-definition.json`: off-chain LP fund definition document
- `fund-capital-call-state.json`: off-chain capital call state document
- `fund-capital-call-open.simf`: capital-call contract for manager claim or rollover into refund-only
- `fund-capital-call-refund-only.simf`: capital-call contract that allows LP refund only after rollover
- `fund-distribution-claim.simf`: one-shot LP distribution claim contract
- `recursive-delay-required.simf`: public `required` recursive policy contract for 1tx direct hops
- `recursive-delay-optional.simf`: public `optional` / `none` recursive policy contract for 1tx plain-or-recursive branching
- `recursive-policy-transfer-machine.simf`: retained for internal or experimental routed regressions only

## Public Architecture

The public SDK now has four layers:
- `sdk.outputBinding`: canonical binding support matrix and fallback behavior
- `sdk.policies`: generic recursive covenant / transfer engine
- `sdk.bonds`: Bond business layer for definition, issuance, redemption, settlement, closing, and evidence/finality
- `sdk.funds`: LP fund settlement business layer for capital calls, distributions, closing, and evidence/finality

We are **not** introducing `sdk.rwas` yet. The shared abstraction point today is Policy Core + output binding, not a premature RWA super-layer.

## Recommended Bond Flow

1. Load or define the bond artifact with `sdk.bonds.define(...)`
2. Verify or load it with `sdk.bonds.verify(...)` / `sdk.bonds.load(...)`
3. Prepare a redemption with `sdk.bonds.prepareRedemption(...)`
4. Inspect or execute the runtime redemption with `sdk.bonds.inspectRedemption(...)` / `sdk.bonds.executeRedemption(...)`
5. Verify the runtime redemption artifact with `sdk.bonds.verifyRedemption(...)`
6. Build or verify the settlement envelope with `sdk.bonds.buildSettlement(...)` / `sdk.bonds.verifySettlement(...)`
7. Prepare, inspect, execute, and verify closing with:
   - `sdk.bonds.prepareClosing(...)`
   - `sdk.bonds.inspectClosing(...)`
   - `sdk.bonds.executeClosing(...)`
   - `sdk.bonds.verifyClosing(...)`
8. Export evidence and finality payloads with:
   - `sdk.bonds.exportEvidence(...)`
   - `sdk.bonds.exportFinalityPayload(...)`

Packaged external-consumer smoke for that same public business flow:

```bash
npm run e2e:bond-consumer
```

What is intentionally no longer public:
- machine / rollover / transition compile helpers
- script-bound / descriptor-bound machine helpers
- expected-output descriptor helpers as a top-level Bond API

Those live only in:
- `src/internal/experimental/bond.ts`
- `examples/internal/experimental/bonds/`

Public Bond example:
- `./examples/show-bond-business-flow.ts`

## Recommended Fund Flow

1. Load or define the fund artifact with `sdk.funds.define(...)`
2. Verify or load it with `sdk.funds.verify(...)` / `sdk.funds.load(...)`
3. Prepare a capital call with `sdk.funds.prepareCapitalCall(...)`
4. Inspect or execute the manager claim on the `open` artifact with:
   - `sdk.funds.inspectCapitalCallClaim(...)`
   - `sdk.funds.executeCapitalCallClaim(...)`
5. Inspect or execute the rollover into the `refund-only` artifact with:
   - `sdk.funds.inspectCapitalCallRollover(...)`
   - `sdk.funds.executeCapitalCallRollover(...)`
6. Inspect or execute the LP refund from the `refund-only` artifact with:
   - `sdk.funds.inspectCapitalCallRefund(...)`
   - `sdk.funds.executeCapitalCallRefund(...)`
7. Verify the capital call artifact with `sdk.funds.verifyCapitalCall(...)`
8. Sign and verify a canonical receipt envelope with:
   - `sdk.funds.signPositionReceipt(...)`
   - `sdk.funds.verifyPositionReceipt(...)`
9. Prepare and verify a distribution claim with:
   - `sdk.funds.prepareDistribution(...)`
   - `sdk.funds.verifyDistribution(...)`
10. Inspect or execute the LP distribution claim with:
   - `sdk.funds.inspectDistributionClaim(...)`
   - `sdk.funds.executeDistributionClaim(...)`
11. Reconcile the attested receipt envelope with one or more distributions:
   - `sdk.funds.reconcilePosition(...)`
12. Prepare and verify descriptor-only closing with:
   - `sdk.funds.prepareClosing(...)`
   - `sdk.funds.verifyClosing(...)`
13. Export evidence and finality payloads with:
   - `sdk.funds.exportEvidence(...)`
   - `sdk.funds.exportFinalityPayload(...)`

Packaged external-consumer smoke for that same public fund flow:

```bash
npm run e2e:fund-consumer
```

Public Fund example:
- `./examples/show-fund-claim-close-flow.ts`
- `./examples/show-fund-refund-flow.ts`

## Recursive Policy Flow

1. Describe binding support with `sdk.outputBinding.describeSupport()`
2. Describe the template manifest with `sdk.policies.describeTemplate(...)`
3. Validate params with `sdk.policies.validateTemplateParams(...)`
4. Issue the first constrained UTXO with `sdk.policies.issue(...)`
5. Optionally pre-build the next output descriptor with `sdk.policies.buildOutputDescriptor(...)`
6. Prepare / inspect / execute the next hop with:
   - `sdk.policies.prepareTransfer(...)`
   - `sdk.policies.inspectTransfer(...)`
   - `sdk.policies.executeTransfer(...)`
7. Verify and export evidence with:
   - `sdk.policies.verifyState(...)`
   - `sdk.policies.verifyTransfer(...)`
   - `sdk.policies.exportEvidence(...)`

## CLI Entry Points

Binding support:
- `binding describe-support`
- `binding evaluate-support`

Policy flow:
- `policy list-templates`
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

Bond business flow:
- `bond define`
- `bond verify`
- `bond issue`
- `bond prepare-redemption`
- `bond inspect-redemption`
- `bond execute-redemption`
- `bond verify-redemption`
- `bond build-settlement`
- `bond verify-settlement`
- `bond prepare-closing`
- `bond inspect-closing`
- `bond execute-closing`
- `bond verify-closing`
- `bond export-evidence`
- `bond export-finality-payload`

Fund business flow:
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
- `fund prepare-distribution`
- `fund inspect-distribution-claim`
- `fund execute-distribution-claim`
- `fund verify-distribution`
- `fund reconcile-position`
- `fund prepare-closing`
- `fund verify-closing`
- `fund export-evidence`
- `fund export-finality-payload`

## Shared Output Binding Metadata

Policy, Bond, and Fund now expose the same generalized binding metadata:
- `supportedForm`
- `reasonCode`
- `autoDerived`
- `fallbackReason`
- `bindingInputs`

Current support matrix:
- `explicit-v1`: explicit asset + explicit amount + null nonce + empty range proof
- `raw-output-v1`: caller supplies `assetBytesHex`, `amountBytesHex`, `nonceBytesHex`, plus either `scriptPubKeyHex` or `scriptPubKeyHashHex`, and either `rangeProofHex` or `rangeProofHashHex`
- manual-hash path: caller supplies `nextOutputHash`
- unsupported form: deterministic fallback to `script-bound` with an explicit reason code
- unsupported auto-derive features are explicit:
  - `assetInput=non-bitcoin-nonhex`
  - `assetForm=confidential`
  - `amountForm=confidential`
  - `nonceForm=confidential`
  - `rangeProofForm=non-empty`
- surjection proofs are excluded from `output_hash(0)` in Elements, so they are intentionally outside the current derivation contract

`sdk.outputBinding.describeSupport()` is the canonical support matrix. Policy, Bond, and Fund reuse that same shared engine and expose the same reason codes / fallback semantics.

Versioned schemas:
- `PolicyTemplateManifest.manifestVersion = "policy-template-manifest/v1"`
- `PolicyVerificationReport.schemaVersion = "policy-verification-report/v1"`
- `PolicyEvidenceBundle.schemaVersion = "policy-evidence-bundle/v1"`

## Reproducible Validation Commands

- `npm run e2e:policy-local`
- `POLICY_OUTPUT_BINDING_MODE=script-bound npm run e2e:policy-testnet`
- `POLICY_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:policy-testnet`
- `npm run e2e:policy-consumer`
- `npm run e2e:bond-consumer`
- `npm run e2e:fund-local`
- `npm run e2e:fund-consumer`
- `BOND_OUTPUT_BINDING_MODE=script-bound npm run e2e:bond-testnet`
- `BOND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:bond-testnet`
- `FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet`
- `FUND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:fund-testnet`
- `FUND_FLOW_MODE=refund FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet`
- `FUND_OUTPUT_BINDING_MODE=script-bound FUND_DISTRIBUTION_AMOUNTS_SAT=2000,4000 ... npm run e2e:fund-testnet`
- `FUND_OUTPUT_BINDING_MODE=descriptor-bound FUND_DISTRIBUTION_AMOUNTS_SAT=2000,4000 ... npm run e2e:fund-testnet`

Latest Bond testnet reruns:
- `script-bound`
  - funding txid: `1c982864ef6c83da4eb7f8018edc4cbdff439db7c6366984b3f85ad4937e2c4f`
  - execution txid: `d659c4bdce6b32650ff58ac37ccaa55209a9f04d5dc4595f956fad034089f580`
- `descriptor-bound`
  - funding txid: `72d0015b51a74c3cc81f7abb74a4f6f894c7f7bbd1e83647939459d7b40e504f`
  - execution txid: `85e0830a7b2ba33ca37d5f11bd981938418fc472e98657095680ada71387974c`

Fund security model summary:
- on-chain enforced:
  - `open` capital call allows manager claim only
  - `refund-only` capital call allows LP refund only
  - claim cutoff height is committed into the `open` artifact
- off-chain attested:
  - `LPPositionReceiptEnvelope`
  - manager attestation over receipt hash and sequence
- operationally enforced:
  - watcher/keeper executes rollover after cutoff so refund-only semantics become active

Current fund runtime truth, latest txids, and rerun commands live in:
- `../design/fund-runtime-validation.md`
