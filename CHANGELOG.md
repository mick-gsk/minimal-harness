# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.1.0] - 2026-07-11

Initial public release — a lean, framework-agnostic agent harness for local LLMs
with **zero runtime dependencies**.

### Added

- **Agent core** — `DefaultAgentLoop` with a prompt-based tool-calling protocol
  that works even on models without native function-calling, a turn state machine,
  and an output parser (`tool_call` vs `final_answer`).
- **Guardrails** — `StructuredOutputValidator` enforces the output contract and
  drives corrective retries; pluggable `GuardrailPolicy` to restrict tools.
- **LLM adapters** — `OllamaClient`, `OpenAiCompatAdapter` (plus `LMStudioAdapter`,
  `LlamaCppAdapter`) and `adapterFromFn`; native tool calling and SSE token
  streaming (`onToken`).
- **Memory** — `InMemoryMemory` and a durable `SqliteMemory` on the built-in
  `node:sqlite` (WAL mode), a drop-in replacement.
- **Parallel tool calls** — opt-in concurrent execution of a turn's accepted
  calls, results written in call order.
- **Local RAG** — `OllamaEmbedder` + `SqliteKnowledgeStore` with cosine ranking
  and a `knowledge.search` built-in tool. Fully local, no cloud.
- **Structured extraction** — `responseSchema` on `loop.run(...)` guarantees the
  final answer is one JSON object matching your schema, or fails explicitly.
- **Office text extraction** — zero-dependency `xlsx` / `docx` / `pdf` text
  extraction.
- **Multi-user Agent Server** — `createAgentServer` (`node:http` + `node:crypto`):
  Bearer API-key auth, per-user session isolation, `/healthz`, Prometheus
  `/metrics`, SSE streaming, human-in-the-loop approvals, and GDPR access/erasure
  routes.
- **Built-in tools** — `clock.now`, `calculator.evaluate` (safe recursive-descent
  parser), `text_utils.summarize_local` (extractive, no external model).
- **Benchmarks** — a deterministic ablation matrix (`ollama-native` / `naive` /
  `minimal`) with pinned seeds, 95% Wilson confidence intervals, and a
  self-contained interactive dashboard.
- **Demo corpus** — a deterministically generated ~2,169-file German *Mittelstand*
  company used to exercise the harness against real-world, contradictory data.

[Unreleased]: https://github.com/mick-gsk/minimal-harness/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mick-gsk/minimal-harness/releases/tag/v0.1.0
