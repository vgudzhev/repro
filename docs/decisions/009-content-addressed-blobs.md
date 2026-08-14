# ADR-009: Large payloads are content-addressed blobs

**Status:** Accepted  
**Date:** 2026-08-15

## Context

A single agent trace can produce hundreds of megabytes of model I/O. Inlining all payloads into `trace.json` makes it unreadable and unmanageable.

## Decision

Payloads exceeding a configurable threshold are stored as content-addressed blobs under `.repro/<id>/blobs/` and referenced from the trace as `blob:sha256-<hex>`.

## Rationale

- Content-addressing deduplicates identical payloads (common in cached-prefix conversations).
- Keeps `trace.json` human-scannable.
- Blob references are stable and verifiable.

## Consequences

- Tools reading the trace must resolve blob references.
- Blob storage is gitignored by default (see ADR-016 for the `--slim` decision).
- `repro verify` (future, §11) can validate blob integrity by recomputing hashes.
