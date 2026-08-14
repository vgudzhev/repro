import type { TraceEvent } from "./types.js";

export type DivergenceType =
  | "args_changed"
  | "tool_changed"
  | "event_inserted"
  | "event_dropped"
  | "result_changed"
  | "match";

export interface AlignedPair {
  a: TraceEvent | null;
  b: TraceEvent | null;
  divergence: DivergenceType;
}

function eventKey(event: TraceEvent): string {
  const body = event.data.body as Record<string, unknown> | undefined;
  if (!body) return event.type;

  const blocks = collectAllContentBlocks(body);
  const toolNames = blocks
    .filter((b) => b.type === "tool_use" || b.type === "tool_result")
    .map((b) => (b.name as string) ?? (b.tool_use_id as string) ?? "")
    .filter(Boolean);

  if (toolNames.length > 0) {
    return `${event.type}:${toolNames.join(",")}`;
  }

  return event.type;
}

function lcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

export function alignTraces(
  eventsA: TraceEvent[],
  eventsB: TraceEvent[],
): AlignedPair[] {
  const keysA = eventsA.map(eventKey);
  const keysB = eventsB.map(eventKey);

  const dp = lcs(keysA, keysB);

  let i = keysA.length;
  let j = keysB.length;

  const result: AlignedPair[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && keysA[i - 1] === keysB[j - 1]) {
      const divergence = classifyPair(eventsA[i - 1], eventsB[j - 1]);
      result.push({ a: eventsA[i - 1], b: eventsB[j - 1], divergence });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({
        a: null,
        b: eventsB[j - 1],
        divergence: "event_inserted",
      });
      j--;
    } else {
      result.push({
        a: eventsA[i - 1],
        b: null,
        divergence: "event_dropped",
      });
      i--;
    }
  }

  return result.reverse();
}

function collectAllContentBlocks(
  body: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];

  if (Array.isArray(body.content)) {
    blocks.push(...(body.content as Array<Record<string, unknown>>));
  }

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages as Array<Record<string, unknown>>) {
      if (Array.isArray(msg.content)) {
        blocks.push(...(msg.content as Array<Record<string, unknown>>));
      }
    }
  }

  return blocks;
}

function classifyPair(a: TraceEvent, b: TraceEvent): DivergenceType {
  if (a.type !== b.type) return "tool_changed";

  const bodyA = a.data.body as Record<string, unknown> | undefined;
  const bodyB = b.data.body as Record<string, unknown> | undefined;

  if (!bodyA && !bodyB) return "match";
  if (!bodyA || !bodyB) return "args_changed";

  if (a.type === "model.response" || a.type === "model.request") {
    const hashA = a.data.normalizedHash as string | undefined;
    const hashB = b.data.normalizedHash as string | undefined;
    if (hashA && hashB && hashA === hashB) return "match";
  }

  const allBlocksA = collectAllContentBlocks(bodyA);
  const allBlocksB = collectAllContentBlocks(bodyB);

  if (allBlocksA.length > 0 && allBlocksB.length > 0) {
    const toolsA = allBlocksA.filter((c) => c.type === "tool_use");
    const toolsB = allBlocksB.filter((c) => c.type === "tool_use");

    if (toolsA.length > 0 && toolsB.length > 0) {
      const namesA = toolsA.map((t) => t.name).join(",");
      const namesB = toolsB.map((t) => t.name).join(",");
      if (namesA !== namesB) return "tool_changed";

      const argsA = JSON.stringify(toolsA.map((t) => t.input));
      const argsB = JSON.stringify(toolsB.map((t) => t.input));
      if (argsA !== argsB) return "args_changed";
    }

    const resultsA = allBlocksA.filter((c) => c.type === "tool_result");
    const resultsB = allBlocksB.filter((c) => c.type === "tool_result");
    if (resultsA.length > 0 && resultsB.length > 0) {
      const resA = JSON.stringify(resultsA.map((r) => r.content));
      const resB = JSON.stringify(resultsB.map((r) => r.content));
      if (resA !== resB) return "result_changed";
    }
  }

  const strA = JSON.stringify(bodyA);
  const strB = JSON.stringify(bodyB);
  if (strA !== strB) return "args_changed";

  return "match";
}

export interface ExplainResult {
  firstDivergence: AlignedPair | null;
  divergenceIndex: number;
  isEnvironmentDrift: boolean;
  summary: string;
  downstreamCount: number;
}

export function explainDivergence(aligned: AlignedPair[]): ExplainResult {
  let firstIdx = -1;
  for (let i = 0; i < aligned.length; i++) {
    if (aligned[i].divergence !== "match") {
      firstIdx = i;
      break;
    }
  }

  if (firstIdx === -1) {
    return {
      firstDivergence: null,
      divergenceIndex: -1,
      isEnvironmentDrift: false,
      summary: "Traces are identical.",
      downstreamCount: 0,
    };
  }

  const first = aligned[firstIdx];
  const downstreamCount = aligned
    .slice(firstIdx + 1)
    .filter((p) => p.divergence !== "match").length;

  const isEnvironmentDrift =
    firstIdx <= 2 && first.divergence === "result_changed";

  let summary: string;
  if (isEnvironmentDrift) {
    summary =
      "The first tool result differs from the recording — this usually means the environment has changed since recording. Consider re-recording.";
  } else {
    const loc = first.a
      ? `seq ${first.a.seq}`
      : first.b
        ? `seq ${first.b.seq}`
        : "unknown";
    summary = `First divergence at ${loc}: ${first.divergence}. ${downstreamCount} downstream event(s) also differ.`;
  }

  return {
    firstDivergence: first,
    divergenceIndex: firstIdx,
    isEnvironmentDrift,
    summary,
    downstreamCount,
  };
}
