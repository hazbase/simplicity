# Recursive Policy Runtime Validation

This note captures the current practical runtime story for the public recursive policy SDK.

Reproducible commands:

- `npm run e2e:policy-local`
- `npm run e2e:policy-restricted-otc-local`
- `npm run e2e:policy-restricted-otc-testnet`
- `POLICY_OUTPUT_BINDING_MODE=script-bound npm run e2e:policy-testnet`
- `POLICY_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:policy-testnet`
- `npm run e2e:policy-consumer`

`npm run e2e:policy-testnet` now emits phase logs on stderr so a rerun can distinguish:

- `issued`
- `funded`
- `waiting-funding-confirmations`
- `waiting-contract-utxo`
- `executed`

The testnet runner is now resumable. By default it persists binding-mode-specific runtime files under `/tmp`:

- `policy-e2e-testnet-script-bound.runtime.json`
- `policy-e2e-testnet-descriptor-bound.runtime.json`

Those runtime state files capture:

- `contractAddress`
- `artifactPath`
- `statePath`
- `fundingTxId`
- `bindingMode`
- `phase`

If a rerun sees an existing runtime state file, it reuses the issued artifact/state, waits from the current phase, and returns the saved success payload once the execution phase is already complete.

The dedicated restricted OTC testnet runner uses a separate scenario namespace via `POLICY_SCENARIO=restricted-otc`, so its runtime files are distinct from the generic policy runner and can be resumed independently.

## Public model

The public policy flow is now 1tx-first.

- `required`
  - current constrained state -> next constrained state in 1 tx
  - enforcement label: `direct-hop`
- `optional`
  - current constrained state -> plain exit or next constrained state in 1 tx
  - recursive branch enforcement label: `conditional-hop`
- `none`
  - current constrained state -> plain terminate path in 1 tx
  - enforcement label: `sdk-path`

Legacy routed helpers and the router machine remain available only for internal or experimental regression coverage. They are no longer part of the public SDK or CLI guidance.

## What is already validated

- policy-aware issue on local Elements
- `required` mode 1tx direct hop with `lockDistanceBlocks=2` on testnet, `script-bound`:
  - rerun command:
    - `POLICY_OUTPUT_BINDING_MODE=script-bound npm run e2e:policy-testnet`
  - latest fresh funding txid: `ca1c5cf1e4b2b9b40336e0b3cef39703a5ce0dab4e627b1ab49e1562487acd0d`
  - latest fresh execution txid: `8bcb733a10ac0c9fe52bc4702b2094f658087e466ec8617f8044ec1a48024ff5`
  - input sequence set to `2`
  - current policy state -> next constrained policy output
- `required` mode 1tx direct hop:
  - current policy state -> next constrained policy output
- `optional` mode plain exit
- `optional` mode 1tx recursive branch
- restricted OTC-style transfer preview via `npm run e2e:policy-restricted-otc-local`
- dedicated restricted OTC testnet scenario entrypoint via `npm run e2e:policy-restricted-otc-testnet`
- `required` mode 1tx `descriptor-bound` direct hop with auto-derived `nextOutputHash` on testnet:
  - rerun command:
    - `POLICY_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:policy-testnet`
  - latest fresh funding txid: `8b89827f3420b25260760942abd52933daa7983f58db316fb0b40de07e89aceb`
  - latest fresh execution txid: `f134b5025c50dda7c7975ae04567c2e0d87ee437accc461f72b95ece1244eaf7`
- public 1tx policy flow through:
  - `sdk.policies.prepareTransfer(...)`
  - `sdk.policies.inspectTransfer(...)`
  - `sdk.policies.executeTransfer(...)`
  - `sdk.policies.verifyTransfer(...)`

## Current limitation

The local dynamic-federation docker fixture used during development still does not reliably support on-demand block generation for relative timelock E2E.

Observed failure:

- `generatetoaddress` can fail with a dynamic federation signblock witness error
- `getsidechaininfo` currently reports a non-trivial `current_signblock_asm`, so this local fixture is not the permissive `WSH(OP_TRUE)` setup that `generatetoaddress` expects during simple development mining

Because of that, the docker-only fixture is still limited to:

- `lockDistanceBlocks=0`

However, against the live testnet-connected environment, the public 1tx `required` flow has now also been runtime-validated with:

- `lockDistanceBlocks=2`

This still validates:

- 1tx direct-hop enforcement for `required`
- 1tx plain exit for `optional`
- 1tx recursive branch selection for `optional`
- next constrained output binding via `script-bound`
- next constrained output binding via `descriptor-bound` for explicit outputs
- public descriptor reports that now carry:
  - `supportedForm`
  - `reasonCode`
  - `nextOutputHash`
  - `autoDerived`
  - `fallbackReason`
  - `bindingInputs`
- versioned public schema:
  - `PolicyVerificationReport.schemaVersion = "policy-verification-report/v1"`
  - `PolicyEvidenceBundle.schemaVersion = "policy-evidence-bundle/v1"`

It does not yet fully validate in the docker-only fixture:

- waiting `+N` blocks and then spending

It also surfaced an SDK gap that is now fixed:

- policy inspect/execute now derives the contract input sequence from `lockDistanceBlocks`, so relative timelocks are not silently attempted with the default sequence anymore

## Recommended next environment work

For full relative-timelock runtime validation, use a setup that can mine blocks predictably:

- an Elements fixture with working signblock configuration
- or a local environment where `generatetoaddress` succeeds

At the moment, simply waiting on the existing local docker setup does not advance height either, so `lockDistanceBlocks=2` is blocked by the fixture itself rather than by the SDK contract path.

Known testnet caveat:

- confirmation speed varies, so the resumable state file is the supported way to survive long waits between `funded` and `executed`
- the dedicated OTC scenario also requires:
  - `ELEMENTS_RPC_URL`
  - `ELEMENTS_RPC_USER`
  - `ELEMENTS_RPC_PASSWORD`

## Restricted OTC scenario

The restricted OTC scenario intentionally stays inside `sdk.policies` rather than introducing a separate OTC business domain.

Scenario defaults:

- `propagationMode = required`
- enforcement label: `direct-hop`
- seller custodian -> approved buyer custodian only
- happy path:
  - `descriptor-bound`
  - `raw-output-v1`
- control path:
  - `script-bound`

Expected runtime summary fields:

- `scenario=restricted-otc`
- `enforcement=direct-hop`
- `approvedBuyerCustodianXonly`
- `bindingMode`
- `reasonCode`

Current environment status:

- `npm run e2e:policy-restricted-otc-local`
  - latest known result:
    - clean skip when `simc/hal-simplicity` are unavailable
- `npm run e2e:policy-restricted-otc-testnet`
  - dedicated entrypoint is now implemented
  - fresh txids have not been recorded in this environment yet because the required Elements RPC env vars were not set at run time

Once that exists, the same policy flow can be replayed with:

- `lockDistanceBlocks=2`
- then `lockDistanceBlocks=100`

and verified end-to-end without changing the public SDK surface.

## Current descriptor-bound scope

`descriptor-bound` is treated as a normal public feature for:

- `explicit-v1`
- `raw-output-v1`
- manual `nextOutputHash`

Supported today:

- `explicit-v1`
  - explicit asset
  - explicit amount
  - null nonce
  - empty range proof
  - asset input supplied as `bitcoin` or a 64-character asset id
- `raw-output-v1`
  - caller supplies `assetBytesHex`
  - caller supplies `amountBytesHex`
  - caller supplies `nonceBytesHex`
  - caller supplies either `scriptPubKeyHex` or `scriptPubKeyHashHex`
  - caller supplies either `rangeProofHex` or `rangeProofHashHex`

Elements excludes surjection proofs from `output_hash(0)`, so they are intentionally outside the current descriptor-bound derivation contract.

If a caller asks for `descriptor-bound` outside that supported form, the SDK now falls back to `script-bound` and records the fallback reason in the verification report instead of overstating runtime coverage.
That fallback path now also carries a stable `reasonCode`, so CLI output, JSON verification, and evidence bundles all explain the same downgrade in the same words.

Current non-goal in this phase:

- wallet/RPC-driven confidential output reconstruction
