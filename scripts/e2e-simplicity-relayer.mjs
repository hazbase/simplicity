import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createSimplicityClient } from '../dist/index.js';

const PORT = process.env.SIMPLICITY_RELAYER_PORT || '3126';
const RELAYER_URL = `http://127.0.0.1:${PORT}`;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_RELAYER_DIR = path.resolve(PACKAGE_DIR, '..', 'pset-server');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function startRelayer() {
  const child = spawn('npm', ['run', 'start'], {
    cwd: process.env.SIMPLICITY_RELAYER_DIR || DEFAULT_RELAYER_DIR,
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[relayer] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[relayer] ${chunk}`));
  return child;
}

async function main() {
  const relayer = startRelayer();
  try {
    await delay(5000);
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

    const compiled = await sdk.loadArtifact(
      process.env.SIMPLICITY_ARTIFACT || path.resolve(PACKAGE_DIR, 'artifact.json')
    );
    const toAddress = await sdk.rpc.call('getnewaddress', [], process.env.RECEIVER_WALLET || 'simplicity-test');
    const client = sdk.relayer({
      baseUrl: RELAYER_URL,
      apiKey: requireEnv('SIMPLICITY_RELAYER_API_KEY'),
    });
    const result = await compiled.at().executeGasless({
      relayer: client,
      fromLabel: process.env.SIMPLICITY_FROM_LABEL || 'sdk-e2e-script',
      wallet: process.env.ELEMENTS_RPC_WALLET || 'simplicity-test',
      toAddress,
      signer: {
        type: 'schnorrPrivkeyHex',
        privkeyHex: requireEnv('SIMPLICITY_PRIVKEY'),
      },
    });

    process.stdout.write(`${JSON.stringify({ relayerUrl: RELAYER_URL, toAddress, result }, null, 2)}\n`);
  } finally {
    relayer.kill('SIGTERM');
    await delay(500);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
