import { createHash } from "node:crypto";

export interface RedactionConfig {
  allowedEnvVars?: string[];
  additionalPatterns?: Array<{ name: string; pattern: RegExp }>;
  pathDenylist?: string[];
}

const DEFAULT_PATH_DENYLIST = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "**/secrets/**",
];

interface SecretPattern {
  name: string;
  pattern: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: "anthropic-key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai-key", pattern: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: "github-pat", pattern: /ghp_[A-Za-z0-9]{36,}/g },
  { name: "github-user", pattern: /ghu_[A-Za-z0-9]{36,}/g },
  { name: "aws-key", pattern: /AKIA[A-Z0-9]{16}/g },
  { name: "jwt", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    name: "pem-block",
    pattern: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
  },
];

function sha256Prefix(value: string, len = 8): string {
  return createHash("sha256").update(value).digest("hex").slice(0, len);
}

function makeMarker(
  type: "env" | "pattern" | "path",
  rule: string,
  value: string,
): string {
  return `[[redacted:${type}:${rule}:${sha256Prefix(value)}]]`;
}

export function buildEnvRedactions(
  env: Record<string, string | undefined>,
  allowlist: string[] = [],
): Array<{ value: string; marker: string }> {
  const redactions: Array<{ value: string; marker: string }> = [];
  const allowSet = new Set(allowlist);

  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 4 || allowSet.has(key)) continue;
    redactions.push({
      value,
      marker: makeMarker("env", key, value),
    });
  }

  redactions.sort((a, b) => b.value.length - a.value.length);
  return redactions;
}

export function redactSecrets(
  text: string,
  config: RedactionConfig = {},
): string {
  let result = text;

  const patterns = [...SECRET_PATTERNS, ...(config.additionalPatterns ?? [])];
  for (const { name, pattern } of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    result = result.replace(regex, (match) =>
      makeMarker("pattern", name, match),
    );
  }

  return result;
}

export function redactEnvValues(
  text: string,
  envRedactions: Array<{ value: string; marker: string }>,
): string {
  let result = text;
  for (const { value, marker } of envRedactions) {
    let idx = result.indexOf(value);
    while (idx !== -1) {
      result = result.slice(0, idx) + marker + result.slice(idx + value.length);
      idx = result.indexOf(value, idx + marker.length);
    }
  }
  return result;
}

export function redactAuthHeader(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const result = { ...headers };
  for (const key of Object.keys(result)) {
    if (key.toLowerCase() === "authorization" && result[key]) {
      const val =
        typeof result[key] === "string"
          ? (result[key] as string)
          : (result[key] as string[])[0];
      result[key] = makeMarker("pattern", "auth-header", val);
    }
    if (key.toLowerCase() === "x-api-key" && result[key]) {
      const val =
        typeof result[key] === "string"
          ? (result[key] as string)
          : (result[key] as string[])[0];
      result[key] = makeMarker("pattern", "api-key-header", val);
    }
  }
  return result;
}

export function matchesPathDenylist(
  filePath: string,
  denylist: string[] = DEFAULT_PATH_DENYLIST,
): boolean {
  for (const pattern of denylist) {
    if (pattern.startsWith("**/")) {
      if (filePath.includes(pattern.slice(3).replace(/\*\*/g, "")))
        return true;
    } else if (pattern.startsWith("*.")) {
      if (filePath.endsWith(pattern.slice(1))) return true;
    } else if (pattern.includes(".*")) {
      const base = pattern.split(".*")[0];
      if (
        filePath === base ||
        filePath.startsWith(base + ".") ||
        filePath.endsWith("/" + base) ||
        filePath.includes("/" + base + ".")
      )
        return true;
    } else {
      if (
        filePath === pattern ||
        filePath.endsWith("/" + pattern) ||
        filePath.includes("/" + pattern + "/")
      )
        return true;
    }
  }
  return false;
}

export function redactString(
  text: string,
  envRedactions: Array<{ value: string; marker: string }>,
  config: RedactionConfig = {},
): string {
  let result = redactSecrets(text, config);
  result = redactEnvValues(result, envRedactions);
  return result;
}

export function redactJsonDeep(
  obj: unknown,
  envRedactions: Array<{ value: string; marker: string }>,
  config: RedactionConfig = {},
): unknown {
  if (typeof obj === "string") {
    return redactString(obj, envRedactions, config);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => redactJsonDeep(item, envRedactions, config));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = redactJsonDeep(value, envRedactions, config);
    }
    return result;
  }
  return obj;
}
