# ADR-015: TLS is a non-issue for v0.1

**Status:** Accepted  
**Date:** 2026-08-15  
**Resolves:** §9 Q3 (TLS and certificate pinning)

## Context

§9 Q3 asks how to handle agents that pin certificates, given that "the proxy terminates TLS."

## Decision

The question's premise is incorrect and the question is dissolved.

With `ANTHROPIC_BASE_URL=http://127.0.0.1:<PORT>`, the agent speaks **plain HTTP** to localhost. The proxy makes its own HTTPS connection to the upstream API. The agent never sees a TLS certificate from the proxy, so cert pinning is irrelevant.

## Actual limitation

Agents that **ignore** the base-URL env var or hardcode the upstream API host are unsupported. This is not a TLS problem — it is a "the agent does not respect configuration" problem.

## Consequences

- No CA injection, no self-signed cert generation, no mkcert dependency.
- The README documents which agents respect `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`.
- If an agent only speaks HTTPS to localhost (unlikely but possible), the proxy can add a `--tls` flag later with a self-signed cert. Not in v0.1.
