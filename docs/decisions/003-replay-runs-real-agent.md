# ADR-003: Replay runs the real agent binary

**Status:** Accepted  
**Date:** 2026-08-15

## Context

Replay could either simulate the agent's actions from the recording (video-playback style) or run the real agent binary with recorded model responses served from the proxy.

## Decision

Only the model is a fixture. The agent genuinely executes, dispatches tools, and writes files. The proxy serves recorded responses instead of forwarding to the upstream API.

## Rationale

This makes replay a real test of the harness and environment rather than video playback. The agent's tool dispatch logic, error handling, and file operations are exercised for real, catching regressions that a pure log replay would miss.

## Consequences

- Replay mutates the filesystem — requires worktree isolation (D-006).
- The agent binary must be installed in the replay environment.
- Agents that check for API key validity at startup need a dummy key.
