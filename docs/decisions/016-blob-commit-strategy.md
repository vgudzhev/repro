# ADR-016: Blobs default to slim mode; full blobs via git-lfs

**Status:** Accepted  
**Date:** 2026-08-15  
**Resolves:** §9 Q4 (Do blobs get committed?)

## Context

A single trace can produce 5–50 MB of blobs (full model request/response payloads). Committing them makes the repo self-contained and PRs reviewable; not committing keeps the repo small.

## Decision

- **Default (`--slim`):** tool I/O blobs (tool calls, tool results) are committed. Full model request/response payloads are stored locally but gitignored.
- **`--full`:** all blobs are committed. Recommended only with git-lfs.
- **`.repro/<id>/trace.json`** and **`.repro/<id>/assertions.json`** are always committed.
- **`.repro/<id>/blobs/`** is gitignored by default (covered by `.gitignore` pattern `.repro/*/blobs/`).

## Rationale

Tool I/O is what matters for assertions and debugging — it shows what the agent read and wrote. Full model payloads are needed only for replay, and replay can re-download or be run from a full local copy. The slim default keeps PRs reviewable and repos under 1 MB per trace.

## Consequences

- `repro run` requires the blobs directory to be populated (from a prior `repro record` or by fetching from lfs).
- The gitignore pattern `.repro/*/blobs/` is set in the project `.gitignore` during `repro init`.
- `repro save --full` commits blobs and warns about repo size.
