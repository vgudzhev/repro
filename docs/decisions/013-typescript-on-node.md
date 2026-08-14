# ADR-013: TypeScript on Node.js

**Status:** Accepted  
**Date:** 2026-08-15  
**Resolves:** §9 Q1 (Language and runtime)

## Context

The project needs a language/runtime for the CLI. Candidates: TypeScript/Node, Python, Go.

## Decision

TypeScript on Node.js.

## Rationale

- The DoD (§8) specifies `npx repro init` — that's npm distribution.
- SSE handling is native in Node's fetch/streams.
- The agent ecosystem is npm-shaped (Claude Code, Codex CLI).
- Development speed matches the scope of v0.1.

## Noted tension

Python would be easier for the `ddmin` minimization work in v0.3 (D-012), where the academic implementations are in Python. This is a v0.3 concern; if it becomes blocking, a Python subprocess or port is viable then.

## Consequences

- All source in `src/`, TypeScript strict mode.
- Distribution via npm (`npx repro`).
- Go's single-binary advantage is forfeited; `npx` is the distribution substitute.
