# repro

Minimal reproducible test cases for AI coding agents you didn't write.

Record a real agent run, replay it with no network and no API key, assert on what the agent did, and commit the result as a reproducible regression test.

```
$ repro record -- claude
  agent failed after 41 events
  saved r-7f3a91

$ repro run r-7f3a91
  reproduced — 41 events, 0 API calls, 0 API keys

$ repro test
  17 known failures replayed
  r-7f3a91 regression: agent modified src/gen/
```

> **Status**: v0.1 alpha. Multi-turn replay with tool use is validated against Claude Code. Other agents (Codex, Cursor, Aider) are architecturally supported but untested.

## Install

```bash
npm install repro-md
```

Requires Node.js 20+.

The agent you want to record (e.g. `claude`) must be installed separately — repro spawns it as a child process during both recording and replay.

## Quick start

```bash
# 1. Initialize repro in your repo
repro init

# 2. Record a failing agent run
repro record -- claude "fix the auth bug"

# 3. Save it as a named regression test
repro save r-abc123 --title "agent modifies generated files" \
  --assertion forbidden_path:src/gen/**

# 4. Commit the test
git add REPRO.md .repro/
git commit -m "add repro: agent modifies generated files"

# 5. Run in CI — no API key needed
repro test
```

## How it works

1. **Record**: An HTTP proxy sits between the agent and the model API. Every request/response pair is captured, secrets are redacted, and the trace is written to `.repro/<id>/`.

2. **Replay**: The proxy serves recorded responses instead of forwarding. The real agent binary runs against recorded model responses in an isolated git worktree. Requests are matched by normalized content hash — if the agent diverges, the mismatch is detected immediately.

3. **Assert**: Oracle-free assertions check what the agent did without needing a model to judge correctness.

4. **Commit**: `REPRO.md` is a human-readable manifest of known failures, reviewable in PRs.

## Commands

| Command | Description |
|---|---|
| `repro init` | Scaffold `.repro/` and `REPRO.md` in the current repo |
| `repro record -- <cmd>` | Record an agent run through the proxy |
| `repro run <id>` | Replay a recorded run (default: `--strict`) |
| `repro save <id>` | Promote a recording into `REPRO.md` |
| `repro test` | Replay all open failures, exit non-zero on regression |
| `repro list` | List all recordings |
| `repro inspect <id>` | Show a trace timeline in the terminal |
| `repro diff <a> <b>` | Align and compare two traces |
| `repro explain <a> <b>` | Report the first divergence and downstream effects |
| `repro minimize <id>` | Delta-debug inputs to find a minimal reproducing set |

## Assertions

Add assertions when saving a recording:

```bash
repro save r-abc123 --title "description" \
  --assertion forbidden_path:src/gen/** \
  --assertion max_calls:5 \
  --assertion no_repeat:2 \
  --assertion command:"test -f output.txt"
```

| Type | Description |
|---|---|
| `forbidden_path:<glob>` | Fail if any tool call touches a path matching the glob |
| `no_repeat:<n>` | Fail if the same tool call (name + args) repeats more than n times |
| `max_calls:<n>` | Fail if total model API calls exceed n |
| `command:<cmd>` | Run a shell command in the worktree after replay; non-zero exit = failure |

## Replay modes

- **`--strict`** (default for `repro test`): Aborts on the first request that doesn't match a recorded hash. Reports which message diverged and why.
- **`--lenient`**: Falls back to positional matching on hash miss. Warns on every fallback. Useful during development.

## CI

No API key is needed. The agent binary must be available on the runner.

```yaml
# .github/workflows/repro.yml
name: Repro Tests
on: [push, pull_request]
jobs:
  repro-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      # Install the agent CLI used in your recordings
      - run: npm install -g @anthropic-ai/claude-code
      - run: npx repro test
```

## What repro records

The proxy captures the full Anthropic Messages API conversation: every model request, every model response, every tool call embedded in responses, every tool result sent back in the next request. Streaming responses are reassembled on capture and re-chunked on replay.

What repro does **not** capture (in v0.1): filesystem changes as observed on disk, subprocess output, network calls made by tools. Side effects are recorded as reported by the agent, not as observed. This is a known limitation.

## Redaction

Secrets are redacted at capture time, before anything touches disk:

- Environment variable values are replaced with `[[redacted:env:<hash>]]`
- Known secret patterns (`sk-ant-*`, `ghp_*`, `AKIA*`, JWTs, PEM blocks) are scrubbed
- `Authorization` and `x-api-key` headers are stripped
- Content from `.env*`, `*.pem`, `*.key`, `**/secrets/**` paths is redacted

Common non-secret env vars (`PWD`, `HOME`, `PATH`, `SHELL`, `TERM`, `EDITOR`, etc.) are deliberately excluded from redaction — redacting them corrupts file paths in response bodies and breaks replay. The full denylist is in `src/redact.ts`. If you store secrets in unconventionally named env vars, add them to your recording's redaction config.

## Minimize

Delta-debug inputs to find a minimal reproducing set:

```bash
repro minimize r-abc123 --inputs context,files,tools --budget 5.00
```

This uses the `ddmin` algorithm to systematically remove inputs (context messages, tool definitions, file contents) and re-run the agent with live model calls, finding the smallest set of inputs that still reproduces the failure.

Options:
- `--budget <n>` (required): Maximum spend in dollars
- `--inputs <types>`: Comma-separated input types to minimize (default: `context,files,tools`)
- `--k <n>`: Samples per candidate (default: 3)
- `--m <n>`: Minimum successes to accept (default: 2)

The output reports a "minimal reproducing set" — never "cause." A minimal sufficient input is not a causal explanation.

## Architecture decisions

Design decisions are recorded in `docs/decisions/`. Key ones:

- **D-004**: Request matching by normalized hash, not sequence number
- **D-006**: Replay in isolated git worktree
- **D-007**: Redaction at capture time, never at read time
- **D-011**: Oracle-free assertions only in v0.1
- **D-020**: Hash raw request body before redaction
- **D-021**: Strip system prompt and `<system-reminder>` noise from hash

## License

MIT
