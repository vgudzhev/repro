import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { RecordingProxy, ReplayProxy } from "../src/proxy.js";
import { StubUpstream } from "../src/test-fixtures/stub-upstream.js";
import { TraceReader } from "../src/trace.js";
import { evaluateAssertions } from "../src/assertions.js";
import {
  scaffoldRepro,
  addEntry,
  readManifest,
} from "../src/manifest.js";
import { createWorktree, removeWorktree } from "../src/worktree.js";
import type { AssertionDef } from "../src/types.js";

const TEST_BASE = join(
  import.meta.dirname,
  "..",
  ".test-fullloop-" + process.pid,
);

const agentPath = join(
  import.meta.dirname,
  "..",
  "dist",
  "test-fixtures",
  "reference-agent.js",
);

function initGitRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: "pipe",
  });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "test-input.txt"), "hello world", "utf-8");
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: dir, stdio: "pipe" });
}

async function spawnAgent(
  baseUrl: string,
  cwd: string,
): Promise<number> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        agentPath,
        "Read test-input.txt and write its content reversed to test-output.txt",
      ],
      {
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: baseUrl,
          ANTHROPIC_API_KEY: "sk-repro-dummy",
          REPRO_AGENT_STREAM: "0",
        },
        cwd,
        stdio: "pipe",
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", reject);
  });
}

beforeEach(() => {
  initGitRepo(TEST_BASE);
});

afterEach(() => {
  try {
    execSync("git worktree prune", { cwd: TEST_BASE, stdio: "pipe" });
  } catch {
    // ignore
  }
  rmSync(TEST_BASE, { recursive: true, force: true });
});

describe("full loop: record → save → test", () => {
  it("complete flow passes with no assertion violations", async () => {
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
          content: [{ type: "text", text: "Done!" }],
          stop_reason: "end_turn",
        },
      ],
    });

    const stubPort = await stub.start();
    const traceId = "r-full01";
    const traceDir = join(TEST_BASE, ".repro", traceId);

    // 1. Record
    const proxy = new RecordingProxy({
      upstream: `http://127.0.0.1:${stubPort}`,
      traceDir,
      traceId,
      env: { ANTHROPIC_API_KEY: "sk-repro-dummy" },
    });
    const proxyPort = await proxy.start();
    await spawnAgent(`http://127.0.0.1:${proxyPort}`, TEST_BASE);
    await proxy.stop();
    await stub.stop();

    const reader = new TraceReader(traceDir);
    const eventCount = reader.readEvents().length;
    const commit = execSync("git rev-parse HEAD", {
      cwd: TEST_BASE,
      encoding: "utf-8",
    }).trim();
    writeFileSync(
      join(traceDir, "meta.json"),
      JSON.stringify({
        id: traceId,
        command: [
          process.execPath,
          agentPath,
          "Read test-input.txt and write its content reversed to test-output.txt",
        ],
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        eventCount,
        commit,
      }, null, 2) + "\n",
      "utf-8",
    );

    // 2. Save
    scaffoldRepro(TEST_BASE);
    const assertions: AssertionDef[] = [
      { type: "max_calls", args: { max: 10 } },
      { type: "forbidden_path", args: { pattern: "danger/**" } },
    ];
    writeFileSync(
      join(traceDir, "assertions.json"),
      JSON.stringify(assertions, null, 2) + "\n",
      "utf-8",
    );
    addEntry(TEST_BASE, {
      id: traceId,
      title: "Test full loop",
      status: "open",
      firstSeen: "2026-08-15",
    });

    const manifest = readManifest(TEST_BASE);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].id).toBe(traceId);

    // Commit everything for worktree
    execSync("git add -A && git commit -m 'post-record'", {
      cwd: TEST_BASE,
      stdio: "pipe",
    });

    // 3. Test (replay + assertions)
    const replayProxy = new ReplayProxy({
      traceDir,
      strict: false,
    });
    const replayPort = await replayProxy.start();

    const worktree = createWorktree(TEST_BASE);

    const replayCode = await spawnAgent(
      `http://127.0.0.1:${replayPort}`,
      worktree.path,
    );
    await replayProxy.stop();

    const events = reader.readEvents();
    const results = evaluateAssertions(assertions, events, worktree.path);

    removeWorktree(TEST_BASE, worktree.path);

    expect(replayCode).toBe(0);
    expect(results.every((r) => r.passed)).toBe(true);
  }, 60000);

  it("detects assertion violation in test mode", async () => {
    const stub = new StubUpstream({
      responses: [
        {
          content: [
            {
              type: "tool_use",
              id: "toolu_01",
              name: "write_file",
              input: { path: "src/gen/evil.ts", content: "bad code" },
            },
          ],
          stop_reason: "tool_use",
        },
        {
          content: [{ type: "text", text: "Done!" }],
          stop_reason: "end_turn",
        },
      ],
    });

    const stubPort = await stub.start();
    const traceId = "r-fail01";
    const traceDir = join(TEST_BASE, ".repro", traceId);

    const proxy = new RecordingProxy({
      upstream: `http://127.0.0.1:${stubPort}`,
      traceDir,
      traceId,
      env: { ANTHROPIC_API_KEY: "sk-repro-dummy" },
    });
    const proxyPort = await proxy.start();
    await spawnAgent(`http://127.0.0.1:${proxyPort}`, TEST_BASE);
    await proxy.stop();
    await stub.stop();

    const reader = new TraceReader(traceDir);
    const events = reader.readEvents();

    const assertions: AssertionDef[] = [
      { type: "forbidden_path", args: { pattern: "src/gen/**" } },
    ];

    const results = evaluateAssertions(assertions, events);
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain("src/gen/evil.ts");
  }, 30000);
});
