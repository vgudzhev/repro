# ADR-002: The proxy sees the entire tool loop

**Status:** Accepted  
**Date:** 2026-08-15

## Context

Agent tool loops are round-trips through the model API: the model response contains tool invocations, the agent executes them, and the results are sent back in the next request's message array. We need to decide whether the proxy captures only model calls or the full conversation.

## Decision

The proxy captures the complete conversation including tool calls (in model responses) and tool results (in subsequent requests). The entire tool loop reconstructs from API traffic alone.

## Rationale

Tool invocations arrive inside model responses; tool results are sent back up in the next request. No additional instrumentation is needed — the proxy already sees everything.

## Consequences

- What the proxy does **not** see is what tools did to the machine. A `write_file` result says `ok`; only the filesystem knows which bytes changed.
- v0.1 records side effects as reported by the agent, not as observed on disk. The README must state this limitation.
- Filesystem/process capture layers are deferred to v0.4.
