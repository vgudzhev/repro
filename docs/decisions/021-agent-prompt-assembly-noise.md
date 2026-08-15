# ADR-021: Normalize agent prompt-assembly noise in request hashing

**Status:** Accepted  
**Date:** 2026-08-15

## Context

Real agent CLIs (Claude Code, and likely Codex/Cursor) inject session-specific content into every API request body. This content changes between recording and replay even when the agent performs identical logical work. Strict hash matching (D-004) fails on the first request because the raw bodies genuinely differ.

### Empirical evidence (Claude Code, 2026-08-15)

Recording a real `claude` session and replaying it in a worktree revealed two categories of genuine noise, verified by dumping the incoming (replay) and recorded request bodies and diffing them:

**1. `system` field (system prompt).** Contains the primary working directory path (e.g. `/Users/dev/myproject` during recording vs `/var/folders/.../repro-worktree-xyz` during replay). The system prompt is assembled by the CLI and includes session-specific paths. Verified: 38-char delta, entirely due to the worktree path difference.

**2. `<system-reminder>` blocks in messages.** Claude Code wraps user messages in `<system-reminder>` blocks containing worktree temp paths, scratchpad paths, CLAUDE.md file paths, and session IDs. These are randomly generated per run. Verified: after stripping system-reminder blocks, message content is byte-identical (301 chars each).

### What is NOT noise

**Tools (`tools` field).** After fixing the env-var redaction bug (see below), tool definitions are byte-identical between recording and replay (108,047 chars, same=True). The earlier hypothesis of "tool description drift" was wrong: the apparent 64-char delta was caused by `GIT_EDITOR=true` being redacted as `[[redacted:env:GIT_EDITOR:...]]` in the recording but remaining as `true` in replay. No normalization of tool descriptions is needed.

### Root cause of earlier failures

The original multi-turn replay failure (recording r-a763b3) had a different root cause: `buildEnvRedactions` in `src/redact.ts` treated every env var with value >= 4 chars as a secret. This caused `PWD`, `HOME`, `GIT_EDITOR=true`, `CLAUDE_EFFORT=high` etc. to be redacted, corrupting response bodies with `[[redacted:env:PWD:...]]/package.json` markers. Fixed by adding a denylist of non-secret env vars (the denylist alone was sufficient; the minimum value length remains at 4 chars).

## Decision

Two normalizations before hashing:

1. **Strip `system` as a volatile field.** The system prompt is CLI-assembled and contains session-specific paths. It carries no information about whether the agent's behavior diverged.

2. **Strip `<system-reminder>` blocks from message text.** These blocks contain per-session worktree paths, scratchpad paths, and CLI config injected by the agent.

Tools, tool descriptions, and all other request fields are hashed as-is.

## Consequences

- Strict mode no longer detects changes in the CLI's system prompt or `<system-reminder>` content. These are per-session noise, not user or model behavior.
- `metadata` is also stripped as volatile — it carries a per-session `user_id` / device ID that changes every run.
- Tool definitions (including descriptions) ARE hashed. If a tool's description changes between recording and replay, strict mode will catch it. This means a Claude Code version bump that changes tool text will invalidate every stored trace — an acceptable trade-off for detecting real behavioral drift, but users should expect to re-record after agent upgrades.
- Per-message hash chains (D-004) continue to work on the normalized message content.
- Multi-turn replay with tool use is validated: recording r-c6ef14 replayed in strict mode with 0 divergences, 0 API calls.
