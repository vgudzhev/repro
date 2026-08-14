# ADR-005: Do not claim replay is "deterministic" without qualification

**Status:** Accepted  
**Date:** 2026-08-15

## Context

Marketing replay as "deterministic" invites scrutiny the claim cannot survive. The agent process touches the clock, filesystem, subprocesses, tool versions, and OS.

## Decision

The defensible claim is: *given identical recorded model responses and an isolated execution environment, the agent produces the same observable event sequence, and any deviation is detected and reported rather than absorbed.*

## Rationale

Underpromise, overdeliver. The detection guarantee (D-004) is more valuable than a purity claim. Users trust a tool that tells them when it failed more than one that claims it cannot.

## Consequences

- README, docs, and CLI output must use "reproducible" and "detected divergence," not "deterministic."
- The divergence detection mechanism (hash-based matching) is the actual guarantee being made.
