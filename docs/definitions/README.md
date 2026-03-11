# Trusted Definitions and Issuance State

This directory shows the intended flow for trusted definition JSON support and trusted issuance state support.

Files:
- `bond-definition.json`: off-chain bond definition document
- `bond-anchor.simf`: a custom Simplicity contract that is compiled with `DEFINITION_HASH` and `DEFINITION_ID` injected from the definition document
- `bond-issuance-state.json`: off-chain issuance state document
- `bond-issuance-anchor.simf`: a custom Simplicity contract that commits both `DEFINITION_HASH` and `STATE_HASH`

Recommended flow:
1. Load the JSON definition with `sdk.loadDefinition(...)`
2. Load the JSON issuance state with `sdk.loadStateDocument(...)`
3. Compile the contract with:
   - `definition: { ..., anchorMode: "on-chain-constant-committed" }`
   - `state: { ..., anchorMode: "on-chain-constant-committed" }`
4. Save the artifact with the embedded definition hash anchor and issuance state hash anchor
5. Later, verify the JSON documents against the artifact with:
   - `sdk.verifyDefinitionAgainstArtifact(...)`
   - `sdk.verifyStateAgainstArtifact(...)`
6. Use `sdk.bonds.verifyBond(...)` or `sdk.bonds.loadBond(...)` for combined retrieval + invariant checking

Trust model:
- The JSON body remains off-chain
- The canonical SHA-256 hash of the JSON is stored in the artifact and injected at compile time
- In `on-chain-constant-committed` mode, `bond-anchor.simf` also executes `require_definition_anchor()`, which uses `DEFINITION_HASH` in contract logic
- In `bond-issuance-anchor.simf`, the contract also executes `require_state_anchor()`, which uses `STATE_HASH` in contract logic
- That means the definition hash materially changes the compiled program, CMR, and contract address
- The issuance state hash also materially changes the compiled program, CMR, and contract address
- Retrieval verifies both:
  - the JSON still matches the artifact hash anchor
  - the source file still contains the blessed on-chain helper pattern when re-checked by the SDK

Two modes exist:
- `artifact-hash-anchor`: JSON integrity is anchored in the artifact only
- `on-chain-constant-committed`: JSON integrity is anchored in the artifact and also committed into the contract program itself

Important limitation:
- artifact JSON alone is not treated as proof of on-chain enforcement
- if the original `.simf` source file is unavailable at verification time, the SDK can still report the claimed anchor mode, but `onChainAnchorVerified` will be `false`
- this milestone fixes the issuance record as a trusted document; it does not yet implement a full on-chain state machine for holder balances, coupon processing, or redemption lifecycle
