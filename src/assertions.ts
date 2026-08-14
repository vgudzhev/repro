import { execSync } from "node:child_process";
import type { TraceEvent, AssertionDef, AssertionResult } from "./types.js";

export function evaluateAssertions(
  assertions: AssertionDef[],
  events: TraceEvent[],
  worktreeDir?: string,
): AssertionResult[] {
  return assertions.map((assertion) =>
    evaluateOne(assertion, events, worktreeDir),
  );
}

function evaluateOne(
  assertion: AssertionDef,
  events: TraceEvent[],
  worktreeDir?: string,
): AssertionResult {
  switch (assertion.type) {
    case "forbidden_path":
      return evaluateForbiddenPath(assertion, events);
    case "no_repeat":
      return evaluateNoRepeat(assertion, events);
    case "max_calls":
      return evaluateMaxCalls(assertion, events);
    case "command":
      return evaluateCommand(assertion, worktreeDir);
    default:
      return {
        assertion,
        passed: false,
        message: `Unknown assertion type: ${assertion.type}`,
      };
  }
}

function matchGlob(pattern: string, path: string): boolean {
  const regexStr = pattern
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`^${regexStr}$`).test(path);
}

function extractPaths(event: TraceEvent): string[] {
  const paths: string[] = [];
  const data = event.data;

  if (data.body && typeof data.body === "object") {
    collectPaths(data.body as Record<string, unknown>, paths);
  }

  return paths;
}

function collectPaths(
  obj: Record<string, unknown>,
  paths: string[],
): void {
  if (typeof obj.path === "string") {
    paths.push(obj.path);
  }
  if (typeof obj.file_path === "string") {
    paths.push(obj.file_path);
  }

  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          collectPaths(item as Record<string, unknown>, paths);
        }
      }
    } else if (value && typeof value === "object") {
      collectPaths(value as Record<string, unknown>, paths);
    }
  }
}

function evaluateForbiddenPath(
  assertion: AssertionDef,
  events: TraceEvent[],
): AssertionResult {
  const pattern = assertion.args.pattern as string;
  const violations: string[] = [];

  for (const event of events) {
    const paths = extractPaths(event);
    for (const p of paths) {
      if (matchGlob(pattern, p)) {
        violations.push(`seq ${event.seq}: ${event.type} touched ${p}`);
      }
    }
  }

  return {
    assertion,
    passed: violations.length === 0,
    message:
      violations.length === 0
        ? `No paths matched ${pattern}`
        : `Forbidden path ${pattern} matched:\n  ${violations.join("\n  ")}`,
  };
}

function evaluateNoRepeat(
  assertion: AssertionDef,
  events: TraceEvent[],
): AssertionResult {
  const maxRepeats = (assertion.args.max as number) ?? 2;
  const responseEvents = events.filter((e) => e.type === "model.response");

  const toolCallCounts = new Map<string, number>();
  for (const event of responseEvents) {
    const body = event.data.body as Record<string, unknown> | undefined;
    if (!body?.content) continue;
    const content = body.content as Array<Record<string, unknown>>;
    for (const block of content) {
      if (block.type === "tool_use") {
        const name = block.name as string;
        const input = JSON.stringify(block.input ?? {});
        const key = `${name}:${input}`;
        toolCallCounts.set(key, (toolCallCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const violations: string[] = [];
  for (const [key, count] of toolCallCounts) {
    if (count > maxRepeats) {
      violations.push(`${key} repeated ${count} times (max ${maxRepeats})`);
    }
  }

  return {
    assertion,
    passed: violations.length === 0,
    message:
      violations.length === 0
        ? `No tool call repeated more than ${maxRepeats} times`
        : `Repeated tool calls:\n  ${violations.join("\n  ")}`,
  };
}

function evaluateMaxCalls(
  assertion: AssertionDef,
  events: TraceEvent[],
): AssertionResult {
  const max = assertion.args.max as number;
  const count = events.filter((e) => e.type === "model.request").length;

  return {
    assertion,
    passed: count <= max,
    message:
      count <= max
        ? `${count} model calls (max ${max})`
        : `${count} model calls exceeded max of ${max}`,
  };
}

function evaluateCommand(
  assertion: AssertionDef,
  worktreeDir?: string,
): AssertionResult {
  const command = assertion.args.command as string;
  const cwd = worktreeDir ?? process.cwd();

  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });
    return {
      assertion,
      passed: true,
      message: `Command succeeded: ${output.trim().slice(0, 200)}`,
    };
  } catch (err) {
    const error = err as { status?: number; stderr?: string; stdout?: string };
    return {
      assertion,
      passed: false,
      message: `Command failed (exit ${error.status}): ${(error.stderr ?? error.stdout ?? "").trim().slice(0, 200)}`,
    };
  }
}
