import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { evaluateAssertions } from "./assertions.js";
import type {
  AnthropicRequest,
  AnthropicResponse,
  AnthropicContentBlock,
  AnthropicTool,
  AssertionDef,
  TraceEvent,
} from "./types.js";
import type { Oracle } from "./minimize.js";

interface MinimizeItem {
  type: string;
  index: number;
  value: unknown;
}

interface LiveOracleOptions {
  baseUrl: string;
  apiKey: string;
  originalRequest: AnthropicRequest;
  assertions: AssertionDef[];
  workDir: string;
  maxTurns?: number;
}

const INPUT_COST_PER_MTOK: Record<string, number> = {
  "claude-haiku-4-5-20251001": 0.80,
  "claude-sonnet-4-20250514": 3.00,
  "claude-sonnet-5-20260715": 3.00,
  "claude-opus-4-20250515": 15.00,
};
const OUTPUT_COST_PER_MTOK: Record<string, number> = {
  "claude-haiku-4-5-20251001": 4.00,
  "claude-sonnet-4-20250514": 15.00,
  "claude-sonnet-5-20260715": 15.00,
  "claude-opus-4-20250515": 75.00,
};
const DEFAULT_INPUT_COST = 3.00;
const DEFAULT_OUTPUT_COST = 15.00;

function estimateCost(model: string, usage: AnthropicResponse["usage"]): number {
  const inputCost = INPUT_COST_PER_MTOK[model] ?? DEFAULT_INPUT_COST;
  const outputCost = OUTPUT_COST_PER_MTOK[model] ?? DEFAULT_OUTPUT_COST;
  return (
    (usage.input_tokens / 1_000_000) * inputCost +
    (usage.output_tokens / 1_000_000) * outputCost
  );
}

function executeTool(
  name: string,
  input: Record<string, unknown>,
  workDir: string,
): { result: string; is_error: boolean } {
  try {
    if (name === "read_file") {
      const path = join(workDir, input.path as string);
      const content = readFileSync(path, "utf-8");
      return { result: content, is_error: false };
    }
    if (name === "write_file") {
      const path = join(workDir, input.path as string);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, input.content as string, "utf-8");
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

function reconstructRequest(
  original: AnthropicRequest,
  subset: MinimizeItem[],
): AnthropicRequest {
  const toolItems = subset.filter((i) => i.type === "tool");
  const contextItems = subset.filter((i) => i.type === "context");
  const fileItems = subset.filter((i) => i.type === "file");

  const request: AnthropicRequest = {
    ...original,
    stream: false,
  };

  if (toolItems.length > 0 || subset.some((i) => i.type === "tool")) {
    request.tools = toolItems.map((i) => i.value as AnthropicTool);
  } else if (original.tools && !subset.some((i) => i.type === "tool")) {
    delete request.tools;
  }

  if (contextItems.length > 0) {
    request.messages = contextItems.map(
      (i) => i.value as AnthropicRequest["messages"][0],
    );
  }

  if (fileItems.length > 0) {
    const lastMsg = request.messages[request.messages.length - 1];
    if (lastMsg && Array.isArray(lastMsg.content)) {
      const existing = lastMsg.content as AnthropicContentBlock[];
      const fileValues = fileItems.map((i) => i.value as AnthropicContentBlock);
      lastMsg.content = [...existing, ...fileValues];
    }
  }

  return request;
}

async function sendRequest(
  baseUrl: string,
  apiKey: string,
  request: AnthropicRequest,
): Promise<AnthropicResponse> {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text}`);
  }

  return (await response.json()) as AnthropicResponse;
}

export function createLiveOracle(opts: LiveOracleOptions): {
  oracle: Oracle<MinimizeItem>;
  getSpend: () => number;
} {
  let totalSpend = 0;

  const oracle: Oracle<MinimizeItem> = {
    async test(subset: MinimizeItem[]): Promise<boolean> {
      const request = reconstructRequest(opts.originalRequest, subset);
      const events: TraceEvent[] = [];
      let seq = 0;
      const maxTurns = opts.maxTurns ?? 10;

      const messages = [...request.messages];
      let callSpend = 0;

      for (let turn = 0; turn < maxTurns; turn++) {
        const turnRequest: AnthropicRequest = {
          ...request,
          messages,
          stream: false,
        };

        events.push({
          seq: seq++,
          type: "model.request",
          timestamp: new Date().toISOString(),
          data: { body: turnRequest },
        });

        const response = await sendRequest(
          opts.baseUrl,
          opts.apiKey,
          turnRequest,
        );

        callSpend += estimateCost(request.model, response.usage);

        events.push({
          seq: seq++,
          type: "model.response",
          timestamp: new Date().toISOString(),
          data: { body: response },
        });

        messages.push({ role: "assistant", content: response.content });

        if (response.stop_reason === "end_turn") break;

        if (response.stop_reason === "tool_use") {
          const toolResults: AnthropicContentBlock[] = [];
          for (const block of response.content) {
            if (block.type === "tool_use" && block.name && block.id) {
              const { result, is_error } = executeTool(
                block.name as string,
                (block.input as Record<string, unknown>) ?? {},
                opts.workDir,
              );
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id as string,
                content: result,
                is_error,
              });
            }
          }
          messages.push({ role: "user", content: toolResults });
        }
      }

      totalSpend += callSpend;

      const results = evaluateAssertions(
        opts.assertions,
        events,
        opts.workDir,
      );

      const failureReproduced = results.some((r) => !r.passed);
      return failureReproduced;
    },
  };

  return { oracle, getSpend: () => totalSpend };
}

export function estimateCostPerCall(model: string): number {
  const inputCost = INPUT_COST_PER_MTOK[model] ?? DEFAULT_INPUT_COST;
  const outputCost = OUTPUT_COST_PER_MTOK[model] ?? DEFAULT_OUTPUT_COST;
  return (1000 / 1_000_000) * inputCost + (500 / 1_000_000) * outputCost;
}
