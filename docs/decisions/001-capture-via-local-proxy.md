# ADR-001: Capture at the model API boundary via a local proxy

**Status:** Accepted  
**Date:** 2026-08-15

## Context

We need a capture mechanism that works with any off-the-shelf coding agent CLI (Claude Code, Codex, Cursor, OpenHands) without requiring code changes to the agent or adoption of a specific runtime/framework. This is the primary differentiator over langchain-replay (LangChain-only) and cagent (own runtime only).

## Decision

The agent is pointed at `http://127.0.0.1:<PORT>` using `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`. A local HTTP proxy intercepts all model API traffic.

## Rationale

- Wrapping the process and scraping stdout yields rendered TTY output (spinners, ANSI, truncation), not structured events. Parsing it is brittle per-agent work that breaks every release.
- The proxy is model-agnostic by construction: any agent speaking a compatible API works.
- Needs zero code changes from the user.
- One chokepoint for redaction (D-007).

## Consequences

- Agents that ignore the base-URL env var or hardcode the API host are unsupported.
- The proxy speaks plain HTTP on localhost; upstream connections are HTTPS from the proxy.
- No cert-pinning issues arise because the agent never sees a TLS connection to localhost.
