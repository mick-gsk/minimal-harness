# minimal-harness

A lean, framework-agnostic **Agent Harness** in TypeScript for local LLMs.

- **Ollama-first** — works against `localhost:11434` out of the box
- **Prompt-based Tool Calling** — functions even when the model has no native function-calling support
- **Zero cloud dependencies** — no API keys, no database required
- **ESM + strict TypeScript** — fully typed contracts throughout
- **Independently testable modules** — Memory, Tools, Guardrails, and Output Validator are decoupled

---

## Quickstart

```bash
git clone https://github.com/mick-gsk/minimal-harness.git
cd minimal-harness
npm install

# Start Ollama with any chat model
ollama run llama3

# Run the tool-agent example
npx tsx examples/tool-agent.ts
```

---

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

---

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

The `StructuredOutputValidator` parses this format and rejects anything that does not conform. On parse failure, the harness retries up to `maxRetries` times (default: 2) with a corrective prompt before terminating with `validation_failed`.

---

## Built-in Tools

| Tool | Name | Description |
|---|---|---|
| Clock | `clock.now` | Returns local or UTC time (IANA timezone) |
| Calculator | `calculator.evaluate` | Safe arithmetic via recursive descent parser |
| Text Utils | `text_utils.summarize_local` | Extractive summarizer, no external model |

---

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

---

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

---

## Running Tests

```bash
npm test
```

Tests use Jest with a mock LLM adapter — no running Ollama instance required.

---

## Benchmarks

The ablation matrix measures the **harness uplift**: the same local model,
same tasks, run through `ollama-native` (fair out-of-the-box baseline),
`naive` (illustrative: no retry/recovery) and `minimal` (this harness).

An interactive **[benchmark dashboard](docs/benchmark-dashboard.html)** renders these
results (success rate, 95% Wilson CIs, methodology) as a self-contained page — open it
in a browser, or serve `docs/` via GitHub Pages for a shareable link.

```bash
# requires a running Ollama with the target models pulled
npm run bench                      # frozen suite → writes BENCHMARKS.md
BENCH_MODELS="qwen3:8b" npm run bench
BENCH_SUITE=dev npm run bench      # dev suite for tuning, report to stdout only
```

Runs are reproducible: pinned seeds (1001–1005), temperature 0.7, k=5 runs
per task. Success rates come with 95% Wilson confidence intervals; an uplift
is only claimed when the intervals are disjoint. See
`docs/superpowers/specs/2026-07-09-messmethodik-lokales-agent-harness-design.md`.

**Scope, stated plainly:** the in-house suite was designed by this project's
author and minimal was debugged against it. It supports the *uplift* claim
(all arms share tasks, tools, models and seeds — a difference on identical
terrain), but it is **not evidence of "best harness"**. Numbers for external
harnesses (e.g. smolagents, opt-in via `BENCH_SMOLAGENTS`) are orientative
only: off-the-shelf defaults, home-field task design, sidecar integration
seam. Neutral third-party benchmarks (BFCL) are tracked separately.

---

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

---

## v1 Limitations

- No parallel tool execution
- No streaming support
- `summarize()` on `Memory` is optional and not wired into the default loop
- LM Studio and llama.cpp adapters are stubs

## Extension Points

- **Streaming**: extend `LLMAdapter.generate()` to yield tokens
- **Parallel tools**: extend `AgentLoop` to detect multiple `tool_call` blocks per turn
- **Custom policies**: pass a `GuardrailPolicy` to `DefaultAgentLoop` to restrict allowed tools
