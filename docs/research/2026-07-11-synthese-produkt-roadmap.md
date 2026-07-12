# Synthese: Das leistungsbeste Agent-Harness für den EU-Mittelstand — Produkt-Roadmap

> Orchestrator-Synthese aus vier Opus-Recherche-Berichten (2026-07-11):
> [KI-Bedarf EU-KMU](2026-07-11-ki-bedarf-eu-kmu.md) · [Wettbewerbslandschaft](2026-07-11-wettbewerbslandschaft-agent-harnesses.md) ·
> [EU-Regulatorik](2026-07-11-eu-regulatorik-agent-pflichten.md) · [SOTA Small-Model-Agents](2026-07-11-sota-small-model-agents.md)
> plus eigene Messungen ([mittelstand-validierung.md](../mittelstand-validierung.md)).

## Der Konvergenzpunkt (alle vier Berichte zeigen auf dieselbe Stelle)

1. **Bedarf:** Größter Wunsch-Adoptions-Gap = Dokumenten-Backoffice + Wissensmanagement (11–17 % Ist-Nutzung); Blocker Nr. 1–4: Rechtsunsicherheit (53 %), Know-how (53 %), DSGVO (48 %), Halluzination (36 %). Die lokal am besten lösbaren Use Cases sind genau die mit dem größten Gap.
2. **Wettbewerb:** Niemand erfüllt gleichzeitig (A) zuverlässiger Loop auf 8–14B lokal, (B) DSGVO/AI-Act nativ, (C) betreibbar ohne ML-Team, (D) deterministisch bewiesener Uplift. Leichte TS-Frameworks haben keine Compliance; Souverän-Plattformen sind schwer/teuer (Langdock on-prem ab 5.000 Seats); smolagents hat den besten Loop aber null Governance + Code-Exec-Risiko.
3. **Regulatorik:** Sofort geltende Pflichten (Art. 4, Art. 50 ab 08/2026, DSGVO, NIS2) sind in Software abbildbar; die Frameworks haben sie nicht. Art.-19-Logs müssen unter *eigener Kontrolle* sein → Cloud-Audit (LangSmith) disqualifiziert sich selbst.
4. **Technik:** Harness-Design schlägt Modellgröße (TSR 0,952 vs. 0,429; arXiv 2605.12129). Die Gewinner-Mechanik ist bekannt: geschlossener plan→execute→verify→recover-Loop mit final_answer-Gate, Datenwerkzeug statt Kopfrechnen, Kontext-Kompression. Warnung: nicht-monoton — halbe Scaffolds schaden.

**Positionierung in einem Satz:**
> *Der einzige zero-dependency Agent-Kern, der auf 8–14B-Modellen on-premise nachweisbar zuverlässig arbeitet und EU-Compliance (Audit, Approval, DSGVO, KI-Kennzeichnung) als eingebaute Primitive mitbringt — deterministisch gemessen auf einer realistischen 2.169-Dateien-Firma.*

## Die drei Säulen und ihr Bauplan

### Säule 1 — Leistung (der empirische Beweis)
| Hebel | Beleg | Status |
|---|---|---|
| P1: Persistenz-Scaffold: plan→execute→verify→recover, final_answer-Gate (opt-in Modus) | 2605.12129 (je ~24,7 % Plan/Recovery); eigener smolagents-Gap 63–65 vs. ~50 % | **nächster Build** |
| P2: `data.query` Tabellen-Engine (JSON-Query, anti-Join) | 2402.01030/2505.17612: sLMs schreiben Queries, Engine rechnet | ✅ gebaut (69de049) — **jetzt messen** |
| P3: Tool-Result-Truncation + History-Kompression | ACON 2510.00615: +20–46 % für kleine LMs | nach P1 |
| P4: verifyFinalAnswer (deterministischer Re-Check) | T1 2504.04718: Verifier > Voting | ✅ vorhanden |
| P5: first-thought prefix | 2505.17612 | trivial, mit P1 |
| Geparkt: constrained decoding, Best-of-N | 2605.02363: 3,6–8,2× Latenz, Inhalt unverbessert | bewusst nicht |

### Säule 2 — EU-Compliance nativ (der Burggraben)
| Feature | Rechtsgrund | Status |
|---|---|---|
| C1: Hash-verkettetes Append-only-Audit-Log jedes Tool-Calls, Retention-Policy, Export | AI Act Art. 12/19/26(6), NIS2 | **nächster Build** |
| C2: KI-Kennzeichnung im Output (Art.-50-Header, maschinenlesbar) | Art. 50, Pflicht ab 08/2026 | billig, mit C1 |
| C3: Approval-Gate (HITL) | Art. 14, DSGVO Art. 22 | ✅ vorhanden (SSE-Flow, fail-closed) |
| C4: DSGVO-Auskunft/-Löschung Session-scoped | Art. 15/17 | ✅ vorhanden; Ausbau: Subject-ID-Tagging über RAG-Index |
| C5: Tool-RBAC (Rolle→Tool-Matrix) + Tool-Manifeste (Zweck/Datenkategorien → VVT-Export) | NIS2, Art. 30/32 | danach |
| C6: Betriebsrats-/Einsatz-Report, DSFA-Rohexport | Art. 26(7), Art. 35 | Kür, später |

### Säule 3 — Betreibbarkeit ohne ML-Team (vorhanden, pflegen)
`dependencies: {}` · Ollama-first · ein Docker-Artefakt · Prometheus/healthz · deployment.md. Kein Neubau nötig — Zielzustand halten.

## Beweisführung (Test-Optimier-Schleife)

Jeder Hebel wird auf der Demo-Firma (2.169 Dateien, 3 Fakten-Klassen + Verweigerungs-Fallen) deterministisch gemessen, k=3 Seeds, gegen die etablierten Baselines (native, smolagents). Reihenfolge nach Idiot-Index:

1. **Messen jetzt:** system-facts mit `data.query` (war 0/15) — qwen, k=3.
2. **P1 bauen → messen:** Kern-Recherche qwen (Ziel: smolagents 63–65 % erreichen/schlagen) und llama (Verweigerung darf nicht kippen — p2-Lektion!).
3. **C1+C2 bauen → Server-E2E erweitern** (Audit-Kette verifizieren, Kennzeichnung prüfen).
4. **P3 bauen → messen:** lange Recherchen (tribal/binary-Klasse), Token-Peak dokumentieren.
5. Geparkt bis Ollama-Neustart: smolagents-v2-Vergleichszellen, RAG-Arm, qwen3:14b.

**Erfolgskriterium („das beste Harness"):** Auf identischen Aufgaben, identischem lokalem Modell: (a) ≥ smolagents-Niveau in der Kern-Recherche, (b) einzige Lösung > 0 % in der Tabellen-Klasse, (c) Verweigerungsdisziplin ≥ 5/6, (d) Compliance-Featureliste, die kein leichtes Framework hat — alles reproduzierbar in results.jsonl.

> **Abgleich Stand 2026-07-12** (Kampagne v2 Tag 2, Messtabelle in [../mittelstand-validierung.md](../mittelstand-validierung.md)): (a) **offen** — Bestwert 54 % (rag+verify), fairer v2-smolagents-Vergleich ausstehend; (b) **teils erfüllt** — 6/15 Joins über `data.query`, offen bleiben s03/s04; (c) **erfüllt** — 6/6 beim Bestwert-Arm; (d) **erfüllt** — verlinkt in eu-compliance-vergleich.md.

## Bekannte Grenzen (ehrlich dokumentieren, nicht verstecken)

- 8–14B bleibt assistierte Recherche, keine offene Autonomie (GAIA-Realität ~20–24 %).
- `data.query` kann heute CSV↔CSV; ERP-sqlite↔CSV-Joins brauchen erp.query-Umweg oder Erweiterung (messen, dann entscheiden).
- Frontier-Fälle (offene Dialoge, lange Rechtsketten) sind explizit out-of-scope — Positionierung auf enge, verifizierbare Business-Tasks.
