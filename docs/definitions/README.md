# Trusted Definitions

This directory shows the intended flow for trusted definition JSON support.

Files:
- `bond-definition.json`: off-chain bond definition document
- `bond-anchor.simf`: a custom Simplicity contract that is compiled with `DEFINITION_HASH` and `DEFINITION_ID` injected from the definition document

Recommended flow:
1. Load the JSON definition with `sdk.loadDefinition(...)`
2. Compile the contract with `definition: { ... }`
3. Save the artifact with the embedded definition hash anchor
4. Later, verify the JSON against the artifact with `sdk.verifyDefinitionAgainstArtifact(...)`
5. Use `contract.getTrustedDefinition(...)` to retrieve and verify from a deployed contract handle

Trust model:
- The JSON body remains off-chain
- The canonical SHA-256 hash of the JSON is stored in the artifact and injected at compile time
- Retrieval verifies that the JSON you are reading still matches the definition that the contract/artifact was built against
