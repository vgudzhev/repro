# ADR-012: Minimization delta-debugs inputs, never the recorded tape

**Status:** Accepted  
**Date:** 2026-08-15  
**Implements:** v0.3 (not v0.1 — recorded now so it is not designed wrong later)

## Context

Deleting event 7 from a recording and replaying is vacuous: event 8's recorded response was conditioned on event 7 having happened, and the failure observed at the end was played back, not computed.

## Decision

`ddmin` minimizes **inputs** — context files, prompt sections, tool definitions — re-running in `reinfer` mode (live model calls). It reports "minimal reproducing set" with the observed reproduction rate, never the word "cause."

## Mechanism

- Oracle is stochastic: run each candidate k times, accept at ≥m (default k=3, m=2).
- Pin `temperature: 0` and a seed where the provider supports it.
- Hard budget cap in dollars; abort cleanly when reached.
- Refuse to run when recorded reproduction rate is below ~0.3.

## Rationale

A minimal sufficient input is not a causal explanation, but `47 context items → 3` is the demo nobody else can give. This is the durable differentiator (§2.5, wedge 3).

## Consequences

- Requires live model calls — cannot run in CI without an API key.
- Budget management is critical — unbounded ddmin over an LLM API is expensive.
- The word "cause" must never appear in minimize output.
