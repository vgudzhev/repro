# ADR-017: Cache breakpoints excluded from match hash

**Status:** Accepted  
**Date:** 2026-08-15  
**Resolves:** §9 Q5 (Prompt caching)

## Context

Anthropic's prompt caching uses `cache_control` breakpoints in message content. Cached prefixes mean the recorded request may not be what the model actually conditioned on. These breakpoints can shift between runs without changing the semantic content.

## Decision

- `cache_control` fields are captured in the raw trace for observability.
- They are **excluded** from the normalized request used for hash matching (D-004).
- The volatile-fields exclusion list is defined once in the normalization module and covers: request ids, timestamps, `cache_control` breakpoints, and any provider-specific metadata fields.

## Rationale

Cache breakpoints are a transport-level optimization hint, not semantic content. Including them in the match hash would cause false divergences when the cache state differs between record and replay.

## Consequences

- The normalization function strips `cache_control` before hashing but preserves it in the stored trace.
- This exclusion list is the single source of truth for both D-004 matching and D-005 normalization.
- Future providers may have their own caching mechanisms; the exclusion list is extensible.
