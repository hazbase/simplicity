import { createSimplicityClient } from '@hazbase/simplicity';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectDir = process.cwd();
const artifactPath = path.join(projectDir, 'artifact.json');
const privkeyHex = process.env.SIMPLICITY_PRIMARY_PRIVKEY || '<primary-privkey-hex>';
const signerXonly = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

const sdk = createSimplicityClient({
  network: 'liquidtestnet',
  rpc: {
    url: process.env.ELEMENTS_RPC_URL || 'http://127.0.0.1:18884',
    username: process.env.ELEMENTS_RPC_USER || '<rpc-user>',
    password: process.env.ELEMENTS_RPC_PASSWORD || '<rpc-password>',
    wallet: process.env.ELEMENTS_RPC_WALLET || 'simplicity-test',
  },
  toolchain: {
    simcPath: process.env.SIMC_PATH || 'simc',
    halSimplicityPath: process.env.HAL_SIMPLICITY_PATH || 'hal-simplicity',
    elementsCliPath: process.env.ELEMENTS_CLI_PATH || 'eltc',
  },
});

async function main() {
  const height = await sdk.rpc.call('getblockcount');
  const minHeight = Math.max(1, Number(height) - 10);
  const receiver = await sdk.rpc.call('getnewaddress', [], 'simplicity-test');

  const compiled = await sdk.compileFromPreset({
    preset: 'p2pkLockHeight',
    params: {
      MIN_HEIGHT: minHeight,
      SIGNER_XONLY: signerXonly,
    },
    artifactPath,
  });

  const deployment = compiled.deployment();
  const fundTxId = await sdk.rpc.call('sendtoaddress', [deployment.contractAddress, 0.00002], 'simplicity-test');
  const contract = compiled.at();
  const utxos = await contract.waitForFunding({ minAmountSat: 1000, pollIntervalMs: 2000, timeoutMs: 30000 });
  const inspectResult = await contract.inspectCall({
    wallet: 'simplicity-test',
    toAddress: receiver,
    signer: { type: 'schnorrPrivkeyHex', privkeyHex },
  });
  const dryRun = await contract.execute({
    wallet: 'simplicity-test',
    toAddress: receiver,
    signer: { type: 'schnorrPrivkeyHex', privkeyHex },
    broadcast: false,
  });
  const broadcast = await contract.execute({
    wallet: 'simplicity-test',
    toAddress: receiver,
    signer: { type: 'schnorrPrivkeyHex', privkeyHex },
    broadcast: true,
  });

  const result = {
    package: '@hazbase/simplicity',
    receiver,
    minHeight,
    artifactPath,
    deployment,
    fundTxId,
    contractUtxos: utxos,
    inspectSummaryHash: inspectResult.summaryHash,
    inspectOutputs: inspectResult.summary.outputs,
    dryRunSummaryHash: dryRun.summaryHash,
    rawTxHex: dryRun.rawTxHex,
    txId: broadcast.txId,
    broadcasted: broadcast.broadcasted,
  };
  await writeFile(path.join(projectDir, 'preset-flow-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
