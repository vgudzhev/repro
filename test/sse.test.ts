import { describe, it, expect } from "vitest";
import { reassembleSSE, rechunkToSSE } from "../src/sse.js";

describe("reassembleSSE", () => {
  it("reassembles a text response from SSE chunks", () => {
    const chunks = [
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: {
          id: "msg_01",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-sonnet-4-20250514",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello " },
      })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "world!" },
      })}\n\n`,
      `event: content_block_stop\ndata: ${JSON.stringify({
        type: "content_block_stop",
        index: 0,
      })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 5 },
      })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({
        type: "message_stop",
      })}\n\n`,
    ];

    const result = reassembleSSE(chunks);
    expect(result.id).toBe("msg_01");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.stop_reason).toBe("end_turn");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("Hello world!");
  });

  it("reassembles a tool_use response from SSE chunks", () => {
    const chunks = [
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: {
          id: "msg_02",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-sonnet-4-20250514",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_01",
          name: "read_file",
          input: {},
        },
      })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: '{"path":"test.txt"}',
        },
      })}\n\n`,
      `event: content_block_stop\ndata: ${JSON.stringify({
        type: "content_block_stop",
        index: 0,
      })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 20 },
      })}\n\n`,
    ];

    const result = reassembleSSE(chunks);
    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("tool_use");
    expect(result.content[0].name).toBe("read_file");
    expect(result.content[0].input).toEqual({ path: "test.txt" });
  });
});

describe("rechunkToSSE", () => {
  it("produces valid SSE from a text response", () => {
    const response = {
      id: "msg_01",
      type: "message" as const,
      role: "assistant" as const,
      content: [{ type: "text", text: "Hello world!" }],
      model: "claude-sonnet-4-20250514",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    };

    const events = rechunkToSSE(response);
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events[0]).toContain("event: message_start");
    expect(events.at(-1)).toContain("event: message_stop");

    const reassembled = reassembleSSE(events);
    expect(reassembled.content[0].text).toBe("Hello world!");
    expect(reassembled.stop_reason).toBe("end_turn");
  });

  it("round-trips a tool_use response", () => {
    const response = {
      id: "msg_02",
      type: "message" as const,
      role: "assistant" as const,
      content: [
        {
          type: "tool_use",
          id: "toolu_01",
          name: "write_file",
          input: { path: "out.txt", content: "data" },
        },
      ],
      model: "claude-sonnet-4-20250514",
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    };

    const events = rechunkToSSE(response);
    const reassembled = reassembleSSE(events);
    expect(reassembled.content[0].type).toBe("tool_use");
    expect(reassembled.content[0].name).toBe("write_file");
    expect(reassembled.content[0].input).toEqual({
      path: "out.txt",
      content: "data",
    });
  });
});
