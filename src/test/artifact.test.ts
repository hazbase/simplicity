import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArtifact } from "../core/artifact";

test("normalizeArtifact upgrades v5 artifact to v6", () => {
  const artifact = normalizeArtifact({
    version: 5,
    createdAt: "2026-03-09T00:24:45.818Z",
    simfTemplatePath: "./p2pk_lockheight.simf.tmpl",
    params: {
      minHeight: 2344430,
      signerXonly: "79be",
    },
    compiled: {
      program: "prog",
      cmr: "cmr",
      internalKey: "internal",
      contractAddress: "tex1",
    },
    toolchain: {
      simcPath: "/usr/bin/simc",
      halSimplicity: "hal-simplicity 0.2.0",
    },
  });

  assert.equal(artifact.version, 6);
  assert.equal(artifact.kind, "simplicity-artifact");
  assert.equal(artifact.compiled.contractAddress, "tex1");
  assert.equal(artifact.legacy?.params?.minHeight, 2344430);
});
