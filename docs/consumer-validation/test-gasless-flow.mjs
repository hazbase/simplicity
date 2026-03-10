import { createSimplicityClient } from '@hazbase/simplicity';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectDir = process.cwd();
const artifactPath = process.env.SIMPLICITY_ARTIFACT || path.join(projectDir, 'artifact.json');
const privkeyHex = process.env.SIMPLICITY_PRIMARY_PRIVKEY || '<primary-privkey-hex>';

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
  const compiled = await sdk.loadArtifact(artifactPath);
  const deployment = compiled.deployment();
  const receiver = await sdk.rpc.call('getnewaddress', [], 'simplicity-test');
  const fundTxId = await sdk.rpc.call('sendtoaddress', [deployment.contractAddress, 0.00002], 'simplicity-test');
  const contract = compiled.at();
  const utxos = await contract.waitForFunding({ minAmountSat: 1000, pollIntervalMs: 2000, timeoutMs: 30000 });
  const relayer = sdk.relayer({
    baseUrl: process.env.SIMPLICITY_RELAYER_URL || 'http://127.0.0.1:3136',
    apiKey: process.env.SIMPLICITY_RELAYER_API_KEY || '<relayer-api-key>',
  });
  const gasless = await contract.executeGasless({
    relayer,
    fromLabel: process.env.SIMPLICITY_FROM_LABEL || 'consumer-gasless-test',
    wallet: 'simplicity-test',
    toAddress: receiver,
    signer: { type: 'schnorrPrivkeyHex', privkeyHex },
  });

  const result = {
    package: '@hazbase/simplicity',
    artifactPath,
    deployment,
    receiver,
    fundTxId,
    contractUtxos: utxos,
    mode: gasless.mode,
    summaryHash: gasless.summaryHash,
    txId: gasless.txId,
    broadcasted: gasless.broadcasted,
  };
  await writeFile(path.join(projectDir, 'gasless-flow-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
