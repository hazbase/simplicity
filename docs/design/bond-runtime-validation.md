# Bond Runtime Validation

This note tracks the reproducible runtime validation story for the public Bond business flow.

## Scope

Current target:
- public `sdk.bonds.executeRedemption(...)`
- `sdk.bonds.verifyIssuanceHistory(...)`
- `sdk.bonds.exportEvidence(...)`
- `sdk.bonds.exportFinalityPayload(...)`
- `required`-style settlement path through the Bond business layer
- `script-bound`
- `descriptor-bound`

Current non-goals:
- coupon lifecycle
- registry / cap-table semantics
- wallet/RPC-backed confidential output auto-reconstruction beyond the shared `outputBinding` support matrix

## Validation Sources

- local/unit confidence:
  - `npm test`
  - `npm run e2e:bond-consumer`
- runtime confidence:
  - `BOND_OUTPUT_BINDING_MODE=script-bound npm run e2e:bond-testnet`
  - `BOND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:bond-testnet`

The testnet script is resumable. It keeps a runtime state file per binding mode under `/tmp` by default and resumes from:
- post-define
- post-prepare-redemption
- post-funding
- waiting-for-confirmations
- executed

It also persists a canonical issuance-history sidecar per binding mode under `/tmp` so the final runtime report can surface the shared lineage trust fields:

- `issuanceLineageTrust.lineageKind`
- `issuanceLineageTrust.latestOrdinal`
- `issuanceLineageTrust.allHashLinksVerified`
- `issuanceLineageTrust.identityConsistent`
- `issuanceLineageTrust.fullLineageVerified`
- `issuanceLineageTrust.fullHistoryVerified`

## Required Environment

The testnet runtime script expects:

- `ELEMENTS_RPC_URL`
- `ELEMENTS_RPC_USER`
- `ELEMENTS_RPC_PASSWORD`

Optional:

- `ELEMENTS_RPC_WALLET`
- `ELEMENTS_CLI_PATH` (legacy/experimental paths only; public Bond redemption now executes via RPC-backed shared executor)
- `SIMC_PATH`
- `HAL_SIMPLICITY_PATH`
- `BOND_OUTPUT_BINDING_MODE`
- `BOND_MATURITY_OFFSET`
- `BOND_REDEEM_AMOUNT`
- `BOND_NEXT_AMOUNT_SAT`
- `BOND_MAX_FEE_SAT`
- `BOND_FEE_SAT`
- `BOND_FUNDING_SAT`
- `BOND_REDEEMED_AT`
- `BOND_RUNTIME_STATE_PATH`
- `BOND_ARTIFACT_PATH`
- `BOND_DEFINITION_PATH`
- `BOND_ISSUANCE_PATH`
- `BOND_NEXT_ISSUANCE_PATH`
- `BOND_ISSUANCE_HISTORY_PATH`
- `BOND_SIGNER_PRIVKEY`
- `BOND_WAIT_TIMEOUT_MS`
- `BOND_WAIT_POLL_MS`
- `BOND_REQUIRED_CONFIRMATIONS`

## Default Behavior

- a temporary Bond definition is derived from the reference definition
- `maturityDate` is set to `currentHeight + BOND_MATURITY_OFFSET`
- the default offset is `0`, so the business-flow runtime test does not block on maturity unless you choose to
- next issuance state is generated via `sdk.bonds.prepareRedemption(...)`
- runtime execution is performed via `sdk.bonds.executeRedemption(...)`

## Phase Log

The script emits structured phase logs to stderr:

- `defined`
- `prepared`
- `funded`
- `waiting-funding-confirmations`
- `waiting-contract-utxo`
- `executed`

The final result also includes:
- `issuanceHistory`
- `issuanceLineageTrust`
- `evidence`
- `finality`

## Latest Status

Latest fresh `script-bound` rerun:

- command:
  - `BOND_OUTPUT_BINDING_MODE=script-bound npm run e2e:bond-testnet`
- lock distance / maturity offset:
  - `BOND_MATURITY_OFFSET=0`
- funding txid:
  - `90f521bf3c457e0f919bc6876a9f4185fb4e095cda03130cdda640639fc9bcb2`
- execution txid:
  - `2fd8b5ca82a8cb451d5305d3ec104f0f1864754db27c429d040ab054883eeac2`
- settlement binding:
  - `script-bound`
- issuance history:
  - chain length `2`
  - latest status `PARTIALLY_REDEEMED`
  - `fullLineageVerified = true`
  - `fullHistoryVerified = true`
- observed phases:
  - `defined`
  - `prepared`
  - `funded`
  - `waiting-funding-confirmations`
  - `waiting-contract-utxo`
  - `executed`

Latest fresh `descriptor-bound` rerun:

- command:
  - `BOND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:bond-testnet`
- lock distance / maturity offset:
  - `BOND_MATURITY_OFFSET=0`
- funding txid:
  - `7e5bb2fedd562e977388b007d0901cf0334e802402bc6f2a85080571a84b348d`
- execution txid:
  - `b3c2819edb4e55cbc311fb85e033b9528ae7fcb8de196301059ef98120eb8170`
- settlement binding:
  - `descriptor-bound`
- reason code:
  - `OK_EXPLICIT`
- issuance history:
  - chain length `2`
  - latest status `PARTIALLY_REDEEMED`
  - `fullLineageVerified = true`
  - `fullHistoryVerified = true`
- observed phases:
  - `defined`
  - `prepared`
  - `funded`
  - `waiting-funding-confirmations`
  - `waiting-contract-utxo`
  - `executed`

Latest fresh close-out reruns (`BOND_REDEEM_AMOUNT=1000000`):

- `script-bound`
  - command:
    - `BOND_OUTPUT_BINDING_MODE=script-bound BOND_REDEEM_AMOUNT=1000000 npm run e2e:bond-testnet`
  - funding txid:
    - `5486ae5e47540f9d882cb5e080f40679051f913a69cf4414cb187effcca3820c`
  - execution txid:
    - `6db4b307ec5fb9e770cb6b506e281bde6415ed890f86bc08f67cce74b8211298`
  - closing hash:
    - `68ede25e5ea442eb182321c149002b4930f9ffca384e5e7e113f82346edcb5ae`
  - issuance history:
    - chain length `3`
    - latest status `CLOSED`
    - `fullLineageVerified = true`
    - `fullHistoryVerified = true`
- `descriptor-bound`
  - command:
    - `BOND_OUTPUT_BINDING_MODE=descriptor-bound BOND_REDEEM_AMOUNT=1000000 npm run e2e:bond-testnet`
  - funding txid:
    - `882e9c71b8c20c8a13a39b848d765a30965a8c2d43e9a5ea2883ef85b35a9869`
  - execution txid:
    - `d69a0c05eec79af34878bb07a7dcc42f445d6d8522c9452ba5673ea97d1a818b`
  - closing hash:
    - `b1a0605ad3a0063a837d00b39c6d1f9d7a62b588c5548f52ab38a6f67c1f5aab`
  - issuance history:
    - chain length `3`
    - latest status `CLOSED`
    - `fullLineageVerified = true`
    - `fullHistoryVerified = true`

## Caveats

- Bond runtime validation depends on the current testnet/Elements node height and confirmation speed.
- Because Bond uses an absolute maturity height, the runtime script rewrites the sample definition to a temporary maturity aligned with the current chain height.
- For binding semantics, Bond follows the same shared support matrix as `sdk.outputBinding.describeSupport()`.
- Advanced generalized binding is available as:
  - `explicit-v1`
  - `raw-output-v1`
  - manual `nextOutputHash`
- `raw-output-v1` now accepts either raw script/range-proof bytes or pre-hashed `scriptPubKeyHashHex` / `rangeProofHashHex` components.
- Elements excludes surjection proofs from `output_hash(0)`, so they are intentionally outside the current derivation contract.
- Runtime validation here still targets the business flow itself (`script-bound` / `descriptor-bound`), not wallet-driven confidential output reconstruction.
- The current runtime script no longer depends on `findUtxos()` for contract discovery; it uses direct RPC scans so it can resume cleanly up to the spendable-contract-UTXO stage.
- The public Bond redemption runtime path now uses the RPC-backed shared executor, so Docker-backed `elements-cli` wrappers are no longer a blocker for the normal business-flow execute step.
- `sdk.bonds.verifyIssuanceHistory(...)` is the stronger lineage check when the operator can provide the canonical issuance-state history from the original `ISSUED` state through the latest runtime state.
- When you provide that canonical history, bond evidence/finality now surfaces the same lineage vocabulary as funds: `lineageKind`, `latestOrdinal`, `allHashLinksVerified`, `identityConsistent`, and `fullLineageVerified`.
