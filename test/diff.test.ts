import { describe, it, expect } from "vitest";
import { alignTraces, explainDivergence } from "../src/diff.js";
import type { TraceEvent } from "../src/types.js";

function makeEvent(
  seq: number,
  type: string,
  data: Record<string, unknown> = {},
): TraceEvent {
  return {
    seq,
    type,
    timestamp: new Date().toISOString(),
    data,
  };
}

describe("alignTraces", () => {
  it("aligns identical traces perfectly", () => {
    const events = [
      makeEvent(0, "process.start"),
      makeEvent(1, "model.request", { normalizedHash: "abc123" }),
      makeEvent(2, "model.response", { body: { content: [{ type: "text", text: "hi" }] } }),
      makeEvent(3, "process.exit"),
    ];

    const aligned = alignTraces(events, events);
    const divergences = aligned.filter((p) => p.divergence !== "match");
    expect(divergences).toHaveLength(0);
  });

  it("detects inserted events", () => {
    const eventsA = [
      makeEvent(0, "process.start"),
      makeEvent(1, "model.request", { normalizedHash: "abc" }),
      makeEvent(2, "process.exit"),
    ];
    const eventsB = [
      makeEvent(0, "process.start"),
      makeEvent(1, "model.request", { normalizedHash: "abc" }),
      makeEvent(2, "model.response", { body: { content: [{ type: "text", text: "extra" }] } }),
      makeEvent(3, "process.exit"),
    ];

    const aligned = alignTraces(eventsA, eventsB);
    const inserted = aligned.filter((p) => p.divergence === "event_inserted");
    expect(inserted.length).toBeGreaterThan(0);
  });

  it("detects reordering in same-length traces", () => {
    const eventsA = [
      makeEvent(0, "process.start"),
      makeEvent(1, "model.response", {
        body: { content: [{ type: "tool_use", name: "read_file", input: {} }] },
      }),
      makeEvent(2, "model.response", {
        body: { content: [{ type: "tool_use", name: "write_file", input: {} }] },
      }),
      makeEvent(3, "process.exit"),
    ];
    const eventsB = [
      makeEvent(0, "process.start"),
      makeEvent(1, "model.response", {
        body: { content: [{ type: "tool_use", name: "write_file", input: {} }] },
      }),
      makeEvent(2, "model.response", {
        body: { content: [{ type: "tool_use", name: "read_file", input: {} }] },
      }),
      makeEvent(3, "process.exit"),
    ];

    const aligned = alignTraces(eventsA, eventsB);
    const nonMatch = aligned.filter((p) => p.divergence !== "match");
    expect(nonMatch.length).toBeGreaterThan(0);
  });

  it("detects dropped events", () => {
    const eventsA = [
      makeEvent(0, "process.start"),
      makeEvent(1, "model.request", { normalizedHash: "abc" }),
      makeEvent(2, "model.response", { body: { content: [] } }),
      makeEvent(3, "process.exit"),
    ];
    const eventsB = [
      makeEvent(0, "process.start"),
      makeEvent(1, "process.exit"),
    ];

    const aligned = alignTraces(eventsA, eventsB);
    const dropped = aligned.filter((p) => p.divergence === "event_dropped");
    expect(dropped.length).toBeGreaterThan(0);
  });
});

describe("explainDivergence", () => {
  it("reports no divergence for identical traces", () => {
    const events = [
      makeEvent(0, "process.start"),
      makeEvent(1, "process.exit"),
    ];
    const aligned = alignTraces(events, events);
    const result = explainDivergence(aligned);
    expect(result.firstDivergence).toBeNull();
    expect(result.summary).toContain("identical");
  });

  it("reports environment drift for early result_changed", () => {
    const eventsA = [
      makeEvent(0, "process.start"),
      makeEvent(1, "model.request", {
        normalizedHash: "abc",
        body: {
          messages: [
            {
              role: "user",
              content: [
                { type: "tool_result", tool_use_id: "t1", content: "result A" },
              ],
            },
          ],
        },
      }),
    ];
    const eventsB = [
      makeEvent(0, "process.start"),
      makeEvent(1, "model.request", {
        normalizedHash: "def",
        body: {
          messages: [
            {
              role: "user",
              content: [
                { type: "tool_result", tool_use_id: "t1", content: "result B" },
              ],
            },
          ],
        },
      }),
    ];

    const aligned = alignTraces(eventsA, eventsB);
    const result = explainDivergence(aligned);
    expect(result.isEnvironmentDrift).toBe(true);
    expect(result.summary).toContain("environment has changed");
  });

  it("reports first divergence with downstream count", () => {
    const eventsA = [
      makeEvent(0, "process.start"),
      makeEvent(1, "model.request", { normalizedHash: "same" }),
      makeEvent(2, "model.response", {
        body: {
          content: [{ type: "tool_use", name: "read_file", input: { path: "a.txt" } }],
        },
      }),
      makeEvent(3, "model.request", { normalizedHash: "diff_a" }),
      makeEvent(4, "process.exit"),
    ];
    const eventsB = [
      makeEvent(0, "process.start"),
      makeEvent(1, "model.request", { normalizedHash: "same" }),
      makeEvent(2, "model.response", {
        body: {
          content: [{ type: "tool_use", name: "read_file", input: { path: "b.txt" } }],
        },
      }),
      makeEvent(3, "model.request", { normalizedHash: "diff_b" }),
      makeEvent(4, "process.exit"),
    ];

    const aligned = alignTraces(eventsA, eventsB);
    const result = explainDivergence(aligned);
    expect(result.firstDivergence).not.toBeNull();
    expect(result.divergenceIndex).toBeGreaterThan(0);
    expect(result.summary).toContain("divergence");
  });
});
