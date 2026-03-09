import test from "node:test";
import assert from "node:assert/strict";
import { RelayerClient } from "../gasless/RelayerClient";
import { RelayerError } from "../core/errors";

test("RelayerClient parses successful request response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ psetId: "id", psetBase64: "pset", summary: { summaryHash: "hash" } }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  try {
    const client = new RelayerClient({ baseUrl: "http://localhost:3000", apiKey: "key" });
    const result = await client.requestPset({ amount: 0.1, toAddress: "tex1", fromLabel: "user-1" });
    assert.equal(result.psetId, "id");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RelayerClient converts error response to RelayerError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "boom" } }), {
      status: 409,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const client = new RelayerClient({ baseUrl: "http://localhost:3000", apiKey: "key" });
    await assert.rejects(() => client.getPsetStatus("id"), RelayerError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
