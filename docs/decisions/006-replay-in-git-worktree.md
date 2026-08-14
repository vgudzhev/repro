# ADR-006: Replay executes in an isolated git worktree

**Status:** Accepted  
**Date:** 2026-08-15

## Context

Replay runs tools for real (D-003), which mutates the filesystem. A tool that dirties the user's repo will not be run twice. `git status` clean after `repro run` is a hard requirement.

## Decision

Replay creates a fresh `git worktree`, executes the agent there, and tears it down afterwards. The worktree is created outside the main repo tree (under a temp directory) to avoid polluting `git status`.

## Rationale

Git worktrees provide proper isolation with the full repo history available. The agent sees a real git repo, not a copy, so git-dependent tools work correctly.

## Consequences

- The worktree path must not be inside the main repo's working tree, or `git status` will see it.
- Worktree creation/teardown adds latency to replay. Acceptable for a test tool.
- The repo must be a git repo. Non-git repos need a different isolation strategy (future work).
- Cleanup must be robust — if the agent crashes, the worktree must still be removed.
