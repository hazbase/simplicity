#!/usr/bin/env node

const DEFAULT_LWK_MODULE = "lwk_node";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help || flags.h) {
    printHelp();
    return;
  }

  const lwkModuleName = String(flags["lwk-module"] || flags.lwkModule || process.env.LIQUID_X402_E2E_LWK_MODULE || DEFAULT_LWK_MODULE);
  const lwk = normalizeImportedModule(await import(lwkModuleName));
  const generated = Boolean(flags.generate);
  const mnemonic = generated
    ? generateMnemonic(lwk, flags.generate)
    : String(flags.mnemonic || process.env.LIQUID_X402_E2E_MNEMONIC || "").trim();

  if (!mnemonic) {
    throw new Error(
      "LIQUID_X402_E2E_MNEMONIC is required to derive a funding address. " +
      "Use --generate to create a new test wallet mnemonic.",
    );
  }

  const sdk = await loadBuiltSdk();
  const result = await sdk.deriveLiquidX402LwkWasmAddress({
    mnemonic,
    network: String(flags.network || process.env.LIQUID_X402_E2E_NETWORK || "liquidtestnet"),
    index: optionalInteger(flags.index || process.env.LIQUID_X402_E2E_ADDRESS_INDEX),
    importLwk: async () => lwk,
  });

  const body = {
    ...result,
    ...(generated || flags["print-mnemonic"] || flags.printMnemonic ? { mnemonic } : {}),
  };

  if (flags.json) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  console.log("");
  console.log(`Liquid x402 LWK funding address (${body.network})`);
  console.log(`   address: ${body.address}`);
  if (body.unconfidentialAddress) console.log(`   unconfidential: ${body.unconfidentialAddress}`);
  console.log(`   index: ${body.index}`);
  if (body.dwid) console.log(`   dwid: ${body.dwid}`);
  if (body.policyAsset) console.log(`   policyAsset: ${body.policyAsset}`);
  if (body.mnemonic) {
    console.log("");
    console.log("Generated mnemonic for this test wallet:");
    console.log(body.mnemonic);
  }
  console.log("");
}

function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const withoutPrefix = arg.slice(2);
    const equals = withoutPrefix.indexOf("=");
    if (equals >= 0) {
      flags[withoutPrefix.slice(0, equals)] = withoutPrefix.slice(equals + 1);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags[withoutPrefix] = next;
      index += 1;
    } else {
      flags[withoutPrefix] = true;
    }
  }
  return flags;
}

async function loadBuiltSdk() {
  try {
    return normalizeImportedModule(await import("../dist/index.js"));
  } catch (error) {
    throw new Error(
      "Build the SDK before running this E2E script (`npm run build`). " +
      `Import failed: ${error?.message || error}`,
    );
  }
}

function normalizeImportedModule(imported) {
  return imported?.default && !imported.deriveLiquidX402LwkWasmAddress
    ? imported.default
    : imported;
}

function generateMnemonic(lwk, value) {
  const words = value === true ? 12 : optionalInteger(value);
  if (![12, 15, 18, 21, 24].includes(words)) {
    throw new Error("--generate must be one of 12, 15, 18, 21, or 24");
  }
  return lwk.Mnemonic.fromRandom(words).toString();
}

function optionalInteger(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Expected a non-negative integer, got ${value}`);
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  npm run e2e:x402-lwk-address -- [options]

Options:
  --generate [words]    Generate a new test wallet mnemonic and address.
  --mnemonic <words>    Derive from an explicit mnemonic.
  --index <n>           Derive a specific receive address index.
  --network <network>   liquidtestnet or liquidv1 (default: liquidtestnet).
  --lwk-module <name>   Import lwk_node or lwk_wasm (default: lwk_node).
  --print-mnemonic      Print mnemonic even when supplied through env/flag.
  --json                Print machine-readable JSON.

Environment:
  LIQUID_X402_E2E_MNEMONIC
  LIQUID_X402_E2E_NETWORK
  LIQUID_X402_E2E_ADDRESS_INDEX
  LIQUID_X402_E2E_LWK_MODULE

Install a local signer module first:
  npm install --no-save lwk_node@^0.17.1
`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
