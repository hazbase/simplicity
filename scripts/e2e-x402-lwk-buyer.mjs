#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const LIQUID_X402_SCHEME = "exact-liquid-pset";
const DEFAULT_LWK_MODULE = "lwk_node";

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help || flags.h) {
    printHelp();
    return;
  }

  const url = resolveUrl(flags);
  const dryRun = Boolean(flags["dry-run"] || flags.dryRun);
  const noSubmit = dryRun || Boolean(flags["no-submit"] || flags.noSubmit);
  const json = Boolean(flags.json);
  const printHeader = Boolean(flags["print-header"] || flags.printHeader);

  const initial = await fetch(url, {
    headers: {
      accept: "application/json, application/x-x402+json;q=0.9, text/html;q=0.8, */*;q=0.1",
    },
  });
  const initialBytes = Buffer.from(await initial.arrayBuffer());
  const initialText = initialBytes.toString("utf8");

  if (initial.status !== 402) {
    const result = {
      paid: false,
      status: initial.status,
      contentType: initial.headers.get("content-type") || "",
      bytes: initialBytes.length,
      note: initial.ok ? "resource did not require payment" : "resource did not return x402 payment requirements",
    };
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (initial.ok) {
      console.log(`No payment required (${initial.status}).`);
      await writeOrPreviewBody({ flags, response: initial, bytes: initialBytes });
      return;
    }
    throw new Error(`Expected HTTP 402 payment requirements, got ${initial.status}`);
  }

  const x402 = parseX402ResponseBody(initialText);
  const requirement = selectLiquidRequirement(x402, flags);
  const summary = summarizeRequirement(requirement);

  if (dryRun) {
    const result = {
      paid: false,
      dryRun: true,
      url,
      ...summary,
    };
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printSummary("Liquid x402 requirement", result);
      console.log("Dry run only; no wallet was scanned and no payment was signed.");
    }
    return;
  }

  const mnemonic = resolveSecret(flags.mnemonic, "LIQUID_X402_E2E_MNEMONIC");
  if (!mnemonic) {
    throw new Error(
      "LIQUID_X402_E2E_MNEMONIC is required to sign a lightweight Liquid payment. " +
      "Use --dry-run to inspect requirements without signing.",
    );
  }

  const sdk = await loadBuiltSdk();
  const lwkModuleName = String(flags["lwk-module"] || flags.lwkModule || process.env.LIQUID_X402_E2E_LWK_MODULE || DEFAULT_LWK_MODULE);
  const payment = await sdk.prepareLiquidX402LwkWasmPayment({
    requirements: requirement,
    mnemonic,
    payer: String(flags.payer || process.env.LIQUID_X402_E2E_PAYER || "").trim() || undefined,
    esploraUrl: String(flags.esplora || flags["esplora-url"] || process.env.LIQUID_X402_E2E_ESPLORA_URL || "").trim() || undefined,
    feeRate: optionalNumber(flags["fee-rate"] || flags.feeRate || process.env.LIQUID_X402_E2E_FEE_RATE),
    scan: !(flags["no-scan"] || flags.noScan || process.env.LIQUID_X402_E2E_NO_SCAN === "1"),
    scanToIndex: optionalInteger(flags["scan-to-index"] || flags.scanToIndex || process.env.LIQUID_X402_E2E_SCAN_TO_INDEX),
    importLwk: async () => normalizeImportedModule(await import(lwkModuleName)),
  });

  const signed = {
    paid: false,
    signed: true,
    submitted: false,
    url,
    ...summary,
    payer: payment.paymentPayload?.payer || "",
    descriptor: payment.descriptor,
    dwid: payment.dwid || "",
    summaryHash: payment.summaryHash,
    psetBase64Bytes: Buffer.byteLength(payment.psetBase64, "utf8"),
    xPaymentBytes: Buffer.byteLength(payment.xPayment, "utf8"),
    ...(printHeader ? { xPayment: payment.xPayment } : {}),
  };

  if (noSubmit) {
    if (json) {
      console.log(JSON.stringify(signed, null, 2));
    } else {
      printSummary("Liquid x402 payment signed", signed);
      if (printHeader) console.log(`X-PAYMENT: ${payment.xPayment}`);
      console.log("No submit mode; signed payment was not sent to the share URL.");
    }
    return;
  }

  const paid = await fetch(url, {
    headers: {
      accept: "*/*",
      "x-payment": payment.xPayment,
    },
  });
  const paidBytes = Buffer.from(await paid.arrayBuffer());
  const result = {
    ...signed,
    paid: paid.ok,
    submitted: true,
    status: paid.status,
    contentType: paid.headers.get("content-type") || "",
    bytes: paidBytes.length,
    xPaymentResponse: decodeXPaymentResponseHeader(paid.headers.get("x-payment-response")),
  };

  if (!paid.ok) {
    result.errorBody = parseErrorBody(paidBytes);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }
    printSummary("Liquid x402 payment rejected", result);
    console.error(formatErrorBody(result.errorBody));
    process.exitCode = 1;
    return;
  }

  if (json) {
    await writeOrPreviewBody({ flags, response: paid, bytes: paidBytes, result });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printSummary("Liquid x402 payment settled", result);
  if (result.xPaymentResponse) {
    const tx = result.xPaymentResponse.transactionHash || result.xPaymentResponse.txHash || result.xPaymentResponse.txId || "";
    if (tx) console.log(`   tx: ${tx}`);
  }
  await writeOrPreviewBody({ flags, response: paid, bytes: paidBytes, result });
  if (result.output) console.log(`   saved: ${result.output}`);
}

function parseFlags(args) {
  const flags = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      flags._.push(arg);
      continue;
    }
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

function resolveUrl(flags) {
  const raw = String(flags.url || flags._[0] || process.env.LIQUID_X402_E2E_URL || "").trim();
  if (!raw) throw new Error("Usage: npm run e2e:x402-lwk-buyer -- <share-url> [--dry-run|--no-submit]");
  try {
    return new URL(raw).toString();
  } catch {
    throw new Error("Liquid x402 E2E URL must be an absolute http(s) URL");
  }
}

function resolveSecret(flagValue, envName) {
  return String(flagValue || process.env[envName] || "").trim();
}

async function loadBuiltSdk() {
  try {
    const imported = await import("../dist/index.js");
    return normalizeImportedModule(imported);
  } catch (error) {
    throw new Error(
      "Build the SDK before running this E2E script (`npm run build`). " +
      `Import failed: ${error?.message || error}`,
    );
  }
}

function normalizeImportedModule(imported) {
  return imported?.default && !imported.prepareLiquidX402LwkWasmPayment
    ? imported.default
    : imported;
}

function parseX402ResponseBody(input) {
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}

  const match = String(input).match(
    /<script[^>]+type=["']application\/x-x402\+json["'][^>]*>([\s\S]*?)<\/script>/iu,
  );
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch {}
  }
  throw new Error("HTTP 402 response did not contain a valid x402 JSON body");
}

function selectLiquidRequirement(x402, flags) {
  const accepts = Array.isArray(x402?.accepts)
    ? x402.accepts
    : Array.isArray(x402?.x402?.accepts)
    ? x402.x402.accepts
    : [];
  const network = String(flags.network || process.env.LIQUID_X402_E2E_NETWORK || "").trim();
  const asset = String(flags.asset || process.env.LIQUID_X402_E2E_ASSET || "").trim().toLowerCase();
  const requirement = accepts.find((item) => {
    if (!item || String(item.scheme || "") !== LIQUID_X402_SCHEME) return false;
    if (network && String(item.network || "") !== network) return false;
    if (asset) {
      const offeredAsset = String(item.extra?.asset || item.asset || "").toLowerCase();
      if (offeredAsset !== asset && !String(item.asset || "").toLowerCase().includes(asset)) return false;
    }
    return true;
  });
  if (!requirement) {
    const offered = accepts.map((item) => `${item?.scheme || "?"}:${item?.network || "?"}:${item?.extra?.asset || item?.asset || "?"}`).join(", ") || "none";
    throw new Error(`No Liquid x402 payment option found (offered: ${offered})`);
  }
  return requirement;
}

function summarizeRequirement(requirement) {
  const decimals = Number(requirement.extra?.decimals ?? 8);
  const assetKey = String(requirement.extra?.asset || "").toLowerCase() || "usdt";
  return {
    scheme: String(requirement.scheme || ""),
    network: String(requirement.network || ""),
    assetKey,
    assetId: String(requirement.asset || requirement.extra?.assetId || ""),
    amountAtomic: String(requirement.maxAmountRequired || "0"),
    amount: formatAtomicAmount(requirement.maxAmountRequired || "0", decimals),
    payTo: String(requirement.payTo || ""),
    resource: String(requirement.resource || ""),
    paymentRequestId: String(requirement.extra?.paymentRequestId || ""),
    expiresAt: String(requirement.extra?.expiresAt || ""),
    maxFeeSat: requirement.extra?.maxFeeSat ? String(requirement.extra.maxFeeSat) : "",
  };
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Expected a positive number, got ${value}`);
  return parsed;
}

function optionalInteger(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Expected a non-negative integer, got ${value}`);
  return parsed;
}

function formatAtomicAmount(amountAtomic, decimals) {
  const amount = BigInt(String(amountAtomic));
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const frac = amount % scale;
  const trimmed = frac.toString().padStart(decimals, "0").replace(/0+$/u, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

function decodeXPaymentResponseHeader(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const parsed = JSON.parse(Buffer.from(normalized + padding, "base64").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { raw };
  } catch {
    return { raw };
  }
}

async function writeOrPreviewBody({ flags, response, bytes, result = {} }) {
  const output = String(flags.output || flags.o || process.env.LIQUID_X402_E2E_OUTPUT || "").trim();
  if (output) {
    const outputPath = path.resolve(output);
    await fs.writeFile(outputPath, bytes);
    result.output = outputPath;
    return;
  }
  if (flags.json) return;

  const contentType = response.headers.get("content-type") || "";
  if (/^text\/|json|html|xml/u.test(contentType)) {
    console.log(bytes.toString("utf8").slice(0, 800));
  } else {
    console.log(`Received ${bytes.length} bytes (${contentType || "unknown content type"}). Use --output <file> to save it.`);
  }
}

function parseErrorBody(bytes) {
  const text = bytes.toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 500) };
  }
}

function formatErrorBody(body) {
  if (!body || typeof body !== "object") return String(body || "");
  const code = body.error || body.code || body.errorCode || "";
  const message = body.message || body.detail || body.reason || "";
  return [code, message].filter(Boolean).join(": ") || JSON.stringify(body);
}

function printSummary(title, summary) {
  console.log("");
  console.log(title);
  console.log(`   amount: ${summary.amount} ${summary.assetKey.toUpperCase()} on ${summary.network}`);
  console.log(`   to: ${summary.payTo}`);
  if (summary.payer) console.log(`   from: ${summary.payer}`);
  if (summary.resource) console.log(`   resource: ${summary.resource}`);
  if (summary.summaryHash) console.log(`   summaryHash: ${summary.summaryHash}`);
  console.log("");
}

function printHelp() {
  console.log(`Usage:
  npm run e2e:x402-lwk-buyer -- <share-url> [options]

Options:
  --dry-run             Fetch and print Liquid x402 requirements only.
  --no-submit           Sign a PSET and build X-PAYMENT, but do not retry the URL.
  --print-header        Include the signed X-PAYMENT header in output.
  --output <file>       Save the unlocked response body.
  --network <network>   Prefer a Liquid network, e.g. liquidtestnet.
  --asset <asset>       Prefer an asset, e.g. usdt or lbtc.
  --esplora-url <url>   Override LWK Esplora URL.
  --lwk-module <name>   Import lwk_node or lwk_wasm (default: lwk_node).
  --fee-rate <sat/vB>   Override LWK fee rate.
  --scan-to-index <n>   Use LWK fullScanToIndex for faster controlled scans.
  --no-scan             Skip LWK wallet scan.
  --json                Print machine-readable JSON.

Environment:
  LIQUID_X402_E2E_URL
  LIQUID_X402_E2E_MNEMONIC
  LIQUID_X402_E2E_ESPLORA_URL
  LIQUID_X402_E2E_PAYER
  LIQUID_X402_E2E_OUTPUT
  LIQUID_X402_E2E_LWK_MODULE

Install a local signer module before signing:
  npm install --no-save lwk_node@^0.17.1
`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
