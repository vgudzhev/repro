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
  "model",
  "stream",
  "max_tokens",
  "thinking",
  "context_management",
  "output_config",
  "tools",
]);

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

function stripSystemReminders(text: string): string {
  return text.replace(SYSTEM_REMINDER_RE, "").trim();
}

function replaceCwd(text: string, cwdPattern: RegExp | null): string {
  if (!cwdPattern) return text;
  return text.replace(cwdPattern, "[[CWD]]");
}

function normalizeText(text: string, cwdPattern: RegExp | null): string {
  return replaceCwd(stripSystemReminders(text), cwdPattern);
}

function buildCwdPattern(cwds: string | string[]): RegExp {
  const paths = Array.isArray(cwds) ? cwds : [cwds];
  const unique = [...new Set(paths.filter(Boolean))];
  // Sort longest-first so longer paths match before shorter prefixes
  unique.sort((a, b) => b.length - a.length);
  const escaped = unique.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("|"), "g");
}

function normalizeMessages(messages: unknown[], cwdPattern: RegExp | null): unknown[] {
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
            return { ...b, text: normalizeText(b.text, cwdPattern) };
          }
          if (b.type === "tool_result") {
            if (typeof b.content === "string") {
              return { ...b, content: normalizeText(b.content, cwdPattern) };
            }
            if (Array.isArray(b.content)) {
              return { ...b, content: (b.content as Record<string, unknown>[]).map((inner) => {
                if (inner.type === "text" && typeof inner.text === "string") {
                  return { ...inner, text: normalizeText(inner.text, cwdPattern) };
                }
                return inner;
              })};
            }
            return block;
          }
          if (b.type === "tool_use" && typeof b.input === "object" && b.input !== null) {
            return { ...b, input: normalizePaths(b.input, cwdPattern) };
          }
          return block;
        }),
      };
    }
    if (typeof content === "string") {
      return { ...m, content: normalizeText(content, cwdPattern) };
    }
    return msg;
  });
}

function normalizePaths(obj: unknown, cwdPattern: RegExp | null): unknown {
  if (!cwdPattern) return obj;
  if (typeof obj === "string") return replaceCwd(obj, cwdPattern);
  if (Array.isArray(obj)) return obj.map(item => normalizePaths(item, cwdPattern));
  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = normalizePaths(value, cwdPattern);
    }
    return result;
  }
  return obj;
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

export function normalizeRequest(req: AnthropicRequest, cwd?: string | string[]): unknown {
  const cwdPattern = cwd ? buildCwdPattern(cwd) : null;
  const withNormalized = {
    ...req,
    messages: normalizeMessages(req.messages ?? [], cwdPattern),
  };
  const stripped = stripVolatile(withNormalized);
  return stripped;
}

export function hashRequest(req: AnthropicRequest, cwd?: string | string[]): string {
  const normalized = normalizeRequest(req, cwd);
  const canonical = canonicalize(normalized);
  return sha256(canonical);
}

export function computeMessageHashes(messages: unknown[], cwd?: string | string[]): string[] {
  const hashes: string[] = [];
  let chain = "";
  const cwdPattern = cwd ? buildCwdPattern(cwd) : null;

  const normalized = normalizeMessages(messages, cwdPattern);
  for (const msg of normalized) {
    const canonical = canonicalize(stripVolatile(msg));
    chain = sha256(chain + canonical);
    hashes.push(chain);
  }

  return hashes;
}
