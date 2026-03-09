import crypto from "node:crypto";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function sha256HexUtf8(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function summarize(value: unknown): { canonicalJson: string; hash: string } {
  const canonicalJson = stableStringify(value);
  return { canonicalJson, hash: sha256HexUtf8(canonicalJson) };
}
