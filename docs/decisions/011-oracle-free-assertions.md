# ADR-011: Assertions are oracle-free in v0.1

**Status:** Accepted  
**Date:** 2026-08-15

## Context

Assertions that require a correctness oracle (LLM-graded "did the agent do the right thing?") produce false positives that destroy trust in a tool whose promise is "your agent went wrong."

## Decision

v0.1 ships only oracle-free assertions:

- `forbidden_path` — agent must not read/write specified paths
- `no_repeat` — agent must not repeat the same tool call N times
- `max_calls` — cap on total model API calls
- `command` — run a shell command; non-zero exit = failure

These need no judgement about what "correct" looked like.

## Rationale

The product is an agent regression test format. Formats spread; tools don't. `judge` assertions need a correctness oracle and their false positives would be fatal. The `command` assertion is the escape hatch — any check expressible as a shell script works.

## Consequences

- No LLM dependency in the assertion path. `repro test` needs no API key.
- `command` assertions give users arbitrary extensibility without framework complexity.
- `judge` assertions are explicitly deferred — do not build them.
