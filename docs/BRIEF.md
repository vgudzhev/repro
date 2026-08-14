# repro.md — Project Brief

**Paste this whole file as the opening prompt of a new Claude Code session.**
It is self-contained. Everything needed to plan and build v0.1 is here.

---

## 0. How to use this brief

You are acting as **architect-planner first, implementer second.**

Before writing any code:

1. Read this brief end to end.
2. Create `docs/decisions/` and write one ADR file per decision listed in §4, in the form `NNN-short-title.md` containing: context, decision, rationale, consequences, status. The decisions in §4 are **already made** — record them, do not relitigate them.
3. Resolve the open questions in §9 by writing new ADRs, asking me where the answer is a product judgement rather than a technical one.
4. Write `docs/PLAN.md` breaking §7 into concrete tasks with the acceptance criteria attached.
5. Only then start Phase 1.

Rules for the whole project:

- **Phase gates are hard.** Do not begin phase N+1 until every acceptance criterion in phase N passes in CI.
- **Every phase ends with tests that run without a network connection or an API key.** If a phase cannot be tested hermetically, that is a design problem, not a testing problem.
- When you deviate from this brief, write an ADR explaining why. Do not silently redesign.
- Update `docs/PLAN.md` as work completes. It is the source of truth for progress.

---

## 1. Mission

Build `repro` — a CLI that records a real AI coding-agent run, replays it deterministically with the network unplugged, asserts on what the agent did, and commits the result as a regression test.

One-line pitch: **a reproducible test format for AI agent failures.**

---

## 2. Problem

Coding agents fail in ways nobody can reproduce. A failing run is dozens of model calls, tool calls, file edits and decisions. The developer sees "the agent did something wrong" and has no way to replay it, no way to isolate what caused it, and no way to prove a fix worked.

The consequences are measurable. In 2026 survey data (Forrester/Anaconda, replicated by a16z and an MIT Sloan CIO panel), roughly 88% of agent pilots never reach production. Evaluation gaps are the single largest cited blocker at 64%, and 70% of leaders name non-deterministic output as the top production-readiness barrier. The problem is specifically *not* "the model is wrong" — it is that teams cannot tell in advance when it will be wrong, and their regression tests do not catch it.

There is no equivalent of a minimal reproducible test case for agent behaviour. That is the gap.

### Who this is for

Developers running coding agents (Claude Code, Codex, Cursor CLI, OpenHands) against real repositories, who want a failure to become a permanent CI check rather than a story they retell.

### Why now

Agent CLIs are ubiquitous, they all speak an OpenAI- or Anthropic-shaped HTTP API, and none of them make their runs reproducible.

---

## 2.5 Competitive landscape — read this before designing anything

**The record/replay proxy is not novel. Treat it as table stakes, not as the product.**

| Project | What it does | Why it is not this |
|---|---|---|
| **Docker `cagent`** | Proxy-and-cassette. Records full request/response, normalizes volatile fields, matches requests against the cassette, blocks external calls in replay, fails deterministically on divergence. | Only records agents built in **cagent's own YAML runtime**. Cannot wrap Claude Code, Codex or Cursor. Early stage, breaking changes expected. |
| **`langchain-replay`** (sixty-north) | Records the LLM's *decisions* and replays them while tools execute for real against the filesystem. | **LangChain/LangGraph only** — a library integration, not a wrapper. Useless for agents you did not write. Pre-release on PyPI. |
| Generic VCR-for-LLM proxies | VCR-style record/replay proxies for HTTP/SSE/WebSocket, drop-in mocks for OpenAI/Anthropic. Also MCP-server record/replay. | Generic HTTP fixtures. No agent semantics, no assertions, no notion of a failure or a regression. |
| **`catacomb`** | Regression testing for Claude Code and Codex. Repeated runs per variant, small-sample statistics, CI exit codes, secret redaction, named baselines. | Closest *positioning*. But the method is repeated **live** runs compared statistically — costly, slow, needs API keys in CI. Not replay. |
| **AgentReplay**, **`claude-replay`** | Turn agent sessions into shareable HTML/video replays from on-disk transcripts. | Visualization and sharing. No execution replay, no assertions, no CI. |
| LangSmith, Langfuse, Braintrust, Phoenix | Tracing and eval platforms. | Observe outcomes after the fact. Do not make runs reproducible. |

**Consequences for this project — these override anything that contradicts them:**

1. **Do not position on "deterministic replay."** Docker has shipped it and will market it harder than you can. It is a capability this tool has, not the reason it exists.
2. **The actual wedge is: works with agents you did not write.** Every existing replay tool requires adopting a runtime (cagent) or a framework (langchain-replay). Nothing today wraps an off-the-shelf coding-agent CLI. That is the gap, and it is why D-001's proxy is non-negotiable — it is the only capture mechanism that needs no cooperation from the agent.
3. **Minimization is the differentiator, not replay.** No product does failure minimization for agent runs. The technique has fresh academic grounding — `ddmin` (Zeller & Hildebrandt), with 2026 work applying it to LLM behaviours (DDOR for overrefusal localization, SkillReducer for agent skill descriptions) — but nobody has shipped it as a developer tool. `47 context items → 3` is the demo nobody else can currently give.
4. **`REPRO.md` as a committed, reviewable convention is unclaimed.** Cassettes are test fixtures; none of these tools produce a shared artifact a team reviews in a PR.

**Revised one-line pitch:** *minimal reproducible test cases for AI coding agents you didn't write.*

**Risk to monitor:** if Docker extends cagent to wrap third-party agent CLIs, wedge 2 narrows sharply. Wedges 3 and 4 are the durable ones. Do not let Phase 5 slip indefinitely.

---

## 3. What we are building — and explicitly not building

### In scope for v0.1

- A recording HTTP proxy that sits between the agent and the model provider
- A machine-readable execution archive (`trace.json` + content-addressed blobs)
- Replay that runs the **real agent binary** against **recorded model responses**
- Oracle-free assertions over what the agent did
- `REPRO.md`, a committed human-readable manifest of known failures
- `repro test` for CI, running with no API key

### Explicitly NOT in v0.1 — do not build these

| Not building | Why |
|---|---|
| Web UI, dashboard, charts | This is a CLI tool. A terminal demo is the artifact. |
| Hosted service, accounts, teams | No backend. Everything is local files in the repo. |
| `judge` / LLM-graded assertions | Needs a correctness oracle. False positives destroy trust. |
| `reexec` mode (live model + live env) | Requires environment virtualization. Out of scope entirely. |
| Multi-provider support | One provider API shape first. Second comes in v0.4. |
| Filesystem / process interception | v0.4. The proxy gives enough for v0.1. |
| `minimize` | v0.3, and it needs live model calls. Not part of the core loop. |
| Telemetry, analytics, phone-home | No. |

If you find yourself building something in the right-hand column, stop and re-read this section.

---

## 4. Locked decisions

Record each of these as an ADR. They are settled.

**D-001 — Capture at the model API boundary, via a local proxy.**
The agent is pointed at `http://127.0.0.1:PORT` using `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL`.
*Rationale:* wrapping the process and scraping stdout yields rendered TTY output — spinners, ANSI, truncation — not structured events, and parsing it is brittle per-agent work that breaks every release. The proxy is model-agnostic by construction, works with any agent speaking a compatible API, needs zero code changes from the user, and gives one chokepoint for redaction.

**D-002 — The proxy sees the entire tool loop, not just model calls.**
Tool invocations arrive inside model responses; tool *results* are sent back up in the next request's message array. The complete conversation, every tool call and every tool result reconstruct from API traffic alone.
*Consequence:* what the proxy does **not** see is what tools did to the machine. A `write_file` result says `ok`; only the filesystem knows which bytes changed. v0.1 records side effects **as reported by the agent, not as observed on disk**, and the README must say so.

**D-003 — Replay runs the real agent binary. Only the model is a fixture.**
The agent genuinely executes, dispatches tools, writes files. The proxy serves recorded responses instead of forwarding.
*Rationale:* this is the differentiator. It makes replay a real test of the harness and environment rather than video playback.

**D-004 — Replay matches requests by normalized hash, never by sequence number.**
This is the single most important implementation decision in the project.
*Rationale:* if any tool result differs from recording time — a changed file, a moved `git log`, a timestamp — the agent sends a different request than it originally did. Serving response N by position means the model is "answering" a conversation it never saw. The run completes, looks plausible, and proves nothing. This failure is silent, which makes it the worst kind.
*Mechanism:*
1. Normalize the request: drop volatile fields (request ids, timestamps, cache breakpoints), canonicalize JSON key ordering.
2. Hash the full message array. Also store a per-message hash chain so a mismatch localizes to the exact diverging message.
3. Hit → serve the recorded response. Miss → the agent has diverged.
4. On miss: `--strict` (default for `repro test`) aborts and reports the diverging message with a diff. `--lenient` falls back to positional matching, warns loudly, and marks the trace `diverged`.
*Consequence:* divergence detection falls out of the replay engine for free. `repro diff` later becomes a reporting layer over data that already exists.

**D-005 — Do not claim replay is "deterministic" without qualification.**
The defensible claim is: *given identical recorded model responses and an isolated execution environment, the agent produces the same observable event sequence, and any deviation is detected and reported rather than absorbed.*
*Rationale:* the agent process still touches the clock, filesystem, subprocesses, tool versions and OS. The flat claim does not survive scrutiny.

**D-006 — Replay executes in an isolated `git worktree`, and restores the tree afterwards.**
`git status` clean after `repro run` is a hard requirement.
*Rationale:* replay runs tools for real and therefore mutates the filesystem. A tool that dirties your repo will not be run twice.

**D-007 — Redaction happens at capture time, in the proxy.**
Never at read time. Rules: (1) env var *values* never captured, names only unless allowlisted; (2) known secret shapes scrubbed before write — `sk-`, `ghp_`, `AKIA`, JWTs, PEM blocks, `Authorization` headers; (3) path denylist defaulting to `.env*`, `*.pem`, `*.key`, `**/secrets/**`; (4) every removal recorded as `[[redacted:<rule>:<sha256-prefix>]]`.
*Consequence:* on replay a redacted value must fail **loudly**, never substitute silently — otherwise you get a green test that proves nothing. Redaction ships in Phase 1, not later. A trace that captures a real key once is a project nobody can adopt.

**D-008 — `trace.json` is a flat, append-only event log, not nested steps.**
Events carry `seq` and a type named after an observable boundary, not a provider: `model.request`, `model.response`, `tool.call`, `tool.result`, `fs.write`, `fs.delete`, `fs.move`, `process.start`, `process.exit`, `network.request`, `network.response`, `env.read`, `assertion`.
*Rationale:* append-only matches how recording actually works and stays extensible as capture layers are added in v0.4.

**D-009 — Large payloads are content-addressed blobs, never inlined.**
`blob:sha256-…` references into `.repro/<id>/blobs/`. Inlining puts a single trace into the hundreds of megabytes.

**D-010 — Two layers: `REPRO.md` committed and human-facing, `.repro/` machine-readable.**
*Rationale:* the committed markdown manifest is what makes this a convention rather than a tool — small, diffable, reviewable in a PR, readable by other agents. That is why `AGENTS.md` spread.

**D-011 — Assertions are oracle-free in v0.1.**
Ship `forbidden_path`, `no_repeat`, `max_calls`, `command`. These need no judgement about what "correct" looked like.
*Rationale:* the product is an *agent regression test format*. Formats spread; tools don't. `judge` assertions need a correctness oracle and their false positives would be fatal in a tool whose promise is "your agent went wrong."

**D-012 — Minimization delta-debugs inputs, never the recorded tape.** (v0.3, recorded now so it is not got wrong later.)
Deleting event 7 from a recording and replaying is vacuous: event 8's recorded response was conditioned on event 7 having happened, and the failure observed at the end was played back, not computed. `ddmin` needs an oracle that recomputes; replay has none. Minimize **inputs** — context files, prompt sections, tool definitions — re-running in `reinfer` mode. Report the result as a **minimal reproducing set**, never as "the cause": a minimal sufficient input is not a causal explanation. The oracle is stochastic, so run each candidate *k* times and accept at ≥*m* (start k=3, m=2), pin `temperature: 0` and a seed where supported, and cap spend.

---

## 5. Known traps

Things that will look correct and are not:

1. **Serving replay responses by sequence number.** See D-004. This is the one that silently ruins everything downstream.
2. **Testing only against a real agent and a real API.** Slow, costly, flaky, and needs secrets in CI. See §6 — build a reference agent and a stub upstream.
3. **Storing streaming responses as received.** SSE chunks must be reassembled before storage and re-chunked on replay, or streaming clients hang forever.
4. **Assuming a single ordered event sequence.** Agents that fan out issue parallel tool calls. Record a `parallel_group` id and match on the set, not the order.
5. **Deferring redaction.** It is a Phase 1 requirement, not polish.
6. **Letting replay run in the live working tree.** See D-006.
7. **Building assertions that need an LLM.** See D-011.
8. **Forgetting that CI needs the agent CLI installed** and that many agents check for an API key at startup — supply a dummy value.

---

## 6. Test strategy

The test suite must run hermetically: **no network, no API key, no real agent binary.**

Build two fixtures early, in Phase 1:

- **Stub upstream** — a local HTTP server returning canned provider-shaped responses, including a streaming variant. Stands in for Anthropic/OpenAI.
- **Reference agent** — a ~100-line script that speaks the provider API and dispatches two trivial tools (`read_file`, `write_file`). Stands in for Claude Code.

With those, the full record → replay → assert loop is testable in milliseconds. Validate against a real agent and real API manually at the end of each phase, not in CI.

---

## 7. Phases and acceptance criteria

### Phase 0 — Decisions and skeleton

- [ ] `docs/decisions/` contains one ADR per decision D-001 … D-012
- [ ] Open questions from §9 are resolved as new ADRs or escalated to me
- [ ] `docs/PLAN.md` exists with tasks and acceptance criteria per phase
- [ ] Repo skeleton builds, lints, and runs an empty test suite in CI

### Phase 1 — Recording

- [ ] `repro record -- <cmd>` starts a proxy, sets the base-URL env var for the child process, and runs the command
- [ ] Every request/response pair is written to `.repro/<id>/` with monotonic `seq`
- [ ] Streaming responses are reassembled on capture and stored whole
- [ ] Payloads over a threshold become `blob:sha256-…` references
- [ ] Redaction rules 1–4 (D-007) are enforced in the proxy before anything touches disk
- [ ] **Test:** a redaction test asserts a known fake secret in a request never appears anywhere under `.repro/`
- [ ] **Test:** reference agent + stub upstream produces a complete, ordered trace with no network access
- [ ] **Manual:** a real agent CLI runs to completion through the proxy with no behavioural difference

### Phase 2 — Replay (the make-or-break phase)

- [ ] `repro run <id>` replays: the proxy serves recorded responses instead of forwarding
- [ ] Request matching is by normalized hash (D-004), with a per-message hash chain
- [ ] `--strict` aborts on a miss and reports the diverging message with a diff; `--lenient` falls back positionally, warns, and marks the trace `diverged`
- [ ] Streaming responses are re-chunked so streaming clients do not hang
- [ ] Replay runs in a fresh `git worktree` and restores it (D-006)
- [ ] **Test:** `git status` is clean after every replay
- [ ] **Test:** a deliberately mutated tool result causes a strict-mode abort at the correct message index
- [ ] **THE GATE:** record a real agent run, **disconnect the network**, replay, and obtain an identical observable event sequence. Nothing proceeds until this passes.

### Phase 3 — Assertions, manifest, CI

- [ ] `assertion.json` supports `forbidden_path`, `no_repeat`, `max_calls`, `command`
- [ ] `repro init` scaffolds `REPRO.md` and `.repro/`
- [ ] `repro save <id>` promotes a recording into the `REPRO.md` table with id, title, status, first-seen
- [ ] `repro test` replays every open failure and exits non-zero if any assertion regresses
- [ ] `repro list` / `repro inspect <id>` render a trace readably in the terminal
- [ ] A GitHub Action runs `repro test` **with no API key present**
- [ ] **Test:** an assertion that should fire, fires; one that should not, does not
- [ ] **Test:** the full loop — record, save, test — passes on the reference agent

### Phase 4 — Diff and explain

- [ ] `repro diff <a> <b>` aligns two traces (LCS or Needleman–Wunsch over canonical event keys — sequences differ in length, so this is alignment, not a zip)
- [ ] Divergences are classified: `args_changed`, `tool_changed`, `event_inserted`, `event_dropped`, `result_changed`
- [ ] `repro explain <a> <b>` reports the first divergence, the diverging message, and downstream consequences — **no LLM involved**
- [ ] A `result_changed` at the first event is reported as environment drift with advice to re-record rather than debug

### Phase 5 — Minimize (only after 1–4 are green)

- [ ] `repro minimize <id> --inputs context,files,tools --budget <n>` implements `ddmin` over inputs (D-012)
- [ ] Stochastic oracle: k samples, accept at ≥m, configurable, defaulting to 3 and 2
- [ ] Hard budget cap in dollars; aborts cleanly when reached
- [ ] Output reports "minimal reproducing set" with the observed reproduction rate — never the word "cause"
- [ ] Refuses to run when the recorded reproduction rate is below ~0.3, with an explanatory message

---

## 8. Definition of done for v0.1

A developer who has never seen this project can:

1. `npx repro init` in their repo
2. `repro record -- claude` and reproduce a real failure
3. `repro save` it, commit `REPRO.md` and `.repro/`
4. Open a PR where CI runs `repro test` **with no API key configured** and the known failure is checked
5. Have `git status` clean throughout

The README's headline demo is:

```
$ repro record -- claude
  agent failed after 41 events
  saved r-7f3a91

$ repro run r-7f3a91
  ✓ reproduced — 41 events, 0 API calls, 0 API keys
  ✓ working tree restored

$ repro test
  ✓ 17 known failures replayed
  ✗ r-7f3a91 regression: agent modified src/gen/
```

---

## 9. Open questions for the planner

Resolve these as ADRs before Phase 1. Ask me where the answer is a product judgement.

1. **Language and runtime.** Recommendation: TypeScript on Node — the distribution story (`npx repro`) matches the audience, SSE handling is native, and the agent ecosystem is npm-shaped. Python is viable and easier for the later `ddmin` work; Go gives single-binary distribution at the cost of development speed. Pick one and record why.
2. **Which provider API shape first?** Whichever agent you can most reliably test against locally.
3. **TLS.** The proxy terminates TLS. How do we handle agents that pin certificates — document the limitation, or ship a CA-injection path?
4. **Do blobs get committed?** Self-contained repos and reviewable PRs argue yes; 5–50 MB per trace argues no. A `--slim` mode keeping tool I/O and dropping full model inputs is probably the right default, with git-lfs as the escape hatch.
5. **Prompt caching.** Cached prefixes mean the recorded request may not be what the model actually conditioned on. Capture cache breakpoints explicitly and exclude them from the match hash.
6. **Trace identity.** How is `<id>` generated, and is it stable across re-records of the same failure?

---

## 10. Competitive landscape (verified August 2026)

Read this before designing. The differentiation is narrower than it first appears, and building the wrong part is the main risk.

### Not our competitors

LangSmith, Langfuse, Phoenix, Helicone — hosted tracing and evaluation platforms. Different artifact (a dashboard), different buyer, SDK-instrumented. We are not competing with them and must not drift toward them.

**AgentOps** is frequently cited as close because of "time-travel debugging," but its own documentation describes that as inspecting a recorded session — explicitly *without reproducing it locally*. It is a navigation UI over a log, not re-execution. Not the same product.

### The real competitors

**1. VCR-style cassette record/replay.** VCR.py, pytest-recording, nock, plus several LLM-specific record/replay proxies for OpenAI/Anthropic-shaped APIs including SSE. These already do proxy-level record and deterministic offline replay, with cassettes committed to git.

**`langchain-replay` (sixty-north) is direct prior art for our core insight.** It independently published exactly the "record the model's decisions, replay them while letting tools execute for real" design, with the same rationale — zero API cost, deterministic replay, real tool execution. It is LangChain/LangGraph-specific and SDK-level.

**Consequence: deterministic replay is not our novelty.** Do not position it as invented here. It is a means, not the differentiator.

**2. `catacomb` (realkarych/catacomb)** — the closest existing project. Regression testing for Claude Code and Codex agents: local files, evidence directories, SQLite baselines, secret redaction before disk, CI exit codes, checkpoints so comparisons survive prompt rewrites.

**How it differs from us:** catacomb runs the agent *live*, repeatedly, and compares results statistically against a baseline. Every run costs API money and requires a key. It reads session transcripts rather than intercepting the API, so it cannot serve recorded responses back to the agent.

### Where the actual gap is

Nobody occupies the intersection of all three:

| | black-box coding agents | deterministic replay, no API key | behavioural assertions |
|---|---|---|---|
| VCR / cassette proxies | ✗ | ✓ | ✗ |
| langchain-replay | ✗ | ✓ | ✗ |
| catacomb | ✓ | ✗ | ✓ |
| AgentOps / LangSmith | ✗ | ✗ | ✗ |
| **repro** | **✓** | **✓** | **✓** |

### What this means for design

- **Lead with the assertion layer and the no-API-key CI property**, not with replay. Replay is proven, borrowed machinery. Asserting on agent *behaviour* — forbidden paths, loops, runaway tool use — over a fixture that needs no key is the part nobody has built.
- **The committed artifact is the second differentiator.** `REPRO.md` plus a portable `.repro/` bundle that another developer can clone and run. Cassettes are anonymous fixture files with no index and no convention.
- **Divergence localization is the third.** Cassette libraries fail on an unmatched request with an opaque error. D-004's per-message hash chain tells you *which message* diverged and how. Build that reporting deliberately.
- **Before Phase 1, read the source of `catacomb` and `langchain-replay`.** A day spent there will save weeks. Record what you learn as an ADR.
- **Recording via transcripts is a cheaper path than a proxy** — Claude Code, Cursor and Codex all write session JSONL to disk, and several tools already parse them. It is not sufficient for us (a transcript cannot be served back to the agent, so replay needs the proxy), but it is a useful cross-check that the proxy captured everything.

---

## 11. Future, for context only — do not build now

- `frozen.md` policies compiling to `forbidden_path` / `forbidden_command` assertions
- Filesystem and process capture layers for observed rather than reported side effects
- Fork points: `repro run <id> --from N --mode reinfer`
- Failure fingerprinting for recurrence clustering, computed after minimization
- `repro verify` — manifest hash over the blob set, making committed tests tamper-evident
- Second provider shape

These exist to show the architecture has somewhere to go. Building any of them before §8 is met is a mistake.
