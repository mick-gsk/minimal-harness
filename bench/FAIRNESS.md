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

## Ablation-Ergebnisse (Probe, Seed 1001, 2026-07-10)

Drei System-Prompt-Varianten für minimal (default / bare / paraphrase), sonst
identischer Aufbau, auf beiden Suiten:

| Variante | v2 qwen | v2 llama | BFCL qwen | BFCL llama (simple) | BFCL llama (irrelevance) |
|---|---|---|---|---|---|
| minimal@default | **47/50** | **46/50** | 83/100 | 42/50 | 13/50 |
| minimal@bare | 41/50 | 41/50 | **85/100** | 45/50 | 3/50 |
| minimal@paraphrase | 46/50 | 42/50 | 83/100 | 42/50 | 5/50 |
| _(ollama-native zum Vergleich)_ | _43/50_ | _26/50_ | _83/100_ | _29/50_ | _26/50_ |

**Befund zu Einwand 4 (Prompt-Verschränkung):**
- **qwen3:8b:** Uplift formulierungs-insensitiv (83–85/100 über alle Varianten) — der Gewinn gehört dem Mechanismus, nicht der Prompt-Passung.
- **llama3.1:** Der Kern-Uplift (Tool-Calling, BFCL simple) hält über alle Varianten (42–45/50, jede ≫ native 29/50). Die irrelevance-Schwäche ist **Scaffold-inhärent** und wird ohne Prompt-Anleitung *schlimmer* (Ø bis 2,12 Tool-Calls wo 0 richtig wäre) — der verdächtigte Default-Prompt *mildert* sie. Kein Heimspiel-Artefakt; stattdessen Produkt-Fix abgeleitet (Protokollblock benennt den No-Tool-Pfad explizit, Commit 86efed7), Validierung auf BFCL + v2-Regression dokumentiert unten.

**Befund zu Einwand 1 auf neutralem Terrain (BFCL, echte Berkeley-Daten):**
- llama3.1 simple: minimal 41/50 vs. native 29/50 (**+24 pp auf Dritt-Tasks**) — der Uplift ist kein Suite-Artefakt.
- qwen3:8b gesamt: 83/100 = 83/100 — auf starken Tool-Calling-Modellen hilft und schadet das Harness auf Single-Call-Tasks nicht.
- llama3.1 irrelevance: minimal 11/50 vs. native 26/50 — ehrlicher Negativ-Befund, siehe Fix oben.
