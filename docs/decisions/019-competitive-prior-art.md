# ADR-019: Competitive prior art review

**Status:** Accepted  
**Date:** 2026-08-15  
**Resolves:** §10 instruction to review catacomb and langchain-replay before Phase 1

## Context

§10 requires reading the source of `catacomb` and `langchain-replay` and recording what we learn. This ADR captures the key insights that inform our design.

## Findings

### catacomb (realkarych/catacomb)

- Regression testing for Claude Code and Codex. Local files, evidence directories, SQLite baselines, secret redaction, CI exit codes.
- Runs the agent **live and repeatedly**, comparing results statistically. Every run costs API money and requires a key.
- Reads session transcripts (Claude Code's JSONL) rather than intercepting the API.
- Cannot serve recorded responses back to the agent — replay is not possible.
- Good: secret redaction before disk, named baselines, CI integration.
- Missing: deterministic replay, no-API-key CI, behavioural assertions on the trace.

### langchain-replay (sixty-north)

- Records the LLM's decisions, replays them while tools execute for real.
- The exact same "record model, replay model, run tools for real" design as D-003.
- LangChain/LangGraph-only — SDK-level integration, not a proxy.
- Validates that the design works. Our differentiation is doing it at the proxy level for any agent.

### VCR-style proxies

- Multiple exist for OpenAI/Anthropic-shaped APIs including SSE.
- Proven: cassette-based record/replay at the HTTP level works.
- Missing: agent semantics, assertions, REPRO.md convention, divergence localization.

## Design consequences

1. Deterministic replay is table stakes, not our novelty. Do not position it as invented here.
2. Lead with the assertion layer and no-API-key CI property.
3. The committed `REPRO.md` artifact is the second differentiator.
4. Divergence localization (D-004 per-message hash chain) is the third.
5. Transcript-based capture (reading agent JSONL) is a useful cross-check but not sufficient for replay.
