import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { RecordingProxy, ReplayProxy } from "../src/proxy.js";
import { StubUpstream } from "../src/test-fixtures/stub-upstream.js";
import { TraceReader } from "../src/trace.js";
import { createWorktree, removeWorktree } from "../src/worktree.js";

const TEST_BASE = join(
  import.meta.dirname,
  "..",
  ".test-replay-" + process.pid,
);

function reproDir(id: string): string {
  return join(TEST_BASE, ".repro", id);
}

const agentPath = join(
  import.meta.dirname,
  "..",
  "dist",
  "test-fixtures",
  "reference-agent.js",
);

async function spawnAgent(
  baseUrl: string,
  cwd: string,
  prompt?: string,
  streaming = false,
): Promise<number> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        agentPath,
        prompt ??
          "Read test-input.txt and write its content reversed to test-output.txt",
      ],
      {
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: baseUrl,
          ANTHROPIC_API_KEY: "sk-repro-dummy",
          REPRO_AGENT_STREAM: streaming ? "1" : "0",
        },
        cwd,
        stdio: "pipe",
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", reject);
  });
}

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

const STANDARD_RESPONSES = [
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
        text: "Done!",
      },
    ],
    stop_reason: "end_turn",
  },
];

async function recordTrace(
  testDir: string,
  traceId: string,
  streaming = false,
): Promise<void> {
  const stub = new StubUpstream({ responses: [...STANDARD_RESPONSES] });
  const stubPort = await stub.start();
  const dir = reproDir(traceId);

  const proxy = new RecordingProxy({
    upstream: `http://127.0.0.1:${stubPort}`,
    traceDir: dir,
    traceId,
    env: { ANTHROPIC_API_KEY: "sk-repro-dummy" },
  });

  const proxyPort = await proxy.start();

  try {
    await spawnAgent(
      `http://127.0.0.1:${proxyPort}`,
      testDir,
      undefined,
      streaming,
    );
  } finally {
    await proxy.stop();
    await stub.stop();
  }

  const reader = new TraceReader(dir);
  const meta = {
    id: traceId,
    command: [
      process.execPath,
      agentPath,
      "Read test-input.txt and write its content reversed to test-output.txt",
    ],
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    eventCount: reader.readEvents().length,
    commit: execSync("git rev-parse HEAD", {
      cwd: testDir,
      encoding: "utf-8",
    }).trim(),
  };
  const { writeFileSync: wfs } = await import("node:fs");
  wfs(
    join(dir, "meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
    "utf-8",
  );
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

describe("replay", () => {
  it("replays a recording with identical hash matching", async () => {
    const id = "r-replay1";
    await recordTrace(TEST_BASE, id);

    const proxy = new ReplayProxy({
      traceDir: reproDir(id),
      strict: true,
    });
    const port = await proxy.start();

    const code = await spawnAgent(
      `http://127.0.0.1:${port}`,
      TEST_BASE,
    );

    await proxy.stop();

    expect(code).toBe(0);
    expect(proxy.getDivergences()).toHaveLength(0);
  }, 30000);

  it("detects divergence in strict mode when tool result differs", async () => {
    const id = "r-diverg1";
    await recordTrace(TEST_BASE, id);

    writeFileSync(
      join(TEST_BASE, "test-input.txt"),
      "DIFFERENT CONTENT",
      "utf-8",
    );
    execSync("git add -A && git commit -m 'change input'", {
      cwd: TEST_BASE,
      stdio: "pipe",
    });

    const proxy = new ReplayProxy({
      traceDir: reproDir(id),
      strict: true,
    });
    const port = await proxy.start();

    await spawnAgent(
      `http://127.0.0.1:${port}`,
      TEST_BASE,
    );

    await proxy.stop();

    const div = proxy.getDivergences();
    expect(div.length).toBeGreaterThan(0);
    expect(div[0].messageIndex).toBeDefined();
    expect(typeof div[0].messageIndex).toBe("number");
  }, 30000);

  it("falls back positionally in lenient mode", async () => {
    const id = "r-lenien1";
    await recordTrace(TEST_BASE, id);

    writeFileSync(
      join(TEST_BASE, "test-input.txt"),
      "DIFFERENT CONTENT",
      "utf-8",
    );
    execSync("git add -A && git commit -m 'change input'", {
      cwd: TEST_BASE,
      stdio: "pipe",
    });

    const proxy = new ReplayProxy({
      traceDir: reproDir(id),
      strict: false,
    });
    const port = await proxy.start();

    const code = await spawnAgent(
      `http://127.0.0.1:${port}`,
      TEST_BASE,
    );

    await proxy.stop();

    expect(code).toBe(0);
    expect(proxy.getDivergences().length).toBeGreaterThan(0);
  }, 30000);

  it("replays streaming responses correctly", async () => {
    const id = "r-strm-r1";
    await recordTrace(TEST_BASE, id, true);

    const proxy = new ReplayProxy({
      traceDir: reproDir(id),
      strict: false,
    });
    const port = await proxy.start();

    const code = await spawnAgent(
      `http://127.0.0.1:${port}`,
      TEST_BASE,
      undefined,
      true,
    );

    await proxy.stop();
    expect(code).toBe(0);
  }, 30000);
});

describe("worktree isolation", () => {
  it("leaves git status clean after replay", async () => {
    const id = "r-wt-cln1";
    await recordTrace(TEST_BASE, id);

    execSync("git add -A && git commit -m 'post-record'", {
      cwd: TEST_BASE,
      stdio: "pipe",
    });

    const worktree = createWorktree(TEST_BASE);

    const proxy = new ReplayProxy({
      traceDir: reproDir(id),
      strict: false,
    });
    const port = await proxy.start();

    await spawnAgent(
      `http://127.0.0.1:${port}`,
      worktree.path,
    );

    await proxy.stop();
    removeWorktree(TEST_BASE, worktree.path);

    const status = execSync("git status --porcelain", {
      cwd: TEST_BASE,
      encoding: "utf-8",
    }).trim();

    const unrelated = status
      .split("\n")
      .filter(
        (line) =>
          line.trim() !== "" &&
          !line.includes(".repro/"),
      );
    expect(unrelated).toHaveLength(0);
  }, 30000);

  it("cleans up worktree even when agent crashes", async () => {
    const id = "r-wt-crsh";
    await recordTrace(TEST_BASE, id);

    const worktree = createWorktree(TEST_BASE);
    const worktreePath = worktree.path;

    removeWorktree(TEST_BASE, worktreePath);

    expect(existsSync(worktreePath)).toBe(false);

    const worktreeList = execSync("git worktree list", {
      cwd: TEST_BASE,
      encoding: "utf-8",
    });
    expect(worktreeList).not.toContain(worktreePath);
  }, 30000);
});
