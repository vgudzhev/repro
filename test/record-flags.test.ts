import { describe, it, expect } from "vitest";
import { parseRecordFlags } from "../src/cli.js";

describe("parseRecordFlags", () => {
  it("parses bare command with no flags", () => {
    const result = parseRecordFlags(["--", "claude", "--print", "hi"]);
    expect(result).toEqual({
      model: undefined,
      auth: undefined,
      cmd: ["claude", "--print", "hi"],
    });
  });

  it("parses --model flag", () => {
    const result = parseRecordFlags(["--model", "claude-sonnet-4", "--", "claude", "--print", "hi"]);
    expect(result.model).toBe("claude-sonnet-4");
    expect(result.cmd).toEqual(["claude", "--print", "hi"]);
  });

  it("parses --auth plan", () => {
    const result = parseRecordFlags(["--auth", "plan", "--", "claude", "--print", "hi"]);
    expect(result.auth).toBe("plan");
  });

  it("parses --auth credits", () => {
    const result = parseRecordFlags(["--auth", "credits", "--", "claude", "--print", "hi"]);
    expect(result.auth).toBe("credits");
  });

  it("parses both flags together", () => {
    const result = parseRecordFlags([
      "--model", "claude-opus-4", "--auth", "plan",
      "--", "claude", "--print", "fix the bug",
    ]);
    expect(result.model).toBe("claude-opus-4");
    expect(result.auth).toBe("plan");
    expect(result.cmd).toEqual(["claude", "--print", "fix the bug"]);
  });

  it("does not consume --model after -- separator", () => {
    const result = parseRecordFlags(["--", "claude", "--model", "opus", "--print", "hi"]);
    expect(result.model).toBeUndefined();
    expect(result.cmd).toEqual(["claude", "--model", "opus", "--print", "hi"]);
  });

  it("throws on missing -- separator", () => {
    expect(() => parseRecordFlags(["--model", "opus"])).toThrow("Usage:");
  });

  it("throws on invalid --auth value", () => {
    expect(() => parseRecordFlags(["--auth", "free", "--", "claude"])).toThrow(
      '--auth must be "plan" or "credits"',
    );
  });

  it("throws on unknown flag", () => {
    expect(() => parseRecordFlags(["--verbose", "--", "claude"])).toThrow("unknown flag");
  });
});
