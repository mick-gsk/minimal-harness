# Design: smolagents als Kontrahent in der Bench-Matrix

**Datum:** 2026-07-09
**Status:** Approved (Brainstorming abgeschlossen)
**These-Bezug:** „Ein minimales Harness schlägt naives Tool-Calling auf lokalen Modellen — deterministisch gemessen." Dieses Feature erweitert den Vergleich erstmals um ein **berühmtes** externes Harness (Hugging Face `smolagents`), um die Frage „wo stehe ich?" auf einem gemeinsamen Maßstab zu beantworten.

## Ziel & Nicht-Ziel

**Ziel:** `smolagents` (Modus `ToolCallingAgent`) als 4. Kontrahent (`smolagents-tool`) in die bestehende `runMatrix`-Ablation aufnehmen — gleiche Tasks, gleiche Modelle, gleiche Seeds, gleiche deterministische `check()`. Ergebnis: eine reproduzierbare Zeile in `BENCHMARKS.md` `minimal % · smolagents-tool % · ollama-native % · naive %` pro Modell.

**Nicht-Ziel (YAGNI / Scope-Wächter):** kein `CodeAgent` (später nachrüstbar), kein LangChain/AutoGen (die Bridge macht es später möglich), keine BFCL-Original-Datensätze, kein τ-bench. Der `src/`-Kern bleibt unangetastet und `dependencies: {}`.

## Entscheidungen (mit Begründung)

1. **Modus = `ToolCallingAgent`** (nicht `CodeAgent`). Grund: apples-to-apples — beide machen JSON-Tool-Calls, gleiche Spielregeln. Testet die These am direktesten. `CodeAgent` ist ein anderes Paradigma (schreibt Code) und bleibt spätere Erweiterung.
2. **Fairness-Brücke = HTTP-Tool-Bridge (World bleibt in Node).** Grund: nur **eine** World-Implementierung (Single Source of Truth), dieselben JS-Tools, dieselbe `check()` — maximal fair, und generisch wiederverwendbar für jedes künftige Fremd-Harness. Verworfen: World in Python nachbauen (zwei driftende Implementierungen → Fairness-Risiko, verstößt gegen „nicht duplizieren"); nur zustandslose Tasks (umgeht multi-step/error-recovery, halbe Antwort).

## Architektur & Datenfluss

Pro `harness.run` (ein Task × Modell × Seed):

```
runMatrix erzeugt world + JS-tools (unverändert)
        │
        ▼
smolagentsHarness.run(task, llm, tools, ctx={model, seed})
        │  1. startet kurzlebigen World-HTTP-Bridge-Server (JS-tools als Endpunkte)
        │  2. spawnt Python-Sidecar mit: task.prompt, tool-specs(JSON),
        │     model-coords(name, baseUrl, seed, temp), maxTurns, bridge-URL
        ▼
Python: smolagents ToolCallingAgent
        │  eigener System-Prompt · spricht GPU-Ollama direkt (OpenAI-/v1-Endpunkt)
        │  jeder Tool-Call → HTTP POST an Bridge → tool.execute() mutiert DEN Node-WorldState
        ▼
Python schreibt JSON auf stdout: {finalAnswer, steps, toolCalls, tokens, agentMs, error?}
        │
        ▼
Node parst → BenchRunResult · task.check(result, world) läuft gegen den EINEN echten World-State
```

**Kernpunkt:** Es gibt nur eine World (in Node). smolagents' Tools sind dünne HTTP-Wrapper. Tasks, Suite, `check()` bleiben unverändert (Prinzip 7: Frozen-Suite unantastbar).

## Komponenten

| Datei | Rolle |
|---|---|
| `bench/bridge/world-http-bridge.ts` | Generischer lokaler HTTP-Server: exponiert ein `ToolDefinition[]` als `POST /tool/{name}` → `tool.execute(args)`. Ephemerer Port, nur localhost, Lebensdauer = ein Run. Wiederverwendbar für jedes Nicht-JS-Harness. |
| `bench/smolagents/agent_runner.py` | Python-Sidecar: liest Job (JSON via argv/stdin), baut generische HTTP-Tool-Wrapper aus den Tool-Specs, konstruiert `ToolCallingAgent` + Modell-Anbindung, führt aus, schreibt Ergebnis-JSON auf stdout. |
| `bench/smolagents/requirements.txt` | Python-Deps (`smolagents`, `openai`). Isoliert in `bench/smolagents/.venv` — **nicht** in `package.json`. |
| `bench/harnesses/smolagents.ts` | Node-`HarnessAdapter` `smolagents-tool`: startet Bridge, spawnt Python-Sidecar, parst Rückgabe → `BenchRunResult`. |

## Interface-Änderungen (minimal, begründet)

1. **`HarnessAdapter.run` bekommt 4. Parameter `ctx: { model: ModelConfig; seed: number }`.** Grund: smolagents braucht Modell-*Koordinaten* (Name/URL/Seed/Temp), nicht den in-process JS-`llm`. Die 3 bestehenden TS-Harnesses ignorieren `ctx` — nur Signatur, kein Logik-Umbau.
2. **`HarnessAdapter.name`-Union um `"smolagents-tool"` erweitern.**
3. **Telemetrie-Fill in `run-matrix.ts` wird Fallback-Semantik:** statt hart `result.tokens = llm.stats.tokens` nun nur füllen, wenn der Adapter nichts gemeldet hat (`result.tokens ||= llm.stats.tokens`, analog `llmCalls`). Grund: smolagents nutzt den JS-`llm` nicht (Stats = 0) und meldet Token/Steps aus Pythons eigenem Usage-Tracking. Bestehende TS-Adapter geben weiter 0 zurück und werden wie bisher gefüllt.
4. **`runner.ts` schaltet smolagents nur zu, wenn `BENCH_SMOLAGENTS=1`** (und Preflight findet Python-venv). Grund: der normale `npm run bench` bleibt ohne Python-Abhängigkeit lauffähig.

## Fairness & Reproduzierbarkeit (das Herzstück)

- Gleiches Modell, `temperature = 0.7`, **Seed durchgereicht** über Ollamas OpenAI-kompatiblen `/v1`-Endpunkt (`OpenAIServerModel`, reicht `seed`+`temperature` explizit durch). LiteLLM als Fallback.
- `task.maxTurns → max_steps`.
- smolagents' **eigener** System-Prompt/Scaffold bleibt — den zu ersetzen wäre unfair, sein Scaffold *ist* der Gegner.
- **Latency-Ehrlichkeit:** der Runner misst Wall-Clock inkl. Python-Boot → in `BENCHMARKS.md` als Fußnote gekennzeichnet, nicht 1:1 mit In-Process-TS vergleichbar. Python meldet zusätzlich `agentMs` (reine Agent-Zeit) zurück.
- **Seed-Ehrlichkeit:** Smoke-Test verifiziert Doppellauf-Reproduzierbarkeit. Falls Ollama über `/v1` den Seed nicht deterministisch durchreicht, wird das offen als Limitation ausgewiesen (smolagents-Reproduzierbarkeit ≤ TS-Harnesses).

## Ablauf bis „läuft gegeneinander"

1. Implementieren (Bridge → Python-Sidecar → Node-Adapter → Verdrahtung), Bridge mit Unit-Test.
2. Python-venv auf dem Mac einrichten (`smolagents` + `openai`), Import verifizieren.
3. **Fail-fast-Smoke-Test:** 1 Task × qwen3:8b × 1 Seed über den Tunnel — erst wenn das echt läuft, weiter.
4. Volle Matrix auf **suite-v1** (offiziell vergleichbar), qwen3:8b + llama3.1, alle Seeds, 4 Harnesses → `BENCHMARKS.md` bekommt smolagents als 4. Spalte.

## Erfolgskriterium

Eine reproduzierbare Zeile in `BENCHMARKS.md` pro Modell, die `minimal` gegen `smolagents-tool` (und die zwei Baselines) auf identischer Suite/Seeds stellt — die erste echte Standortbestimmung gegen ein berühmtes Harness.

## Umgebungsannahme

Node-Runner läuft auf dem Mac, spricht GPU-Ollama über SSH-Tunnel (`OLLAMA_BASE_URL=http://127.0.0.1:21434`, siehe Memory `gpu-pc-ollama-zugang`). smolagents ist reines Orchestrierungs-Python (keine GPU) und läuft auf dem Mac gegen dieselben GPU-Modelle.
