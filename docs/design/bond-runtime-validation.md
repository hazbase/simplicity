# Bond Runtime Validation

This note tracks the reproducible runtime validation story for the public Bond business flow.

## Scope

Current target:
- public `sdk.bonds.executeRedemption(...)`
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

## Latest Status

Latest fresh `script-bound` rerun:

- command:
  - `BOND_OUTPUT_BINDING_MODE=script-bound npm run e2e:bond-testnet`
- lock distance / maturity offset:
  - `BOND_MATURITY_OFFSET=0`
- funding txid:
  - `1c982864ef6c83da4eb7f8018edc4cbdff439db7c6366984b3f85ad4937e2c4f`
- execution txid:
  - `d659c4bdce6b32650ff58ac37ccaa55209a9f04d5dc4595f956fad034089f580`
- settlement binding:
  - `script-bound`
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
  - `72d0015b51a74c3cc81f7abb74a4f6f894c7f7bbd1e83647939459d7b40e504f`
- execution txid:
  - `85e0830a7b2ba33ca37d5f11bd981938418fc472e98657095680ada71387974c`
- settlement binding:
  - `descriptor-bound`
- reason code:
  - `OK_EXPLICIT`
- observed phases:
  - `defined`
  - `prepared`
  - `funded`
  - `waiting-funding-confirmations`
  - `waiting-contract-utxo`
  - `executed`

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
