# Trusted Definitions

This directory shows the intended flow for trusted definition JSON support.

Files:
- `bond-definition.json`: off-chain bond definition document
- `bond-anchor.simf`: a custom Simplicity contract that is compiled with `DEFINITION_HASH` and `DEFINITION_ID` injected from the definition document

Recommended flow:
1. Load the JSON definition with `sdk.loadDefinition(...)`
2. Compile the contract with `definition: { ..., anchorMode: "on-chain-constant-committed" }`
3. Save the artifact with the embedded definition hash anchor
4. Later, verify the JSON against the artifact with `sdk.verifyDefinitionAgainstArtifact(...)`
5. Use `contract.getTrustedDefinition(...)` to retrieve and verify from a deployed contract handle

Trust model:
- The JSON body remains off-chain
- The canonical SHA-256 hash of the JSON is stored in the artifact and injected at compile time
- In `on-chain-constant-committed` mode, `bond-anchor.simf` also executes `require_definition_anchor()`, which uses `DEFINITION_HASH` in contract logic
- That means the definition hash materially changes the compiled program, CMR, and contract address
- Retrieval verifies both:
  - the JSON still matches the artifact hash anchor
  - the source file still contains the blessed on-chain helper pattern when re-checked by the SDK

Two modes exist:
- `artifact-hash-anchor`: JSON integrity is anchored in the artifact only
- `on-chain-constant-committed`: JSON integrity is anchored in the artifact and also committed into the contract program itself

Important limitation:
- artifact JSON alone is not treated as proof of on-chain enforcement
- if the original `.simf` source file is unavailable at verification time, the SDK can still report the claimed anchor mode, but `onChainAnchorVerified` will be `false`
