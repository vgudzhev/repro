# ADR-014: Anthropic Messages API shape first

**Status:** Accepted  
**Date:** 2026-08-15  
**Resolves:** §9 Q2 (Which provider API shape first?)

## Context

The proxy must understand at least one provider's API shape to normalize requests, extract tool calls, and handle streaming. We can only do one first.

## Decision

Anthropic Messages API first.

## Rationale

- The DoD demo is `repro record -- claude`. Claude Code is the primary target agent.
- The Anthropic Messages API has a clean, well-documented structure: `messages` array with typed content blocks, tool use blocks, and tool result blocks.
- SSE streaming uses standard `event: message_start`, `content_block_delta`, etc.
- Second provider (OpenAI Chat Completions) is explicitly v0.4 scope.

## Consequences

- Request normalization, hash computation, and streaming reassembly are built for the Anthropic shape.
- The proxy architecture must be provider-aware but the abstraction boundary sits between "parse provider format" and "store normalized events."
- OpenAI-shaped agents (Codex, Cursor) are unsupported in v0.1. The README must say so.
