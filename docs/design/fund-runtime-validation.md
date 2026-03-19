# Fund Runtime Validation

This note tracks the reproducible runtime validation story for the public LP fund settlement layer.

## Scope

Current public target:
- `sdk.funds.prepareCapitalCall(...)`
- `sdk.funds.executeCapitalCallClaim(...)`
- `sdk.funds.executeCapitalCallRollover(...)`
- `sdk.funds.executeCapitalCallRefund(...)`
- `sdk.funds.signPositionReceipt(...)`
- `sdk.funds.verifyPositionReceipt(...)`
- `sdk.funds.verifyPositionReceiptChain(...)`
- `sdk.funds.prepareDistribution(...)`
- `sdk.funds.executeDistributionClaim(...)`
- `sdk.funds.reconcilePosition(...)`
- `sdk.funds.prepareClosing(...)`
- `sdk.funds.exportEvidence(...)`
- `sdk.funds.exportFinalityPayload(...)`

Current non-goals:
- LP registry / cap-table semantics
- waterfall / NAV / allocation calculation
- wallet/RPC-driven confidential output auto-reconstruction beyond the shared `sdk.outputBinding` support matrix
- on-chain transferable LP position receipts

## Validation Sources

- local/unit confidence:
  - `npm test`
  - `npm run e2e:fund-local`
  - `npm run e2e:fund-consumer`
- runtime confidence:
  - `FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet`
  - `FUND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:fund-testnet`
  - `FUND_FLOW_MODE=refund FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet`

## Security Model

Current canonical flow:
- `open` capital call
  - manager claim is allowed
  - rollover into `refund-only` is allowed after `claimCutoffHeight`
- `refund-only` capital call
  - LP refund is allowed
  - manager claim is not available
- `LPPositionReceiptEnvelope`
  - off-chain canonical receipt
  - signed by `managerXonly`
  - carries `sequence` and `previousReceiptHash`
- closing
  - uses a definition-bound attested receipt envelope
  - for `sequence > 0`, requires the immediate previous attested envelope
  - requires `distributedAmount === fundedAmount`

Enforcement split:
- on-chain enforced:
  - claim vs refund branch separation
  - cutoff height commitment in the `open` artifact
  - output binding behavior for claim / refund / distribution payouts
- off-chain attested:
  - receipt hash
  - receipt sequence
  - manager attestation
  - immediate predecessor continuity for `sequence > 0`
  - optional full receipt-chain continuity from genesis to latest
- operationally enforced:
  - watcher/keeper executes rollover after cutoff to make refund-only semantics effective

Watcher/keeper responsibilities:
- monitor `open` capital calls until `claimCutoffHeight`
- submit the rollover transaction promptly once cutoff is reached
- wait for the rollover confirmation before treating LP refund as available
- alert if an `open` capital call remains unrolled after cutoff

## Runtime Story

The testnet runner is resumable. By default it keeps binding-mode-and-flow-specific runtime files under `/tmp`.

Examples:
- `fund-e2e-testnet-script-bound-claim-close.runtime.json`
- `fund-e2e-testnet-descriptor-bound-claim-close.runtime.json`
- `fund-e2e-testnet-script-bound-refund.runtime.json`

The runtime state captures:
- definition path
- open / refund-only / claimed / refunded capital-call paths
- open / refund-only artifact paths
- position-receipt-envelope path
- position-receipt-chain path
- previous position-receipt-envelope path
- distribution paths
- funding txids
- execution txids
- flow mode
- current phase

Reruns resume from the last durable phase instead of reissuing a fresh capital call every time.

To force a fresh runtime instead of a resume, set a unique:
- `FUND_RUNTIME_STATE_PATH`
- `FUND_ID`
- `FUND_CALL_ID`
- `FUND_POSITION_ID`
- `FUND_DISTRIBUTION_ID`
- `FUND_DISTRIBUTION_IDS`
- `FUND_CLOSING_ID`
- `FUND_POSITION_RECEIPT_CHAIN_PATH`

## Phase Log

The testnet script emits structured phase logs to stderr.

Claim-close phases:
- `capital-call-prepared`
- `capital-call-funded`
- `waiting-capital-call-confirmations`
- `waiting-capital-call-utxo`
- `capital-call-claimed`
- `distribution-prepared`
- `distribution-funded`
- `waiting-distribution-confirmations`
- `waiting-distribution-utxo`
- `distribution-claimed`
- `receipt-reconciled`
- `closing-prepared`
- `finalized`

Refund phases:
- `capital-call-prepared`
- `capital-call-funded`
- `waiting-capital-call-confirmations`
- `waiting-capital-call-utxo`
- `waiting-claim-cutoff`
- `capital-call-rolled-over`
- `waiting-refund-only-utxo`
- `finalized`

## Required Environment

Required:
- `ELEMENTS_RPC_URL`
- `ELEMENTS_RPC_USER`
- `ELEMENTS_RPC_PASSWORD`

Optional:
- `ELEMENTS_RPC_WALLET`
- `SIMC_PATH`
- `HAL_SIMPLICITY_PATH`
- `ELEMENTS_CLI_PATH`
- `FUND_OUTPUT_BINDING_MODE`
- `FUND_FLOW_MODE`
- `FUND_CURRENCY_ASSET_ID`
- `FUND_CAPITAL_CALL_AMOUNT_SAT`
- `FUND_DISTRIBUTION_AMOUNT_SAT`
- `FUND_DISTRIBUTION_AMOUNTS_SAT`
- `FUND_FEE_SAT`
- `FUND_CAPITAL_CALL_FUNDING_SAT`
- `FUND_DISTRIBUTION_FUNDING_SAT`
- `FUND_DISTRIBUTION_FUNDING_SATS`
- `FUND_APPROVED_ATS`
- `FUND_CLAIM_CUTOFF_BLOCKS`
- `FUND_REQUIRED_CONFIRMATIONS`
- `FUND_WAIT_TIMEOUT_MS`
- `FUND_WAIT_POLL_MS`
- `FUND_MANAGER_PRIVKEY`
- `FUND_LP_PRIVKEY`

## Default Behavior

- the script derives a temporary `FundDefinition` from `docs/definitions/fund-definition.json`
- it derives a temporary `CapitalCallState` from `docs/definitions/fund-capital-call-state.json`
- `currencyAssetId` defaults to `getsidechaininfo.pegged_asset` unless overridden
- claim-close flow is:
  - LP-funded `open` capital call UTXO
  - manager claim
  - signed `LPPositionReceiptEnvelope`
  - one or more distribution claim contracts
  - manager-attested receipt reconciliation
  - descriptor-only closing and finality export
- refund flow is:
  - LP-funded `open` capital call UTXO
  - cutoff wait
  - rollover into `refund-only`
  - LP refund
  - evidence / finality export

## Current Status

Local smoke:
- `npm run e2e:fund-local`
- validates compile / verify / receipt envelope / closing / finality wiring without relying on live contract spends

Packaged consumer smoke:
- `npm run e2e:fund-consumer`
- validates `sdk.funds` from a fresh external consumer project

Testnet runtime:
- the runner supports:
  - `script-bound` claim-close
  - `descriptor-bound` claim-close
  - explicit `open -> rollover -> refund-only` refund flow
- latest fresh reruns on March 19, 2026:
  - `script-bound` claim-close
    - funding txid: `a7676264c0afab65d2357fd04f743cb3544bde24bb6839ffb21459fe08fb311b`
    - claim txid: `d6cea7140e96d9db7cc803cdb382233e789ac1c79df5d616deb2e59502290bc7`
    - distribution claim txid: `fa430a540723d5ea8799423ac03b3f66a69fd689e305fd15311f39d17ff0d0ef`
    - final receipt envelope hash: `3288b9fe2ddea6a2cd801fcea63540e165fb2ee48e15c6a3e59fa236b8a3f807`
    - closing hash: `1960560c3bec9865b94637191253b55622ef1e4f2ef97bd57e1d17196c8339fe`
    - canonical receipt chain length: `2`
    - `fullChainVerified = true`
    - rerun command:
      - `FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet`
  - `descriptor-bound` claim-close
    - funding txid: `bf7b2fffbe83367a00b3dceaa0a603b74405ea04ea9eca040562f04817a5515d`
    - claim txid: `fa393943bbe15432ac07ade5852f903bcc7bd489c5db6f76204110d1f4591b76`
    - distribution claim txid: `47ba261ae2005661d4febf4b59b2fb812005c8ece65479a75b3d3a0e7fc68cb8`
    - final receipt envelope hash: `3916dd1ad73bfbffd88fa66e61d82b369ba51ebac0c9d36141f04b727a517e42`
    - closing hash: `9af65eb24d4226d899e6d26b01cb7e99d3921e49ce3cd2d955fa0c4bb5edb760`
    - canonical receipt chain length: `2`
    - `fullChainVerified = true`
    - rerun command:
      - `FUND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:fund-testnet`
  - `script-bound` refund
    - funding txid: `4bc21f88e7fb03b3ee916de57647621a7d445f172a482481a7dceeddac6f1b56`
    - rollover txid: `7f53e98ca0f935bd6a13781392acc2ff4257b0135e96fb19f81afc68947cd6a6`
    - refund txid: `e11ebad54259c59e61e41b1cfd6f501490645eaab997661ff3854ca4cbc6e4ba`
    - rerun command:
      - `FUND_FLOW_MODE=refund FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet`

## Caveats

- strict cutoff is delivered as a rollover-window guarantee, not as a single-artifact consensus upper-bound claim rule
- between cutoff height and rollover confirmation, the refund path is still operationally dependent on the watcher/keeper
- `LPPositionReceiptEnvelope` is off-chain canonical state, not a transferable on-chain position token
- `sdk.funds.reconcilePosition(...)` is the canonical way to roll receipts forward after one or more distributions before closing
- `sdk.funds.verifyPositionReceipt(...)` and closing verification now require the immediate previous envelope when `sequence > 0`
- `sdk.funds.verifyPositionReceiptChain(...)` is the stronger check when the operator can provide the full canonical receipt chain
- the default claim-close rerun now persists that canonical chain into a sidecar JSON file so the shared receipt-chain trust fields can be reproduced from runtime state alone:
  - `lineageKind`
  - `latestOrdinal`
  - `allHashLinksVerified`
  - `identityConsistent`
  - `fullLineageVerified`
  - `fullChainVerified`
- `descriptor-bound` follows the shared output binding support matrix:
  - `explicit-v1`
  - `raw-output-v1`
  - manual `nextOutputHash`
- unsupported confidential/generalized auto-derive paths still fall back deterministically to `script-bound`
