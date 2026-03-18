# Consumer Validation

This directory captures a real external-consumer validation of `@hazbase/simplicity`.

The goal is to prove that the published npm package works from a blank Node.js project without importing this repo's source code directly.

## What Was Validated

The following scenarios were executed from a fresh project created under `/tmp` and installed with:

```bash
npm init -y
npm install @hazbase/simplicity
```

Validated scenarios:

| Scenario | Status | Notes |
| --- | --- | --- |
| Fresh install + JS import | Success | `createSimplicityClient` imported from the published package |
| CLI smoke | Success | `npx simplicity-cli presets list` |
| Preset flow (`p2pkLockHeight`) | Success | compile -> fund -> inspect -> execute(`broadcast=true`) |
| Custom `.simf` flow | Success | `compileFromFile(...)` -> fund -> inspect -> execute(`broadcast=true`) |
| Relayer-backed gasless flow | Success | `executeGasless(...)` from the external project |
| LP fund business flow | Success | `sdk.funds` open capital call / signed receipt envelope / two distributions / closing / finality smoke |

## Verified Transaction IDs

- Preset flow broadcast txid: `e45bf8b2261eb04f6d4ccc4cd85e95f2c65b36d18fc77844de6ffb1a89950cda`
- Custom `.simf` broadcast txid: `5f203d8049be3673903b264ae8bbbed008df785839d75aecf5c8a63bc9a4b296`
- Gasless broadcast txid: `b6c006ab6585e68381119ef94dd5c74c4a8fd916f3203d4c93c4267b50c1feed`

Packaged consumer smokes:
- `npm run e2e:policy-consumer`
- `npm run e2e:bond-consumer`
- `npm run e2e:fund-consumer`

## Files In This Directory

- `.env.example`: environment template for local validation
- `contract.simf`: minimal custom contract used in external validation
- `test-preset-flow.mjs`: built-in preset happy path
- `test-custom-flow.mjs`: custom `.simf` happy path
- `test-gasless-flow.mjs`: relayer-backed gasless path
- `scripts/e2e-fund-consumer.mjs`: packaged LP fund business-flow smoke in this repo, including signed receipt envelopes and two reconciliations before closing

## How To Reproduce

1. Create a new project outside this repo.
2. Run `npm init -y`.
3. Run `npm install @hazbase/simplicity`.
4. Copy the files from this directory into that project.
5. Fill in `.env.example` values for your environment.
6. Run one of the scripts with your preferred env loader.

Example:

```bash
node test-preset-flow.mjs
node test-custom-flow.mjs
node test-gasless-flow.mjs
```

## Important Assumptions

These scripts assume:
- `liquidtestnet`
- a wallet-enabled Elements RPC
- `simc` on PATH or provided through `SIMC_PATH`
- `hal-simplicity` on PATH or provided through `HAL_SIMPLICITY_PATH`
- `eltc` on PATH or provided through `ELEMENTS_CLI_PATH`
- for gasless validation, a relayer that can sponsor contract execution

## Practical Takeaways

- The published package works from a blank external project.
- The README quickstart model matches real usage.
- Built-in presets are the easiest onboarding path.
- Custom `.simf` authoring is also viable from the published package.
- Gasless execution works, but it depends on a trusted relayer and a wallet-capable RPC setup.
- The packaged business-layer surfaces also work from a blank external project, including `sdk.funds` with signed receipt envelopes.
