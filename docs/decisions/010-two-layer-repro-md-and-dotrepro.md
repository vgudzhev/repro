# ADR-010: Two layers — REPRO.md committed and human-facing, .repro/ machine-readable

**Status:** Accepted  
**Date:** 2026-08-15

## Context

The project needs both human-readable documentation of known failures and machine-readable trace data for replay.

## Decision

Two layers:

- `REPRO.md` — committed to git, human-readable markdown manifest. Contains an index table of known failures with id, title, status, first-seen date. Reviewable in a PR.
- `.repro/` — machine-readable trace data. Contains `trace.json`, blobs, assertions, and metadata per recording.

## Rationale

The committed markdown manifest is what makes this a convention rather than a tool. Small, diffable, reviewable in a PR, readable by other agents. This is the same reason `AGENTS.md` and `CLAUDE.md` spread — committed, readable, convention-shaped.

## Consequences

- `.repro/` directory structure (excluding blobs, per ADR-016) is committed.
- `REPRO.md` is maintained by `repro save` and `repro test` commands.
- Other tools and agents can read `REPRO.md` without installing repro.
