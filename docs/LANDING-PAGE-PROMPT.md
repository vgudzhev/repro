# repro.md Landing Page — Build Prompt

**Paste this entire file as the opening prompt of a new Claude Code session.**

---

## What you are building

Build the landing page and documentation site for **repro.md** — an open-source CLI and format for reproducing AI coding-agent failures.

The domain is `repro.md`. The GitHub repo is at `github.com/vgudzhev/repro`.

This is a real, implemented project. Everything described below as "implemented" is shipped and tested. Do not fabricate features. Mark anything planned as `Planned`.

---

## Identity

This is NOT a SaaS product. It is a developer convention and CLI tool — closer to a specification than a startup.

**The site should feel like:**
- Git documentation
- The SQLite homepage
- OpenTelemetry docs
- Rust's website
- The npm registry
- Terraform documentation
- AGENTS.md / CLAUDE.md conventions

**The site should NOT feel like:**
- An AI startup landing page
- An observability dashboard
- An enterprise product pitch
- A "book a demo" funnel

**Banned elements:** pricing tables, testimonials, fake metrics ("trusted by 10,000 developers"), newsletter signups, login/signup flows, sales contact forms, stock photography, AI robot illustrations, glassmorphism, giant gradient blobs, excessive animation.

**Banned words:** revolutionary, next-generation, AI-powered, unlock, seamless, enterprise-grade, transform, intelligent, scale your AI.

---

## Visual direction

Restrained developer-tool aesthetic. The page should be extremely well-typeset and fast.

**Use:**
- Off-white / white background (not cream — no `#F4F1EA`)
- Black / near-black typography
- Monospace type for all code and terminal content
- Terminal blocks as primary visual elements — more prominent than marketing copy
- Thin dividers, subtle gray borders
- Generous whitespace
- Green/red only for terminal pass/fail output
- Minimal, purposeful color — one accent used sparingly
- Dark mode supported, but not the neon-on-black AI startup look

**Typography:**
- System sans-serif stack for body text (Inter weight if you want a named face)
- Monospace for code: `SF Mono`, `JetBrains Mono`, or `IBM Plex Mono` via `@font-face` data URI or system fallback
- The logo is the word `repro.md` — lowercase, `repro` visually dominant, `.md` subtle/dimmed

**Do not** default to the common AI-site palette (cream + serif + terracotta, or black + acid-green). Choose neutrals deliberately.

---

## Navigation

Extremely simple top nav:

```
repro.md                     Docs    GitHub    v0.1
```

That's it. No mega-menu. No dropdowns. Feels like a project README header.

---

## Technical ground truth

Use these exact details. They come from the actual implementation.

### CLI commands (all implemented)

```
repro init               Scaffold .repro/ and REPRO.md
repro record -- <cmd>    Record an agent run through the proxy
repro run <id>           Replay a recorded run
repro save <id>          Promote a recording into REPRO.md
repro test               Replay all open failures in CI
repro list               List all recordings
repro inspect <id>       Show trace timeline
repro diff <a> <b>       Align and compare two traces
repro explain <a> <b>    Report first divergence point
repro minimize <id>      Delta-debug to find minimal reproducing set
```

Note: the replay command is `repro run`, NOT `repro replay`.

### Actual CLI output format

Recording:
```
$ repro record -- claude
repro: recording r-7f3a91
repro: proxy listening on http://127.0.0.1:54321
repro: agent failed after 41 events
repro: saved r-7f3a91
```

Replay:
```
$ repro run r-7f3a91
repro: replaying r-7f3a91 (41 events)
repro: mode: strict
repro: worktree at /tmp/repro-wt-abc123
repro: ✓ reproduced — 41 events, 0 API calls, 0 API keys
repro: ✓ working tree restored
```

Test:
```
$ repro test
repro: ✓ r-31fa22 — fixed tool loop
repro: ✓ r-82d101 — fixed generated file writes
repro: ✗ r-7f3a91 — assertion failed
repro:   ✗ Forbidden path src/gen/** matched: seq 14: model.response touched src/gen/output.ts

repro: ✓ 2 passed, ✗ 1 failed, ⚠ 0 diverged
```

### File structure (actual)

```
REPRO.md
.repro/
├── r-7f3a91/
│   ├── trace.json
│   ├── meta.json
│   ├── assertions.json
│   └── blobs/
│       ├── sha256-a1b2c3...
│       └── sha256-d4e5f6...
└── r-2b8e04/
    ├── trace.json
    ├── meta.json
    └── assertions.json
```

Note: it's `meta.json` (not `env.lock`), `assertions.json` (not `assertion.json`).

### REPRO.md format (actual)

```markdown
# REPRO.md — Known Agent Failures

This file is maintained by repro. Each row is a recorded agent failure
that replays deterministically without an API key.

Run `repro test` to replay all open failures.

| ID | Title | Status | First Seen |
|----|-------|--------|------------|
| r-7f3a91 | agent modifies generated files | open | 2026-08-15 |
| r-31fa22 | infinite tool loop on large file | fixed | 2026-08-10 |
| r-2b8e04 | writes outside project directory | open | 2026-08-12 |
```

### Trace format (actual event types)

```json
[
  {
    "seq": 0,
    "type": "process.start",
    "timestamp": "2026-08-15T10:00:00.000Z",
    "data": { "command": ["claude", "fix the auth bug"], "pid": 12345 }
  },
  {
    "seq": 1,
    "type": "model.request",
    "timestamp": "2026-08-15T10:00:01.000Z",
    "data": {
      "normalizedHash": "sha256-abc123...",
      "messageHashes": ["sha256-111...", "sha256-222..."],
      "body": { "model": "claude-sonnet-4-20250514", "messages": [...] }
    }
  },
  {
    "seq": 2,
    "type": "model.response",
    "timestamp": "2026-08-15T10:00:03.000Z",
    "data": {
      "body": {
        "content": [
          { "type": "tool_use", "name": "read_file", "input": { "path": "src/auth.ts" } }
        ],
        "stop_reason": "tool_use"
      }
    }
  }
]
```

Event types: `process.start`, `process.exit`, `model.request`, `model.response`. Tool calls and results are embedded inside model request/response bodies (not separate event types).

Large payloads use `blob:sha256-...` references into the `blobs/` directory.

### Assertion types (all implemented)

```
forbidden_path:<glob>     Fail if any tool call touches a matching path
no_repeat:<n>             Fail if same tool call (name+args) repeats > n times
max_calls:<n>             Fail if total model API calls exceed n
command:<cmd>             Run shell command in worktree; non-zero = failure
```

### How the proxy works (actual architecture)

1. `repro record -- claude` starts an HTTP proxy on localhost
2. Sets `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` in the agent's environment
3. The agent talks to the proxy thinking it's the real API
4. The proxy forwards to the real API, records every request/response pair
5. Secrets are redacted at capture time (before anything touches disk)
6. Streaming SSE responses are reassembled into complete messages for storage

On replay:
1. The proxy serves recorded responses instead of forwarding
2. Requests are matched by normalized SHA-256 hash of the message content (NOT by sequence number — this is the most important design decision)
3. Hash miss in strict mode → abort and report which message diverged
4. Hash miss in lenient mode → fall back to positional matching with warnings
5. The agent runs in an isolated git worktree, restored after replay

### What's implemented vs planned

**Implemented (shipped, tested, 83 tests passing):**
- Recording proxy (Anthropic Messages API)
- SSE streaming reassembly and re-chunking
- Request normalization and SHA-256 hash matching
- Per-message hash chain for divergence localization
- Capture-time secret redaction (env vars, API keys, JWTs, PEM blocks)
- Content-addressed blob storage
- Replay with strict/lenient modes
- Git worktree isolation
- Assertions: forbidden_path, no_repeat, max_calls, command
- REPRO.md manifest
- All CLI commands including diff, explain, minimize
- ddmin algorithm with stochastic oracle and budget management
- GitHub Actions CI workflow

**Planned (not yet implemented):**
- Live oracle for `repro minimize` (algorithm is built, API integration pending)
- OpenAI/other provider API shapes (Anthropic-only for now)
- Filesystem/process capture layers (currently records side effects as reported by the agent, not as observed on disk)
- `--slim` / `--full` blob commit modes (currently all blobs are gitignored)

---

## Page sections

### Section 1 — Hero

```
Reproduce AI agent failures.
```

Subtitle: `Turn a failed agent run into a deterministic regression test.`

A terminal block showing the core loop — this should be one of the strongest visual elements on the page:

```
$ repro record -- claude
  repro: agent failed after 41 events
  repro: saved r-7f3a91

$ repro run r-7f3a91
  repro: ✓ reproduced — 41 events, 0 API calls, 0 API keys

$ repro test
  repro: ✓ 2 passed, ✗ 1 failed, ⚠ 0 diverged
```

Buttons: `Get started` (links to docs) · `GitHub` · `View specification`

Status line beneath: `Open format · Git-native · No API key required`

### Section 2 — The problem

Heading: `Agent failures disappear.`

```
A traditional bug comes with a reproduction.

Agent failures come with a transcript.

The model changes. The prompt changes.
The environment changes. The agent takes a different path.

By the time you try again, the failure is gone.
```

Visual flow:
```
failure → record → replay → test
```

### Section 3 — How it works

Heading: `The model doesn't have to be deterministic.`

This is the central technical insight. Give it significant visual weight.

Diagram showing:
```
┌─────────────────────────────┐
│          AI AGENT           │
│  prompt → tool → tool → …  │
└──────────────┬──────────────┘
               │
          repro proxy
               │
    ┌──────────┴──────────┐
    │  RECORD:            │  REPLAY:
    │  forward + capture  │  serve from trace
    └─────────────────────┘
```

Key point: "During replay, the real agent runs. Model responses come from the recorded trace. No API key. No inference cost."

### Section 4 — The artifact

Heading: `A failure you can commit.`

Show the actual file structure (use exact format from ground truth above).

Then show the actual REPRO.md format.

Emphasize: "Commit them. Review them in PRs. Replay them in CI. Read them without installing anything."

This should feel like documenting a file-format convention, like AGENTS.md.

### Section 5 — Workflow

Heading: `From failure to regression test.`

Four steps (use a vertical technical timeline, NOT large colorful marketing cards):

```
01  RECORD          repro record -- <agent>
                    Proxy captures every model call. Secrets redacted.

02  REPLAY          repro run <id>
                    Agent runs against recorded responses. No network needed.

03  INSPECT         repro diff <a> <b>  ·  repro explain <a> <b>
                    LCS-aligned trace comparison. Divergence localization.

04  TEST            repro test
                    CI entry point. No API key. Exit code 0 or 1.
```

### Section 6 — Assertions

Heading: `Test what the agent did.`

Show the four assertion types with examples:

```
repro save r-7f3a91 \
  --title "agent modifies generated files" \
  --assertion forbidden_path:src/gen/** \
  --assertion max_calls:5
```

Explain: "Oracle-free. No model needed to judge correctness. The assertions check structure and behavior, not output quality."

### Section 7 — Minimization

Heading: `Find the smallest reproduction.`

```
47 context items → 19 → 7 → 3

AGENTS.md
src/generated/user_pb.ts
edit_file
```

Note: mark this as the ddmin algorithm is implemented but the live oracle (actual API calls during minimization) is planned. Use language like: "The ddmin algorithm and budget management are implemented. Live oracle integration is in progress."

### Section 8 — CI

Heading: `Regressions belong in CI.`

Show the GitHub Actions workflow (actual from the repo):

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
      - run: npm ci && npm run build
      - run: npx repro test
```

Then: `No API key. No inference. No model cost.`

### Section 9 — Not an observability platform

Heading: `Not another dashboard.`

Two-column comparison:

```
OBSERVABILITY              REPRO

agent                      agent
  ↓                          ↓
trace                      failure
  ↓                          ↓
dashboard                  replay
  ↓                          ↓
inspect                    minimize
                             ↓
                           regression test
                             ↓
                           CI
```

"Observability tells you what happened. repro gives you something you can run again."

### Section 10 — Open format

Heading: `A format, not a platform.`

```
Claude Code  ─┐
Codex        ─┤
OpenHands    ─┼──→  .repro/
Cursor       ─┤
Custom agent ─┘
```

"The CLI is one implementation. The reproduction artifact is the primitive. The goal is a portable failure format that works across agent tooling."

Currently supports Anthropic Messages API. Other providers planned.

### Section 11 — Specification peek

Heading: `Simple enough to inspect.`

Show a small trace.json excerpt (use actual format from ground truth).

Button: `Read the specification →`

### Section 12 — Final CTA

```
Make agent failures reproducible.

$ repro record -- <agent>
```

Buttons: `GitHub` · `Documentation` · `Specification`

### Footer

```
repro.md
Open format for reproducible AI agent failures.

Docs · GitHub · Specification · v0.1
```

---

## Technical implementation

**Stack:**
- Astro (static site generator) — minimal JS, fast builds, Cloudflare Pages-ready
- TypeScript
- Tailwind CSS (if useful, but don't let it produce generic-looking output)
- MDX for documentation pages

**Structure:**
```
src/
  pages/
    index.astro          Landing page
    docs/                Documentation (can grow later)
    spec/                Specification
  components/            Shared components
  layouts/               Page layouts
  styles/                Global styles
```

**Requirements:**
- Deployable to Cloudflare Pages
- Responsive (optimize for desktop, must work on mobile)
- Accessible (contrast, keyboard nav, semantic HTML)
- Fast (minimal JS, no unnecessary dependencies)
- Dark mode (but NOT the neon AI startup look — muted, professional)
- Code blocks with copy buttons
- Terminal examples that look authentic (not generic code blocks)

**Quality bar:**
When an experienced developer sees this site, their first thought should be: "This looks like an open-source protocol." Not: "This looks like another AI startup."

Code and terminal output should carry more visual weight than prose.
