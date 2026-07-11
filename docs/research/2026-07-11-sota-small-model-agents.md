# Maximale agentische Leistung aus kleinen lokalen Modellen (7–14B)

> Erstellt von einem Opus-Recherche-Agenten. Fokus: was messbar wirkt, was es im Zero-Dep-TS-Harness kostet, was zuerst zu bauen ist.

## Kernbefund vorab

Die eigene Messung (smolagents 63–65 % vs. ~50 %) deckt sich exakt mit der Literatur: **Bei kleinen Modellen entscheidet das Harness-Design über Erfolg, nicht die Modellgröße.** Das direkteste Paper: *"It's Not the Size: Harness Design Determines Operational Stability in Small Language Models"* (arXiv 2605.12129). An 2–3B-Modellen: eine 4-Stufen-Pipeline **plan → execute → verify → recover** hebt die Task Success Rate auf **0,952** (Gemma), während dasselbe Modell ohne Scaffold auf **0,429** einbricht („scaffold collapse"). Ablation: **Planning und Recovery tragen je ~24,7 %** des Gesamtgewinns. **Warnung: Effekt ist nicht-monoton** — ein dünner Wrapper war in zwei Modellen *schlechter* als gar keiner. Halbe Struktur schadet; es braucht den geschlossenen Loop.

## 1. Loop-/Scaffold-Design

**CodeAct (arXiv 2402.01030, ICML 2024):** Code statt JSON/Text als Aktionsformat. M3ToolEval: **bis +20 pp** Success, **~30 % weniger Interaktionsschritte**. Aber: feingetuntes CodeActAgent-Mistral-7B nur 12,2 % auf hartem Benchmark (GPT-4: 74,4 %) — Code-Actions helfen relativ, ersetzen keine Modellqualität.

**Warum smolagents gewinnt:** ~30 % weniger LLM-Schritte als JSON/ReAct-Loops; final_answer als einziger Loop-Ausweg = real und wirksam (deckt sich mit verify→recover-Gate). Absolute smolagents-GAIA-Zahlen klein: Qwen2.5-7B ~9,4 %. **Der Loop, nicht das Framework, ist das Übertragbare.**

**Bausteine erzwungener Persistenz:**
- **final_answer-Gate:** Loop endet *nur* über expliziten final_answer-Call, nie durch freien Text. „Aufhören" wird selbst eine bewusste Aktion.
- **Plan-Step:** erzwungener Planungsschritt zu Beginn + periodische Re-Plans (~24,7 % des Gewinns).
- **Recovery-Step:** nach fehlgeschlagener/leerer Tool-Antwort erzwungene Reflexion statt Abbruch (~24,7 %).
- **first-thought prefix** (arXiv 2505.17612): ersten „Gedanken" als Präfix vorgeben — kleine Modelle kommen in den agentischen Modus. Null Kosten.

*TS-Aufwand:* niedrig–mittel (reine Loop-Logik). CodeAct: mittel–hoch (sicherer Executor nötig).

## 2. Kontext-Management

**ACON (arXiv 2510.00615):** Kompression von Beobachtungen + History senkt Peak-Tokens **26–54 %**, kleine LMs **+32 % (AppWorld), +20 % (OfficeBench), +46 % (Multi-objective QA)**. Kompression klärt Abhängigkeiten (Agent hörte auf, denselben 401-Fehler zu wiederholen). Trifft „zu frühes Aufgeben/Im-Kreis-Drehen" direkt.

**Context-Folding (arXiv 2510.11967):** Sub-Task in Branch auslagern, zu knapper Zusammenfassung „einfalten": gleiche/bessere Leistung bei **10× kleinerem aktivem Kontext**. Loop-Struktur ohne RL nachbaubar.

*TS-Aufwand:* mittel. Tool-Result-Truncation (Top-k pro Beobachtung) = Einzeiler mit hohem Nutzen; LLM-Zusammenfassung alter Turns lokal quasi gratis.

## 3. Strukturierte Ausgaben / constrained decoding — Hebel KLEINER als gedacht

- Grammar/GBNF garantiert **Syntax, nicht Inhalt** (arXiv 2605.02363 „When Correct Isn't Usable").
- **3,6×–8,2× höhere Latenz** auf kleinen Modellen; Genauigkeit blieb *unter* optimierter Prompt-Variante; kann „lautes Denken" verhindern.
- Ollama ≥0.5: JSON-Schema → GBNF intern; validiert aber nicht die Gesamtantwort (Abbruch mitten im JSON bleibt möglich).

**Einordnung:** Zuverlässigkeits-Werkzeug gegen Parse-Fehler, kein Fähigkeits-Werkzeug. Nicht zuerst bauen.

## 4. Tabellen/Daten-Fragen (schwächster Punkt: CSV-Joins/Aggregationen)

Konsens: **kleine Modelle sollen nicht rechnen, sondern Code/SQL schreiben, das ein Tool ausführt** (2402.01030; 2505.17612: „code tools statt CoT, weil sLMs bei präziser Berechnung halluzinieren").

- **DuckDB als Tool** (Motherduck DuckDB-NSQL-7B): CSV direkt lesen, Joins/Aggregationen deterministisch. Muster: qwen3:8b schreibt Query → Engine rechnet → Agent liest nur Ergebnis.
- smolagents Text-to-SQL zeigt Self-Correction über Query-Fehler (= Recovery-Step).

*TS-Aufwand:* mittel. Zero-Dep-Weg: eigene deklarative Query-Engine oder externes CLI-Binary. Für die Backoffice-Zielgruppe der wertvollste Einzelbaustein.

## 5. Test-time-Techniken

- **Tool-integrierte Verifikation schlägt Sampling-Skalierung** (T1, arXiv 2504.04718): **1B+ToolV übertrifft 8B ohne**; Verifier braucht **1–3× weniger Tokens** als Mehrheits-Voting.
- Self-Consistency/Best-of-N wirkt, aber teuer — schlechter Idiot-Index.
- **Für uns:** deterministischer Verifier-Pass gegen tatsächliche Tool-Ergebnisse — `verifyFinalAnswer` ist genau diese Richtung.

## Priorisierte Technik-Liste

| # | Technik | Erwarteter Uplift (Quelle) | TS-Aufwand (Zero-Dep) |
|---|---------|---------------------------|----------------------|
| 1 | **final_answer-Gate + Plan/Recover-Loop** | TSR 0,952 vs. 0,429; Plan+Recovery je ~24,7 % (2605.12129) | **Niedrig** — Loop-Logik |
| 2 | **Code/SQL-Executor-Tool für Tabellen** | sLMs schreiben Code statt rechnen (2402.01030, 2505.17612) | **Mittel** |
| 3 | **History-/Observation-Kompression + Truncation** | +32/+20/+46 %, −26–54 % Peak-Tokens (2510.00615); 10× Kontext (2510.11967) | **Mittel** |
| 4 | **Deterministischer Verifier-Re-Check** | 1B+ToolV > 8B; 1–3× günstiger als Voting (2504.04718) | **Niedrig** — begonnen |
| 5 | **first-thought prefix** | Teil des Distillation-Gewinns (2505.17612) | **Trivial** |
| 6 | Constrained decoding/GBNF | Syntax ok, 3,6–8,2× Latenz, Inhalt unverbessert (2605.02363) | Niedrig, geringer Nutzen |
| 7 | Self-Consistency/Best-of-N | Verifier dominiert | Schlechter Idiot-Index |

## Top-3 „das zuerst bauen"

1. **Loop schließen: plan → execute → verify → recover, final_answer als einziger Ausweg.** Exakt der gemessene smolagents-Gap, direkt belegt, reine Loop-Logik. **Achtung nicht-monoton: ganz oder gar nicht.**
2. **Tabellen-Query-Executor-Tool.** Löst die 0-%-Klasse (CSV-Joins); kleines Modell formuliert, Engine rechnet deterministisch.
3. **Kontext-Kompression + Tool-Result-Truncation.** Truncation sofort; Zusammenfassung alter Turns lokal quasi gratis.

Verifier-Re-Check (#4) und first-thought prefix (#5) als billige Ergänzungen danach. Constrained decoding und Best-of-N bewusst parken.

## Quellen

- CodeAct: https://arxiv.org/abs/2402.01030 · https://github.com/xingyaoww/code-act
- Harness Design/Operational Stability (SLM): https://arxiv.org/abs/2605.12129
- smolagents: https://github.com/huggingface/smolagents
- Agent Distillation: https://arxiv.org/abs/2505.17612
- ACON: https://arxiv.org/abs/2510.00615 · Context-Folding: https://arxiv.org/abs/2510.11967
- Structured Output Reliability: https://arxiv.org/abs/2605.02363
- Ollama structured outputs: https://blog.danielclayton.co.uk/posts/ollama-structured-outputs/ · GBNF: https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md
- DuckDB-NSQL: https://motherduck.com/blog/duckdb-text2sql-llm/ · https://huggingface.co/blog/duckdb-nsql-7b
- T1 (Tool-Verifikation): https://arxiv.org/abs/2504.04718

Hinweis: 2604/2605-arXiv-IDs sind junge Preprints (2026); tragende Zahlen aus Abstract/Ergebnis-Abschnitt zitiert.
