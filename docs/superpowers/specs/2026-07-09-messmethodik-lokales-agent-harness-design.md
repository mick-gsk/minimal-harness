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
| **1** | **Harness-Uplift** ⭐ | *Unser* Verdienst, isoliert vom Modell | Erfolgsrate(Modell **in** minimal-harness) − Erfolgsrate(dasselbe Modell in der **fairen Baseline**, s. §5) |
| **2** | **Gap-to-Frontier** | Nähe zum Ziel „so gut wie Claude Code" | Erfolgsrate(bestes lokales Modell + minimal-harness) ÷ Erfolgsrate(**Sonnet 5 im selben Bench-Runner**) |
| **3** | **Reliability (pass^k)** | Zuverlässigkeit statt Zufallstreffer | Anteil Aufgaben, die in **allen** k Läufen (k=5) gelingen |

**Definition pass^k:** Wir nutzen die strikte Variante — genau k Läufe pro (Task, Harness, Modell), Task zählt nur bei k/k Erfolgen. (τ-bench nutzt einen kombinatorischen Schätzer über n ≥ k Läufe; unsere Variante ist konservativer und wird im Report so benannt, um Verwechslung zu vermeiden.)

**Zu Metrik 2:** „Claude Code + Sonnet 5" ist auf einer generischen Tool-Task-Suite nicht sauber ausführbar (Claude Code ist ein Coding-Harness mit eigenem Toolset). Praktisch messbar und fair vergleichbar ist: **Sonnet 5 via API als Modell im selben Bench-Runner** (gleiche Tasks, gleiche Tools, gleicher Scorer). Das ist die Frontier-Referenz; „Claude Code"-Niveau bleibt das symbolische Ziel im Marketing, gemessen wird gegen Sonnet 5 unter identischen Bedingungen.

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
- Task-Set × **{Ollama-nativ, Naiv-Loop, minimal-harness}** × **{2–3 lokale Modelle}** (Stufe 2: + LangChain/smolagents).
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
│   ├── ollama-native.ts  # PRIMÄRE Baseline: Ollamas eingebautes Tool-Calling (chat-API `tools`)
│   ├── naive.ts          # sekundäre Baseline: minimaler Prompt-Loop ohne Retry/Recovery
│   └── langchain.ts       # (Stufe 2) LangChain-/smolagents-Agent
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
  parseFailures: number;          // wie oft Tool-Call-Format brach (Stufe 2)
  recoveries: number;             // wie oft das Harness sich erholte (Stufe 2)
  tokens: number;
  latencyMs: number;
  error?: string;
}
```

**MVP-Einschränkung:** `parseFailures`/`recoveries` erfordern Instrumentierung im Kern-Loop (Retries sind intern). Das MVP misst stattdessen `llmCalls` über einen Telemetrie-Decorator um `LLMAdapter` (kein Kern-Umbau, §6-konform); `llmCalls − turns` approximiert den Retry-Aufwand. Echte parseFailures/recoveries kommen in Stufe 2.

```ts
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

**Achtung — kein `temperature: 0` für die Hauptläufe.** Bei Temperatur 0 + fixem Seed wären alle k Läufe deterministisch identisch; pass^k wäre dann immer 0 oder 1 und damit bedeutungslos. Stattdessen:

- **Sampling-Temperatur** (Modell-Default, typ. 0.7) mit **k verschiedenen, fest dokumentierten Seeds** (z. B. 1001–1005). → Reproduzierbar (gleiche Seeds → gleiche Läufe, wo Ollama Seeds unterstützt) **und** varianz-aufdeckend (pass^k misst echte Streuung).
- Modell-Tags **gepinnt** (Tag + Digest) in `models/`; Temperatur, Seeds und Harness-Versionen stehen im Report-Header.
- Rest-Nichtdeterminismus (GPU, Ollama-Version) wird durch **k Läufe + pass^k** ehrlich abgebildet statt versteckt.
- Alles per `npm run bench` reproduzierbar; `BENCHMARKS.md` ist versioniert und committet.

### 4.4 Statistische Ehrlichkeit & Overfitting-Schutz

Zwei Angriffsflächen, die den ganzen Nachweis entwerten würden, wenn wir sie ignorieren:

**a) Rauschen:** Bei 15–20 Tasks × 5 Läufen kann ein scheinbarer Uplift Zufall sein. Deshalb:
- Der Reporter gibt zu jeder Erfolgsrate ein **95 %-Wilson-Konfidenzintervall** aus (Grundgesamtheit: Task×Lauf-Paare).
- Ein Uplift wird nur dann als Claim kommuniziert, wenn sich die Intervalle von Baseline und minimal-harness **nicht überlappen**; sonst heißt es ehrlich „kein signifikanter Unterschied".
- Langfristig wächst die Suite Richtung 50+ Tasks, damit auch kleinere Uplifts signifikant messbar werden.

**b) Overfitting auf die eigene Suite:** Wer das Harness gegen dieselben Tasks tunt, die er reportet, misst am Ende Auswendiglernen. Deshalb:
- Die Suite wird in **`dev/`** (zum Entwickeln/Tunen des Harness erlaubt) und **`frozen/`** (nur für Reports, niemals zum Debuggen einzelner Fails) geteilt.
- `frozen/` wird versioniert eingefroren (`suite-v1`, `suite-v2`, …); neue Tasks kommen nur per Versions-Bump dazu, und der Report nennt die Suite-Version.
- Ebene A (externe Benchmarks) bleibt der ultimative Overfitting-Check, da wir deren Tasks nicht kontrollieren.

---

## 5. Erster Meilenstein: Ablations-Matrix (MVP)

Ziel: **die erste echte Uplift-Zahl**, schnellstmöglich, ohne externe Dependencies.

**Umfang MVP:**
1. **Task-Suite v0:** 15–20 eigene Aufgaben, die echtes agentisches Verhalten erfordern:
   - Single-Tool (z. B. „Wie spät ist es in Tokio?" → `clock.now`)
   - Multi-/Sequential-Tool (Ergebnis von Tool A speist Tool B)
   - Recovery-Szenarien (Aufgabe, die typisch das Tool-Call-Format bricht)
   - 2–3 Test-Tools mit prüfbarer Nebenwirkung (Mock-„set/get") für World-State-Checks.
2. **Drei Kontrahenten zuerst** (alle in-repo, keine externe dep):
   - `minimal` (DefaultAgentLoop)
   - `ollama-native` — **die primäre, faire Baseline**: Ollamas eingebautes Tool-Calling über den `tools`-Parameter der Chat-API, in einem simplen Standard-Loop (Tool-Result zurückgeben, bis Antwort kommt). Das ist, was ein Entwickler heute *wirklich* out-of-the-box benutzt — eine selbstgebaute Schwach-Baseline wäre als Strohmann angreifbar („ihr habt eine schwache Baseline gebaut, um sie zu schlagen").
   - `naive` — sekundäre Baseline: minimaler Prompt-Loop (LLM-Call → Roh-Parse → kein Retry, kein Recovery). Zeigt, was Retry/Recovery konkret beitragen; wird als „illustrativ" gekennzeichnet, nie als Haupt-Uplift-Referenz.
3. **1–2 echte lokale Modelle** über Ollama (Modell-Liste konfigurierbar; Auswahl abhängig von Micks Hardware).
4. **k = 5 Läufe** pro Kombination (Seeds 1001–1005, Sampling-Temperatur, s. §4.3) → Erfolgsrate + pass^5.
5. **Reporter → `BENCHMARKS.md`** mit Uplift-Spalte inkl. 95 %-Konfidenzintervallen (s. §4.4).

**Definition of Done (MVP):**
`npm run bench` erzeugt eine committbare `BENCHMARKS.md` mit einer Zeile pro Modell, den Spalten *ollama-native / naive / minimal / Uplift (vs. ollama-native)*, *pass^5* und Konfidenzintervallen — reproduzierbar auf derselben Maschine (gleiche Seeds → gleiche Läufe).

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
- Wann wird die Sonnet-5-Referenz (Metrik 2, via API im selben Bench-Runner, s. §2) erstmals gemessen — direkt im MVP (kostet API-Guthaben) oder erst, wenn die lokalen Zahlen stehen?
- Genaue Menge & Themen der Task-Suite v0 (Balance Tool-Use ↔ Recovery ↔ Multi-Step) und der Schnitt dev/ vs. frozen/ (s. §4.4).
- Unterstützt die installierte Ollama-Version stabile Seeds über alle Ziel-Modelle? (Falls nein: k Läufe ohne Seed, Reproduzierbarkeit dann nur statistisch — im Report kennzeichnen.)

---

## 8. Zusammenfassung

„Bestes Harness" wird operationalisiert als **Harness-Uplift** (Hauptbeweis), **Gap-to-Frontier** (Nordstern) und **pass^k-Reliability** (Qualitätssiegel), belegt über eine dreistufige Evidenz-Pyramide (extern / CI / Ablation). Erster Schritt ist die **Ablations-Matrix** in einem entkoppelten `bench/`-Modul, die die erste reproduzierbare Uplift-Zahl liefert — zugleich Beweis und Marketing für das Open-Source-Produkt.
