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
  - uses the latest attested receipt envelope
  - requires `distributedAmount === fundedAmount`

Enforcement split:
- on-chain enforced:
  - claim vs refund branch separation
  - cutoff height commitment in the `open` artifact
  - output binding behavior for claim / distribution payouts
- off-chain attested:
  - receipt hash
  - receipt sequence
  - manager attestation
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
- latest fresh reruns on March 18, 2026:
  - `script-bound` claim-close
    - funding txid: `a488a5c6e7c56ecca8d5860bf495590d38cfe8087f678f5664241b8eb90396de`
    - claim txid: `43974a18c048f67f3399b614ea476ffb87c4622d8083636d1aeacbb51747d94d`
    - distribution claim txids:
      - `90fb3abdb000d9f66a18b1e2061fa06b56a51fe64513d358c47cc992c374e209`
      - `0644820b7fee4c11a9a66dbd1a14733ed2420435449717f4895d589f55b05b30`
    - final receipt envelope hash: `f1f294c0f33405f31abbdd8a3a258e57c614bd381b61a7fba2ae420a35e77c70`
    - closing hash: `19dfd60dfe04cbe1f145a2ab112ef5cf30a087e084837fa7bcce3ed80df72a2a`
    - rerun command:
      - `FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet`
  - `descriptor-bound` claim-close
    - funding txid: `201b66c3843b9999703b08d242c547ca1d1f35619ca99e916d93e4ed70338bc6`
    - claim txid: `c27621a27cb3b99b4d960cfa4be98de925beed7c3a7bd799fd3f88a3cb680762`
    - distribution claim txids:
      - `d4066986e90a9faa000032198307955583e318c0afd09d98691db7b07dc1b022`
      - `bbfe830790ef5a86a5595d0dccdd2a344efc7d3eebe7a597be1f2a5c2330dabb`
    - final receipt envelope hash: `05b3e4b2c33518b22bd28939cef36972e7fe0c7273b24a6867fba40a0e374fce`
    - closing hash: `b1ff75e989628130ec56e753f7bc48cc0648b82272c90dfee03f7582879835dd`
    - rerun command:
      - `FUND_OUTPUT_BINDING_MODE=descriptor-bound npm run e2e:fund-testnet`
  - `script-bound` refund
    - funding txid: `3adf9025c4656d099752f2e5f43738495fbad712177b75f9330c05273eff12ff`
    - rollover txid: `8b1224e808ad9824d7bf85924a07d62c75c038987a4163b2e450c455b962ed9d`
    - refund txid: `6be225448ff062e1f2e8992cf3319601098b7b19edb0ea27823487e9a881f415`
    - rerun command:
      - `FUND_FLOW_MODE=refund FUND_OUTPUT_BINDING_MODE=script-bound npm run e2e:fund-testnet`

## Caveats

- strict cutoff is delivered as a rollover-window guarantee, not as a single-artifact consensus upper-bound claim rule
- between cutoff height and rollover confirmation, the refund path is still operationally dependent on the watcher/keeper
- `LPPositionReceiptEnvelope` is off-chain canonical state, not a transferable on-chain position token
- `sdk.funds.reconcilePosition(...)` is the canonical way to roll receipts forward after one or more distributions before closing
- `descriptor-bound` follows the shared output binding support matrix:
  - `explicit-v1`
  - `raw-output-v1`
  - manual `nextOutputHash`
- unsupported confidential/generalized auto-derive paths still fall back deterministically to `script-bound`
