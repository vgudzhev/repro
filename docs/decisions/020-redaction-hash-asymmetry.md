# ADR-020: Fix redaction-hash asymmetry by hashing before redaction

**Status:** Fixed  
**Date:** 2026-08-15

## Context

During recording, request bodies were redacted (D-007) before hashing for replay matching (D-004). The normalized hash stored in `trace.json` was computed from the redacted body. During replay, the incoming request was hashed as-is — the replay proxy has no redaction config and runs in a different process with different environment variables.

If any environment variable value (>=4 chars) appeared verbatim in a request body, the recording hash (computed from the redacted body, where that value is replaced with `[[redacted:env:...]]`) would differ from the replay hash (computed from the raw body). This caused spurious hash mismatches in strict mode.

## Options considered

1. **Redact before hashing on both paths.** Unimplementable: `buildEnvRedactions` reads `process.env` at proxy construction time. Recording and replay are different processes with different environments — replay sets `ANTHROPIC_API_KEY=sk-repro-replay-dummy`. Applying `redactJsonDeep` on the replay side would redact a different set of values than recording did, making matching nondeterministic.

2. **Exclude redacted spans from the hash input.** Collapses back into Option 1: recording has `[[redacted:env:FOO:hash]]` markers where replay has raw values. Eliding markers on one side and nothing on the other still yields different hashes. The only way this works is to also redact on the replay side first — which inherits Option 1's defect.

3. **Hash the raw body before redaction (chosen).** During recording, compute `hashRequest(parsed)` on the raw body, then `redactJsonDeep(parsed)` for storage. The trace stores the redacted body (safe) indexed by a hash of the raw body. Replay already computes `hashRequest(parsed)` on the raw body, so hashes match.

## Decision

Option 3: hash before redaction on the recording path. Both `normalizedHash` and `computeMessageHashes` now operate on the raw parsed body, before `redactJsonDeep` is applied for storage.

## Rationale

- Does not violate D-007: the redaction marker format already embeds `sha256Prefix(value)` of every secret as a detection aid. A SHA-256 of the entire multi-KB request body is strictly weaker exposure — it is non-reversible and the secret is one substring in a much larger input.
- The hash no longer depends on redaction rules at all, so a rule-version change between record and replay cannot affect matching. This is the strongest form of forward compatibility.
- No trace migration needed: every trace recorded before this fix had zero body redactions (env vars go in auth headers, not request bodies), so pre-redaction hashes are identical to post-redaction hashes for all existing traces.

## Consequences

- Recording and replay hashes are now symmetric for all requests, regardless of env var values in the body.
- Traces recorded before this change are unaffected — the broken case (env var in body causing mismatch) never worked, so no regression.
- Redacted bodies are still stored in `trace.json` — secrets never appear on disk.
