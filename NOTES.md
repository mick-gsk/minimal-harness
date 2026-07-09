# NOTES — Ablage & Notiz-Zettel (für Claude Code)

> **Was das ist:** Ein Parkplatz für Gedanken, Ideen, Fundstücke und offene Fragen, die
> *gerade nicht dran*, aber zu wertvoll zum Wegwerfen sind. Alles darf hier stichpunktartig
> rein. **Ob etwas davon je umgesetzt wird, ist ausdrücklich offen** — das ist kein Backlog
> und keine Pflichtenliste.
>
> **Umgang:**
> - Einfach unten (oder in den passenden Block) als Stichpunkt anhängen — Reibung so niedrig wie möglich.
> - Optionale Tags: `[idee]` `[frage]` `[später]` `[snippet]` `[entscheidung offen]`.
> - Nichts wird gelöscht, nur weil es keine Priorität hat. Wird etwas wirklich umgesetzt,
>   wandert es in den eigentlichen Plan/Commit — hier kann man es dann streichen oder mit
>   `→ umgesetzt (Datum)` markieren.
> - Prosa Deutsch, Code/IDs Englisch (wie im Rest der Codebasis).
>
> *Echte, zugesagte Arbeit steht NICHT hier, sondern im Plan:*
> [docs/superpowers/plans/2026-07-09-bench-mvp-ablations-matrix.md](docs/superpowers/plans/2026-07-09-bench-mvp-ablations-matrix.md)

---

## Ideen & mögliche Verbesserungen (parkiert)

- `[später]` **Echte `parseFailures` / `recoveries` statt `llmCalls`-Proxy.** MVP misst nur `llmCalls`
  (≈ Retry-Aufwand); echte Zählung bräuchte Kern-Instrumentierung im Agent-Loop. Schärferer Beleg,
  was Retry/Recovery beitragen. (Abweichungs-Notiz in [bench/types.ts](bench/types.ts).)
- `[idee]` **Multi-Modell-Ablation** — Matrix über mehrere Ollama-Modelle statt nur `qwen3:8b`,
  um zu zeigen, dass der Harness-Uplift modellübergreifend hält.

## Benchmark-Integration — Recherche 2026-07-09 (wertvoll, nicht dringend)

Kernidee: Wir ranken *Harnesses*, öffentliche Benchmarks ranken *Modelle*. Deshalb bleibt unser
Runner — aber wir könnten deren **Task-Daten leihen** (JSON), statt eigene Tasks zu erfinden.
**Achtung:** Diese Benchmarks sind Python, unser Harness ist TS → nur die **Datensätze** übernehmen,
nicht die Runner.

- `[idee]` **BFCL (Berkeley Function-Calling Leaderboard)** — erste Wahl. Apache 2.0, deterministischer
  AST-Check (kein LLM-Judge), Ollama-tauglich. HF-Dataset `gorilla-llm/Berkeley-Function-Calling-Leaderboard`.
  - `simple` / `multiple` → mappt auf `single-tool`
  - `parallel` / `multi-turn` → `multi-step`
  - **`irrelevance` → `no-tool`** (Modell darf *nicht* callen; oft vergessen — BFCL liefert es fertig)
  - AST-Check für die einfachen Kategorien in TS nachbauen (~50 Zeilen), als `BenchTask.check()` einhängen
- `[idee]` **ACEBench (2025)** — bewusst deterministische Evaluation ohne teuren Judge/API-Call.
  Gut für `multi-step` / `world-state` (Agent-Kategorie mit State-Mutation, ohne User-Simulator).
- `[idee]` **τ²-bench (Sierra/Princeton)** — echter geteilter World-State, bringt die `pass^k`-Metrik mit,
  die wir in [bench/stats.ts](bench/stats.ts) schon haben → gute Portfolio-Story. Braucht aber einen
  **User-Simulator-LLM** → teuerste Integration, nur bei echtem Multi-Turn-User-State-Bedarf.
- `[entscheidung offen]` Bewusst NICHT verfolgen (Zeitfresser fürs Ziel): ToolBench/StableToolBench
  (instabile Live-APIs), GAIA/WebArena (Browser/Judge), SWE-bench (Code-Domäne).

## Offene Fragen / noch zu entscheiden

- `[frage]` Lohnt ein zweites Modell in der Ablation für den Portfolio-Wert, oder reicht `qwen3:8b` für den MVP?
- `[frage]` BFCL-Daten direkt als eigene `suite-v2.ts` einziehen, oder als separate „external"-Suite halten?

## Snippets & Referenzen

- `[snippet]` Bench-Lauf über SSH-Tunnel zum GPU-PC:
  `OLLAMA_BASE_URL=http://127.0.0.1:21434 OLLAMA_MODEL=qwen3:8b npx tsx bench/ab-experiment.ts`
  (Tunnel-Details im Memory: `gpu-pc-ollama-zugang.md`.)
- `[snippet]` BFCL-Dataset (Apache 2.0): https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard

---

## Freie Ablage (einfach unten anhängen)

<!-- Alles, was in keinen Block oben passt, hier als Stichpunkt reinwerfen. -->
