# ADR-007: Redaction happens at capture time, in the proxy

**Status:** Accepted  
**Date:** 2026-08-15

## Context

A trace that captures a real API key once is a project nobody can adopt. Redaction cannot be deferred to a later phase or to read time.

## Decision

Redaction is applied in the proxy before anything touches disk:

1. Env var *values* are never captured (names only, unless allowlisted).
2. Known secret shapes are scrubbed: `sk-`, `ghp_`, `AKIA`, JWTs, PEM blocks, `Authorization` headers.
3. Path denylist defaults to `.env*`, `*.pem`, `*.key`, `**/secrets/**`.
4. Every removal is recorded as `[[redacted:<rule>:<sha256-prefix>]]`.

## Rationale

- Never-captured is strictly safer than captured-and-scrubbed.
- The proxy is the single chokepoint (D-001), making it the natural place for redaction.
- The `[[redacted:...]]` markers preserve structure for replay while preventing silent substitution.

## Consequences

- On replay, a redacted value must fail loudly — never substitute silently. A green test that replayed with silently replaced secrets proves nothing.
- Redaction ships in Phase 1, not later.
- The sha256-prefix in the marker allows detecting if the same secret appears elsewhere without storing the secret.
