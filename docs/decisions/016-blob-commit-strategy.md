# ADR-016: Blob commit strategy

**Status:** Accepted  
**Date:** 2026-08-15  
**Resolves:** §9 Q4 (Do blobs get committed?)

## Context

A single trace can produce 5–50 MB of blobs (full model request/response payloads). Committing them makes the repo self-contained and PRs reviewable; not committing keeps the repo small.

## Decision

- **v0.1:** All blobs are gitignored (`.repro/*/blobs/`). `repro test` replays from local blobs produced by a prior `repro record`. This keeps the repo small and unblocks the core loop.
- **v0.2 (planned):** Introduce `--slim` (commit only tool I/O blobs) and `--full` (commit all blobs, recommended with git-lfs). This requires splitting blobs by category (model payload vs. tool I/O) at write time.
- **`.repro/<id>/trace.json`** and **`.repro/<id>/assertions.json`** are always committed.

## Rationale

The `--slim`/`--full` split adds complexity (blob categorization, selective gitignore) that isn't needed for v0.1's goal: hermetic replay from a local recording. Deferring it avoids half-implemented code paths. The gitignore pattern already covers all blobs, so adding the split later is backwards-compatible.

## Consequences

- `repro test` on a fresh clone will fail if blobs are not present locally. This is a known limitation of v0.1.
- The workaround is to re-record (`repro record`) before running `repro test` on a new machine.
- v0.2 will address this with selective blob commits.
