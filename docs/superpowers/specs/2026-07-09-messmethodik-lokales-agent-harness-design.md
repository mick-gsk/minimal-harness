# Design: Mess- & Nachweis-Methodik für minimal-harness

**Datum:** 2026-07-09
**Status:** Entwurf zur Review
**Kontext:** `minimal-harness` — schlankes, framework-agnostisches Agent-Harness für lokale LLMs (Ollama-first, prompt-basiertes Tool-Calling).

---

## 1. Ziel & Problemstellung

Der Anspruch ist: **minimal-harness soll das beste Harness für lokale KI-Agenten werden** — als echtes Open-Source-Produkt, das fremde Entwickler freiwillig wählen und behalten.

„Bestes" darf kein Gefühl sein. Es muss eine **reproduzierbare Zahl** sein, die man jederzeit nachrechnen kann und die fremde Entwickler überzeugt.

### Die entscheidende Abgrenzung: Modell ≠ Harness

„So gut wie Claude Code + Sonnet 5" besteht zu ~80 % aus *Sonnet 5* (Frontier-Modell) und ~20 % aus dem Harness. Ein Harness kann Modell-Intelligenz **nicht** ersetzen — ein lokales 8B/70B-Modell ist roh weniger intelligent als Sonnet 5. Das ist keine Harness-Schwäche.

Was ein Harness **kann**:
1. Aus einem *gegebenen* lokalen Modell das Maximum herausholen (robustes Prompting, verlässliche Tool-Calls, Retry-/Recovery-Logik, Fehler-Feedback).
2. Dafür sorgen, dass **nicht das Harness der Flaschenhals ist**. Lokale Agenten scheitern oft nicht am Denken, sondern an gebrochenem Tool-Call-Format, hängendem Loop oder nicht zurückgespielten Fehlern.

**Messbares Ziel:**
> Bei Aufgaben, die ein gutes lokales Modell prinzipiell beherrscht, erreicht minimal-harness dieselbe Erfolgsrate wie ein Frontier-Harness — das Harness verschenkt nichts. Der verbleibende Abstand zu Sonnet 5 ist reine Modellsache.

### Realitäts-Anker (aus Recherche 2026)

- **BFCL v4**: ein 8B-Modell (ToolACE) schlägt GPT-4 bei *Tool-Calling*. → Bei Tool-Calling (nicht roher Intelligenz) können kleine lokale Modelle mit richtigem Harness Frontier-Niveau erreichen. Das Ziel ist ambitioniert, aber nicht absurd.
- **τ²-bench** nutzt **pass^k** („löst dieselbe Aufgabe in *allen* k Versuchen") — Zuverlässigkeit statt Glück. Genau das, was ein gutes Harness verbessert.

---

## 2. Die drei Kern-Metriken

| # | Metrik | Was sie beweist | Formel |
|---|---|---|---|
| **1** | **Harness-Uplift** ⭐ | *Unser* Verdienst, isoliert vom Modell | Erfolgsrate(Modell **in** minimal-harness) − Erfolgsrate(dasselbe Modell im Naiv-Loop) |
| **2** | **Gap-to-Frontier** | Nähe zum Ziel „so gut wie Claude Code" | Erfolgsrate(bestes lokales Modell + minimal-harness) ÷ Erfolgsrate(Sonnet 5 + Claude Code) |
| **3** | **Reliability (pass^k)** | Zuverlässigkeit statt Zufallstreffer | Anteil Aufgaben, die in **allen** k Läufen (k=5) gelingen |

**Metrik 1 ist die Hauptwaffe** — das Einzige, was wir direkt kontrollieren (Modell fix, Harness variabel). Beispielaussage:
> *„Qwen3-8B: 41 % → 67 % Erfolgsrate durch minimal-harness (+26 pp Uplift, pass^5 von 0.20 → 0.55)."*

Das ist gleichzeitig **Beweis** und **Marketing**. Metrik 2 = Nordstern (schrumpft über die Zeit). Metrik 3 = Qualitätssiegel gegen „Demo lief einmal".

---

## 3. Evidenz-Pyramide (drei Ebenen, drei Zwecke)

**Ebene A — Externe Benchmarks (Glaubwürdigkeit nach außen)**
- BFCL v4 → Tool-Calling-Korrektheit, direkt mit offiziellem Leaderboard vergleichbar.
- τ²-bench → mehrstufige Agenten-Zuverlässigkeit (pass^k, Policy-Treue).
- Nicht selbst-manipulierbar → fremde Entwickler glauben den Zahlen.

**Ebene B — Eigene CI-Smoke-Suite (schnelle Regression)**
- 20–40 handkuratierte Aufgaben, Sekunden-Laufzeit (Mock-LLM + optional 1 kleines echtes Modell).
- Läuft bei jedem Commit → fängt Regressionen sofort. Internes Sicherheitsnetz, kein Außen-Beweis.

**Ebene C — Ablations-Matrix (der Uplift-Beweis, Metrik 1)** ← **erster Fokus**
- Task-Set × **{Naiv-Loop, LangChain, minimal-harness}** × **{2–3 lokale Modelle}**.
- Zeigt: der Vorsprung kommt vom Harness, modellunabhängig.

---

## 4. Architektur des `bench/`-Moduls

Ein neues, vom Kern entkoppeltes Verzeichnis `bench/`. Es *konsumiert* minimal-harness über die öffentliche API (`src/index.ts`), es verändert den Kern nicht.

```
bench/
├── tasks/            # Task-Definitionen (die eigene Suite)
│   └── *.task.ts
├── harnesses/        # Adapter: ein Contestant je Datei
│   ├── minimal.ts        # DefaultAgentLoop über öffentliche API
│   ├── naive.ts          # bewusst minimaler Baseline-Loop
│   └── langchain.ts       # (Stufe 2) LangChain-Agent
├── models/           # Modell-Konfiguration (Ollama-Tags, gepinnt)
├── runner.ts         # führt (Task × Harness × Modell × N Läufe) aus
├── scorer.ts         # deterministische Erfolgsprüfung je Task
├── reporter.ts       # aggregiert → BENCHMARKS.md + results.json
└── config.ts         # welche Tasks/Harnesses/Modelle/k
```

### 4.1 Kern-Interfaces

```ts
// Eine Aufgabe: deterministisch scorebar, kein LLM-Judge nötig.
interface BenchTask {
  id: string;
  prompt: string;
  tools: ToolDefinition[];        // verfügbare Tools (inkl. Test-Tools mit prüfbarer Nebenwirkung)
  maxTurns: number;
  // Prüft Endzustand: finaler Antwortwert ODER World-State der Test-Tools.
  check: (result: RunResult, world: WorldState) => boolean;
}

// Ein Kontrahent: nimmt Task + Modell, liefert Ergebnis + Telemetrie.
interface HarnessAdapter {
  name: string;                   // "minimal" | "naive" | "langchain"
  run(task: BenchTask, model: ModelConfig): Promise<RunResult>;
}

interface RunResult {
  finalAnswer: string | null;
  turns: number;
  parseFailures: number;          // wie oft Tool-Call-Format brach
  recoveries: number;             // wie oft das Harness sich erholte
  tokens: number;
  latencyMs: number;
  error?: string;
}
```

### 4.2 Datenfluss

```
config → runner
  für jede (task, harness, model):
    N Läufe → RunResult[]
    scorer → success/fail je Lauf → passRate, pass^k
  → reporter → BENCHMARKS.md (Tabelle) + results.json (Rohdaten)
```

### 4.3 Reproduzierbarkeit

- Ollama mit `temperature: 0` und fixem `seed` (wo unterstützt).
- Modell-Tags **gepinnt** (Tag + Digest) in `models/`.
- Rest-Nichtdeterminismus wird durch **N Läufe + pass^k** ehrlich abgebildet statt versteckt.
- Alles per `npm run bench` reproduzierbar; `BENCHMARKS.md` ist versioniert und committet.

---

## 5. Erster Meilenstein: Ablations-Matrix (MVP)

Ziel: **die erste echte Uplift-Zahl**, schnellstmöglich, ohne externe Dependencies.

**Umfang MVP:**
1. **Task-Suite v0:** 15–20 eigene Aufgaben, die echtes agentisches Verhalten erfordern:
   - Single-Tool (z. B. „Wie spät ist es in Tokio?" → `clock.now`)
   - Multi-/Sequential-Tool (Ergebnis von Tool A speist Tool B)
   - Recovery-Szenarien (Aufgabe, die typisch das Tool-Call-Format bricht)
   - 2–3 Test-Tools mit prüfbarer Nebenwirkung (Mock-„set/get") für World-State-Checks.
2. **Zwei Kontrahenten zuerst** (beide in-repo, keine externe dep):
   - `minimal` (DefaultAgentLoop)
   - `naive` (bewusst minimaler Loop: LLM-Call → Roh-Regex-Parse → kein Retry, kein Recovery — „was jeder in 50 Zeilen schreibt")
3. **1–2 echte lokale Modelle** über Ollama (Modell-Liste konfigurierbar; Auswahl abhängig von Micks Hardware).
4. **k = 5 Läufe** pro Kombination → Erfolgsrate + pass^5.
5. **Reporter → `BENCHMARKS.md`** mit Uplift-Spalte.

**Definition of Done (MVP):**
`npm run bench` erzeugt eine committbare `BENCHMARKS.md` mit einer Zeile pro Modell, den Spalten *naive / minimal / Uplift* und *pass^5* — reproduzierbar auf derselben Maschine.

**Stufe 2 (nach MVP):** LangChain als dritter Kontrahent; danach Ebene B (CI-Smoke mit Mock-LLM) und Ebene A (BFCL v4, τ²-bench).

---

## 6. Nicht-Ziele (YAGNI)

- **Kein LLM-Judge** in Stufe 1 — Aufgaben sind deterministisch scorebar (arithmetisch / World-State). Judge fügt nur Rauschen + Kosten hinzu.
- **Kein Umbau des Kerns** für die Messung — `bench/` konsumiert nur die öffentliche API.
- **Kein Streaming/Parallel-Tools** als Messziel (v1-Limitierungen des Harness bleiben, werden nicht in dieser Spec adressiert).
- **Keine Adoption-Metriken** (Stars/Issues) als Bau-Aufgabe — das sind Spätindikatoren, keine steuerbaren Zahlen.

---

## 7. Offene Punkte (für Umsetzungsplan zu klären)

- Welche konkreten lokalen Modelle laufen auf Micks Hardware (bestimmt die Modell-Matrix)? Kandidaten: Qwen3-8B, Llama3.1-8B, evtl. ein 14B/32B.
- Wie wird die Sonnet-5-Referenz (Metrik 2) praktisch gemessen — separater Lauf, oder zunächst nur dokumentierter Platzhalter bis lokale Zahlen stehen?
- Genaue Menge & Themen der Task-Suite v0 (Balance Tool-Use ↔ Recovery ↔ Multi-Step).

---

## 8. Zusammenfassung

„Bestes Harness" wird operationalisiert als **Harness-Uplift** (Hauptbeweis), **Gap-to-Frontier** (Nordstern) und **pass^k-Reliability** (Qualitätssiegel), belegt über eine dreistufige Evidenz-Pyramide (extern / CI / Ablation). Erster Schritt ist die **Ablations-Matrix** in einem entkoppelten `bench/`-Modul, die die erste reproduzierbare Uplift-Zahl liefert — zugleich Beweis und Marketing für das Open-Source-Produkt.
