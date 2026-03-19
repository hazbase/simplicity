import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { buildConsumerNpmEnv, installPackedSdkForConsumer } from "./consumerInstall.mjs";

const execFileAsync = promisify(execFile);

async function main() {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const workDir = await mkdtemp(path.join(tmpdir(), "simplicity-receivable-consumer-"));
  const npmEnv = buildConsumerNpmEnv(workDir);

  await writeFile(
    path.join(workDir, "package.json"),
    JSON.stringify({
      name: "receivable-consumer-smoke",
      private: true,
      type: "module",
    }, null, 2),
    "utf8",
  );

  await installPackedSdkForConsumer({ repoRoot, workDir, npmEnv });

  const smokePath = path.join(workDir, "consumer-smoke.mjs");
  await writeFile(
    smokePath,
    `
import { createSimplicityClient } from "@hazbase/simplicity";
import {
  buildReceivableFundingClaimDescriptor,
  buildReceivableRepaymentClaimDescriptor,
} from "@hazbase/simplicity";

const sdk = createSimplicityClient({
  network: "liquidtestnet",
  rpc: {
    url: "http://127.0.0.1:18884",
    username: "user",
    password: "pass",
    wallet: "simplicity-test",
  },
  toolchain: {
    simcPath: "simc",
    halSimplicityPath: "hal-simplicity",
    elementsCliPath: "eltc",
  },
});

const definition = {
  receivableId: "REC-001",
  originatorEntityId: "originator-1",
  debtorEntityId: "debtor-1",
  currencyAssetId: "bitcoin",
  faceValue: 10000,
  dueDate: "2027-12-31T00:00:00Z",
  controllerXonly: "11".repeat(32),
};

const originated = {
  stateId: "REC-001-S0",
  receivableId: "REC-001",
  originatorEntityId: "originator-1",
  debtorEntityId: "debtor-1",
  holderEntityId: "originator-1",
  currencyAssetId: "bitcoin",
  controllerXonly: "11".repeat(32),
  faceValue: 10000,
  outstandingAmount: 10000,
  repaidAmount: 0,
  status: "ORIGINATED",
  createdAt: "2027-01-01T00:00:00Z",
  lastTransition: {
    type: "ORIGINATE",
    amount: 10000,
    at: "2027-01-01T00:00:00Z",
  },
};

const funded = await sdk.receivables.prepareFunding({
  definitionValue: definition,
  previousStateValue: originated,
  stateId: "REC-001-S1",
  holderEntityId: "fund-1",
  fundedAt: "2027-01-02T00:00:00Z",
});
const repaid = await sdk.receivables.prepareRepayment({
  definitionValue: definition,
  previousStateValue: funded.nextStateValue,
  stateId: "REC-001-S2",
  amount: 10000,
  repaidAt: "2027-02-01T00:00:00Z",
});
const fundingClaim = buildReceivableFundingClaimDescriptor({
  claimId: "REC-001-FUNDING-CLAIM",
  currentState: funded.nextStateValue,
});
const fundingClaimVerified = await sdk.receivables.verifyFundingClaim({
  definitionValue: definition,
  currentStateValue: funded.nextStateValue,
  stateHistoryValues: [originated, funded.nextStateValue],
  fundingClaimValue: fundingClaim,
});
const repaymentClaim = buildReceivableRepaymentClaimDescriptor({
  claimId: "REC-001-REPAYMENT-CLAIM",
  currentState: repaid.nextStateValue,
});
const repaymentClaimVerified = await sdk.receivables.verifyRepaymentClaim({
  definitionValue: definition,
  currentStateValue: repaid.nextStateValue,
  stateHistoryValues: [originated, funded.nextStateValue, repaid.nextStateValue],
  repaymentClaimValue: repaymentClaim,
});
const closing = await sdk.receivables.prepareClosing({
  definitionValue: definition,
  latestStateValue: repaid.nextStateValue,
  stateHistoryValues: [originated, funded.nextStateValue, repaid.nextStateValue],
  closingId: "REC-CLOSE-001",
  closedAt: "2027-02-02T00:00:00Z",
});
const finality = await sdk.receivables.exportFinalityPayload({
  definitionValue: definition,
  stateHistoryValues: [originated, funded.nextStateValue, repaid.nextStateValue],
  fundingClaimValue: fundingClaim,
  repaymentClaimValue: repaymentClaim,
  closingValue: closing.closingValue,
});

console.log(JSON.stringify({
  fundingVerified: funded.verified,
  fundingClaimVerified: fundingClaimVerified.verified,
  repaymentVerified: repaid.verified,
  repaymentClaimVerified: repaymentClaimVerified.verified,
  closingVerified: closing.verified,
  latestStatus: repaid.nextStateValue.status,
  fullLineageVerified: finality.trustSummary.lineage?.fullLineageVerified ?? false,
  closingReason: finality.closingReason,
  fundingClaimHash: finality.fundingClaimHash,
  repaymentClaimHash: finality.repaymentClaimHash,
  latestStateHash: finality.latestStateHash,
  closingHash: finality.closingHash,
}, null, 2));
`,
    "utf8",
  );

  const { stdout } = await execFileAsync("node", [smokePath], {
    cwd: workDir,
  });
  process.stdout.write(stdout);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
