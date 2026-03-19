# Trusted Definitions and Issuance State

This directory contains the reference JSON and `.simf` files used by the public Bond business flow, the public LP fund settlement flow, the public recursive policy templates, and the repayment-first receivable business layer.

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
- `fund-capital-call-refund-only.simf`: capital-call contract that allows LP refund only after rollover, with optional payout output binding
- `fund-distribution-claim.simf`: one-shot LP distribution claim contract
- `receivable-definition.json`: sample receivable definition document
- `receivable-state-originated.json`: sample genesis receivable state
- `receivable-state-funded.json`: sample funded receivable state linked from genesis
- `receivable-state-repaid.json`: sample repaid receivable state linked from funded
- `receivable-funding-claim.json`: sample funding-claim descriptor for the funded state
- `receivable-repayment-claim.json`: sample repayment-claim descriptor for the repaid state
- `receivable-funding-claim.simf`: runtime claim contract for funding payout, with optional payout output binding
- `receivable-repayment-claim.simf`: runtime claim contract for repayment payout, with optional payout output binding
- `recursive-delay-required.simf`: public `required` recursive policy contract for 1tx direct hops
- `recursive-delay-optional.simf`: public `optional` / `none` recursive policy contract for 1tx plain-or-recursive branching
- `recursive-policy-transfer-machine.simf`: retained for internal or experimental routed regressions only

## Public Architecture

The public SDK now has four core layers plus one lightweight domain layer:
- `sdk.outputBinding`: canonical binding support matrix and fallback behavior
- `sdk.policies`: generic recursive covenant / transfer engine
- `sdk.bonds`: Bond business layer for definition, issuance, redemption, settlement, closing, and evidence/finality
- `sdk.funds`: LP fund settlement business layer for capital calls, distributions, closing, and evidence/finality
- `sdk.receivables`: repayment-first receivable business layer for lineage-aware permissioned RWA pilots

We are **not** introducing `sdk.rwas` yet. The shared abstraction point today is Policy Core + output binding, not a premature RWA super-layer.

## Building The Next RWA Domain

If you want to add another permissioned RWA domain on top of the current SDK, the recommended minimum pattern is:

1. Define one canonical state or receipt document per business object.
2. Add an explicit hash link such as `previousStateHash` or `previousReceiptHash`.
3. Verify the full lineage with the shared helpers in:
   - `src/core/lineage.ts`
   - `src/core/reporting.ts`
4. Return the shared lineage vocabulary in your domain report:
   - `lineageKind`
   - `latestOrdinal`
   - `allHashLinksVerified`
   - `identityConsistent`
   - `fullLineageVerified`
5. Reuse `buildVerificationTrustSummary(...)` when exporting evidence or finality payloads so lightweight trust summaries stay consistent across domains.

That keeps new domains aligned with the same “latest state + lineage + finality” model already used by `sdk.funds`, `sdk.bonds`, and now the repayment-first `sdk.receivables` layer.

## Receivable Flow

The receivable layer now has a repayment-first runtime path. It still shows how the shared lineage/reporting model extends into the next permissioned RWA case, but it no longer stops at pure SDK lineage helpers.

Suggested flow:

1. Load or define the canonical receivable definition with `sdk.receivables.define(...)`
2. Verify or load the latest state with `sdk.receivables.verify(...)` / `sdk.receivables.load(...)`
3. Prepare or verify funding / repayment / write-off transitions with:
   - `sdk.receivables.prepareFunding(...)`
   - `sdk.receivables.prepareRepayment(...)`
   - `sdk.receivables.prepareWriteOff(...)`
4. Prepare, inspect, execute, or verify runtime funding claims with:
   - `sdk.receivables.prepareFundingClaim(...)`
   - `sdk.receivables.inspectFundingClaim(...)`
   - `sdk.receivables.executeFundingClaim(...)`
   - `sdk.receivables.verifyFundingClaim(...)`
5. Prepare, inspect, execute, or verify runtime repayment claims with:
   - `sdk.receivables.prepareRepaymentClaim(...)`
   - `sdk.receivables.inspectRepaymentClaim(...)`
   - `sdk.receivables.executeRepaymentClaim(...)`
   - `sdk.receivables.verifyRepaymentClaim(...)`
6. When you maintain the canonical state history, verify it with `sdk.receivables.verifyStateHistory(...)`
7. Prepare or verify terminal close-out with:
   - `sdk.receivables.prepareClosing(...)`
   - `sdk.receivables.verifyClosing(...)`
8. Export evidence and finality payloads with:
   - `sdk.receivables.exportEvidence(...)`
   - `sdk.receivables.exportFinalityPayload(...)`
9. Reuse the returned shared lineage/trust summary fields:
   - `lineageKind`
   - `latestOrdinal`
   - `allHashLinksVerified`
   - `identityConsistent`
   - `fullLineageVerified`

Public receivable confidence commands:
- `npm run e2e:receivable-consumer`
- `npm run e2e:receivable-local`
- `RECEIVABLE_OUTPUT_BINDING_MODE=script-bound npm run e2e:receivable-testnet`
- `RECEIVABLE_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:receivable-testnet`

Reference example:
- `./examples/show-receivable-lineage.ts`
- `./examples/show-receivable-business-flow.ts`

## Recommended Bond Flow

1. Load or define the bond artifact with `sdk.bonds.define(...)`
2. Verify or load it with `sdk.bonds.verify(...)` / `sdk.bonds.load(...)`
3. When you maintain a canonical issuance-state history, verify it with `sdk.bonds.verifyIssuanceHistory(...)`
4. Prepare a redemption with `sdk.bonds.prepareRedemption(...)`
5. Inspect or execute the runtime redemption with `sdk.bonds.inspectRedemption(...)` / `sdk.bonds.executeRedemption(...)`
6. Verify the runtime redemption artifact with `sdk.bonds.verifyRedemption(...)`
7. Build or verify the settlement envelope with `sdk.bonds.buildSettlement(...)` / `sdk.bonds.verifySettlement(...)`
8. Prepare, inspect, execute, and verify closing with:
   - `sdk.bonds.prepareClosing(...)`
   - `sdk.bonds.inspectClosing(...)`
   - `sdk.bonds.executeClosing(...)`
   - `sdk.bonds.verifyClosing(...)`
9. Export evidence and finality payloads with:
   - `sdk.bonds.exportEvidence(...)`
   - `sdk.bonds.exportFinalityPayload(...)`
   - when available, also pass the canonical issuance history to surface shared lineage trust fields such as `lineageKind`, `latestOrdinal`, `fullLineageVerified`, and `fullHistoryVerified`

Packaged external-consumer smoke for that same public business flow:

```bash
npm run e2e:bond-consumer
```

That packaged smoke now also covers:
- `sdk.bonds.verifyIssuanceHistory(...)`
- canonical issuance history passed into evidence / finality export

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
   - `outputBindingMode`, `nextOutputHash`, `outputForm`, and `rawOutput` are optional advanced inputs for binding the refund payout
7. Verify the capital call artifact with `sdk.funds.verifyCapitalCall(...)`
8. Sign and verify a canonical receipt envelope with:
   - `sdk.funds.signPositionReceipt(...)`
   - `sdk.funds.verifyPositionReceipt(...)`
   - `sdk.funds.verifyPositionReceiptChain(...)` when you want full lineage validation from `sequence=0`
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
   - when `sequence > 0`, pass the immediate previous `LPPositionReceiptEnvelope` as well
   - when available, also pass the full attested receipt chain to get shared receipt-chain trust fields such as `lineageKind`, `latestOrdinal`, `fullLineageVerified`, and `fullChainVerified`
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
- `bond verify-issuance-history`
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

Receivable business flow:
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
  - funding txid: `90f521bf3c457e0f919bc6876a9f4185fb4e095cda03130cdda640639fc9bcb2`
  - execution txid: `2fd8b5ca82a8cb451d5305d3ec104f0f1864754db27c429d040ab054883eeac2`
  - `issuanceLineageTrust.fullLineageVerified = true`
  - `issuanceLineageTrust.fullHistoryVerified = true`
- `descriptor-bound`
  - funding txid: `7e5bb2fedd562e977388b007d0901cf0334e802402bc6f2a85080571a84b348d`
  - execution txid: `b3c2819edb4e55cbc311fb85e033b9528ae7fcb8de196301059ef98120eb8170`
  - `issuanceLineageTrust.fullLineageVerified = true`
  - `issuanceLineageTrust.fullHistoryVerified = true`

Latest Bond close-out reruns (`BOND_REDEEM_AMOUNT=1000000`):
- `script-bound`
  - funding txid: `5486ae5e47540f9d882cb5e080f40679051f913a69cf4414cb187effcca3820c`
  - execution txid: `6db4b307ec5fb9e770cb6b506e281bde6415ed890f86bc08f67cce74b8211298`
  - closing hash: `68ede25e5ea442eb182321c149002b4930f9ffca384e5e7e113f82346edcb5ae`
  - `issuanceLineageTrust.fullLineageVerified = true`
  - `issuanceLineageTrust.fullHistoryVerified = true`
- `descriptor-bound`
  - funding txid: `882e9c71b8c20c8a13a39b848d765a30965a8c2d43e9a5ea2883ef85b35a9869`
  - execution txid: `d69a0c05eec79af34878bb07a7dcc42f445d6d8522c9452ba5673ea97d1a818b`
  - closing hash: `b1a0605ad3a0063a837d00b39c6d1f9d7a62b588c5548f52ab38a6f67c1f5aab`
  - `issuanceLineageTrust.fullLineageVerified = true`
  - `issuanceLineageTrust.fullHistoryVerified = true`

Fund security model summary:
- on-chain enforced:
  - `open` capital call allows manager claim only
  - `refund-only` capital call allows LP refund only, and can still bind the payout output
  - claim cutoff height is committed into the `open` artifact
- off-chain attested:
  - `LPPositionReceiptEnvelope`
  - manager attestation over receipt hash and sequence
- operationally enforced:
  - watcher/keeper executes rollover after cutoff so refund-only semantics become active

Public fund confidence commands:
- `npm run e2e:fund-consumer`
- `FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet`
- `FUND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:fund-testnet`
- `FUND_FLOW_MODE=refund FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet`

Public bond confidence commands:
- `npm run e2e:bond-consumer`
- `BOND_OUTPUT_BINDING_MODE=script-bound npm run e2e:bond-testnet`
- `BOND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:bond-testnet`
- `BOND_OUTPUT_BINDING_MODE=script-bound BOND_REDEEM_AMOUNT=1000000 npm run e2e:bond-testnet`
- `BOND_OUTPUT_BINDING_MODE=descriptor-bound BOND_REDEEM_AMOUNT=1000000 npm run e2e:bond-testnet`
