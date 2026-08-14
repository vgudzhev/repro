import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

export interface StubResponse {
  content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stop_reason?: string;
  model?: string;
}

export interface StubUpstreamOptions {
  responses: StubResponse[];
}

export class StubUpstream {
  private server: Server | null = null;
  private responseIndex = 0;
  private readonly responses: StubResponse[];
  private port = 0;

  constructor(options: StubUpstreamOptions) {
    this.responses = options.responses;
  }

  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (typeof addr === "object" && addr) {
          this.port = addr.port;
        }
        resolve(this.port);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    return this.port;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "POST" || !req.url?.endsWith("/v1/messages")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      const stubResponse = this.responses[this.responseIndex];
      if (!stubResponse) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: "No more stub responses" }));
        return;
      }
      this.responseIndex++;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      const isStreaming = parsed.stream === true;
      const response = this.buildResponse(stubResponse);

      if (isStreaming) {
        this.sendStreaming(res, response);
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      }
    });
  }

  private buildResponse(stub: StubResponse): Record<string, unknown> {
    return {
      id: `msg_stub_${this.responseIndex}`,
      type: "message",
      role: "assistant",
      content: stub.content,
      model: stub.model ?? "claude-sonnet-4-20250514",
      stop_reason: stub.stop_reason ?? "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    };
  }

  private sendStreaming(res: ServerResponse, response: Record<string, unknown>): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const content = response.content as Array<Record<string, unknown>>;

    res.write(
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: {
          ...response,
          content: [],
          stop_reason: null,
          usage: { input_tokens: (response.usage as Record<string, number>).input_tokens, output_tokens: 0 },
        },
      })}\n\n`,
    );

    for (let i = 0; i < content.length; i++) {
      const block = content[i];

      const startBlock: Record<string, unknown> =
        block.type === "tool_use"
          ? { type: "tool_use", id: block.id, name: block.name, input: {} }
          : { type: block.type, text: "" };

      res.write(
        `event: content_block_start\ndata: ${JSON.stringify({
          type: "content_block_start",
          index: i,
          content_block: startBlock,
        })}\n\n`,
      );

      if (block.type === "text" && block.text) {
        res.write(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            index: i,
            delta: { type: "text_delta", text: block.text },
          })}\n\n`,
        );
      } else if (block.type === "tool_use" && block.input) {
        res.write(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            index: i,
            delta: {
              type: "input_json_delta",
              partial_json: JSON.stringify(block.input),
            },
          })}\n\n`,
        );
      }

      res.write(
        `event: content_block_stop\ndata: ${JSON.stringify({
          type: "content_block_stop",
          index: i,
        })}\n\n`,
      );
    }

    res.write(
      `event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: {
          stop_reason: response.stop_reason,
          stop_sequence: null,
        },
        usage: { output_tokens: (response.usage as Record<string, number>).output_tokens },
      })}\n\n`,
    );

    res.write(
      `event: message_stop\ndata: ${JSON.stringify({
        type: "message_stop",
      })}\n\n`,
    );

    res.end();
  }
}
