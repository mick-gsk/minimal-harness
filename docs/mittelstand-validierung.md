# Mittelstands-Roadmap — Validierungsergebnisse

Fünf Teilprojekte machen das Harness betriebstauglich für kleine/mittlere
Unternehmen: persistente Memory, OpenAI-kompatible Adapter, Streaming, parallele
Tool-Calls, Multi-User-Server. Jede Fähigkeit ist **gemessen und validiert** —
deterministische Tests lokal, Modell-Läufe auf dem GPU-PC (Ollama, 100 % GPU,
ctx 8192). Bench-Läufe mit Experiment-Schaltern sind per Runner-Guard immer
**Proben** (schreiben nie BENCHMARKS.md).

Specs: `docs/superpowers/specs/2026-07-10-*.md` · Stand: 2026-07-10

## SP1 — Persistente Memory (`SqliteMemory`)

Drop-in für `InMemoryMemory` über eingebautes `node:sqlite` (keine Dependency,
Node ≥ 22.5). WAL, stabile Ordnung über `ORDER BY id`, tolerant gegen korrupte
Metadata, idempotentes `close()`.

| Prüfung | Ergebnis |
|---|---|
| Jest (Neustart-Persistenz, Session-Isolation, Metadata-Roundtrip, Ordnung) | 10/10 grün |
| Perf-Smoke | 10 000 Appends ≈ 0,5 s · `get` über 1 000 Messages < 1 ms |
| Äquivalenz-Probe (dev-Suite, llama3.1, Seeds 1001–1005, GPU-PC) | InMemory **20/20** (Ø 574 Tokens, 931 ms) vs. SQLite **20/20** (Ø 574 Tokens, 891 ms) — identische Erfolgsrate & Tokens, kein messbarer Overhead |

## SP2 — OpenAI-kompatibler Adapter (LM Studio / llama.cpp)

Ein Adapter (`OpenAiCompatAdapter`) für alle Chat-Completions-Backends; die
früheren Stubs `LMStudioAdapter`/`LlamaCppAdapter` sind dünne Subklassen.

| Prüfung | Ergebnis |
|---|---|
| Jest (Request-Shape, tool_calls-Parsing, SSE inkl. [DONE], Fehlerpfad) | 6/6 grün |
| Protokoll-Probe gegen Ollama `/v1` (dev-Suite, llama3.1, gleiche Seeds) | minimal **20/20** (identisch zur Ollama-API), ollama-native 15/20 vs. 16/20 (Rauschen bei temp 0.7) — Text-Protokoll **und** native Tools laufen korrekt über die OpenAI-API |

Bekannte Lücke: Über `/v1` zählt die Token-Telemetrie nicht (sie liest Ollamas
`eval_count`-Felder) — betrifft nur Bench-Reporting, nicht die Funktion.

## SP3 — Token-Streaming Ende-zu-Ende

`onToken` in `AgentLoopInput`, durchgereicht an die Haupt-Turn-Calls; Adapter
streamen NDJSON (Ollama) bzw. SSE (OpenAI-kompatibel).

| Prüfung | Ergebnis |
|---|---|
| Jest (Chunks erreichen den Loop-Aufrufer über mehrere Turns) | grün |
| TTFT-Probe (GPU-PC, llama3.1, 5 Läufe, Seeds 1001–1005) | Median TTFT **125 ms** vs. blockierend **2130 ms** — erstes Feedback **17×** früher; Gesamtlatenz Streaming 2072 ms ≈ blockierend 2130 ms (Streaming kostet nichts) |

## SP4 — Parallele Tool-Calls

`parallelToolCalls: true` (Opt-in, nativer Pfad): Batch-Policy-Check vor Start,
`Promise.all`, Ergebnisse in Aufruf-Reihenfolge (reproduzierbare Transcripts).

| Prüfung | Ergebnis |
|---|---|
| Jest (Nebenläufigkeits-Zähler, Ordnung, Fehler-Isolation, Policy-Batch) | 6/6 grün |
| Wall-Time (2 Tools à 100 ms) | sequenziell 203 ms → parallel **102 ms** |

Kein GPU-Lauf nötig: der Gewinn liegt im Tool-Executor, nicht im Modell
(Begründung in der Spec).

## SP5 — Multi-User-Server (Auth, Isolation, SSE)

`createAgentServer` (`node:http` + `node:crypto`, weiterhin null Dependencies):
Bearer-API-Keys mit Konstantzeit-Digest-Vergleich, Session-Scope
`userId:sessionId` (userId ausschließlich aus dem Key), SSE-Streaming,
1-MB-Body-Limit. TLS/Rate-Limiting bewusst im Reverse-Proxy.

| Prüfung | Ergebnis |
|---|---|
| Jest-Integration (401-Pfade, Isolation auf echter SQLite-Datei, SSE, 400/404/405/500) | 10/10 grün |
| Concurrency-Smoke | 20 parallele Requests, 2 User, SQLite-Datei: alle 200, Isolation hält, **21 ms** |
| Live-Smoke gegen GPU-Ollama (examples/server.ts, llama3.1) | `/healthz` 200 · ohne Key 401 · Alice: Calculator-Tool korrekt (17·23 = 391, 852 ms) · Bob: eigene Session · Alices Follow-up in gleichnamiger Session kennt Bobs Namen **nicht** („unknown") — Isolation hält auch live |

---

# Teilprojekt 6 — Ausbau für die Top-KMU-Use-Cases (EU-Marktrecherche)

Herleitung: Marktrecherche 2026-07-10 (Bitkom 2026, OECD 2025, KMU-Praxisquellen)
— höchstes Automationspotenzial in dokumenten-zentrierten Back-Office-Prozessen
(Rechnung/Bestellung/E-Mail: strukturierte Extraktion), Wissensmanagement (RAG)
und KI-Agenten mit menschlicher Aufsicht; größte Adoptionsbremse: Datenschutz/
Rechtsunsicherheit → DSGVO-Routen, Observability, On-Premise-Deployment.

## 6a/6b — DSGVO-Session-API & Observability

| Prüfung | Ergebnis |
|---|---|
| Session-API (Art. 15/17): Liste/Auskunft/Löschung nur im eigenen User-Scope, fremde Session = 404 | Jest-Integration grün |
| `/metrics` (Prometheus) zählt Requests/Runs/Dauern; Run-Logs als JSON-Zeile ohne Nachrichteninhalte | Jest-Integration grün |

## 6c — Strukturierte Extraktion (`responseSchema`)

| Prüfung | Ergebnis |
|---|---|
| Jest (Schema-Vertrag im Prompt, Fence-Toleranz, Korrektur-Retry, Typ-Checks, fail-explicit) | 13/13 grün |
| GPU-Probe Feld-Genauigkeit (5 deutsche Belege × 5 Seeds, llama3.1) | Vertrag (`responseSchema`): **100/100 Felder korrekt, 0 fehlgeschlagene Läufe**. Plain-Arm („antworte als JSON" ohne Vertrag): 0/100 — alle 25 Läufe scheiterten End-to-End, weil rohes JSON das Text-Protokoll verletzt. Die Probe fand zuerst einen echten Bug (Modell verschmilzt Protokoll- und Schema-Vertrag zu `ACTION/ANSWER\n{…}` → 0/100 auch im Vertrags-Arm); Fix: Schema-valides JSON wird als Antwort gerettet — danach 100/100 |

## 6d — Lokales RAG (`SqliteKnowledgeStore` + `knowledge.search`)

| Prüfung | Ergebnis |
|---|---|
| Jest (Cosine-Ranking, Persistenz, Tool-Integration) | 5/5 grün |
| Embedding-Modellwahl (8 deutsche Firmendokumente, 5 Queries, GPU) | nomic-embed-text hit@1 **2/5** (mit Task-Präfixen 1/5) · bge-m3 hit@1 5/5, aber **disqualifiziert**: deterministische NaN-Embeddings für bestimmte Token-Sequenzen auf Ollama 0.17 (500er) · **snowflake-arctic-embed2 hit@1 5/5, hit@3 5/5, stabil** ⇒ Default (embeddinggemma ebenfalls 5/5, Alternative) |

## 6e — Approval-Gate (Human-in-the-Loop)

| Prüfung | Ergebnis |
|---|---|
| Jest (Loop-Hook: deny → kein Lauf + ehrliches Feedback ans Modell; Parallel: Freigaben vor Batch-Start) | grün |
| Jest (Server-SSE: approval_request → approve/deny; fremder User 404; Timeout = deny fail-closed; non-stream = deny) | grün |

## 6f — Deployment

| Prüfung | Ergebnis |
|---|---|
| Produktions-Build (`dist/server-main.js`, ohne Dev-Dependencies) | Boot-Smoke: `/healthz` 200, `/metrics` 200, ohne Key 401. Gefundener & gefixter Build-Bug: tsup entfernte das `node:`-Präfix von `node:sqlite` (removeNodeProtocol=false) |
| Dockerfile (Multi-Stage) + docs/deployment.md (Compose, systemd, Backup, DSGVO, Reverse-Proxy) | vorhanden, dokumentiert |

---

# Produktionsreife-Test: Demo-Unternehmen (bench/company)

Testgelände: deterministisch generiertes Mittelstands-Unternehmen
(„Selkinghaus Federn- und Stanztechnik", 142 MA) mit Fileserver (38 Dateien,
teils windows-1252), Mail-Archiv, ERP (SQLite, 7 Tabellen) und AD-Exporten —
plus 16 Ground-Truth-Fragen (`company/truth/facts.jsonl`): Tribal Knowledge nur
in Mails, Revisions-Widersprüche, veraltete Exporte, DSGVO-Verstöße in ACLs und
Halluzinations-Fallen. Der Agent bekommt drei Deployment-Tools: `fs.list`,
`fs.read` (mit cp1252-Toleranz und Traversal-Guard), `erp.query` (nur SELECT).

## Fix-Kreislauf (jeder Schritt gemessen, qwen3:8b)

| Lauf | Ergebnis | Befund → Maßnahme |
|---|---|---|
| 1 | **0/16** | Modell schreibt mitten in der Recherche `ACTION: <toolname>` statt `ACTION: tool_call`; der strikte Validator verwarf ganze Läufe → **Parser akzeptiert Protokoll-Drift**, wenn TOOL+ARGS/ANSWER eindeutig sind (zeilenverankert); Retry-Prompt zeigt das exakte Format |
| 2 | 2/16 | System-Instruktion nannte die Datensysteme nicht — Mail-Archiv wurde nie durchsucht → **Systems-Overview in die Deployment-Instruktion** (Konfiguration, kein Antwort-Leak) |
| 3 | 6/16 | 20k-Zeichen-Reads + 12 Turns sprengen das 8k-Server-Kontextfenster; Ollama schneidet vorne ab und wirft den System-Prompt weg (sichtbar als Drift/„vergessene" Funde) → **`numCtx`-Option im OllamaClient (16k)** + Read-Cap 6k Zeichen |
| 4 | 7/16 (Einzellauf, hohe Varianz) | Einzelläufe bei temp 0.7 kippen pro Lauf → **Produktions-Config**: temp 0.1, think, k=3 Seeds |
| 5 | **20/48 (42 %)** pass@1 über 3 Seeds | Verbleibende Fails: Multi-Quellen-Recherche (ACL-Abgleich, Kalkulations-Mail) — Modellfähigkeits-, nicht Harness-Grenze bei 8B |

Nebenbefund: `unbeantwortbar`-Fallen **5/6 verweigert** statt halluziniert —
die Ehrlichkeits-Instruktion + Fehler-Feedback wirken.

## Modell-Sizing (Produktionsempfehlung)

| Modell | Ergebnis |
|---|---|
| qwen3:8b (think, temp 0.1, 16k ctx) | 20/48 (42 %) pass@1; `unbeantwortbar` 5/6 verweigert |
| qwen3:14b (gleiche Config) | **passt nicht**: 20,6 GB gesamt, nur 76 % im 16-GB-VRAM (16k ctx × OLLAMA_NUM_PARALLEL=4) → CPU-Spill, abgebrochen |

## Wettbewerbs-Matrix: das Harness gegen die Konkurrenz (2026-07-10, nachmittags)

Gleiche 16 Fragen, gleiche Deployment-Instruktion, gleiche Tools (jetzt vier:
plus `fs.search`, Volltextsuche mit Datei-Level-UND über Mehrwort-Queries —
Root-Cause: Modelle suchen wie Menschen, „DF-12040 Wittenbrink"), gleiche
Turn-Budgets, temp 0.1, 16k ctx, 3 Seeds. Konkurrenten: **ollama-native**
(naives Function-Calling, wie man es out-of-the-box schreibt) und **Hugging
Face smolagents** (off-the-shelf, eigener Scaffold). Volle Antworten liegen
als Evidenz in `results.jsonl`; Scoring offline reproduzierbar per
`rescore.ts` (REFUSAL-Checks evidenzbasiert kalibriert, gelten für alle Arme
gleich).

Zwei Deployment-Instruktionen wurden versioniert gemessen (p1 = Basis;
p2 = plus ein Satz Recherche-Beharrlichkeit — gleiche Instruktion für alle
Arme). pass@1 über 16 Fakten × 3 Seeds (n=48 pro Zelle):

| Arm | qwen p1 | qwen p2 | llama p1 | llama p2 |
|---|---|---|---|---|
| **minimal (Text-Protokoll, think)** | 48 % | 48 % | 13 % | — |
| **minimal@verify** | **50 %** | 48 % | — | — |
| **minimal@nt (nativeToolCalling)** | 40 % | 48 % | **40 %** | 21 % |
| minimal@nt4 (4 parallele Calls/Turn) | 42 % | 48 % | 40 % | — |
| ollama-native (Baseline, ohne Harness) | 42 % | 58 % | 27 % | 21 % |
| smolagents-code (HF-Default-Empfehlung) | 54 % | — | — | — |
| smolagents-tool | **65 %** | 63 % | — | — |

Drei Interaktions-Befunde, die man ohne Messung garantiert falsch rät:

1. **Prompt × Modus:** Die Beharrlichkeits-Instruktion hebt qwens
   Function-Calling-Pfad massiv (native 42→58), lässt das Text-Protokoll
   unberührt (48→48) — und **schadet** llama in jedem Modus (40→21,
   Suchschleifen bis zum Turn-Limit, Verweigerungen 4/6→0/6).
2. **Modell × Modus:** llama braucht API-Tool-Specs (@nt), qwen ist im
   Text-Protokoll+think am stabilsten. Eine Config für alle gibt es nicht.
3. **Verweigerungs-Disziplin ist orthogonal zum Score:** das minimal-Harness
   hält 5–6/6 in jeder qwen-Config; llama-native fabriziert stattdessen
   Tool-Ergebnisse. Wer nur pass@1 liest, übersieht das Produktionsrisiko.

**Befund llama3.1:** Mit dem Text-Protokoll antwortet llama auf die deutsche
Recherche-Instruktion mit *Meta-Plänen* („empfehle ich folgende Schritte…")
statt zu handeln — 0 Tool-Calls, Protokoll formal korrekt. Prompt-Varianten
ändern das nicht (Ablation gemessen); llamas Function-Calling-Training braucht
Tool-Specs über die API. Ein Flag (`nativeToolCalling: true`) hebt llama von
13 % auf 40 % — vor die naive Baseline (27 %). **Die Modus-Wahl pro Modell ist
eine Harness-Fähigkeit: gleicher Loop, gleiche Memory, gleiche Guards.**

**Befund Halluzination:** ollama-native mit llama *fabriziert Tool-Ergebnisse*
(f09: erfundene JSON-Blöcke mit nicht existierenden Dateien wie
„Beschluss-über-Nachlass.docx"). Das minimal-Harness verweigert dieselbe Frage
6/6 sauber mit echten Quellenangaben — für den Unternehmenseinsatz ist das der
entscheidende Unterschied.

**Befund Robustheit (Validator-Fix):** qwen fusioniert mitten in Recherchen
ACTION und TOOL zu einer Zeile (`ACTION: erp.query` + `ARGS`, ohne TOOL) —
4/48 Läufe starben daran als `validation_failed`. Der Parser akzeptiert das
Muster jetzt (eindeutige Intention), Regressionstest aus den geloggten
Roh-Outputs, danach **0/48 abnormale Terminierungen**; dev-Suite 40/40
unverändert (kein Tuning gegen die Frozen-Suite).

**Befund smolagents-Gap (qwen):** Der ToolCallingAgent-Scaffold von HF
erzwingt Beharrlichkeit strukturell (`final_answer` ist ein Tool und der
einzige Ausweg aus dem Loop) und liegt damit bei 63–65 %. Unsere beste
qwen-Config erreicht 50 % — die Lücke ist Recherche-Ausdauer, nicht
Korrektheit oder Disziplin. Sie ist benannt, root-caused und der nächste
Hebel (Persistenz-Scaffold als opt-in Loop-Feature) ist definiert.

**Power-Check (Seeds 1004–1006, je n=48 zusätzlich):** Der auffällige
native-p2-Wert (58 %) fiel auf frischen Seeds auf 46 % — kombiniert über
6 Seeds: **native-p2 52 % (50/96) vs. minimal@nt-p2 49 % (47/96)**. Harness
und nackte Baseline sind auf dem FC-Pfad statistisch gleichauf; der Harness
kostet keine Genauigkeit und bringt Recovery, Persistenz, Approval, DSGVO und
Betrieb mit. Lehre: Einzelzellen mit n=48 haben ±14 pp Unsicherheit —
Ausreißer erst replizieren, dann interpretieren.

## Urteil (Stand 2026-07-10, nach der Wettbewerbs-Kampagne)

**Gegen die naive Baseline (die Kern-These) ist der Fall entschieden:**
Frozen-Suite llama +36 pp signifikant (92,4 % vs. 56,4 %, halbe Latenz);
Company-Test llama 40 % vs. 27 % (richtige Modus-Config vs. out-of-the-box);
qwen gleichauf im Score, aber ohne die 4/48 toten Läufe, mit 5–6/6
Verweigerungsdisziplin und ohne fabrizierte Tool-Ergebnisse.

**Gegen smolagents:** Auf llama ist das Harness praktisch konkurrenzlos
(smolagents setzt starkes Instruction-Following voraus). Auf qwen führt
smolagents-tool die Recherche-pass@1 an (63–65 % vs. 50 %) — die Ursache
(struktureller Beharrlichkeits-Scaffold) ist identifiziert; smolagents bringt
dafür weder Persistenz noch Auth/Multi-User, DSGVO-API, Approval-Gate,
Streaming noch Zero-Dependency-Betrieb mit — genau die Anforderungen, an
denen Mittelstands-Deployments real scheitern.

**Empfohlene Produktions-Configs (gemessen):**

| Modell | Config | Ergebnis |
|---|---|---|
| qwen3:8b | Text-Protokoll + think + verifyFinalAnswer, Prompt p1 | 50 % pass@1, 6/6 Verweigerung |
| llama3.1 | `nativeToolCalling: true`, Prompt p1 (keine Beharrlichkeits-Floskel!) | 40 % pass@1 |

**Was die ehrliche Grenze ist:** tiefe Multi-Quellen-Recherche (ACL-Abgleich
gegen Verarbeitungsverzeichnis, Tribal Knowledge in Mails finden) überfordert
ein 8B-Modell auch mit gutem Harness — ~50 % pass@1 sind keine unbeaufsichtigte
Sachbearbeitung. Realistischer Einsatz heute: **assistierte Recherche mit
Quellenangaben und Approval-Gate** (der Mensch prüft), oder eng zugeschnittene
Einzelaufgaben (Extraktion: 100/100). Für autonome Recherche-Qualität braucht
es ein 14B+-Modell und damit >16 GB VRAM (oder NUM_PARALLEL=1) — dokumentiert
in docs/deployment.md.

**Nächste Hebel (definiert, nicht begonnen):** (1) Persistenz-Scaffold als
opt-in Loop-Feature (die smolagents-Lücke), (2) qwen3:14b via
NUM_PARALLEL=1, (3) smolagents-Vergleich auf llama vervollständigen.

---

# Demo-Firma v2: Produktionsreife auf realistischer Skala (2026-07-11)

Die Demo-Firma wurde auf realistische Größe ausgebaut: **2.169 Dateien,
7 Systeme** (Fileserver 1.896 Dateien, 256 Mails, AD, DocuWare-DMS-Index,
BDE-Maschinendaten, DATEV-Buchungsstapel, PDM/CAD-Index; ERP mit 10 Tabellen
und 941 Aufträgen) — plus zwei neue Wahrheits-Sets: **system-facts** (Joins
über Systemgrenzen) und **binary-facts** (Antworten, die ausschließlich in
xlsx/docx/pdf existieren).

## Neuer Baustein: Zero-Dependency-Office-Extraktion

Deutsches Mittelstands-Wissen lebt in Office-Dateien. `src/extractors/office.ts`
liest xlsx/docx (ZIP+OOXML über `node:zlib`) und PDF-Textlayer (Glyph-Codes
subsetted Fonts über die /ToUnicode-CMaps aufgelöst) — **ohne Dependency,
`dependencies: {}` bleibt**. `fs.read` liefert Office-Text, `fs.search`
durchsucht ihn (≈50 ms über 2.169 Dateien). Scans ohne Textlayer bleiben
bewusst leer (kein OCR — die s06-Falle bestätigt genau das). 20/24
Office-Dateien des Korpus extrahieren sauber; Office-Lock-Dateien (`~$…`)
werden korrekt abgewiesen.

## Kern-Kampagne v2 (16 Fakten × 3 Seeds, Prompt v3 = 7 Systeme)

| Arm | qwen3:8b | llama3.1 |
|---|---|---|
| **Harness (verify bzw. @nt)** | **44–48 %** | **44 %** |
| ollama-native (Baseline) | 40 % (tribal 0/6) | — |

Die Skalierung von 148 auf 2.169 Dateien kostet das Harness **nichts**
(v1: 48–50 %); die naive Baseline verliert die Tribal-Knowledge-Fragen
komplett — in der großen Firma findet man Mail-Nadeln nur noch mit
systematischer Suche. Verweigerungsdisziplin des Harness: 6/6 in jeder Zelle.

## Die drei Fähigkeitsklassen (gemessen, qwen3:8b + Harness)

| Fragenklasse | Ergebnis | Bedeutung |
|---|---|---|
| Recherche in Text/Mail/ERP (core) | 44–48 % | Harness-Terrain, schlägt Baseline |
| **Nur-Binär (Office)** | **0 % → 42 %** | war per Definition unlösbar; der Extraktor öffnet die Klasse (docx-Lastenheft und PDF-Vertrag je 3/3) |
| Systemübergreifende Joins | 0/15 → **6/15** (s. Update 2026-07-11) | war Werkzeugklassen-Grenze; `data.query` mit `erp:`/`fs:`-Quellen öffnet die Klasse |
| llama3.1 auf binary | 0/24 | llamas Such-Beharrlichkeit reicht nicht — Office-Recherche braucht qwen-Klasse |

## Produktionspfad End-to-End (bench/company/server-e2e.ts)

Der echte Server-Stack (`createAgentServer`) gegen die Demo-Firma: **14/14
deterministische Checks** — Auth (401), echte Recherche über HTTP (AA-032 →
Rev. C mit Quelle), Session-Isolation zwischen Usern, Approval-Gate
fail-closed ohne Freigabekanal UND SSE-Freigabe-Flow (ERP-Kundenzahl 52 erst
nach approval), DSGVO-Auskunft/-Löschung, Prometheus-Metriken. Auf v1 und v2
der Firma identisch bestanden.

## Update 2026-07-11: die Join-Klasse ist geöffnet (0/15 → 6/15)

Das Zero-Dep-Tabellenwerkzeug `data.query` (deklaratives JSON: where/groupBy/
aggregate/inner+anti-Join) bekam zwei zusätzliche Quellenarten: `erp:<tabelle>`
(liest die ERP-SQLite als Tabelle) und `fs:<ordner>` (liest den Dateibestand
als Tabelle, inkl. `pfad_win`-Spalte für Windows-Pfad-Joins). Damit sind
Index-vs-Realität-Fragen erstmals *rechenbar*: Der Anti-Join DocuWare-
`Ablagepfad` gegen `fs:fileserver` liefert deterministisch die 88 verwaisten
Einträge; `fs:`-Count liefert den 1.896er-Nenner; der DATEV↔ERP-Abgleich
läuft über `erp:rechnungen`.

Messung (qwen3:8b, system-Set, 6 Fakten × 3 Seeds): **3/18 → 9/18**,
systemübergreifende Joins **0/15 → 6/15** (s01 Orphans 2/3, s02 Anteil 2/3,
s05 DATEV-Abgleich 2/3), Verweigerungs-Falle 3/3 gehalten. Die verbleibenden
Fails (s03 Header-Diff über Monatsexporte, s04 Muster-Join) sind Verhaltens-,
keine Werkzeugfälle — das Modell rät statt zu prüfen; Gegenstand des
laufenden Scaffold-Tunings.

Nebenbefund mit Prinzip-Wert: Die erste Live-Messung entlarvte einen
Schema-Bug (`data.query` verlangte einen `{query:{…}}`-Wrapper, die
Description-Beispiele zeigten das nackte Objekt — 8B-Modelle kopieren
Beispiele wörtlich und wurden abgelehnt). Fix: Schema geflattet, alte Form
toleriert (`0c8f7c6`). Lehre: **Tool-Schemas für kleine Modelle müssen
exakt den Description-Beispielen entsprechen** — Messung vor Meinung.

Zweite Beweis-Achse dokumentiert: [eu-compliance-vergleich.md](eu-compliance-vergleich.md)
— nachprüfbare 8×8-Matrix (Audit-Kette, fail-closed Approval, DSGVO-API,
Art.-50-Kennzeichnung) gegen smolagents/LangChain/CrewAI/OpenAI-SDK/Mastra/
Haystack/n8n, inkl. ehrlicher Grenzen.

## Betriebs-Lehre des Tages

Ein Ollama-Neustart ohne `OLLAMA_CONTEXT_LENGTH` lädt qwen3 mit seinem
Modell-Default **40.960** → 30,6 GB → 49 % CPU-Spill → GPU ~8 % ausgelastet,
Läufe 5–10× langsamer. Direkte Harness-Requests sind durch `numCtx` pro
Request geschützt; /v1-Clients ohne num_ctx (z. B. smolagents) erben den
Server-Default. Für den Betrieb heißt das: `OLLAMA_CONTEXT_LENGTH` gehört in
die Server-Konfiguration (systemd/Task-Scheduler), nicht in eine Shell-Session
— dokumentiert in docs/deployment.md.
