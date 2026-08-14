# ADR-008: trace.json is a flat, append-only event log

**Status:** Accepted  
**Date:** 2026-08-15

## Context

The trace format could be a nested tree of steps, a structured protocol, or a flat log.

## Decision

`trace.json` is a flat, append-only event log. Events carry `seq` and a type named after an observable boundary:

- `model.request`, `model.response`
- `tool.call`, `tool.result`
- `fs.write`, `fs.delete`, `fs.move`
- `process.start`, `process.exit`
- `network.request`, `network.response`
- `env.read`
- `assertion`

## Rationale

- Append-only matches how recording actually works — events are written as they arrive.
- Flat structure stays extensible as capture layers are added in v0.4.
- No nesting means no parent-pointer bookkeeping or orphaned subtrees on crash.

## Consequences

- Consumers that want a tree view (e.g., `repro inspect`) must reconstruct it from event types and sequence numbers.
- Parallel tool calls need a `parallel_group` id to express concurrency without nesting.
