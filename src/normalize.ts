import { createHash } from "node:crypto";
import type { AnthropicRequest } from "./types.js";

const VOLATILE_FIELDS = new Set([
  "cache_control",
  "x-request-id",
  "request_id",
  "timestamp",
  "created_at",
  "metadata",
  "system",
]);

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

function stripSystemReminders(text: string): string {
  return text.replace(SYSTEM_REMINDER_RE, "").trim();
}

function normalizeMessages(messages: unknown[]): unknown[] {
  return messages.map((msg) => {
    if (typeof msg !== "object" || msg === null) return msg;
    const m = msg as Record<string, unknown>;
    const content = m.content;
    if (Array.isArray(content)) {
      return {
        ...m,
        content: content.map((block) => {
          if (typeof block !== "object" || block === null) return block;
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            return { ...b, text: stripSystemReminders(b.text) };
          }
          return block;
        }),
      };
    }
    if (typeof content === "string") {
      return { ...m, content: stripSystemReminders(content) };
    }
    return msg;
  });
}

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
  const withNormalizedMessages = {
    ...req,
    messages: normalizeMessages(req.messages ?? []),
  };
  const stripped = stripVolatile(withNormalizedMessages);
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

  const normalized = normalizeMessages(messages);
  for (const msg of normalized) {
    const canonical = canonicalize(stripVolatile(msg));
    chain = sha256(chain + canonical);
    hashes.push(chain);
  }

  return hashes;
}
