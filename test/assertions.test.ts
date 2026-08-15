import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateAssertions } from "../src/assertions.js";
import type { TraceEvent, AssertionDef } from "../src/types.js";

const TEST_DIR = join(
  import.meta.dirname,
  "..",
  ".test-assertions-" + process.pid,
);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function makeEvent(
  seq: number,
  type: string,
  data: Record<string, unknown>,
): TraceEvent {
  return {
    seq,
    type,
    timestamp: new Date().toISOString(),
    data,
  };
}

describe("forbidden_path", () => {
  const events: TraceEvent[] = [
    makeEvent(0, "model.response", {
      body: {
        content: [
          {
            type: "tool_use",
            name: "write_file",
            input: { path: "src/gen/output.ts" },
          },
        ],
      },
    }),
    makeEvent(1, "model.response", {
      body: {
        content: [
          {
            type: "tool_use",
            name: "read_file",
            input: { path: "src/index.ts" },
          },
        ],
      },
    }),
  ];

  it("fires when path matches", () => {
    const assertions: AssertionDef[] = [
      { type: "forbidden_path", args: { pattern: "src/gen/**" } },
    ];
    const results = evaluateAssertions(assertions, events);
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain("src/gen/output.ts");
  });

  it("passes when path does not match", () => {
    const assertions: AssertionDef[] = [
      { type: "forbidden_path", args: { pattern: "nonexistent/**" } },
    ];
    const results = evaluateAssertions(assertions, events);
    expect(results[0].passed).toBe(true);
  });

  it("matches absolute paths against relative patterns", () => {
    const absEvents: TraceEvent[] = [
      makeEvent(0, "model.response", {
        body: {
          content: [
            {
              type: "tool_use",
              name: "write_file",
              input: { file_path: "/tmp/project/src/gen/output.ts" },
            },
          ],
        },
      }),
    ];
    const assertions: AssertionDef[] = [
      { type: "forbidden_path", args: { pattern: "src/gen/**" } },
    ];
    const results = evaluateAssertions(assertions, absEvents);
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain("src/gen/output.ts");
  });

  it("matches .env pattern against absolute paths", () => {
    const absEvents: TraceEvent[] = [
      makeEvent(0, "model.response", {
        body: {
          content: [
            {
              type: "tool_use",
              name: "read_file",
              input: { file_path: "/home/user/project/.env" },
            },
          ],
        },
      }),
    ];
    const assertions: AssertionDef[] = [
      { type: "forbidden_path", args: { pattern: ".env*" } },
    ];
    const results = evaluateAssertions(assertions, absEvents);
    expect(results[0].passed).toBe(false);
  });
});

describe("no_repeat", () => {
  it("fires when tool call repeats too many times", () => {
    const events: TraceEvent[] = [
      makeEvent(0, "model.response", {
        body: {
          content: [
            {
              type: "tool_use",
              name: "read_file",
              input: { path: "foo.txt" },
            },
          ],
        },
      }),
      makeEvent(1, "model.response", {
        body: {
          content: [
            {
              type: "tool_use",
              name: "read_file",
              input: { path: "foo.txt" },
            },
          ],
        },
      }),
      makeEvent(2, "model.response", {
        body: {
          content: [
            {
              type: "tool_use",
              name: "read_file",
              input: { path: "foo.txt" },
            },
          ],
        },
      }),
    ];

    const results = evaluateAssertions(
      [{ type: "no_repeat", args: { max: 2 } }],
      events,
    );
    expect(results[0].passed).toBe(false);
  });

  it("passes when within limits", () => {
    const events: TraceEvent[] = [
      makeEvent(0, "model.response", {
        body: {
          content: [
            {
              type: "tool_use",
              name: "read_file",
              input: { path: "foo.txt" },
            },
          ],
        },
      }),
    ];

    const results = evaluateAssertions(
      [{ type: "no_repeat", args: { max: 5 } }],
      events,
    );
    expect(results[0].passed).toBe(true);
  });

  it("ignores description field when comparing tool inputs", () => {
    const events: TraceEvent[] = [
      makeEvent(0, "model.response", {
        body: {
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: { command: "node --test tests/", description: "Run tests" },
            },
          ],
        },
      }),
      makeEvent(1, "model.response", {
        body: {
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: { command: "node --test tests/", description: "Execute test suite" },
            },
          ],
        },
      }),
      makeEvent(2, "model.response", {
        body: {
          content: [
            {
              type: "tool_use",
              name: "Bash",
              input: { command: "node --test tests/", description: "Run the tests again" },
            },
          ],
        },
      }),
    ];

    const results = evaluateAssertions(
      [{ type: "no_repeat", args: { max: 2 } }],
      events,
    );
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain("repeated 3 times");
  });
});

describe("max_calls", () => {
  it("fires when model call count exceeds max", () => {
    const events: TraceEvent[] = [
      makeEvent(0, "model.request", { body: {} }),
      makeEvent(1, "model.request", { body: {} }),
      makeEvent(2, "model.request", { body: {} }),
    ];

    const results = evaluateAssertions(
      [{ type: "max_calls", args: { max: 1 } }],
      events,
    );
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain("3 model calls");
  });

  it("passes when within max", () => {
    const events: TraceEvent[] = [
      makeEvent(0, "model.request", { body: {} }),
      makeEvent(1, "model.request", { body: {} }),
    ];

    const results = evaluateAssertions(
      [{ type: "max_calls", args: { max: 10 } }],
      events,
    );
    expect(results[0].passed).toBe(true);
  });
});

describe("command", () => {
  it("passes when command succeeds", () => {
    writeFileSync(join(TEST_DIR, "output.txt"), "data", "utf-8");

    const results = evaluateAssertions(
      [{ type: "command", args: { command: "test -f output.txt" } }],
      [],
      TEST_DIR,
    );
    expect(results[0].passed).toBe(true);
  });

  it("fails when command fails", () => {
    const results = evaluateAssertions(
      [
        {
          type: "command",
          args: { command: "test -f nonexistent-file.txt" },
        },
      ],
      [],
      TEST_DIR,
    );
    expect(results[0].passed).toBe(false);
  });
});
