<div align="center">

# minimal-harness

**A lean, framework-agnostic agent harness for local LLMs.**
Prompt-based tool calling · zero runtime dependencies · strict TypeScript.

[![CI](https://github.com/mick-gsk/minimal-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/mick-gsk/minimal-harness/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/minimal-harness?logo=npm&color=cb0000)](https://www.npmjs.com/package/minimal-harness)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.json)
[![dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](package.json)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-5fa04e?logo=node.js&logoColor=white)](package.json)

<a href="#benchmarks"><img src="https://raw.githubusercontent.com/mick-gsk/minimal-harness/main/docs/assets/benchmark-hero.png" alt="Benchmark: on llama3.1 the harness lifts task success from 56% to 92%, measured with 95% Wilson confidence intervals" width="860"></a>

</div>

---

`minimal-harness` makes local models — via **Ollama**, LM Studio, llama.cpp, or any
OpenAI-compatible endpoint — **reliable at tool calling**, even models with no native
function-calling, through a small prompt protocol, output validation, and
retry/recovery. No API keys, no database, no cloud. Roughly 2.8 kLOC of strict, ESM
TypeScript with `dependencies: {}`.

- **Ollama-first** — works against `localhost:11434` out of the box
- **Prompt-based tool calling** — functions even when the model has no native function-calling
- **Zero cloud dependencies** — no API keys, no database required; `dependencies: {}`
- **ESM + strict TypeScript** — fully typed contracts throughout
- **Independently testable modules** — Memory, Tools, Guardrails, and the Output Validator are decoupled
- **Deployable** — a zero-dependency multi-user HTTP server with auth, Prometheus metrics, and GDPR routes

## Contents

- [Benchmarks](#benchmarks) — the measured uplift
- [Quickstart](#quickstart)
- [Architecture](#architecture)
- [Prompt Protocol](#prompt-protocol)
- [Built-in Tools](#built-in-tools) · [Custom Tool](#adding-a-custom-tool) · [Custom LLM Backend](#adding-a-custom-llm-backend)
- [Persistent Memory](#persistent-memory) · [Parallel Tool Calls & Streaming](#parallel-tool-calls--streaming)
- [Multi-User Agent Server](#multi-user-agent-server) · [Structured Extraction & Local RAG](#structured-extraction--local-rag)
- [Tested against a real company](#tested-against-a-real-company)
- [Running Tests](#running-tests) · [Contributing](#contributing) · [License](#license)

---

## Benchmarks

Same model, same tasks — run through a fair `ollama-native` baseline, an illustrative
`naive` arm (no retry/recovery), and `minimal` (this harness). Deterministically scored,
**zero LLM judges**, with 95% Wilson confidence intervals.

| Model | `ollama-native` | `minimal` | Harness uplift |
|---|---|---|---|
| **llama3.1** | 56.4% | **92.4%** | **+36.0 pp** — significant (CIs disjoint) |
| **qwen3:8b** | 85.2% | **90.0%** | +4.8 pp — not yet significant (CIs overlap) |

<sub>suite-v2 · k=5 runs/task · seeds 1001–1005 · temperature 0.7 · 250 runs per cell. See [`BENCHMARKS.md`](BENCHMARKS.md).</sub>

On **neutral Berkeley Function-Calling (BFCL) tasks the harness never saw**, correct
tool-calls go **58% → 82%** — and `minimal` beats off-the-shelf Hugging Face smolagents
on weak models while spending **8–13× fewer tokens**. The full story — five harnesses
head-to-head, the neutral terrain, a token-cost breakdown, and a defect log of bugs the
benchmark itself surfaced — lives in the interactive dashboard:

<div align="center">
<a href="docs/benchmark-dashboard.html"><img src="https://raw.githubusercontent.com/mick-gsk/minimal-harness/main/docs/assets/benchmark-dashboard.png" alt="Full benchmark report: results at a glance, five harnesses head-to-head, neutral BFCL terrain, token cost, method and limitations" width="720"></a>
</div>

```bash
# requires a running Ollama with the target models pulled
npm run bench                    # frozen suite → writes BENCHMARKS.md
BENCH_MODELS="qwen3:8b" npm run bench
BENCH_SUITE=dev npm run bench    # dev suite for tuning, report to stdout only
```

Open [`docs/benchmark-dashboard.html`](docs/benchmark-dashboard.html) locally, or serve
`docs/` via GitHub Pages for a shareable link.

**Scope, stated plainly.** The in-house suite was designed by this project's author and
`minimal` was debugged against it, so it supports the **uplift** claim (all arms share
tasks, tools, models and seeds — a difference on identical terrain), **not** a "best
harness" claim. Rival numbers (smolagents) are off-the-shelf defaults through a sidecar;
neutral third-party benchmarks (BFCL) are tracked separately. Methodology:
[`docs/superpowers/specs/2026-07-09-messmethodik-lokales-agent-harness-design.md`](docs/superpowers/specs/2026-07-09-messmethodik-lokales-agent-harness-design.md).

## Quickstart

Install as a library:

```bash
npm install minimal-harness
```

```ts
import {
  DefaultAgentLoop, OllamaClient, InMemoryMemory, DefaultToolBridge,
  DefaultPromptBuilder, StructuredOutputValidator, calculatorTool, clockTool,
} from "minimal-harness";

const toolBridge = new DefaultToolBridge();
toolBridge.register(calculatorTool);
toolBridge.register(clockTool);

const agent = new DefaultAgentLoop({
  llm: new OllamaClient({ baseUrl: "http://localhost:11434", model: "qwen3:8b" }),
  memory: new InMemoryMemory(),
  toolBridge,
  validator: new StructuredOutputValidator(),
  promptBuilder: new DefaultPromptBuilder(),
  systemInstruction: "You are a helpful assistant. Use a tool when it helps.",
});

const result = await agent.run({
  sessionId: "demo",
  userMessage: "What is 12 * (3 + 4), and what time is it in Europe/Berlin?",
  maxTurns: 8,
});
console.log(result.finalAnswer);
```

Or run the bundled examples from source:

```bash
git clone https://github.com/mick-gsk/minimal-harness.git
cd minimal-harness
npm install

ollama run llama3            # start any local chat model
npx tsx examples/tool-agent.ts
```

> **Node ≥ 22.5** — `SqliteMemory` and `SqliteKnowledgeStore` use the built-in
> `node:sqlite` (unflagged from Node 23.4; on Node 22.x pass `--experimental-sqlite`).

See [`examples/`](examples/) for runnable end-to-end setups.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  AgentLoop                       │
│  PromptBuilder → LLMAdapter → OutputParser       │
│       ↑               ↓              ↓           │
│     Memory       Guardrails      ToolBridge      │
└─────────────────────────────────────────────────┘
```

| Module | File | Responsibility |
|---|---|---|
| `AgentLoop` | `core/agent-loop.ts` | Orchestrates the full dialog flow |
| `PromptBuilder` | `core/prompt-builder.ts` | Builds system + tool-call prompts |
| `OutputParser` | `core/output-parser.ts` | Detects tool_call vs final_answer |
| `StateMachine` | `core/state-machine.ts` | Manages agent turn states |
| `OllamaClient` | `llm/ollama-client.ts` | Calls Ollama REST API |
| `InMemoryMemory` | `memory/in-memory.ts` | Per-session message store |
| `SqliteMemory` | `memory/sqlite-memory.ts` | Durable per-session store via built-in `node:sqlite` |
| `DefaultToolBridge` | `tools/tool-bridge.ts` | Registry, validation, dispatch |
| `StructuredOutputValidator` | `guardrails/validator.ts` | Enforces output format |

## Prompt Protocol

The harness injects this output contract into every system prompt:

```
To call a tool:
ACTION: tool_call
TOOL: <tool_name>
ARGS: <json>

To give a final answer:
ACTION: final_answer
ANSWER: <your answer>
```

The `StructuredOutputValidator` parses this format and rejects anything that does not
conform. On parse failure, the harness retries up to `maxRetries` times (default: 2)
with a corrective prompt before terminating with `validation_failed`.

## Built-in Tools

| Tool | Name | Description |
|---|---|---|
| Clock | `clock.now` | Returns local or UTC time (IANA timezone) |
| Calculator | `calculator.evaluate` | Safe arithmetic via recursive descent parser |
| Text Utils | `text_utils.summarize_local` | Extractive summarizer, no external model |

## Adding a Custom Tool

```ts
import type { ToolDefinition } from "minimal-harness";

const myTool: ToolDefinition<{ query: string }, { result: string }> = {
  name: "my_tool.search",
  description: "Does something useful.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(input) {
    return { result: `You searched for: ${input.query}` };
  },
};

toolBridge.register(myTool);
```

## Adding a Custom LLM Backend

```ts
import { adapterFromFn } from "minimal-harness";

const myAdapter = adapterFromFn(async (messages) => {
  // call your own REST endpoint here
  return { content: "..." };
});
```

**LM Studio**, **llama.cpp server** and any other OpenAI-compatible backend
(including Ollama's `/v1` endpoint) work out of the box via `OpenAiCompatAdapter`:

```ts
import { LMStudioAdapter, LlamaCppAdapter, OpenAiCompatAdapter } from "minimal-harness";

const lmstudio = new LMStudioAdapter();                       // localhost:1234
const llamacpp = new LlamaCppAdapter();                       // localhost:8080
const custom = new OpenAiCompatAdapter({ baseUrl: "http://host:8000/v1", model: "qwen3:8b" });
```

Supports native tool calling and SSE streaming (`onToken`).

## Persistent Memory

`SqliteMemory` is a drop-in replacement for `InMemoryMemory` — sessions survive
process restarts. It uses the **built-in** `node:sqlite` (no new dependency);
this class requires Node ≥ 22.5 (flag-free since 23.4), the rest of the library
does not.

```ts
import { SqliteMemory } from "minimal-harness";

const memory = new SqliteMemory("./agent-memory.db"); // or ":memory:"
// pass it to DefaultAgentLoop instead of InMemoryMemory
```

Writes use WAL mode (crash-safe, concurrent readers). Validated by deterministic
tests (restart persistence, session isolation, metadata round-trip) plus a
perf smoke: 10,000 appends ≈ 0.5 s, reading a 1,000-message session < 1 ms.

## Parallel Tool Calls & Streaming

- **Parallel tool calls** (native path, opt-in): `parallelToolCalls: true` on
  `DefaultAgentLoop` executes all accepted calls of a turn concurrently while
  writing results in call order — measured: two 100 ms tools drop from
  203 ms (sequential) to 102 ms.
- **Token streaming**: pass `onToken` to `loop.run(...)` — chunks flow from the
  backend (Ollama NDJSON, OpenAI-compat SSE) straight to your callback.

## Multi-User Agent Server

`createAgentServer` turns the harness into a deployable HTTP service — still
zero dependencies (`node:http` + `node:crypto`):

```ts
import { createAgentServer, OllamaClient, SqliteMemory } from "minimal-harness";

createAgentServer({
  llm: new OllamaClient({ baseUrl: "http://localhost:11434", model: "qwen3:8b" }),
  tools: [/* your tools */],
  memory: new SqliteMemory("./agent-memory.db"),
  apiKeys: { "sk-secret-key": "alice" }, // key -> userId
}).listen(8790);
```

- **Auth**: Bearer API keys, constant-time comparison over SHA-256 digests
- **Isolation**: sessions are scoped `userId:sessionId` — the userId comes from
  the API key only, so users can never touch each other's sessions
- **Routes**: `GET /healthz` · `GET /metrics` (Prometheus) ·
  `POST /v1/agent/run` (`{sessionId, message, maxTurns?, stream?, responseSchema?}`;
  `stream: true` returns SSE token events plus a final `result` event) ·
  `GET|DELETE /v1/sessions[/{id}]` (GDPR Art. 15 access / Art. 17 erasure,
  own sessions only) · `POST /v1/agent/approvals/{id}`
- **Human-in-the-loop**: list tools in `requireApproval` and streaming clients
  get an `approval_request` event before the tool runs; no answer = deny
  (fail-closed), non-streaming requests deny gated tools outright
- **Observability**: request/run counters and durations at `/metrics`, one
  structured JSON log line per run — metadata only, message content is never logged
- **Validated**: integration tests cover auth failures, cross-user isolation on
  a real SQLite file, SSE, approval flows, error paths, and a
  20-parallel-request smoke (21 ms)
- TLS and rate limiting deliberately live in your reverse proxy

See [examples/server.ts](examples/server.ts) for a runnable setup and
[docs/deployment.md](docs/deployment.md) for Docker/systemd operations.

## Structured Extraction & Local RAG

- **`responseSchema`** on `loop.run(...)` (or the server body): the final
  answer must be one JSON object matching your schema — contract in the
  prompt, validation, corrective retries, `structuredAnswer` on the result.
  A run that never conforms fails explicitly instead of returning broken JSON.
  Built for the highest-ROI SME use cases: invoice/order/e-mail extraction.
- **`SqliteKnowledgeStore` + `knowledge.search`**: a fully local knowledge
  base — Ollama embeddings (default `snowflake-arctic-embed2`, multilingual:
  hit@1 5/5 on German queries vs. 2/5 for nomic-embed-text; bge-m3 also hit
  5/5 but produced NaN embeddings for specific inputs on Ollama 0.17 and was
  rejected for reliability) with SQLite storage and cosine ranking. Zero
  cloud, zero new dependencies.

All production capabilities are measured and validated —
see [docs/mittelstand-validierung.md](docs/mittelstand-validierung.md).

## Tested against a real company

The harness's claim — *"works inside a company"* — had no company to be tested on, so
there is one: a deterministically generated German *Mittelstand* supplier — **2,169
files, 2.7 MB, generated in two seconds** — with its grown fileserver, half-migrated ERP,
Active Directory, mail archive, abandoned DocuWare, machine-data export, DATEV handover
and CAD vault, **and its mess**.

> A *Mittelständler* does not have one system. It has seven, and they disagree with each
> other. Every disagreement in this corpus is **computable** — that is the only reason it
> is here.

No file count was chosen: every number is derived from the business, and
[`company/verify.ts`](company/) checks that the ERP's own invoices add back up to the
stated revenue (within 2.5%). It is the fixture behind the harness's production path —
mixed encodings (UTF-8 / windows-1252), contradictory sources, and answer-key facts a
model must reconcile.

See [`company/README.md`](company/README.md) for how it is built, and
[`bench/company/README.md`](bench/company/README.md) for the deployment-tools probe
(`fs.list`, `fs.read`, `erp.query`) run over the corpus.

## Running Tests

```bash
npm test
```

Tests use Jest with a mock LLM adapter — **no running Ollama instance required**.

## Contributing

Issues and PRs are welcome. The guiding rule is *"the best part is no part"*: a new
runtime dependency needs a written justification, and `dependencies: {}` is the target
state. See [CONTRIBUTING.md](CONTRIBUTING.md) and the engineering principles in
[CLAUDE.md](CLAUDE.md).

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

## v1 Limitations

- `summarize()` on `Memory` is optional and not wired into the default loop
- **Custom policies**: pass a `GuardrailPolicy` to `DefaultAgentLoop` to restrict allowed tools

## License

[MIT](LICENSE) © Mick G. ([@mick-gsk](https://github.com/mick-gsk))
