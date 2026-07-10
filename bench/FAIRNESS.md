# Fairness-Protokoll für Fremd-Harness-Vergleiche

Dieses Dokument beantwortet vier strukturelle Einwände gegen die Vergleiche
in [BENCHMARKS.md](../BENCHMARKS.md) — nicht durch Wegdiskutieren, sondern
durch Deklaration, Instrumentierung und Gegenmessung.

## 1. Heimspiel-Task-Design

Die In-House-Suiten (suite-v1/v2) sind vom Autor von minimal-harness um
dessen WorldState-/Tool-Abstraktion herum gebaut. Sie tragen deshalb **nur
den Uplift-Claim** (minimal vs. ollama-native/naive auf identischem Terrain),
keinen „bestes Harness"-Claim. Neutrale Gegenmessung: die **echte BFCL-v4-
Suite** (Berkeley, Apache-2.0, gepinnt auf `gorilla@6ea5797`) —
`BENCH_SUITE=bfcl`, Report separat in `BENCHMARKS-BFCL.md`.

## 2. Ein-Autor-Asymmetrie

minimal wurde gegen die eigene Suite debuggt (Kern-Fixes 1f40d09, abf858a
stammen direkt aus Bench-Fails); smolagents lief off-the-shelf. Alle
Fremd-Harness-Zahlen sind deshalb als **„off-the-shelf defaults"**
deklariert — das misst, was Nutzer out of the box erleben, nicht das
Potenzial der Bibliothek. Ausgleich: der Equal-Effort-Log unten dokumentiert
gezielte Konfigurationsversuche zugunsten des Rivalen.

## 3. Adapter-Naht (Sidecar/Bridge)

smolagents läuft als Python-Sidecar über eine HTTP-World-Bridge: sanitisierte
Tool-Namen (`kv.set` → `kv_set`), 30-s-Tool-Timeout, Prozess-Spawn von Disk,
Hard-Timeout des Sidecars. Jede dieser Nähte ist ein möglicher Verlustort,
der nichts mit Harness-Qualität zu tun hat. Statt zu argumentieren, wird
**gezählt**: `seamErrors` pro Lauf (Transport-Fehler im Sidecar, Spawn-/
Timeout-/Parse-Fehler im Adapter); der Report weist Fails mit Naht-Fehlern
als *nicht attribuierbar* aus. Stand 2026-07-10 (suite-v2-Probe, 100
CodeAgent-Läufe): 3/100 Naht-Verluste, alle übrigen Fails inhaltlich.

## 4. Prompt-Verschränkung

Ein Harness *ist* sein Scaffold-Bundle — smolagents' generischer System-
Prompt gehört zu smolagents wie minimals Protokollblock zu minimal; verglichen
wird Bundle gegen Bundle. Der berechtigte Rest-Einwand („passt minimals
Prompt zufällig zu dieser Suite?") wird gemessen statt behauptet:
`bench/prompt-ablation.ts` fährt minimal mit drei System-Prompt-Varianten
(default / bare / paraphrase) bei sonst identischem Aufbau. Ergebnisse unten.

## Equal-Effort-Log

Dokumentierte Versuche, den Rivalen besser zu konfigurieren (nur
bibliothekseigene Knöpfe, keine Task-Umformulierung):

| Datum | Versuch | Ergebnis |
|---|---|---|
| 2026-07-09 | `ToolCallingAgent` statt nur Default-Betrachtung; seed/temperature/max_steps durchgereicht | Basis-Kontrahent (suite-v1: 94 % qwen / 12 % llama) |
| 2026-07-10 | `CodeAgent` (HF-Empfehlung, Kernthese der Bibliothek) als 5. Kontrahent | qwen 60 %, llama 54 % (suite-v2-Probe) |
| _offen_ | `additional_authorized_imports` für CodeAgent (häufiger Off-the-shelf-Fail: blockierte Standard-Imports) | ausstehend |

## Ablation-Ergebnisse (Probe, Seed 1001, suite-v2)

_Wird nach dem Prompt-Ablation-Lauf ergänzt._
