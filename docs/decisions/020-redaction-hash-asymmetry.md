# ADR-020: Redaction-hash asymmetry is a known limitation

**Status:** Accepted  
**Date:** 2026-08-15

## Context

During recording, request bodies are redacted (D-007) before hashing for replay matching (D-004). The normalized hash stored in `trace.json` is computed from the redacted body. During replay, the incoming request is hashed as-is — the replay proxy has no redaction config and runs in a different process with different environment variables.

If any environment variable value (>=4 chars) appears verbatim in a request body, the recording hash (computed from the redacted body, where that value is replaced with `[[redacted:env:...]]`) will differ from the replay hash (computed from the raw body). This causes a spurious hash mismatch in strict mode.

## Decision

Document this as a known limitation rather than fix it in v0.1.

## Rationale

Three possible fixes were considered:

1. **Hash the raw body during recording.** This stores a hash derived from unredacted secret material on disk, violating D-007's principle of "never captured."

2. **Redact on the replay side before hashing.** The replay proxy would need the same redaction inputs (env var values) that the recording proxy had. But recording and replay run in different processes with different environments — replay sets `ANTHROPIC_API_KEY=sk-repro-test-dummy`, not the real key. The redaction markers include SHA-256 prefixes of the original values, but the full redaction set is not recoverable from the trace without a format change.

3. **Store the redaction marker set in the trace.** This would let the replay proxy match marker patterns without knowing the original values, but it requires a trace format change and migration logic for existing recordings.

In practice, this rarely fires: API keys are sent in headers (which are redacted separately), not in request bodies. The only risk is if a different env var value (e.g., a file path or config value) appears in the model's message content. Manual testing against the live API confirmed no mismatches.

## Consequences

- Users who record with env var values appearing in request bodies may see spurious strict-mode mismatches on replay. Lenient mode will still work via positional fallback.
- A future version could implement option 3 (store marker set) as a non-breaking trace format extension.
