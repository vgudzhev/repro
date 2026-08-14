import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE_URL =
  process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
const API_KEY = process.env.ANTHROPIC_API_KEY ?? "sk-repro-dummy";

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

const TOOLS = [
  {
    name: "read_file",
    description: "Read a file from the filesystem",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "File path to read" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "File path to write" },
        content: {
          type: "string" as const,
          description: "Content to write",
        },
      },
      required: ["path", "content"],
    },
  },
];

function executeTool(
  name: string,
  input: Record<string, unknown>,
): { result: string; is_error: boolean } {
  try {
    if (name === "read_file") {
      const content = readFileSync(input.path as string, "utf-8");
      return { result: content, is_error: false };
    }
    if (name === "write_file") {
      mkdirSync(dirname(input.path as string), { recursive: true });
      writeFileSync(input.path as string, input.content as string, "utf-8");
      return { result: "ok", is_error: false };
    }
    return { result: `Unknown tool: ${name}`, is_error: true };
  } catch (err) {
    return {
      result: err instanceof Error ? err.message : String(err),
      is_error: true,
    };
  }
}

async function sendMessage(
  messages: Message[],
  stream: boolean,
): Promise<{ content: ContentBlock[]; stop_reason: string }> {
  const url = `${BASE_URL}/v1/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages,
      tools: TOOLS,
      stream,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  if (!stream) {
    const data = await response.json();
    return {
      content: data.content as ContentBlock[],
      stop_reason: data.stop_reason as string,
    };
  }

  return parseSSEResponse(response);
}

async function parseSSEResponse(
  response: Response,
): Promise<{ content: ContentBlock[]; stop_reason: string }> {
  const text = await response.text();
  const content: ContentBlock[] = [];
  let stopReason = "end_turn";
  let currentBlockIndex = -1;

  for (const line of text.split("\n")) {
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
      case "content_block_start": {
        currentBlockIndex = (event.index as number) ?? content.length;
        const block = event.content_block as ContentBlock;
        content[currentBlockIndex] = { ...block };
        break;
      }
      case "content_block_delta": {
        const idx = (event.index as number) ?? currentBlockIndex;
        const delta = event.delta as Record<string, unknown>;
        if (delta.type === "text_delta" && content[idx]) {
          content[idx].text =
            ((content[idx].text as string) ?? "") +
            (delta.text as string);
        } else if (delta.type === "input_json_delta" && content[idx]) {
          const existing =
            ((content[idx] as Record<string, unknown>)
              ._partialJson as string) ?? "";
          (content[idx] as Record<string, unknown>)._partialJson =
            existing + (delta.partial_json as string);
        }
        break;
      }
      case "content_block_stop": {
        const idx = (event.index as number) ?? currentBlockIndex;
        if (
          (content[idx] as Record<string, unknown>)?._partialJson &&
          content[idx].type === "tool_use"
        ) {
          try {
            content[idx].input = JSON.parse(
              (content[idx] as Record<string, unknown>)
                ._partialJson as string,
            );
          } catch {
            content[idx].input = {};
          }
          delete (content[idx] as Record<string, unknown>)._partialJson;
        }
        break;
      }
      case "message_delta": {
        const delta = event.delta as Record<string, unknown>;
        if (delta.stop_reason) stopReason = delta.stop_reason as string;
        break;
      }
    }
  }

  return { content, stop_reason: stopReason };
}

async function run(): Promise<void> {
  const userPrompt =
    process.argv[2] ?? "Read test-input.txt and write its content reversed to test-output.txt";
  const useStreaming = process.env.REPRO_AGENT_STREAM === "1";

  const messages: Message[] = [
    { role: "user", content: userPrompt },
  ];

  const MAX_TURNS = 10;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const { content, stop_reason } = await sendMessage(messages, useStreaming);

    messages.push({ role: "assistant", content });

    if (stop_reason === "end_turn") {
      break;
    }

    if (stop_reason === "tool_use") {
      const toolResults: ContentBlock[] = [];
      for (const block of content) {
        if (block.type === "tool_use" && block.name && block.id) {
          const { result, is_error } = executeTool(
            block.name,
            (block.input as Record<string, unknown>) ?? {},
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
            is_error,
          } as unknown as ContentBlock);
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
