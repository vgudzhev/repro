import { describe, it, expect } from "vitest";
import {
  hashRequest,
  computeMessageHashes,
  normalizeRequest,
} from "../src/normalize.js";
import type { AnthropicRequest } from "../src/types.js";

describe("normalizeRequest", () => {
  it("strips cache_control fields", () => {
    const req: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "hello",
              cache_control: { type: "ephemeral" },
            },
          ],
        },
      ],
    };
    const normalized = normalizeRequest(req) as Record<string, unknown>;
    const messages = normalized.messages as Array<Record<string, unknown>>;
    const content = messages[0].content as Array<Record<string, unknown>>;
    expect(content[0]).not.toHaveProperty("cache_control");
    expect(content[0]).toHaveProperty("text", "hello");
  });

  it("strips timestamp fields", () => {
    const req: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "hello" }],
      timestamp: "2026-01-01T00:00:00Z",
    };
    const normalized = normalizeRequest(req) as Record<string, unknown>;
    expect(normalized).not.toHaveProperty("timestamp");
  });
});

describe("hashRequest", () => {
  it("produces stable hashes for identical requests", () => {
    const req: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "hello" }],
    };
    const hash1 = hashRequest(req);
    const hash2 = hashRequest(req);
    expect(hash1).toBe(hash2);
  });

  it("produces the same hash regardless of key order", () => {
    const req1 = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "hello" }],
    } as AnthropicRequest;

    const req2 = {
      messages: [{ role: "user", content: "hello" }],
      model: "claude-sonnet-4-20250514",
    } as AnthropicRequest;

    expect(hashRequest(req1)).toBe(hashRequest(req2));
  });

  it("produces different hashes for different content", () => {
    const req1: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "hello" }],
    };
    const req2: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "goodbye" }],
    };
    expect(hashRequest(req1)).not.toBe(hashRequest(req2));
  });

  it("ignores volatile fields when hashing", () => {
    const req1: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello", cache_control: { type: "ephemeral" } },
          ],
        },
      ],
    };
    const req2: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      ],
    };
    expect(hashRequest(req1)).toBe(hashRequest(req2));
  });
});

describe("computeMessageHashes", () => {
  it("produces a chain of hashes", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "how are you" },
    ];
    const hashes = computeMessageHashes(messages);
    expect(hashes).toHaveLength(3);
    expect(new Set(hashes).size).toBe(3);
  });

  it("strips system-reminder blocks from message text before hashing", () => {
    const withReminder: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Fix the bug.\n<system-reminder>\nWorktree: /tmp/random-path-abc123\nScratchpad: /tmp/scratch-xyz\n</system-reminder>",
            },
          ],
        },
      ],
    };
    const withDifferentReminder: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Fix the bug.\n<system-reminder>\nWorktree: /tmp/different-path-def456\nScratchpad: /tmp/scratch-other\n</system-reminder>",
            },
          ],
        },
      ],
    };
    const withoutReminder: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Fix the bug." }],
        },
      ],
    };

    expect(hashRequest(withReminder)).toBe(hashRequest(withDifferentReminder));
    expect(hashRequest(withReminder)).toBe(hashRequest(withoutReminder));
  });

  it("strips system prompt as volatile (contains worktree path)", () => {
    const withSystem: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "hello" }],
      system: "You are a helpful assistant.\nPrimary working directory: /Users/dev/myproject",
    };
    const withDifferentSystem: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "hello" }],
      system: "You are a helpful assistant.\nPrimary working directory: /tmp/repro-worktree-abc123",
    };
    expect(hashRequest(withSystem)).toBe(hashRequest(withDifferentSystem));
  });

  it("chain diverges at the point of difference", () => {
    const base = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const variant = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hey" },
    ];
    const hashesBase = computeMessageHashes(base);
    const hashesVariant = computeMessageHashes(variant);

    expect(hashesBase[0]).toBe(hashesVariant[0]);
    expect(hashesBase[1]).not.toBe(hashesVariant[1]);
  });
});
