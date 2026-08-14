import { createHash } from "node:crypto";
import type { AnthropicRequest } from "./types.js";

const VOLATILE_FIELDS = new Set([
  "cache_control",
  "x-request-id",
  "request_id",
  "timestamp",
  "created_at",
]);

function stripVolatile(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;

  if (Array.isArray(obj)) {
    return obj.map(stripVolatile);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (VOLATILE_FIELDS.has(key)) continue;
    result[key] = stripVolatile(value);
  }
  return result;
}

function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") return JSON.stringify(obj);
  if (typeof obj === "number" || typeof obj === "boolean")
    return JSON.stringify(obj);

  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalize).join(",") + "]";
  }

  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) =>
      JSON.stringify(k) +
      ":" +
      canonicalize((obj as Record<string, unknown>)[k]),
  );
  return "{" + pairs.join(",") + "}";
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function normalizeRequest(req: AnthropicRequest): unknown {
  const stripped = stripVolatile(req);
  return stripped;
}

export function hashRequest(req: AnthropicRequest): string {
  const normalized = normalizeRequest(req);
  const canonical = canonicalize(normalized);
  return sha256(canonical);
}

export function computeMessageHashes(messages: unknown[]): string[] {
  const hashes: string[] = [];
  let chain = "";

  for (const msg of messages) {
    const canonical = canonicalize(stripVolatile(msg));
    chain = sha256(chain + canonical);
    hashes.push(chain);
  }

  return hashes;
}
