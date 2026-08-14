import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  redactEnvValues,
  redactString,
  redactJsonDeep,
  redactAuthHeader,
  buildEnvRedactions,
  matchesPathDenylist,
} from "../src/redact.js";

describe("redactSecrets", () => {
  it("redacts Anthropic API keys", () => {
    const input = "key is sk-ant-api03-abcdefghijklmnopqrstuvwx";
    const result = redactSecrets(input);
    expect(result).not.toContain("sk-ant-");
    expect(result).toContain("[[redacted:pattern:anthropic-key:");
  });

  it("redacts OpenAI API keys", () => {
    const input = "key is sk-proj-abcdefghijklmnopqrstuvwx";
    const result = redactSecrets(input);
    expect(result).not.toContain("sk-proj-");
    expect(result).toContain("[[redacted:pattern:openai-key:");
  });

  it("redacts GitHub PATs", () => {
    const input = "token is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    const result = redactSecrets(input);
    expect(result).not.toContain("ghp_");
    expect(result).toContain("[[redacted:pattern:github-pat:");
  });

  it("redacts AWS access keys", () => {
    const input = "aws key AKIAIOSFODNN7EXAMPLE";
    const result = redactSecrets(input);
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result).toContain("[[redacted:pattern:aws-key:");
  });

  it("redacts JWTs", () => {
    const input = "bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = redactSecrets(input);
    expect(result).not.toContain("eyJhbGci");
    expect(result).toContain("[[redacted:pattern:jwt:");
  });

  it("redacts PEM blocks", () => {
    const input = "cert:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQ\n-----END RSA PRIVATE KEY-----\n";
    const result = redactSecrets(input);
    expect(result).not.toContain("MIIEpAIBAAKCAQ");
    expect(result).toContain("[[redacted:pattern:pem-block:");
  });

  it("preserves non-secret text", () => {
    const input = "hello world, no secrets here";
    const result = redactSecrets(input);
    expect(result).toBe(input);
  });
});

describe("buildEnvRedactions + redactEnvValues", () => {
  it("redacts env var values", () => {
    const env = { MY_SECRET: "super-secret-value-12345", PATH: "/usr/bin" };
    const redactions = buildEnvRedactions(env);
    const input = "the secret is super-secret-value-12345 here";
    const result = redactEnvValues(input, redactions);
    expect(result).not.toContain("super-secret-value-12345");
    expect(result).toContain("[[redacted:env:MY_SECRET:");
  });

  it("respects allowlist", () => {
    const env = { ALLOWED_VAR: "visible-value" };
    const redactions = buildEnvRedactions(env, ["ALLOWED_VAR"]);
    const input = "value is visible-value";
    const result = redactEnvValues(input, redactions);
    expect(result).toBe(input);
  });

  it("skips short values", () => {
    const env = { SHORT: "ab" };
    const redactions = buildEnvRedactions(env);
    expect(redactions).toHaveLength(0);
  });
});

describe("redactAuthHeader", () => {
  it("redacts Authorization header", () => {
    const headers = { authorization: "Bearer sk-ant-api03-abc123xyz" };
    const result = redactAuthHeader(headers);
    expect(result.authorization).toContain("[[redacted:pattern:auth-header:");
    expect(result.authorization).not.toContain("sk-ant-");
  });

  it("redacts x-api-key header", () => {
    const headers = { "x-api-key": "sk-ant-api03-abc123xyz" };
    const result = redactAuthHeader(headers);
    expect(result["x-api-key"]).toContain("[[redacted:pattern:api-key-header:");
  });
});

describe("redactJsonDeep", () => {
  it("redacts secrets nested in objects", () => {
    const obj = {
      outer: {
        inner: "my key is sk-ant-api03-abcdefghijklmnopqrstuvwx",
      },
      list: ["ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"],
    };
    const result = redactJsonDeep(obj, []) as Record<string, unknown>;
    const inner = (result.outer as Record<string, unknown>).inner as string;
    expect(inner).not.toContain("sk-ant-");
    const listItem = (result.list as string[])[0];
    expect(listItem).not.toContain("ghp_");
  });

  it("redacts env values in deep structures", () => {
    const env = { SECRET: "my-deep-secret-value" };
    const redactions = buildEnvRedactions(env);
    const obj = { a: { b: { c: "contains my-deep-secret-value here" } } };
    const result = redactJsonDeep(obj, redactions) as Record<string, unknown>;
    const c = ((result.a as Record<string, unknown>).b as Record<string, unknown>).c as string;
    expect(c).not.toContain("my-deep-secret-value");
    expect(c).toContain("[[redacted:env:SECRET:");
  });
});

describe("matchesPathDenylist", () => {
  it("matches .env files", () => {
    expect(matchesPathDenylist(".env")).toBe(true);
    expect(matchesPathDenylist("config/.env")).toBe(true);
  });

  it("matches .env.* files", () => {
    expect(matchesPathDenylist(".env.local")).toBe(true);
    expect(matchesPathDenylist("config/.env.production")).toBe(true);
  });

  it("matches *.pem files", () => {
    expect(matchesPathDenylist("cert.pem")).toBe(true);
    expect(matchesPathDenylist("certs/server.pem")).toBe(true);
  });

  it("matches *.key files", () => {
    expect(matchesPathDenylist("private.key")).toBe(true);
  });

  it("matches **/secrets/** paths", () => {
    expect(matchesPathDenylist("app/secrets/token")).toBe(true);
  });

  it("does not match normal files", () => {
    expect(matchesPathDenylist("src/index.ts")).toBe(false);
    expect(matchesPathDenylist("README.md")).toBe(false);
  });
});

describe("redactString", () => {
  it("combines pattern and env redaction", () => {
    const env = { API_TOKEN: "my-api-token-value-123456" };
    const redactions = buildEnvRedactions(env);
    const input =
      "key=sk-ant-api03-abcdefghijklmnopqrstuvwx token=my-api-token-value-123456";
    const result = redactString(input, redactions);
    expect(result).not.toContain("sk-ant-");
    expect(result).not.toContain("my-api-token-value-123456");
  });
});
