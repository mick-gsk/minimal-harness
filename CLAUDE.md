# CLAUDE.md — minimal-harness

## Projekt
Schlankes, framework-agnostisches **Agent-Harness für lokale LLMs** (Ollama-first).
Kern in `src/` (AgentLoop, PromptBuilder, Validator, ToolBridge, OllamaClient, Memory),
Benchmark-Ablation in `bench/`. Sprache: **Prosa Deutsch, Code + Kommentare Englisch**.
ESM (relative Imports mit `.js`-Endung, auch in `.ts`), strict TypeScript.

## Engineering-Prinzipien (verbindlich für jede Änderung an diesem Repo)

> Hergeleitet aus [../elon-musk-arbeitsweise.md](../elon-musk-arbeitsweise.md) — die Regeln stehen
> aber für sich als Ingenieurs-Disziplin, unabhängig von der Quelle. Nur die Prinzipien, die zu
> einem minimalistischen Code-Projekt passen (nicht die Hardcore-/Risiko-Aspekte).

1. **Erst löschen, dann bauen.** Bevorzuge das Entfernen von Code/Schritten/Optionen gegenüber
   dem Hinzufügen. Keine neue Dependency, Abstraktion oder Datei ohne begründete Notwendigkeit —
   `dependencies: {}` bleibt Zielzustand. „The best part is no part."
2. **Reihenfolge zählt: hinterfragen → löschen → vereinfachen → beschleunigen → automatisieren.**
   Nie automatisieren oder optimieren, was man noch löschen könnte. Den **Kern nicht für die
   Messung umbauen** — Decorator/Adapter bevorzugen (Vorbild: [bench/telemetry.ts](bench/telemetry.ts)).
3. **First Principles statt Konvention.** Deterministische Checks vor LLM-Judge. Frage „was heißt
   Erfolg hier *wirklich*?", statt fremde Benchmark-Muster blind zu kopieren.
4. **Jede Anforderung hat ein „Warum".** Keine Konstante (`maxTurns`, Seeds, `k`, Task-Zahl, Metrik)
   ohne dokumentierten Grund oder Spec-Bezug. Anonyme Anforderungen sind verdächtig und dürfen
   hinterfragt/gelöscht werden.
5. **Idiot Index für Prioritäten.** Aufwand ÷ Wert. Billiges mit hohem Nutzen zuerst
   (z. B. BFCL `simple`/`irrelevance`), Teures mit unklarem Nutzen parken (z. B. τ²-bench).
6. **Fail fast — früh echt messen.** Neue Bench-Ideen früh auf echtem Modell (GPU-PC, dev-Suite)
   laufen lassen und die reale Ausgabe das Design formen lassen; nicht auf Papier perfektionieren.
7. **Frozen-Suite ist unantastbar.** Niemals das Harness gegen einzelne Fails der Frozen-Suite
   tunen — dafür ist die dev-Suite da. Änderungen nur per Versions-Bump (`suite-v2`).
8. **Scope-Wächter (die These in einem Satz):** „Ein minimales Harness schlägt naives Tool-Calling
   auf lokalen Modellen — deterministisch gemessen." Was dieser These nicht dient, ist Löschkandidat.

## Weiterführend
- **Ideen-/Parkplatz** (nicht auto-geladen, bewusst reinschauen): [NOTES.md](NOTES.md)
- **Detailplan bench-MVP:** [docs/superpowers/plans/2026-07-09-bench-mvp-ablations-matrix.md](docs/superpowers/plans/2026-07-09-bench-mvp-ablations-matrix.md)
