# Bench-MVP (Ablations-Matrix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein `bench/`-Modul, das `npm run bench` bereitstellt und eine reproduzierbare `BENCHMARKS.md` erzeugt: Task-Suite × {ollama-native, naive, minimal} × konfigurierbare Ollama-Modelle × 5 Seeds → Erfolgsrate, pass^5, Wilson-CI und Harness-Uplift.

**Architecture:** `bench/` konsumiert minimal-harness über die öffentliche API (`src/index.ts`) und baut drei Harness-Adapter hinter einem gemeinsamen `HarnessAdapter`-Interface. Ein Telemetrie-Decorator um `LLMAdapter` zählt LLM-Calls und Tokens ohne Kern-Umbau. Der Runner (`runMatrix`) ist von der CLI getrennt und bekommt eine injizierbare LLM-Factory, damit alle Tests mit Mock-Adaptern laufen (kein Ollama in CI). Einzige Kern-Änderung: additiver Seed-Support in `OllamaClient` (Voraussetzung für Reproduzierbarkeit, Spec §4.3).

**Tech Stack:** TypeScript (strict, ESM, NodeNext-Imports mit `.js`-Endung), Jest (via `npm test`, ESM-Modus), tsx (neu als devDependency) für den CLI-Runner, Ollama REST-API.

## Global Constraints

- Antworten/Prosa Deutsch, Code und Code-Kommentare Englisch (wie bestehende Codebasis).
- ESM: alle relativen Imports mit `.js`-Endung, auch in `.ts`-Dateien.
- Keine Runtime-Dependencies — `dependencies` in package.json bleibt `{}`; nur `tsx` kommt zu `devDependencies`.
- Kein Umbau des Kerns für die Messung (Spec §6) — einzige Ausnahme: additiver, optionaler Seed-Support (Task 1), da sonst Spec §4.3 unerfüllbar.
- Seeds: `[1001, 1002, 1003, 1004, 1005]`, Temperatur `0.7`, `k = 5` (Spec §4.3/§5).
- Tests liegen in `tests/` mit Muster `tests/*.test.ts` (wie bestehende Tests); Testlauf: `npm test`.
- Jeder Task endet mit einem Commit; Commit-Messages Englisch, conventional-commits-Stil (wie `feat: initial project scaffold …`).
- **Abweichung von Spec §4.1 (begründet):** `RunResult.parseFailures`/`recoveries` erfordern invasive Kern-Instrumentierung (Retries sind intern im Loop). MVP misst stattdessen `llmCalls` (Telemetrie-Decorator) als Proxy — `llmCalls − turns` ≈ Retry-Aufwand. Echte parseFailures/recoveries: Stufe 2.

---

### Task 1: Seed-Support in OllamaClient (additive Kern-Erweiterung)

**Files:**
- Modify: `src/types/llm.ts` (in `LLMGenerateOptions`)
- Modify: `src/types/config.ts` (in `OllamaClientConfig`)
- Modify: `src/llm/ollama-client.ts` (Request-Body)
- Test: `tests/ollama-client.test.ts` (ergänzen)

**Interfaces:**
- Consumes: bestehende `OllamaClient`, `LLMGenerateOptions`, `OllamaClientConfig`.
- Produces: `LLMGenerateOptions.seed?: number`; `OllamaClientConfig.defaultSeed?: number`. Ollama-Request enthält `options.seed`, wenn gesetzt (per-Call `seed` überschreibt `defaultSeed`). Der Bench-Runner (Task 9) verlässt sich auf `defaultSeed`.

- [ ] **Step 1: Failing Test schreiben** — in `tests/ollama-client.test.ts` ergänzen (bestehendes fetch-Mock-Muster der Datei übernehmen; falls die Datei einen Helper zum Mocken von `fetch` hat, diesen wiederverwenden):

```ts
describe("seed support", () => {
  it("sends options.seed from config.defaultSeed", async () => {
    const calls: unknown[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ message: { role: "assistant", content: "ok" }, model: "m" }),
        { status: 200 },
      );
    }) as typeof fetch;

    const client = new OllamaClient({
      baseUrl: "http://localhost:11434",
      model: "m",
      defaultSeed: 1001,
    });
    await client.generate([{ role: "user", content: "hi" }]);
    expect((calls[0] as { options: { seed?: number } }).options.seed).toBe(1001);
  });

  it("per-call seed overrides defaultSeed", async () => {
    const calls: unknown[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ message: { role: "assistant", content: "ok" }, model: "m" }),
        { status: 200 },
      );
    }) as typeof fetch;

    const client = new OllamaClient({
      baseUrl: "http://localhost:11434",
      model: "m",
      defaultSeed: 1001,
    });
    await client.generate([{ role: "user", content: "hi" }], { seed: 42 });
    expect((calls[0] as { options: { seed?: number } }).options.seed).toBe(42);
  });

  it("omits options.seed when no seed configured", async () => {
    const calls: unknown[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ message: { role: "assistant", content: "ok" }, model: "m" }),
        { status: 200 },
      );
    }) as typeof fetch;

    const client = new OllamaClient({ baseUrl: "http://localhost:11434", model: "m" });
    await client.generate([{ role: "user", content: "hi" }]);
    expect("seed" in (calls[0] as { options: object }).options).toBe(false);
  });
});
```

Hinweis: Falls die bestehende Testdatei `fetch` anders mockt (z. B. via `jest.spyOn`), das dortige Muster übernehmen — entscheidend sind die drei Assertions.

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- --testPathPattern ollama-client`
Expected: FAIL — `defaultSeed`/`seed` existieren nicht in den Typen (TS-Fehler) bzw. `options.seed` ist `undefined`.

- [ ] **Step 3: Implementierung**

In `src/types/llm.ts`, innerhalb `LLMGenerateOptions` (nach `stop?: string[];`):

```ts
  /** Sampling seed for reproducible runs on backends that support it. */
  seed?: number;
```

In `src/types/config.ts`, innerhalb `OllamaClientConfig` (nach `defaultMaxTokens?: number;`):

```ts
  /** Applied to every request unless overridden per call via LLMGenerateOptions.seed. */
  defaultSeed?: number;
```

In `src/llm/ollama-client.ts`:
1. Im Interface `OllamaChatRequest` die `options`-Zeile ersetzen:

```ts
  options: { temperature: number; num_predict?: number; stop?: string[]; seed?: number };
```

2. In `generate()`, vor `const body`, einfügen:

```ts
    const seed = options?.seed ?? this.config.defaultSeed;
```

3. Im `options`-Objekt des Bodys (nach der `stop`-Zeile) ergänzen:

```ts
        ...(seed !== undefined ? { seed } : {}),
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test -- --testPathPattern ollama-client`
Expected: PASS (alle, inkl. der bestehenden Tests der Datei)

- [ ] **Step 5: Gesamte Suite + Lint**

Run: `npm test && npm run lint`
Expected: PASS / keine neuen Lint-Fehler

- [ ] **Step 6: Commit**

```bash
git add src/types/llm.ts src/types/config.ts src/llm/ollama-client.ts tests/ollama-client.test.ts
git commit -m "feat(llm): optional sampling seed for OllamaClient (per-call and config default)"
```

---

### Task 2: Bench-Typen, WorldState & Test-Tools

**Files:**
- Create: `bench/types.ts`
- Create: `bench/world.ts`
- Create: `bench/testing.ts`
- Test: `tests/bench-world.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`, `LLMAdapter`, `LLMResponse`, `ChatMessage` aus `../src/index.js`.
- Produces (von allen Folge-Tasks genutzt):
  - `WorldState` mit `kv: Map<string, string>`
  - `BenchTask { id, category, prompt, maxTurns, makeTools(world), check(result, world) }`
  - `BenchRunResult { finalAnswer, terminatedReason, turns, llmCalls, tokens, latencyMs, toolCallCount, error? }`
  - `HarnessAdapter { name, run(task, llm, tools) }`
  - `ModelConfig { name, baseUrl, temperature }`
  - `makeKvTools(world): ToolDefinition[]` (Tools `kv.set`, `kv.get`)
  - `scriptedLlm(responses): LLMAdapter` (Test-Helper)

- [ ] **Step 1: Failing Test schreiben** — `tests/bench-world.test.ts`:

```ts
import { describe, it, expect } from "@jest/globals";
import { WorldState } from "../bench/world.js";
import { makeKvTools } from "../bench/world.js";

describe("WorldState kv tools", () => {
  it("kv.set writes into the world's map", async () => {
    const world = new WorldState();
    const tools = makeKvTools(world);
    const set = tools.find((t) => t.name === "kv.set")!;
    await set.execute({ key: "color", value: "blue" });
    expect(world.kv.get("color")).toBe("blue");
  });

  it("kv.get reads from the world's map", async () => {
    const world = new WorldState();
    world.kv.set("answer", "42");
    const tools = makeKvTools(world);
    const get = tools.find((t) => t.name === "kv.get")!;
    const out = (await get.execute({ key: "answer" })) as { value: string | null };
    expect(out.value).toBe("42");
  });

  it("kv.get returns null for a missing key", async () => {
    const world = new WorldState();
    const get = makeKvTools(world).find((t) => t.name === "kv.get")!;
    const out = (await get.execute({ key: "nope" })) as { value: string | null };
    expect(out.value).toBeNull();
  });

  it("two worlds are isolated", async () => {
    const a = new WorldState();
    const b = new WorldState();
    const setA = makeKvTools(a).find((t) => t.name === "kv.set")!;
    await setA.execute({ key: "k", value: "v" });
    expect(b.kv.has("k")).toBe(false);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- --testPathPattern bench-world`
Expected: FAIL — Module `../bench/world.js` nicht gefunden.

- [ ] **Step 3: Implementierung**

`bench/types.ts`:

```ts
import type { ToolDefinition, LLMAdapter } from "../src/index.js";
import type { WorldState } from "./world.js";

export type TaskCategory = "single-tool" | "multi-step" | "world-state" | "no-tool";

/** One deterministically scorable benchmark task (spec §4.1). */
export interface BenchTask {
  id: string;
  category: TaskCategory;
  prompt: string;
  maxTurns: number;
  /** Fresh tools per run; may pre-seed the world (e.g. kv fixtures). */
  makeTools(world: WorldState): ToolDefinition[];
  /** Deterministic success check on final answer and/or world state. */
  check(result: BenchRunResult, world: WorldState): boolean;
}

/**
 * Telemetry of a single run. MVP deviation from spec §4.1: instead of
 * parseFailures/recoveries (would need core instrumentation) we record
 * llmCalls — llmCalls minus turns approximates retry effort.
 */
export interface BenchRunResult {
  finalAnswer: string | null;
  terminatedReason: string;
  turns: number;
  llmCalls: number;
  /** prompt+completion tokens summed from Ollama's eval counts; 0 if unknown. */
  tokens: number;
  latencyMs: number;
  toolCallCount: number;
  error?: string;
}

/** One contestant in the ablation matrix (spec §4). */
export interface HarnessAdapter {
  name: "minimal" | "ollama-native" | "naive";
  run(task: BenchTask, llm: LLMAdapter, tools: ToolDefinition[]): Promise<BenchRunResult>;
}

export interface ModelConfig {
  name: string;
  baseUrl: string;
  temperature: number;
}
```

`bench/world.ts`:

```ts
import type { ToolDefinition } from "../src/index.js";

/** Mutable per-run world the scorer can inspect (spec §4.1 WorldState). */
export class WorldState {
  readonly kv = new Map<string, string>();
}

/** Test tools with checkable side effects: kv.set / kv.get. */
export function makeKvTools(world: WorldState): ToolDefinition[] {
  const kvSet: ToolDefinition<{ key: string; value: string }, { ok: true }> = {
    name: "kv.set",
    description: "Store a string value under a key in the key-value store.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" }, value: { type: "string" } },
      required: ["key", "value"],
      additionalProperties: false,
    },
    async execute(input) {
      world.kv.set(input.key, String(input.value));
      return { ok: true };
    },
  };

  const kvGet: ToolDefinition<{ key: string }, { value: string | null }> = {
    name: "kv.get",
    description: "Read the string value stored under a key. Returns null if the key does not exist.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
    async execute(input) {
      return { value: world.kv.get(input.key) ?? null };
    },
  };

  return [kvSet as ToolDefinition, kvGet as ToolDefinition];
}
```

`bench/testing.ts` (Test-Helper, von den Adapter-Tests der Tasks 6–8 genutzt):

```ts
import type { LLMAdapter, LLMResponse } from "../src/index.js";

/**
 * Returns each canned response in order; repeats the last one when the
 * script is exhausted. Lets adapter tests simulate multi-turn dialogs.
 */
export function scriptedLlm(responses: LLMResponse[]): LLMAdapter & { calls: number } {
  let i = 0;
  const adapter = {
    calls: 0,
    async generate(): Promise<LLMResponse> {
      adapter.calls++;
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return r;
    },
  };
  return adapter;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test -- --testPathPattern bench-world`
Expected: PASS (4 Tests)

- [ ] **Step 5: Commit**

```bash
git add bench/types.ts bench/world.ts bench/testing.ts tests/bench-world.test.ts
git commit -m "feat(bench): core types, WorldState with kv test tools, scripted LLM helper"
```

---

### Task 3: Statistik — Wilson-Konfidenzintervall & pass^k

**Files:**
- Create: `bench/stats.ts`
- Test: `tests/bench-stats.test.ts`

**Interfaces:**
- Consumes: nichts (pure Funktionen).
- Produces (vom Reporter, Task 10, genutzt):
  - `wilson(successes: number, n: number): { rate: number; low: number; high: number }` (95 %, z = 1.96)
  - `passK(perTaskSuccesses: boolean[][]): number` — Anteil Tasks mit Erfolg in allen k Läufen (strikte Variante, Spec §2)

- [ ] **Step 1: Failing Test schreiben** — `tests/bench-stats.test.ts`:

```ts
import { describe, it, expect } from "@jest/globals";
import { wilson, passK } from "../bench/stats.js";

describe("wilson", () => {
  it("returns rate 0 with interval [0, <1] for 0/10", () => {
    const w = wilson(0, 10);
    expect(w.rate).toBe(0);
    expect(w.low).toBe(0);
    expect(w.high).toBeGreaterThan(0);
    expect(w.high).toBeLessThan(0.35);
  });

  it("returns rate 1 with interval [>0.6, 1] for 10/10", () => {
    const w = wilson(10, 10);
    expect(w.rate).toBe(1);
    expect(w.high).toBeCloseTo(1, 5);
    expect(w.low).toBeGreaterThan(0.6);
  });

  it("matches the known Wilson interval for 50/100", () => {
    // Reference value: Wilson 95% for p̂=0.5, n=100 → [0.404, 0.596]
    const w = wilson(50, 100);
    expect(w.rate).toBeCloseTo(0.5, 5);
    expect(w.low).toBeCloseTo(0.404, 2);
    expect(w.high).toBeCloseTo(0.596, 2);
  });

  it("handles n=0 without NaN", () => {
    const w = wilson(0, 0);
    expect(w.rate).toBe(0);
    expect(w.low).toBe(0);
    expect(w.high).toBe(0);
  });
});

describe("passK", () => {
  it("counts only tasks that succeed in every run", () => {
    const perTask = [
      [true, true, true],   // pass
      [true, false, true],  // fail
      [false, false, false] // fail
    ];
    expect(passK(perTask)).toBeCloseTo(1 / 3, 5);
  });

  it("returns 0 for an empty task list", () => {
    expect(passK([])).toBe(0);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- --testPathPattern bench-stats`
Expected: FAIL — Module `../bench/stats.js` nicht gefunden.

- [ ] **Step 3: Implementierung** — `bench/stats.ts`:

```ts
/** 95% Wilson score interval for a binomial proportion (spec §4.4a). */
export function wilson(
  successes: number,
  n: number,
): { rate: number; low: number; high: number } {
  if (n === 0) return { rate: 0, low: 0, high: 0 };
  const z = 1.96;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { rate: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/**
 * Strict pass^k (spec §2): share of tasks that succeed in ALL of their runs.
 * Input: one boolean array of run outcomes per task.
 */
export function passK(perTaskSuccesses: boolean[][]): number {
  if (perTaskSuccesses.length === 0) return 0;
  const allPass = perTaskSuccesses.filter((runs) => runs.length > 0 && runs.every(Boolean));
  return allPass.length / perTaskSuccesses.length;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test -- --testPathPattern bench-stats`
Expected: PASS (6 Tests)

- [ ] **Step 5: Commit**

```bash
git add bench/stats.ts tests/bench-stats.test.ts
git commit -m "feat(bench): Wilson 95% CI and strict pass^k statistics"
```

---

### Task 4: Telemetrie-Decorator um LLMAdapter

**Files:**
- Create: `bench/telemetry.ts`
- Test: `tests/bench-telemetry.test.ts`

**Interfaces:**
- Consumes: `LLMAdapter`, `LLMResponse` aus `../src/index.js`; `scriptedLlm` aus `../bench/testing.js`.
- Produces (vom Runner, Task 9, genutzt):
  - `withTelemetry(inner: LLMAdapter): LLMAdapter & { stats: { llmCalls: number; tokens: number } }`
  - Tokens werden aus Ollamas `raw.prompt_eval_count + raw.eval_count` summiert; fehlen sie, zählt der Call 0 Tokens.

- [ ] **Step 1: Failing Test schreiben** — `tests/bench-telemetry.test.ts`:

```ts
import { describe, it, expect } from "@jest/globals";
import { withTelemetry } from "../bench/telemetry.js";
import { scriptedLlm } from "../bench/testing.js";

describe("withTelemetry", () => {
  it("counts generate calls and sums Ollama eval token counts", async () => {
    const inner = scriptedLlm([
      { content: "a", raw: { prompt_eval_count: 10, eval_count: 5 } },
      { content: "b", raw: { prompt_eval_count: 20, eval_count: 7 } },
    ]);
    const llm = withTelemetry(inner);
    await llm.generate([{ role: "user", content: "x" }]);
    await llm.generate([{ role: "user", content: "y" }]);
    expect(llm.stats.llmCalls).toBe(2);
    expect(llm.stats.tokens).toBe(42);
  });

  it("treats missing raw counts as 0 tokens", async () => {
    const llm = withTelemetry(scriptedLlm([{ content: "a" }]));
    await llm.generate([{ role: "user", content: "x" }]);
    expect(llm.stats.llmCalls).toBe(1);
    expect(llm.stats.tokens).toBe(0);
  });

  it("passes messages and options through to the inner adapter", async () => {
    const seen: unknown[] = [];
    const inner = {
      async generate(messages: unknown, options?: unknown) {
        seen.push([messages, options]);
        return { content: "ok" };
      },
    };
    const llm = withTelemetry(inner);
    await llm.generate([{ role: "user", content: "hi" }], { temperature: 0.1 });
    expect(seen).toHaveLength(1);
    expect((seen[0] as unknown[])[1]).toEqual({ temperature: 0.1 });
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- --testPathPattern bench-telemetry`
Expected: FAIL — Module `../bench/telemetry.js` nicht gefunden.

- [ ] **Step 3: Implementierung** — `bench/telemetry.ts`:

```ts
import type { ChatMessage, LLMAdapter, LLMGenerateOptions, LLMResponse } from "../src/index.js";

interface OllamaEvalCounts {
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Decorator that counts LLM calls and sums Ollama token counts without
 * touching the core (spec §6: no core rebuild for measurement).
 */
export function withTelemetry(
  inner: LLMAdapter,
): LLMAdapter & { stats: { llmCalls: number; tokens: number } } {
  const stats = { llmCalls: 0, tokens: 0 };
  return {
    stats,
    async generate(messages: ChatMessage[], options?: LLMGenerateOptions): Promise<LLMResponse> {
      stats.llmCalls++;
      const res = await inner.generate(messages, options);
      const raw = (res.raw ?? {}) as OllamaEvalCounts;
      stats.tokens += (raw.prompt_eval_count ?? 0) + (raw.eval_count ?? 0);
      return res;
    },
  };
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test -- --testPathPattern bench-telemetry`
Expected: PASS (3 Tests)

- [ ] **Step 5: Commit**

```bash
git add bench/telemetry.ts tests/bench-telemetry.test.ts
git commit -m "feat(bench): telemetry decorator counting llm calls and ollama tokens"
```

---

### Task 5: Task-Suite v1 (frozen) + dev-Suite

**Files:**
- Create: `bench/tasks/frozen/suite-v1.ts`
- Create: `bench/tasks/dev.ts`
- Test: `tests/bench-tasks.test.ts`

**Interfaces:**
- Consumes: `BenchTask`, `BenchRunResult` aus `../bench/types.js`; `WorldState`, `makeKvTools` aus `../bench/world.js`; `calculatorTool`, `clockTool` aus `../src/index.js`.
- Produces:
  - `suiteV1: BenchTask[]` (10 Tasks, **frozen** — Spec §4.4b: nur für Reports, nie zum Debuggen einzelner Fails; Änderungen nur per Versions-Bump auf `suite-v2.ts`)
  - `SUITE_VERSION = "suite-v1"`
  - `devTasks: BenchTask[]` (4 Tasks — zum Entwickeln/Tunen erlaubt)

- [ ] **Step 1: Failing Test schreiben** — `tests/bench-tasks.test.ts` (Wohlgeformtheit, nicht Inhalt — Inhalt prüft der echte Bench-Lauf):

```ts
import { describe, it, expect } from "@jest/globals";
import { suiteV1, SUITE_VERSION } from "../bench/tasks/frozen/suite-v1.js";
import { devTasks } from "../bench/tasks/dev.js";
import { WorldState } from "../bench/world.js";
import type { BenchRunResult } from "../bench/types.js";

const emptyResult: BenchRunResult = {
  finalAnswer: null,
  terminatedReason: "error",
  turns: 0,
  llmCalls: 0,
  tokens: 0,
  latencyMs: 0,
  toolCallCount: 0,
};

describe("task suites", () => {
  it("suite-v1 has 10 tasks, dev has 4", () => {
    expect(suiteV1).toHaveLength(10);
    expect(devTasks).toHaveLength(4);
    expect(SUITE_VERSION).toBe("suite-v1");
  });

  it("all task ids are unique across both suites", () => {
    const ids = [...suiteV1, ...devTasks].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const task of [...suiteV1, ...devTasks]) {
    it(`task '${task.id}' is well-formed`, () => {
      expect(task.prompt.length).toBeGreaterThan(0);
      expect(task.maxTurns).toBeGreaterThan(0);
      const world = new WorldState();
      const tools = task.makeTools(world);
      expect(Array.isArray(tools)).toBe(true);
      // check() must be callable on a failed run without throwing, and must not pass it
      expect(task.check(emptyResult, world)).toBe(false);
    });
  }
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- --testPathPattern bench-tasks`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Implementierung**

`bench/tasks/frozen/suite-v1.ts`:

```ts
/**
 * FROZEN SUITE v1 (spec §4.4b).
 * Report-only. Never tune the harness against individual failures here.
 * Additions/changes go into a new file (suite-v2.ts) with a version bump.
 */
import type { BenchTask } from "../../types.js";
import { WorldState, makeKvTools } from "../../world.js";
import { calculatorTool, clockTool } from "../../../src/index.js";

export const SUITE_VERSION = "suite-v1";

const finalOk = (r: { terminatedReason: string; finalAnswer: string | null }): boolean =>
  r.terminatedReason === "final_answer" && !!r.finalAnswer;

export const suiteV1: BenchTask[] = [
  {
    id: "calc-simple",
    category: "single-tool",
    prompt: "What is 17 * 23? Use the calculator tool.",
    maxTurns: 6,
    makeTools: () => [calculatorTool],
    check: (r) => finalOk(r) && r.finalAnswer!.includes("391"),
  },
  {
    id: "calc-nested",
    category: "single-tool",
    prompt: "Compute ((5 + 3) * 12) / 4 using the calculator tool.",
    maxTurns: 6,
    makeTools: () => [calculatorTool],
    check: (r) => finalOk(r) && /\b24\b/.test(r.finalAnswer!),
  },
  {
    id: "calc-two-step",
    category: "multi-step",
    prompt: "First compute 15 * 4 with the calculator. Then add 17 to that result and tell me the final number.",
    maxTurns: 8,
    makeTools: () => [calculatorTool],
    check: (r) => finalOk(r) && /\b77\b/.test(r.finalAnswer!),
  },
  {
    id: "calc-chain-3",
    category: "multi-step",
    prompt: "Start with 100. Subtract 37, then multiply the result by 3. Use the calculator and tell me the final number.",
    maxTurns: 10,
    makeTools: () => [calculatorTool],
    check: (r) => finalOk(r) && /\b189\b/.test(r.finalAnswer!),
  },
  {
    id: "kv-set",
    category: "world-state",
    prompt: "Store the value 'blue' under the key 'color' in the key-value store.",
    maxTurns: 6,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r, world) => finalOk(r) && world.kv.get("color") === "blue",
  },
  {
    id: "kv-set-get",
    category: "world-state",
    prompt: "Store the value '42' under the key 'answer'. Then read it back with kv.get and tell me the value you read.",
    maxTurns: 8,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r, world) =>
      finalOk(r) && world.kv.get("answer") === "42" && r.finalAnswer!.includes("42"),
  },
  {
    id: "kv-transfer",
    category: "world-state",
    prompt: "Read the value stored under the key 'src' and store that same value under the key 'dst'.",
    maxTurns: 8,
    makeTools: (world: WorldState) => {
      world.kv.set("src", "hello");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("dst") === "hello",
  },
  {
    id: "kv-conditional",
    category: "multi-step",
    prompt:
      "Read the number stored under the key 'threshold'. If it is greater than 10, store 'high' under the key 'level'; otherwise store 'low' under 'level'.",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("threshold", "15");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("level") === "high",
  },
  {
    id: "clock-tz",
    category: "single-tool",
    prompt: "What time is it right now in the timezone Asia/Tokyo? Use the clock tool.",
    maxTurns: 6,
    makeTools: () => [clockTool],
    check: (r) => finalOk(r) && r.toolCallCount >= 1,
  },
  {
    id: "no-tool-capital",
    category: "no-tool",
    prompt: "What is the capital of France? Answer with just the city name.",
    maxTurns: 4,
    makeTools: (world: WorldState) => makeKvTools(world), // tools offered but not needed
    check: (r) => finalOk(r) && /paris/i.test(r.finalAnswer!),
  },
];
```

`bench/tasks/dev.ts`:

```ts
/** Dev tasks (spec §4.4b): allowed for harness tuning, never reported. */
import type { BenchTask } from "../types.js";
import { WorldState, makeKvTools } from "../world.js";
import { calculatorTool } from "../../src/index.js";

const finalOk = (r: { terminatedReason: string; finalAnswer: string | null }): boolean =>
  r.terminatedReason === "final_answer" && !!r.finalAnswer;

export const devTasks: BenchTask[] = [
  {
    id: "dev-calc",
    category: "single-tool",
    prompt: "What is 9 * 8? Use the calculator tool.",
    maxTurns: 6,
    makeTools: () => [calculatorTool],
    check: (r) => finalOk(r) && /\b72\b/.test(r.finalAnswer!),
  },
  {
    id: "dev-calc-two-step",
    category: "multi-step",
    prompt: "Compute 6 * 7 with the calculator, then subtract 2 from the result. Tell me the final number.",
    maxTurns: 8,
    makeTools: () => [calculatorTool],
    check: (r) => finalOk(r) && /\b40\b/.test(r.finalAnswer!),
  },
  {
    id: "dev-kv-set",
    category: "world-state",
    prompt: "Store the value 'ready' under the key 'status'.",
    maxTurns: 6,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r, world) => finalOk(r) && world.kv.get("status") === "ready",
  },
  {
    id: "dev-no-tool",
    category: "no-tool",
    prompt: "How many days are in a leap year? Answer with just the number.",
    maxTurns: 4,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r) => finalOk(r) && /\b366\b/.test(r.finalAnswer!),
  },
];
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test -- --testPathPattern bench-tasks`
Expected: PASS (2 + 14 Tests)

- [ ] **Step 5: Commit**

```bash
git add bench/tasks/frozen/suite-v1.ts bench/tasks/dev.ts tests/bench-tasks.test.ts
git commit -m "feat(bench): frozen task suite v1 (10 tasks) and dev suite (4 tasks)"
```

---

### Task 6: Harness-Adapter `minimal` (DefaultAgentLoop)

**Files:**
- Create: `bench/harnesses/minimal.ts`
- Test: `tests/bench-harness-minimal.test.ts`

**Interfaces:**
- Consumes: `DefaultAgentLoop`, `InMemoryMemory`, `DefaultToolBridge`, `StructuredOutputValidator`, `DefaultPromptBuilder` aus `../src/index.js`; `HarnessAdapter`, `BenchTask`, `BenchRunResult` aus `../bench/types.js`; `scriptedLlm` aus `../bench/testing.js`.
- Produces: `minimalHarness: HarnessAdapter` mit `name: "minimal"`. `latencyMs` wird hier **nicht** gesetzt (bleibt 0) — der Runner (Task 9) misst und überschreibt sie für alle Adapter einheitlich.

- [ ] **Step 1: Failing Test schreiben** — `tests/bench-harness-minimal.test.ts`:

```ts
import { describe, it, expect } from "@jest/globals";
import { minimalHarness } from "../bench/harnesses/minimal.js";
import { scriptedLlm } from "../bench/testing.js";
import { WorldState, makeKvTools } from "../bench/world.js";
import type { BenchTask } from "../bench/types.js";

const kvTask: BenchTask = {
  id: "t-kv",
  category: "world-state",
  prompt: "Store 'blue' under 'color'.",
  maxTurns: 5,
  makeTools: (w) => makeKvTools(w),
  check: (r, w) => w.kv.get("color") === "blue",
};

describe("minimalHarness", () => {
  it("runs the text protocol: tool_call then final_answer", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: 'ACTION: tool_call\nTOOL: kv.set\nARGS: {"key":"color","value":"blue"}' },
      { content: "ACTION: final_answer\nANSWER: Stored blue under color." },
    ]);
    const result = await minimalHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.finalAnswer).toContain("Stored");
    expect(result.toolCallCount).toBe(1);
    expect(world.kv.get("color")).toBe("blue");
    expect(result.turns).toBe(2);
  });

  it("maps a run that never answers to terminatedReason max_turns", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: 'ACTION: tool_call\nTOOL: kv.get\nARGS: {"key":"color"}' },
    ]);
    const result = await minimalHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("max_turns");
    expect(result.finalAnswer).toBeNull();
  });

  it("captures adapter-level errors instead of throwing", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = {
      async generate(): Promise<never> {
        throw new Error("connection refused");
      },
    };
    const result = await minimalHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("error");
    expect(result.error).toContain("connection refused");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- --testPathPattern bench-harness-minimal`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Implementierung** — `bench/harnesses/minimal.ts`:

```ts
import {
  DefaultAgentLoop,
  DefaultPromptBuilder,
  DefaultToolBridge,
  InMemoryMemory,
  StructuredOutputValidator,
} from "../../src/index.js";
import type { LLMAdapter, ToolDefinition } from "../../src/index.js";
import type { BenchRunResult, BenchTask, HarnessAdapter } from "../types.js";

const SYSTEM_INSTRUCTION =
  "You are a helpful assistant with access to tools. Use them when needed. " +
  "Call exactly one tool per response, then wait for its result before continuing.";

/** Contestant: the full minimal-harness DefaultAgentLoop via its public API. */
export const minimalHarness: HarnessAdapter = {
  name: "minimal",
  async run(task: BenchTask, llm: LLMAdapter, tools: ToolDefinition[]): Promise<BenchRunResult> {
    const toolBridge = new DefaultToolBridge();
    for (const tool of tools) toolBridge.register(tool);

    const loop = new DefaultAgentLoop({
      llm,
      memory: new InMemoryMemory(),
      toolBridge,
      validator: new StructuredOutputValidator(),
      promptBuilder: new DefaultPromptBuilder(),
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    try {
      const res = await loop.run({
        sessionId: `bench-${task.id}`,
        userMessage: task.prompt,
        maxTurns: task.maxTurns,
      });
      return {
        finalAnswer: res.terminatedReason === "final_answer" ? res.finalAnswer : null,
        terminatedReason: res.terminatedReason,
        turns: res.rawTurns.length,
        llmCalls: 0, // filled by the runner from telemetry
        tokens: 0, // filled by the runner from telemetry
        latencyMs: 0, // filled by the runner
        toolCallCount: res.toolTrace.length,
      };
    } catch (err) {
      return {
        finalAnswer: null,
        terminatedReason: "error",
        turns: 0,
        llmCalls: 0,
        tokens: 0,
        latencyMs: 0,
        toolCallCount: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test -- --testPathPattern bench-harness-minimal`
Expected: PASS (3 Tests)

- [ ] **Step 5: Commit**

```bash
git add bench/harnesses/minimal.ts tests/bench-harness-minimal.test.ts
git commit -m "feat(bench): minimal-harness contestant adapter over the public API"
```

---

### Task 7: Baseline-Adapter `ollama-native` (primäre, faire Baseline)

**Files:**
- Create: `bench/harnesses/ollama-native.ts`
- Test: `tests/bench-harness-ollama-native.test.ts`

**Interfaces:**
- Consumes: `LLMAdapter`, `ChatMessage`, `ToolDefinition` aus `../src/index.js`; Bench-Typen; `scriptedLlm`.
- Produces: `ollamaNativeHarness: HarnessAdapter` mit `name: "ollama-native"`. Semantik (Spec §5): der Standard-Loop, den ein Entwickler mit Ollamas nativem Tool-Calling out-of-the-box schreibt — `tools`-Parameter, Tool-Results als `role: "tool"`-Messages zurück, kein Retry, kein Format-Recovery.

- [ ] **Step 1: Failing Test schreiben** — `tests/bench-harness-ollama-native.test.ts`:

```ts
import { describe, it, expect } from "@jest/globals";
import { ollamaNativeHarness } from "../bench/harnesses/ollama-native.js";
import { scriptedLlm } from "../bench/testing.js";
import { WorldState, makeKvTools } from "../bench/world.js";
import type { BenchTask } from "../bench/types.js";

const kvTask: BenchTask = {
  id: "t-kv",
  category: "world-state",
  prompt: "Store 'blue' under 'color'.",
  maxTurns: 5,
  makeTools: (w) => makeKvTools(w),
  check: (r, w) => w.kv.get("color") === "blue",
};

describe("ollamaNativeHarness", () => {
  it("executes native tool calls and finishes on plain content", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: "", toolCalls: [{ name: "kv.set", arguments: { key: "color", value: "blue" } }] },
      { content: "Done, stored blue under color." },
    ]);
    const result = await ollamaNativeHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.finalAnswer).toContain("Done");
    expect(result.toolCallCount).toBe(1);
    expect(world.kv.get("color")).toBe("blue");
  });

  it("feeds tool errors back as tool messages instead of crashing", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: "", toolCalls: [{ name: "does.not.exist", arguments: {} }] },
      { content: "I could not find that tool." },
    ]);
    const result = await ollamaNativeHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.toolCallCount).toBe(0); // unknown tool executes nothing
  });

  it("stops at maxTurns when the model keeps calling tools", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: "", toolCalls: [{ name: "kv.get", arguments: { key: "color" } }] },
    ]);
    const result = await ollamaNativeHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("max_turns");
    expect(result.finalAnswer).toBeNull();
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- --testPathPattern bench-harness-ollama-native`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Implementierung** — `bench/harnesses/ollama-native.ts`:

```ts
import type { ChatMessage, LLMAdapter, ToolDefinition } from "../../src/index.js";
import type { BenchRunResult, BenchTask, HarnessAdapter } from "../types.js";

/**
 * PRIMARY fair baseline (spec §5): what a developer writes out of the box
 * against Ollama's native tool calling. Straight loop, no retries, no
 * format recovery — any uplift over this is the harness's merit.
 */
export const ollamaNativeHarness: HarnessAdapter = {
  name: "ollama-native",
  async run(task: BenchTask, llm: LLMAdapter, tools: ToolDefinition[]): Promise<BenchRunResult> {
    const toolSpecs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as unknown as Record<string, unknown>,
    }));
    const byName = new Map(tools.map((t) => [t.name, t]));

    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant. Use the provided tools when needed." },
      { role: "user", content: task.prompt },
    ];

    let toolCallCount = 0;
    try {
      for (let turn = 0; turn < task.maxTurns; turn++) {
        const res = await llm.generate(messages, { tools: toolSpecs });

        if (res.toolCalls && res.toolCalls.length > 0) {
          messages.push({ role: "assistant", content: res.content });
          for (const call of res.toolCalls) {
            const tool = byName.get(call.name);
            let payload: string;
            if (!tool) {
              payload = JSON.stringify({ tool: call.name, error: "unknown tool" });
            } else {
              try {
                const output = await tool.execute(call.arguments);
                toolCallCount++;
                payload = JSON.stringify({ tool: call.name, result: output });
              } catch (err) {
                payload = JSON.stringify({
                  tool: call.name,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
            messages.push({ role: "tool", content: payload });
          }
          continue;
        }

        // Plain content without tool calls = the final answer.
        return {
          finalAnswer: res.content,
          terminatedReason: "final_answer",
          turns: turn + 1,
          llmCalls: 0,
          tokens: 0,
          latencyMs: 0,
          toolCallCount,
        };
      }
      return {
        finalAnswer: null,
        terminatedReason: "max_turns",
        turns: task.maxTurns,
        llmCalls: 0,
        tokens: 0,
        latencyMs: 0,
        toolCallCount,
      };
    } catch (err) {
      return {
        finalAnswer: null,
        terminatedReason: "error",
        turns: 0,
        llmCalls: 0,
        tokens: 0,
        latencyMs: 0,
        toolCallCount,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test -- --testPathPattern bench-harness-ollama-native`
Expected: PASS (3 Tests)

- [ ] **Step 5: Commit**

```bash
git add bench/harnesses/ollama-native.ts tests/bench-harness-ollama-native.test.ts
git commit -m "feat(bench): ollama-native baseline adapter (fair out-of-the-box loop)"
```

---

### Task 8: Baseline-Adapter `naive` (sekundär, illustrativ)

**Files:**
- Create: `bench/harnesses/naive.ts`
- Test: `tests/bench-harness-naive.test.ts`

**Interfaces:**
- Consumes: wie Task 7.
- Produces: `naiveHarness: HarnessAdapter` mit `name: "naive"`. Semantik (Spec §5): dasselbe Text-Protokoll wie minimal-harness (ACTION/TOOL/ARGS), aber Roh-Regex-Parse, **kein Retry, kein Recovery** — bricht das Format, endet der Lauf mit `parse_error`. Zeigt isoliert, was Retry/Recovery beitragen; im Report als „illustrativ" gekennzeichnet.

- [ ] **Step 1: Failing Test schreiben** — `tests/bench-harness-naive.test.ts`:

```ts
import { describe, it, expect } from "@jest/globals";
import { naiveHarness } from "../bench/harnesses/naive.js";
import { scriptedLlm } from "../bench/testing.js";
import { WorldState, makeKvTools } from "../bench/world.js";
import type { BenchTask } from "../bench/types.js";

const kvTask: BenchTask = {
  id: "t-kv",
  category: "world-state",
  prompt: "Store 'blue' under 'color'.",
  maxTurns: 5,
  makeTools: (w) => makeKvTools(w),
  check: (r, w) => w.kv.get("color") === "blue",
};

describe("naiveHarness", () => {
  it("handles a clean tool_call then final_answer", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: 'ACTION: tool_call\nTOOL: kv.set\nARGS: {"key":"color","value":"blue"}' },
      { content: "ACTION: final_answer\nANSWER: Stored." },
    ]);
    const result = await naiveHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("final_answer");
    expect(result.finalAnswer).toBe("Stored.");
    expect(world.kv.get("color")).toBe("blue");
  });

  it("fails immediately on malformed output (no retry, no recovery)", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: "Sure! I will store blue under color for you." }, // no ACTION block
    ]);
    const result = await naiveHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("parse_error");
    expect(result.finalAnswer).toBeNull();
  });

  it("fails on invalid ARGS json (no retry)", async () => {
    const world = new WorldState();
    const tools = kvTask.makeTools(world);
    const llm = scriptedLlm([
      { content: "ACTION: tool_call\nTOOL: kv.set\nARGS: {key: color}" }, // not valid JSON
    ]);
    const result = await naiveHarness.run(kvTask, llm, tools);
    expect(result.terminatedReason).toBe("parse_error");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- --testPathPattern bench-harness-naive`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Implementierung** — `bench/harnesses/naive.ts`:

```ts
import type { ChatMessage, LLMAdapter, ToolDefinition } from "../../src/index.js";
import type { BenchRunResult, BenchTask, HarnessAdapter } from "../types.js";

/**
 * SECONDARY baseline (spec §5, illustrative only): same text protocol as
 * minimal-harness but raw regex parsing, no retry, no recovery — "what
 * anyone writes in 50 lines". Isolates what retry/recovery contribute.
 */
export const naiveHarness: HarnessAdapter = {
  name: "naive",
  async run(task: BenchTask, llm: LLMAdapter, tools: ToolDefinition[]): Promise<BenchRunResult> {
    const byName = new Map(tools.map((t) => [t.name, t]));
    const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
    const system =
      `You are a helpful assistant with access to tools.\n\n## Available Tools\n${toolList}\n\n` +
      `## Output Format\nTo call a tool respond EXACTLY:\nACTION: tool_call\nTOOL: <tool_name>\nARGS: <json>\n\n` +
      `To give a final answer respond EXACTLY:\nACTION: final_answer\nANSWER: <your answer>`;

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: task.prompt },
    ];

    let toolCallCount = 0;
    try {
      for (let turn = 0; turn < task.maxTurns; turn++) {
        const res = await llm.generate(messages);
        const text = res.content;

        const finalMatch = /ACTION:\s*final_answer[\s\S]*?ANSWER:\s*([\s\S]*)/.exec(text);
        if (finalMatch) {
          return {
            finalAnswer: finalMatch[1].trim(),
            terminatedReason: "final_answer",
            turns: turn + 1,
            llmCalls: 0,
            tokens: 0,
            latencyMs: 0,
            toolCallCount,
          };
        }

        const toolMatch = /ACTION:\s*tool_call[\s\S]*?TOOL:\s*(\S+)[\s\S]*?ARGS:\s*(\{[\s\S]*\})/.exec(text);
        if (!toolMatch) {
          // Malformed output: a naive loop has no recovery — the run fails.
          return {
            finalAnswer: null,
            terminatedReason: "parse_error",
            turns: turn + 1,
            llmCalls: 0,
            tokens: 0,
            latencyMs: 0,
            toolCallCount,
          };
        }

        const toolName = toolMatch[1];
        let args: unknown;
        try {
          args = JSON.parse(toolMatch[2]);
        } catch {
          return {
            finalAnswer: null,
            terminatedReason: "parse_error",
            turns: turn + 1,
            llmCalls: 0,
            tokens: 0,
            latencyMs: 0,
            toolCallCount,
          };
        }

        const tool = byName.get(toolName);
        let payload: string;
        if (!tool) {
          payload = JSON.stringify({ tool: toolName, error: "unknown tool" });
        } else {
          try {
            const output = await tool.execute(args);
            toolCallCount++;
            payload = JSON.stringify({ tool: toolName, result: output });
          } catch (err) {
            payload = JSON.stringify({
              tool: toolName,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        messages.push({ role: "assistant", content: text });
        messages.push({ role: "tool", content: payload });
      }
      return {
        finalAnswer: null,
        terminatedReason: "max_turns",
        turns: task.maxTurns,
        llmCalls: 0,
        tokens: 0,
        latencyMs: 0,
        toolCallCount,
      };
    } catch (err) {
      return {
        finalAnswer: null,
        terminatedReason: "error",
        turns: 0,
        llmCalls: 0,
        tokens: 0,
        latencyMs: 0,
        toolCallCount,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test -- --testPathPattern bench-harness-naive`
Expected: PASS (3 Tests)

- [ ] **Step 5: Commit**

```bash
git add bench/harnesses/naive.ts tests/bench-harness-naive.test.ts
git commit -m "feat(bench): naive baseline adapter (raw parse, no retry/recovery)"
```

---

### Task 9: Runner-Kern `runMatrix` + Konfiguration

**Files:**
- Create: `bench/config.ts`
- Create: `bench/run-matrix.ts`
- Test: `tests/bench-run-matrix.test.ts`

**Interfaces:**
- Consumes: alle Adapter (Tasks 6–8), `withTelemetry` (Task 4), Bench-Typen (Task 2), `scriptedLlm`.
- Produces (vom Reporter/CLI, Tasks 10–11, genutzt):
  - `bench/config.ts`: `SEEDS = [1001..1005]`, `TEMPERATURE = 0.7`, `DEFAULT_MODELS = ["qwen3:8b", "llama3.1:8b"]`, `DEFAULT_BASE_URL = "http://localhost:11434"`
  - `RunRecord { model, harness, taskId, category, seed, success, result: BenchRunResult }`
  - `LlmFactory = (model: ModelConfig, seed: number) => LLMAdapter`
  - `runMatrix(opts: { tasks, harnesses, models, seeds, llmFactory, onProgress? }): Promise<RunRecord[]>`
  - Verantwortung des Runners: pro Lauf frische `WorldState` + Tools, LLM aus Factory + `withTelemetry` wrappen, Latenz messen, Telemetrie (`llmCalls`, `tokens`, `latencyMs`) in das `BenchRunResult` des Adapters schreiben, `task.check` (in try/catch, Fehler ⇒ `success: false`) auswerten.

- [ ] **Step 1: Failing Test schreiben** — `tests/bench-run-matrix.test.ts`:

```ts
import { describe, it, expect } from "@jest/globals";
import { runMatrix } from "../bench/run-matrix.js";
import { scriptedLlm } from "../bench/testing.js";
import { makeKvTools } from "../bench/world.js";
import type { BenchTask, ModelConfig } from "../bench/types.js";
import { minimalHarness } from "../bench/harnesses/minimal.js";
import { naiveHarness } from "../bench/harnesses/naive.js";

const model: ModelConfig = { name: "mock", baseUrl: "http://x", temperature: 0.7 };

const kvTask: BenchTask = {
  id: "t-kv",
  category: "world-state",
  prompt: "Store 'blue' under 'color'.",
  maxTurns: 5,
  makeTools: (w) => makeKvTools(w),
  check: (r, w) => w.kv.get("color") === "blue",
};

describe("runMatrix", () => {
  it("produces one record per task × harness × seed with telemetry filled in", async () => {
    const records = await runMatrix({
      tasks: [kvTask],
      harnesses: [minimalHarness, naiveHarness],
      models: [model],
      seeds: [1, 2],
      llmFactory: () =>
        scriptedLlm([
          { content: 'ACTION: tool_call\nTOOL: kv.set\nARGS: {"key":"color","value":"blue"}' },
          { content: "ACTION: final_answer\nANSWER: done" },
        ]),
    });
    expect(records).toHaveLength(4); // 1 task × 2 harnesses × 1 model × 2 seeds
    for (const rec of records) {
      expect(rec.success).toBe(true);
      expect(rec.result.llmCalls).toBe(2); // telemetry wired through
      expect(rec.result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("marks a run as failed when check throws or fails", async () => {
    const failingTask: BenchTask = {
      ...kvTask,
      id: "t-fail",
      check: () => {
        throw new Error("boom");
      },
    };
    const records = await runMatrix({
      tasks: [failingTask],
      harnesses: [naiveHarness],
      models: [model],
      seeds: [1],
      llmFactory: () => scriptedLlm([{ content: "ACTION: final_answer\nANSWER: hi" }]),
    });
    expect(records[0].success).toBe(false);
  });

  it("isolates world state between runs", async () => {
    // If worlds leaked, the second run would already see color=blue and a
    // task checking "key must NOT pre-exist" would fail.
    const freshTask: BenchTask = {
      ...kvTask,
      id: "t-fresh",
      makeTools: (w) => {
        if (w.kv.size !== 0) throw new Error("world not fresh");
        return makeKvTools(w);
      },
    };
    const records = await runMatrix({
      tasks: [freshTask],
      harnesses: [naiveHarness],
      models: [model],
      seeds: [1, 2, 3],
      llmFactory: () =>
        scriptedLlm([
          { content: 'ACTION: tool_call\nTOOL: kv.set\nARGS: {"key":"color","value":"blue"}' },
          { content: "ACTION: final_answer\nANSWER: done" },
        ]),
    });
    expect(records.every((r) => r.success)).toBe(true);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- --testPathPattern bench-run-matrix`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Implementierung**

`bench/config.ts`:

```ts
/** Bench defaults (spec §4.3/§5). Models are overridable via BENCH_MODELS. */
export const SEEDS = [1001, 1002, 1003, 1004, 1005];
export const TEMPERATURE = 0.7;
export const DEFAULT_MODELS = ["qwen3:8b", "llama3.1:8b"];
export const DEFAULT_BASE_URL = "http://localhost:11434";
```

`bench/run-matrix.ts`:

```ts
import type { LLMAdapter } from "../src/index.js";
import type { BenchRunResult, BenchTask, HarnessAdapter, ModelConfig, TaskCategory } from "./types.js";
import { WorldState } from "./world.js";
import { withTelemetry } from "./telemetry.js";

export interface RunRecord {
  model: string;
  harness: string;
  taskId: string;
  category: TaskCategory;
  seed: number;
  success: boolean;
  result: BenchRunResult;
}

export type LlmFactory = (model: ModelConfig, seed: number) => LLMAdapter;

export interface RunMatrixOptions {
  tasks: BenchTask[];
  harnesses: HarnessAdapter[];
  models: ModelConfig[];
  seeds: number[];
  llmFactory: LlmFactory;
  onProgress?: (done: number, total: number, label: string) => void;
}

/** Runs the full ablation matrix sequentially (one local model at a time). */
export async function runMatrix(opts: RunMatrixOptions): Promise<RunRecord[]> {
  const { tasks, harnesses, models, seeds, llmFactory, onProgress } = opts;
  const records: RunRecord[] = [];
  const total = tasks.length * harnesses.length * models.length * seeds.length;
  let done = 0;

  for (const model of models) {
    for (const harness of harnesses) {
      for (const task of tasks) {
        for (const seed of seeds) {
          const world = new WorldState();
          const tools = task.makeTools(world);
          const llm = withTelemetry(llmFactory(model, seed));

          const t0 = Date.now();
          const result = await harness.run(task, llm, tools);
          result.latencyMs = Date.now() - t0;
          result.llmCalls = llm.stats.llmCalls;
          result.tokens = llm.stats.tokens;

          let success = false;
          try {
            success = task.check(result, world);
          } catch {
            success = false;
          }

          records.push({
            model: model.name,
            harness: harness.name,
            taskId: task.id,
            category: task.category,
            seed,
            success,
            result,
          });
          done++;
          onProgress?.(done, total, `${model.name} / ${harness.name} / ${task.id} / seed=${seed}`);
        }
      }
    }
  }
  return records;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test -- --testPathPattern bench-run-matrix`
Expected: PASS (3 Tests)

- [ ] **Step 5: Commit**

```bash
git add bench/config.ts bench/run-matrix.ts tests/bench-run-matrix.test.ts
git commit -m "feat(bench): runMatrix core with injectable llm factory and telemetry wiring"
```

---

### Task 10: Reporter → BENCHMARKS.md + results.json

**Files:**
- Create: `bench/reporter.ts`
- Test: `tests/bench-reporter.test.ts`

**Interfaces:**
- Consumes: `RunRecord` (Task 9), `wilson`, `passK` (Task 3).
- Produces (von der CLI, Task 11, genutzt):
  - `buildReport(records: RunRecord[], meta: ReportMeta): string` — pures Markdown, kein I/O (I/O macht die CLI)
  - `ReportMeta { date: string; suiteVersion: string; seeds: number[]; temperature: number; k: number }`
  - Report-Regeln (Spec §2/§4.4): Uplift = minimal − ollama-native in Prozentpunkten; Claim „signifikant" nur wenn Wilson-Intervalle disjunkt, sonst wörtlich „kein signifikanter Unterschied"; `naive` als „illustrativ" gekennzeichnet.

- [ ] **Step 1: Failing Test schreiben** — `tests/bench-reporter.test.ts`:

```ts
import { describe, it, expect } from "@jest/globals";
import { buildReport } from "../bench/reporter.js";
import type { RunRecord } from "../bench/run-matrix.js";
import type { BenchRunResult } from "../bench/types.js";

const okResult: BenchRunResult = {
  finalAnswer: "x",
  terminatedReason: "final_answer",
  turns: 2,
  llmCalls: 2,
  tokens: 100,
  latencyMs: 50,
  toolCallCount: 1,
};

function rec(harness: string, taskId: string, seed: number, success: boolean): RunRecord {
  return { model: "m1", harness, taskId, category: "single-tool", seed, success, result: okResult };
}

const meta = { date: "2026-07-09", suiteVersion: "suite-v1", seeds: [1, 2], temperature: 0.7, k: 2 };

describe("buildReport", () => {
  it("renders one row per model×harness with rate, CI and pass^k", () => {
    const records: RunRecord[] = [
      // minimal: task A 2/2, task B 2/2 → rate 1.0, pass^2 = 1.0
      rec("minimal", "a", 1, true), rec("minimal", "a", 2, true),
      rec("minimal", "b", 1, true), rec("minimal", "b", 2, true),
      // ollama-native: task A 1/2, task B 0/2 → rate 0.25, pass^2 = 0
      rec("ollama-native", "a", 1, true), rec("ollama-native", "a", 2, false),
      rec("ollama-native", "b", 1, false), rec("ollama-native", "b", 2, false),
    ];
    const md = buildReport(records, meta);
    expect(md).toContain("suite-v1");
    expect(md).toContain("m1");
    expect(md).toContain("minimal");
    expect(md).toContain("ollama-native");
    expect(md).toContain("100.0%"); // minimal rate
    expect(md).toContain("25.0%"); // baseline rate
    expect(md).toMatch(/\+75\.0 pp/); // uplift minimal vs ollama-native
  });

  it("labels non-significant uplift honestly when CIs overlap", () => {
    const records: RunRecord[] = [
      // 2 runs each, 1/2 vs 2/2 → tiny n, CIs overlap massively
      rec("minimal", "a", 1, true), rec("minimal", "a", 2, true),
      rec("ollama-native", "a", 1, true), rec("ollama-native", "a", 2, false),
    ];
    const md = buildReport(records, meta);
    expect(md).toContain("kein signifikanter Unterschied");
  });

  it("marks the naive baseline as illustrative", () => {
    const records: RunRecord[] = [
      rec("minimal", "a", 1, true),
      rec("ollama-native", "a", 1, true),
      rec("naive", "a", 1, false),
    ];
    const md = buildReport(records, meta);
    expect(md).toContain("illustrativ");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- --testPathPattern bench-reporter`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: Implementierung** — `bench/reporter.ts`:

```ts
import type { RunRecord } from "./run-matrix.js";
import { passK, wilson } from "./stats.js";

export interface ReportMeta {
  date: string;
  suiteVersion: string;
  seeds: number[];
  temperature: number;
  k: number;
}

interface Cell {
  successes: number;
  n: number;
  rate: number;
  low: number;
  high: number;
  passK: number;
  avgTokens: number;
  avgLatencyMs: number;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

function aggregate(records: RunRecord[]): Cell {
  const successes = records.filter((r) => r.success).length;
  const n = records.length;
  const w = wilson(successes, n);
  const byTask = new Map<string, boolean[]>();
  for (const r of records) {
    const arr = byTask.get(r.taskId) ?? [];
    arr.push(r.success);
    byTask.set(r.taskId, arr);
  }
  const avg = (f: (r: RunRecord) => number): number =>
    n === 0 ? 0 : records.reduce((s, r) => s + f(r), 0) / n;
  return {
    successes,
    n,
    rate: w.rate,
    low: w.low,
    high: w.high,
    passK: passK([...byTask.values()]),
    avgTokens: avg((r) => r.result.tokens),
    avgLatencyMs: avg((r) => r.result.latencyMs),
  };
}

/** Builds BENCHMARKS.md content (pure; the CLI does the file I/O). */
export function buildReport(records: RunRecord[], meta: ReportMeta): string {
  const models = [...new Set(records.map((r) => r.model))];
  const lines: string[] = [];

  lines.push(`# BENCHMARKS`);
  lines.push(``);
  lines.push(
    `> Datum: ${meta.date} · Suite: **${meta.suiteVersion}** · k=${meta.k} Läufe/Task ` +
      `(Seeds: ${meta.seeds.join(", ")}) · Temperatur: ${meta.temperature} · ` +
      `Intervalle: 95 % Wilson. Baseline \`naive\` ist **illustrativ** (zeigt den Beitrag ` +
      `von Retry/Recovery), Uplift wird gegen \`ollama-native\` gemessen.`,
  );
  lines.push(``);

  for (const model of models) {
    const forModel = records.filter((r) => r.model === model);
    const harnesses = [...new Set(forModel.map((r) => r.harness))];
    const cells = new Map<string, Cell>(
      harnesses.map((h) => [h, aggregate(forModel.filter((r) => r.harness === h))]),
    );

    lines.push(`## Modell: \`${model}\``);
    lines.push(``);
    lines.push(`| Harness | Erfolgsrate | 95 %-CI | pass^${meta.k} | Ø Tokens | Ø Latenz |`);
    lines.push(`|---|---|---|---|---|---|`);
    for (const h of harnesses) {
      const c = cells.get(h)!;
      lines.push(
        `| ${h} | ${pct(c.rate)} (${c.successes}/${c.n}) | [${pct(c.low)}, ${pct(c.high)}] ` +
          `| ${pct(c.passK)} | ${Math.round(c.avgTokens)} | ${Math.round(c.avgLatencyMs)} ms |`,
      );
    }
    lines.push(``);

    const minimal = cells.get("minimal");
    const baseline = cells.get("ollama-native");
    if (minimal && baseline) {
      const upliftPp = (minimal.rate - baseline.rate) * 100;
      const sign = upliftPp >= 0 ? "+" : "";
      const significant = minimal.low > baseline.high || baseline.low > minimal.high;
      if (significant) {
        lines.push(
          `**Harness-Uplift (minimal vs. ollama-native): ${sign}${upliftPp.toFixed(1)} pp** — ` +
            `signifikant (Konfidenzintervalle disjunkt).`,
        );
      } else {
        lines.push(
          `Harness-Uplift (minimal vs. ollama-native): ${sign}${upliftPp.toFixed(1)} pp — ` +
            `**kein signifikanter Unterschied** (Konfidenzintervalle überlappen; mehr Tasks/Läufe nötig).`,
        );
      }
      lines.push(``);
    }
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test -- --testPathPattern bench-reporter`
Expected: PASS (3 Tests)

- [ ] **Step 5: Commit**

```bash
git add bench/reporter.ts tests/bench-reporter.test.ts
git commit -m "feat(bench): markdown reporter with wilson CIs, pass^k and honest uplift claims"
```

---

### Task 11: CLI-Runner, npm-Script, Doku & Smoke-Run

**Files:**
- Create: `bench/runner.ts`
- Modify: `package.json` (Script `bench`, devDependency `tsx`)
- Modify: `README.md` (neuer Abschnitt „Benchmarks")
- Modify: `.gitignore` (Zeile `bench/results/`)

**Interfaces:**
- Consumes: `runMatrix`, `RunRecord` (Task 9), `buildReport` (Task 10), `suiteV1`, `SUITE_VERSION` (Task 5), Adapter (Tasks 6–8), `SEEDS`, `TEMPERATURE`, `DEFAULT_MODELS`, `DEFAULT_BASE_URL` (Task 9), `OllamaClient` (Kern, mit `defaultSeed` aus Task 1).
- Produces: `npm run bench` → schreibt `BENCHMARKS.md` (Repo-Root, committbar) und `bench/results/results-<timestamp>.json` (Rohdaten, gitignored). Env: `BENCH_MODELS` (kommagetrennt) überschreibt Modelle, `OLLAMA_BASE_URL` die URL, `BENCH_SUITE=dev` wählt die dev-Suite (Tuning-Läufe).

- [ ] **Step 1: tsx installieren**

Run: `npm install --save-dev tsx`
Expected: `tsx` erscheint in `devDependencies`; `dependencies` bleibt `{}`.

- [ ] **Step 2: CLI implementieren** — `bench/runner.ts` (dünne I/O-Schicht, Logik steckt getestet in `run-matrix.ts`/`reporter.ts`; kein eigener Unit-Test, aber Integrations-Smoke in Step 5):

```ts
/**
 * Bench CLI (spec §5): npm run bench
 * Env: BENCH_MODELS="qwen3:8b,llama3.1:8b" OLLAMA_BASE_URL=... BENCH_SUITE=dev
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { OllamaClient } from "../src/index.js";
import { DEFAULT_BASE_URL, DEFAULT_MODELS, SEEDS, TEMPERATURE } from "./config.js";
import { suiteV1, SUITE_VERSION } from "./tasks/frozen/suite-v1.js";
import { devTasks } from "./tasks/dev.js";
import { minimalHarness } from "./harnesses/minimal.js";
import { ollamaNativeHarness } from "./harnesses/ollama-native.js";
import { naiveHarness } from "./harnesses/naive.js";
import { runMatrix } from "./run-matrix.js";
import { buildReport } from "./reporter.js";
import type { ModelConfig } from "./types.js";

const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
const modelNames = (process.env.BENCH_MODELS ?? DEFAULT_MODELS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const useDev = process.env.BENCH_SUITE === "dev";
const tasks = useDev ? devTasks : suiteV1;
const suiteLabel = useDev ? "dev (NICHT reportfähig)" : SUITE_VERSION;

// Preflight: Ollama reachable? Models present?
const tagsRes = await fetch(`${baseUrl}/api/tags`).catch(() => null);
if (!tagsRes?.ok) {
  console.error(`✗ Ollama nicht erreichbar unter ${baseUrl} — läuft \`ollama serve\`?`);
  process.exit(1);
}
const tags = (await tagsRes.json()) as { models?: { name: string }[] };
const available = new Set((tags.models ?? []).map((m) => m.name));
for (const name of modelNames) {
  if (![...available].some((a) => a === name || a.startsWith(`${name}:`))) {
    console.error(`✗ Modell '${name}' fehlt — installieren mit: ollama pull ${name}`);
    process.exit(1);
  }
}

const models: ModelConfig[] = modelNames.map((name) => ({ name, baseUrl, temperature: TEMPERATURE }));
console.log(`Bench: Suite ${suiteLabel} · Modelle: ${modelNames.join(", ")} · Seeds: ${SEEDS.join(",")}`);

const records = await runMatrix({
  tasks,
  harnesses: [ollamaNativeHarness, naiveHarness, minimalHarness],
  models,
  seeds: SEEDS,
  llmFactory: (model, seed) =>
    new OllamaClient({
      baseUrl: model.baseUrl,
      model: model.name,
      defaultTemperature: model.temperature,
      defaultSeed: seed,
    }),
  onProgress: (done, total, label) => console.log(`[${done}/${total}] ${label}`),
});

const meta = {
  date: new Date().toISOString().slice(0, 10),
  suiteVersion: suiteLabel,
  seeds: SEEDS,
  temperature: TEMPERATURE,
  k: SEEDS.length,
};

mkdirSync("bench/results", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`bench/results/results-${stamp}.json`, JSON.stringify({ meta, records }, null, 2));

if (!useDev) {
  writeFileSync("BENCHMARKS.md", buildReport(records, meta));
  console.log(`✓ BENCHMARKS.md geschrieben (${records.length} Läufe)`);
} else {
  console.log(buildReport(records, meta));
  console.log("⚠ dev-Suite: Report nur auf stdout, BENCHMARKS.md unverändert (spec §4.4b)");
}
```

- [ ] **Step 3: package.json, README, .gitignore anpassen**

In `package.json` unter `scripts` ergänzen:

```json
    "bench": "tsx bench/runner.ts"
```

In `.gitignore` ergänzen:

```
bench/results/
```

In `README.md` nach dem Abschnitt „Running Tests" einfügen:

````markdown
---

## Benchmarks

The ablation matrix measures the **harness uplift**: the same local model,
same tasks, run through `ollama-native` (fair out-of-the-box baseline),
`naive` (illustrative: no retry/recovery) and `minimal` (this harness).

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
````

- [ ] **Step 4: Volle Suite + Lint + Typecheck**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: alle Tests PASS, keine Lint-/Typfehler.

- [ ] **Step 5: Smoke-Run (nur wenn lokal Ollama läuft — sonst dokumentiert überspringen)**

Run: `BENCH_SUITE=dev BENCH_MODELS="<kleinstes installiertes Modell>" npm run bench`
Expected: Preflight OK, Fortschritts-Zeilen `[n/60] …`, Report auf stdout mit Tabelle je Modell und Uplift-Zeile. Falls kein Ollama verfügbar: Schritt überspringen und im Commit-Text vermerken; der echte Erst-Lauf ist dann Teil der Abnahme mit Mick.

- [ ] **Step 6: Commit**

```bash
git add bench/runner.ts package.json package-lock.json README.md .gitignore
git commit -m "feat(bench): CLI runner with ollama preflight, npm run bench, docs"
```

---

## Abnahme (Definition of Done, Spec §5)

`npm run bench` erzeugt auf Micks Maschine (Ollama + gezogene Modelle) eine committbare `BENCHMARKS.md` mit je Modell einer Tabelle *ollama-native / naive / minimal* inkl. Erfolgsrate, 95 %-CI, pass^5, Ø Tokens, Ø Latenz und einer ehrlichen Uplift-Aussage. Gleiche Seeds ⇒ gleiche Läufe (soweit Ollama-Seed-Support trägt — offener Punkt §7 der Spec, wird beim Erst-Lauf verifiziert: zweimal hintereinander laufen lassen und Raten vergleichen).
