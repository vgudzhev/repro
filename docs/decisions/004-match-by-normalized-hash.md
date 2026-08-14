# ADR-004: Replay matches requests by normalized hash, not sequence number

**Status:** Accepted  
**Date:** 2026-08-15

## Context

This is the single most important implementation decision in the project.

If any tool result differs from recording time (a changed file, a moved `git log`, a timestamp), the agent sends a different request than it originally did. Serving response N by position means the model is "answering" a conversation it never saw. The run completes, looks plausible, and proves nothing. This failure is silent.

## Decision

1. Normalize the request: drop volatile fields (request ids, timestamps, cache breakpoints), canonicalize JSON key ordering.
2. Hash the full message array. Also store a per-message hash chain so a mismatch localizes to the exact diverging message.
3. Hit → serve the recorded response. Miss → the agent has diverged.
4. On miss: `--strict` (default for `repro test`) aborts and reports the diverging message with a diff. `--lenient` falls back to positional matching, warns loudly, and marks the trace `diverged`.

## Rationale

Divergence detection falls out of the replay engine for free. The per-message hash chain pinpoints which message diverged and how, unlike cassette libraries that produce opaque unmatched-request errors.

## Consequences

- The volatile-fields exclusion list must be defined once and shared between this ADR and D-005 normalization. See ADR-017 for cache breakpoints specifically.
- `repro diff` becomes a reporting layer over data that already exists.
- Strict mode is default for CI (`repro test`); lenient mode exists for debugging.
