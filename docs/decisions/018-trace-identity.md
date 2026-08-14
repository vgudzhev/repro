# ADR-018: Trace identity is a random short id, not content-derived

**Status:** Accepted  
**Date:** 2026-08-15  
**Resolves:** §9 Q6 (Trace identity)

## Context

We need an `<id>` for each recording. Options: content hash (deterministic but changes on re-record), random id (stable slot but no integrity guarantee), or hybrid.

## Decision

Trace id is `r-<6 hex chars>` — a random short identifier generated at record time. Example: `r-7f3a91` (matching the demo in §8).

## Rationale

- A content-derived id changes every time the same failure is re-recorded (different timestamps, tool output, etc.), which breaks the `REPRO.md` row's identity. The id is a *slot* for a known failure, not a fingerprint of a specific recording.
- Content integrity is a separate concern handled by blob hashes (D-009) and future `repro verify` (§11).
- Short random ids are human-typeable and greppable.
- 6 hex chars = 16M possible ids. Collision probability is negligible for per-repo use.

## Consequences

- Re-recording a failure with `repro record --id r-7f3a91` overwrites the existing trace, keeping the REPRO.md row stable.
- `repro save` assigns a new id if none is specified.
- Integrity verification (manifest hash over blobs) is future work (§11), not embedded in the id.
