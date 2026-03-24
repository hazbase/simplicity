# Fund Cutoff Runbook

This runbook describes the public operating model for `sdk.funds` around capital-call cutoff.

The important boundary is:
- before rollover confirms, the `open` capital-call artifact still authorizes manager claim
- after rollover confirms, the `refund-only` artifact becomes the live contract for LP refunds

That means cutoff is **operationally enforced**, not purely consensus-enforced at the deadline itself.

## Roles

- `Manager`: may claim from the `open` artifact before cutoff
- `Watcher`: monitors cutoff height and capital-call status
- `Keeper`: submits the rollover transaction that activates the `refund-only` path
- `Operator`: archives evidence, receipts, and close-out material

In smaller pilots, one team can hold all four roles. In production-like pilots, they should still be tracked separately in runbooks and logs.

## Inputs To Monitor

Track these values for every live capital call:
- fund id and capital-call id
- cutoff height committed in the `open` artifact
- current artifact address and artifact hash
- manager-claim status
- rollover status
- expected refund-only artifact address

## Cutoff Procedure

1. Before cutoff, verify the `open` artifact and record the committed cutoff height.
2. Start watcher alerts before cutoff so the operator sees when the live chain is approaching the threshold.
3. At or immediately after cutoff, re-check whether the manager has already claimed from the `open` artifact.
4. If the capital call is still unclaimed, submit the rollover into the `refund-only` artifact.
5. Wait for the rollover transaction to confirm before treating LP refunds as active.
6. Verify the resulting `refund-only` artifact and archive its address, txid, and output-binding configuration.
7. Only after the rollover confirmation should operators route LP refunds through the `refund-only` flow.

## Evidence To Archive

For each cutoff event, keep:
- the `open` artifact
- the `refund-only` artifact
- rollover inspect output, if generated
- rollover execution txid
- any LP receipt or reconciliation material tied to the capital call
- exported evidence or finality payloads when close-out occurs

## Failure And Recovery

If rollover is delayed:
- do not treat the position as refund-active yet
- keep monitoring the `open` artifact until rollover confirms
- record the delay and the eventual rollover txid in operator notes

If the watcher or keeper is unavailable at cutoff:
- recover from the last verified `open` artifact
- re-run verification against the current chain tip
- submit rollover as soon as the operator regains access

If a refund path must be audited later:
- verify the `refund-only` artifact
- verify the capital-call state and any attested receipt chain
- export evidence and finality payloads from the same canonical inputs used in operations

## Practical Meaning

`sdk.funds` is already strong enough for permissioned pilot and controlled production-adjacent flows, but the cutoff boundary should be run like an operator procedure, not assumed to be automatic.
