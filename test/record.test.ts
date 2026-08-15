import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RecordingProxy } from "../src/proxy.js";
import { StubUpstream } from "../src/test-fixtures/stub-upstream.js";
import { TraceReader } from "../src/trace.js";

const TEST_BASE = join(
  import.meta.dirname,
  "..",
  ".test-record-" + process.pid,
);

function traceDir(id: string): string {
  return join(TEST_BASE, ".repro", id);
}

beforeEach(() => {
  mkdirSync(TEST_BASE, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true });
});

async function runReferenceAgent(
  baseUrl: string,
  workDir: string,
  streaming = false,
): Promise<void> {
  writeFileSync(join(workDir, "test-input.txt"), "hello world", "utf-8");

  const agentPath = join(import.meta.dirname, "..", "dist", "test-fixtures", "reference-agent.js");

  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [agentPath, "Read test-input.txt and write its content reversed to test-output.txt"],
      {
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: baseUrl,
          ANTHROPIC_API_KEY: "sk-repro-dummy",
          REPRO_AGENT_STREAM: streaming ? "1" : "0",
        },
        cwd: workDir,
        stdio: "pipe",
      },
    );

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Agent exited with code ${code}: ${stderr}`));
    });
    child.on("error", reject);
  });
}

describe("full record loop", () => {
  it("records a complete trace with reference agent + stub upstream", async () => {
    const stub = new StubUpstream({
      responses: [
        {
          content: [
            {
              type: "tool_use",
              id: "toolu_01",
              name: "read_file",
              input: { path: "test-input.txt" },
            },
          ],
          stop_reason: "tool_use",
        },
        {
          content: [
            {
              type: "tool_use",
              id: "toolu_02",
              name: "write_file",
              input: { path: "test-output.txt", content: "dlrow olleh" },
            },
          ],
          stop_reason: "tool_use",
        },
        {
          content: [
            {
              type: "text",
              text: "Done! I've read test-input.txt and written the reversed content to test-output.txt.",
            },
          ],
          stop_reason: "end_turn",
        },
      ],
    });

    const stubPort = await stub.start();
    const id = "r-test01";
    const dir = traceDir(id);

    const proxy = new RecordingProxy({
      upstream: `http://127.0.0.1:${stubPort}`,
      traceDir: dir,
      traceId: id,
      env: { ANTHROPIC_API_KEY: "sk-repro-dummy" },
    });

    const proxyPort = await proxy.start();
    const baseUrl = `http://127.0.0.1:${proxyPort}`;

    try {
      await runReferenceAgent(baseUrl, TEST_BASE);
    } finally {
      await proxy.stop();
      await stub.stop();
    }

    const reader = new TraceReader(dir);
    expect(reader.exists()).toBe(true);

    const events = reader.readEvents();
    expect(events.length).toBeGreaterThanOrEqual(6);

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "model.request").length).toBe(3);
    expect(types.filter((t) => t === "model.response").length).toBe(3);

    for (let i = 1; i < events.length; i++) {
      expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
    }

    const firstReq = events.find((e) => e.type === "model.request");
    expect(firstReq).toBeDefined();
    expect(firstReq!.data.normalizedHash).toBeDefined();
    expect(firstReq!.data.messageHashes).toBeDefined();
  }, 30000);

  it("records streaming responses as reassembled messages", async () => {
    const stub = new StubUpstream({
      responses: [
        {
          content: [
            {
              type: "text",
              text: "Hello from streaming!",
            },
          ],
          stop_reason: "end_turn",
        },
      ],
    });

    const stubPort = await stub.start();
    const id = "r-stream1";
    const dir = traceDir(id);

    const proxy = new RecordingProxy({
      upstream: `http://127.0.0.1:${stubPort}`,
      traceDir: dir,
      traceId: id,
      env: { ANTHROPIC_API_KEY: "sk-repro-dummy" },
    });

    const proxyPort = await proxy.start();
    const baseUrl = `http://127.0.0.1:${proxyPort}`;

    try {
      writeFileSync(join(TEST_BASE, "test-input.txt"), "hello", "utf-8");
      await runReferenceAgent(baseUrl, TEST_BASE, true);
    } finally {
      await proxy.stop();
      await stub.stop();
    }

    const reader = new TraceReader(dir);
    const events = reader.readEvents();
    const responseEvents = events.filter((e) => e.type === "model.response");

    expect(responseEvents.length).toBe(1);
    expect(responseEvents[0].data.streaming).toBe(true);

    const body = reader.resolveEventData(responseEvents[0]).body as Record<string, unknown>;
    expect(body.type).toBe("message");
    const content = body.content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("Hello from streaming!");
  }, 30000);
});

describe("accept-encoding stripping", () => {
  it("does not forward accept-encoding to upstream", async () => {
    let capturedHeaders: Record<string, string | string[] | undefined> = {};

    const { createServer: createHttpServer } = await import("node:http");
    const headerCapture = createHttpServer((req, res) => {
      if (req.url?.includes("/v1/messages")) {
        capturedHeaders = { ...req.headers };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_hdr_01",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          model: "claude-sonnet-4-20250514",
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 2 },
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const upstreamPort = await new Promise<number>((resolve) => {
      headerCapture.listen(0, "127.0.0.1", () => {
        const addr = headerCapture.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const id = "r-hdr01";
    const dir = traceDir(id);
    const proxy = new RecordingProxy({
      upstream: `http://127.0.0.1:${upstreamPort}`,
      traceDir: dir,
      traceId: id,
      env: { ANTHROPIC_API_KEY: "sk-repro-dummy" },
    });

    const proxyPort = await proxy.start();

    try {
      await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "sk-repro-dummy",
          "anthropic-version": "2023-06-01",
          "Accept-Encoding": "gzip, deflate, br",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 100,
          messages: [{ role: "user", content: "hi" }],
        }),
      });

      expect(capturedHeaders["accept-encoding"]).toBeUndefined();
    } finally {
      await proxy.stop();
      headerCapture.close();
    }
  }, 10000);
});

describe("redaction integration", () => {
  it("never writes a known secret to disk", async () => {
    const fakeSecret = "sk-ant-api03-FAKE-SECRET-KEY-THAT-MUST-NOT-APPEAR-IN-TRACE-abcdef123456";

    const stub = new StubUpstream({
      responses: [
        {
          content: [
            {
              type: "text",
              text: `Here is a secret: ${fakeSecret}`,
            },
          ],
          stop_reason: "end_turn",
        },
      ],
    });

    const stubPort = await stub.start();
    const id = "r-redact1";
    const dir = traceDir(id);

    const proxy = new RecordingProxy({
      upstream: `http://127.0.0.1:${stubPort}`,
      traceDir: dir,
      traceId: id,
      env: {
        ANTHROPIC_API_KEY: fakeSecret,
        MY_CUSTOM_SECRET: "custom-secret-value-that-is-sensitive",
      },
    });

    const proxyPort = await proxy.start();
    const baseUrl = `http://127.0.0.1:${proxyPort}`;

    try {
      writeFileSync(join(TEST_BASE, "test-input.txt"), "hello", "utf-8");
      await runReferenceAgent(baseUrl, TEST_BASE);
    } finally {
      await proxy.stop();
      await stub.stop();
    }

    const traceContent = readFileSync(join(dir, "trace.json"), "utf-8");
    expect(traceContent).not.toContain(fakeSecret);
    expect(traceContent).not.toContain("custom-secret-value-that-is-sensitive");
    expect(traceContent).toContain("[[redacted:");

    if (existsSync(join(dir, "blobs"))) {
      const { readdirSync } = await import("node:fs");
      const blobFiles = readdirSync(join(dir, "blobs"));
      for (const blobFile of blobFiles) {
        const blobContent = readFileSync(
          join(dir, "blobs", blobFile),
          "utf-8",
        );
        expect(blobContent).not.toContain(fakeSecret);
        expect(blobContent).not.toContain(
          "custom-secret-value-that-is-sensitive",
        );
      }
    }
  }, 30000);
});
