import type { AnthropicResponse, AnthropicContentBlock } from "./types.js";

export function reassembleSSE(chunks: string[]): AnthropicResponse {
  let messageId = "";
  let model = "";
  let role = "assistant" as const;
  let stopReason: string | null = null;
  let stopSequence: string | null = null;
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const contentBlocks: AnthropicContentBlock[] = [];
  let currentBlockIndex = -1;

  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }

      switch (event.type) {
        case "message_start": {
          const msg = event.message as Record<string, unknown>;
          messageId = msg.id as string;
          model = msg.model as string;
          role = (msg.role as "assistant") ?? "assistant";
          if (msg.usage) {
            const u = msg.usage as Record<string, number>;
            usage.input_tokens = u.input_tokens ?? 0;
            usage.output_tokens = u.output_tokens ?? 0;
            if (u.cache_creation_input_tokens)
              usage.cache_creation_input_tokens =
                u.cache_creation_input_tokens;
            if (u.cache_read_input_tokens)
              usage.cache_read_input_tokens = u.cache_read_input_tokens;
          }
          break;
        }

        case "content_block_start": {
          currentBlockIndex = (event.index as number) ?? contentBlocks.length;
          const block = event.content_block as AnthropicContentBlock;
          contentBlocks[currentBlockIndex] = { ...block };
          break;
        }

        case "content_block_delta": {
          const idx = (event.index as number) ?? currentBlockIndex;
          const delta = event.delta as Record<string, unknown>;

          if (delta.type === "text_delta" && contentBlocks[idx]) {
            const existing =
              (contentBlocks[idx].text as string) ?? "";
            contentBlocks[idx].text = existing + (delta.text as string);
          } else if (
            delta.type === "input_json_delta" &&
            contentBlocks[idx]
          ) {
            const existing =
              (contentBlocks[idx]._partialJson as string) ?? "";
            contentBlocks[idx]._partialJson =
              existing + (delta.partial_json as string);
          }
          break;
        }

        case "content_block_stop": {
          const idx = (event.index as number) ?? currentBlockIndex;
          if (
            contentBlocks[idx]?._partialJson &&
            contentBlocks[idx].type === "tool_use"
          ) {
            try {
              contentBlocks[idx].input = JSON.parse(
                contentBlocks[idx]._partialJson as string,
              );
            } catch {
              contentBlocks[idx].input = {};
            }
            delete contentBlocks[idx]._partialJson;
          }
          break;
        }

        case "message_delta": {
          const delta = event.delta as Record<string, unknown>;
          if (delta.stop_reason)
            stopReason = delta.stop_reason as string;
          if (delta.stop_sequence)
            stopSequence = delta.stop_sequence as string;
          if (event.usage) {
            const u = event.usage as Record<string, number>;
            if (u.output_tokens) usage.output_tokens = u.output_tokens;
          }
          break;
        }
      }
    }
  }

  return {
    id: messageId,
    type: "message",
    role,
    content: contentBlocks,
    model,
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    usage,
  };
}

export function rechunkToSSE(response: AnthropicResponse): string[] {
  const events: string[] = [];

  events.push(
    formatSSE("message_start", {
      type: "message_start",
      message: {
        id: response.id,
        type: "message",
        role: response.role,
        content: [],
        model: response.model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: 0,
        },
      },
    }),
  );

  for (let i = 0; i < response.content.length; i++) {
    const block = response.content[i];

    events.push(
      formatSSE("content_block_start", {
        type: "content_block_start",
        index: i,
        content_block:
          block.type === "tool_use"
            ? { ...block, input: {} }
            : { ...block, text: "" },
      }),
    );

    if (block.type === "text" && block.text) {
      events.push(
        formatSSE("content_block_delta", {
          type: "content_block_delta",
          index: i,
          delta: { type: "text_delta", text: block.text as string },
        }),
      );
    } else if (block.type === "tool_use" && block.input) {
      const json = JSON.stringify(block.input);
      events.push(
        formatSSE("content_block_delta", {
          type: "content_block_delta",
          index: i,
          delta: { type: "input_json_delta", partial_json: json },
        }),
      );
    }

    events.push(
      formatSSE("content_block_stop", {
        type: "content_block_stop",
        index: i,
      }),
    );
  }

  events.push(
    formatSSE("message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: response.stop_reason,
        stop_sequence: response.stop_sequence,
      },
      usage: { output_tokens: response.usage.output_tokens },
    }),
  );

  events.push(formatSSE("message_stop", { type: "message_stop" }));

  return events;
}

function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
