# Full Covenant-Oriented Output Binding Design

## Purpose
This note captures what we can honestly bind on-chain today with SimplicityHL on Liquid, based on the SDK's current bond lifecycle implementation and the transaction introspection primitives visible in local SimplicityHL examples.

The goal is not to over-claim "full covenant support" yet. The goal is to identify the strongest next binding layer we can implement without pretending we already have a complete arithmetic state machine enforced purely by on-chain runtime logic.

## Current Baseline
The SDK can already commit the following to contract logic:

- `DEFINITION_HASH`
- `STATE_HASH`
- `PREVIOUS_STATE_HASH`
- `REDEEM_AMOUNT_256`
- `TRANSITION_KIND_256`
- status progression codes
- principal arithmetic inputs
- `NEXT_CONTRACT_ADDRESS_HASH_256`
- `SETTLEMENT_DESCRIPTOR_HASH`

It can also execute the two-step runtime flow:

1. old state contract -> redemption machine
2. redemption machine -> next state contract

This is strong document and transition commitment, but it is not yet full runtime output binding.

## What SimplicityHL Appears To Expose Locally
From local examples, we can already see the following usable transaction introspection building blocks:

- `jet::num_outputs()`
- `jet::current_script_hash()`
- `jet::output_script_hash(index)`
- `jet::output_is_fee(index)`
- `jet::output_hash(index)`
- `jet::outputs_hash()`
- `jet::input_hash(index)`
- `jet::input_utxo_hash(index)`
- `jet::current_index()`
- `jet::version()`
- `jet::lock_time()`
- `jet::tap_env_hash()`

Examples in the local SimplicityHL tree show two especially relevant patterns:

- `last_will.simf`: output count and script-hash level recursive covenant checks
- `sighash_single.simf` / `sighash_all_anyonecanpay.simf`: per-output or all-output hash commitment through custom sighash construction

## Immediate Design Conclusion
The next realistic step is **descriptor-bound output binding**, not yet a full arithmetic covenant.

That means:

1. Keep committing business documents and transitions as canonical hashes.
2. Add a covenant-oriented descriptor for the settlement output shape.
3. Use available output introspection to bind at least:
   - number of outputs
   - presence and position of fee output
   - next output script hash
   - optionally a committed output hash when the exact output structure can be modeled deterministically

## Recommended Intermediate Artifact
Introduce an `OutputBindingDescriptor` inside the bond domain.

Suggested contents:

- `bondId`
- `issuanceId`
- `previousStateHash`
- `nextStateHash`
- `nextContractAddress`
- `nextOutputScriptHash`
- `nextAmountSat`
- `assetId`
- `feeOutputIndex`
- `nextOutputIndex`
- `numOutputs`
- `settlementDescriptorHash`

This should be canonicalized and hashed just like other trusted documents.

## What We Can Likely Enforce Next
### Level 1: Script-bound settlement
Use output introspection to enforce:

- exactly `N` outputs
- output `i` has script hash equal to the next state contract script hash
- output `j` is fee

This is the cleanest next covenant step because local examples already demonstrate script-hash and output-count checks.

### Level 2: Output-hash-bound settlement
If we can deterministically construct the exact expected output hash for the next state output, then we can commit:

- `EXPECTED_NEXT_OUTPUT_HASH`

and enforce:

- `output_hash(next_index) == EXPECTED_NEXT_OUTPUT_HASH`

This would be much stronger because it can bind script + asset + amount + nonce-related output serialization, depending on what `output_hash` covers in Elements.

### Level 3: All-outputs-bound settlement
Use `outputs_hash()` to commit the entire output set.

This is stronger still, but operationally more brittle because any extra output ordering or fee handling change invalidates the covenant. It is probably best used after we standardize the settlement transaction shape.

## What Still Looks Risky / Open
These are still open design questions and should not be over-claimed yet.

### 1. Exact amount enforcement
We are currently committing `nextAmountSat` in documents and machine parameters, but not yet proving that the runtime next output amount must equal that value on-chain.

The most promising path is `output_hash(index)` if its semantics are stable enough for deterministic reconstruction.

### 2. Asset-level enforcement
We need to confirm whether the combination of `output_hash(index)` or other Elements jets is enough to bind explicit asset identity at the output level in the exact way we need.

### 3. Full arithmetic relation enforcement
We still do not have a contract that proves on-chain that:

- `previousOutstanding - redeemAmount = nextOutstanding`
- `previousRedeemed + redeemAmount = nextRedeemed`

The machine currently commits those values. It does not yet derive and enforce the relation from runtime-updated state content.

## Proposed Next Contract Milestones
### Milestone A: Script-bound machine
Add a new bond machine contract that enforces:

- exact output count
- next output script hash equals committed next state contract script hash
- fee output present at fixed index

### Milestone B: Output-hash machine
Investigate whether the SDK can deterministically precompute the exact expected next output hash and then enforce it with `jet::output_hash(index)`.

### Milestone C: Full settlement outputs hash
If transaction shape is stable enough, bind the full `outputs_hash()`.

### Milestone D: Arithmetic state machine
Only after output binding is stable should we attempt to move the state arithmetic itself fully into covenant logic.

## Practical Recommendation
For the next implementation round, we should target **Milestone A** first.

Why:

- local SimplicityHL examples already support it conceptually
- it gives us a meaningful move from "committed transition intent" to "runtime output-shape enforcement"
- it is much safer than jumping straight to a full arithmetic covenant

## Honest Claim We Can Make Today
Today the SDK can honestly say:

- bond definition can be trusted and on-chain committed
- issuance state can be trusted and on-chain committed
- redemption transition can be trusted and on-chain committed
- settlement envelope can be trusted and on-chain committed

It cannot yet honestly say:

- runtime next output amount is fully enforced by covenant logic
- runtime next output asset is fully enforced by covenant logic
- full arithmetic state transition is enforced end-to-end on-chain

## References Used For This Design
Local references consulted while forming this note:

- `SimplicityHL/examples/last_will.simf`
- `SimplicityHL/examples/sighash_single.simf`
- `SimplicityHL/examples/sighash_all_anyonecanpay.simf`
- current bond contracts in `docs/definitions/`
