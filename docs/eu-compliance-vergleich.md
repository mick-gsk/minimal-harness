# EU-Compliance-Vergleich — minimal-harness vs. Markt

> Zweite Achse der Beweisführung „bestes Harness für EU-Mittelständler". Die
> Leistungs-Achse belegen die Benchmarks (`BENCHMARKS.md`, `docs/mittelstand-validierung.md`);
> dieses Dokument liefert die **Compliance-/Betriebs-Achse**: den nachprüfbaren
> Nachweis, welche Pflicht-Features die leichten Agent-Frameworks *nicht* eingebaut
> haben — und dass minimal-harness sie hat.
>
> Alle Zeilen zu minimal-harness sind mit Modul/Endpoint/Test hinterlegt und in
> **einem Kommando selbst verifizierbar**. Wettbewerber-Zellen tragen ihre
> Quelle. Wo die Faktenlage unklar ist, steht bewusst ⚠️ statt eines falschen ❌.
>
> Stand: 2026-07-11. Zwei Wettbewerber-Zellen wurden an diesem Tag live
> nachrecherchiert (LangSmith Self-hosted-Audit, smolagents HITL — siehe
> Fußnoten [L] und [S]).

## Warum diese Achse kaufentscheidend ist

Nicht die Modell-Qualität stoppt KI-Projekte im deutschen Mittelstand, sondern
Rechtsunsicherheit. Der **Bitkom-Report „KI im Mittelstand" (2026)** und die
begleitende KMU-Marktrecherche (zusammengefasst in `docs/mittelstand-validierung.md`,
Abschnitt „Teilprojekt 6") nennen als **größte Adoptionsbremse Datenschutz und
Rechtsunsicherheit** — noch vor Kosten und Fachkräftemangel. In der Praxis heißt
das: Ein Agent, der ERP- und Fileserver-Zugriff hat, aber keine revisionssichere
Ereigniskette, keine Freigabe vor schreibenden Aktionen und kein Löschkonzept
mitbringt, ist für einen regulierten Prozess **nicht einsetzbar** — unabhängig
davon, wie gut er misst.

Der Regulatorik-Bericht (`docs/research/2026-07-11-eu-regulatorik-agent-pflichten.md`)
leitet daraus konkrete, in Software abbildbare Pflichten ab. Zwei davon sind
**heute** scharf (nicht erst 2027): **AI Act Art. 50** (Transparenz/KI-Kennzeichnung,
ab 08/2026) und das **gesamte DSGVO-Regime** (Auskunft Art. 15, Löschung Art. 17).
Der schwere High-Risk-Katalog (Art. 12/14/26 — Audit-Log, Human Oversight) ist per
Digital-Omnibus auf 12/2027 verschoben, aber genau die Features, die ihn erfüllen,
sind zugleich das, was ein Mittelständler *jetzt* für ein belastbares Deployment
verlangt. Der Wettbewerbs-Bericht
(`docs/research/2026-07-11-wettbewerbslandschaft-agent-harnesses.md`) hält fest:
**keines der leichten Agent-Frameworks liefert diese Governance „built-in"** — sie
ist entweder gar nicht vorhanden, in eine Cloud ausgelagert oder hinter einem
teuren Enterprise-Tier eingeschlossen.

## Die Matrix

Zeilen = konkrete Anforderungen der Regulatorik-Checkliste (Bericht Abschnitt 6).
Spalten = die leichten/mittelschweren Kandidaten aus dem Wettbewerbs-Bericht.
Legende: ✅ eingebaut & nutzbar · ⚠️ teilweise / nur Enterprise / nur mit
Eigenbau · ❌ nicht vorhanden.

| Anforderung | minimal-harness | smolagents | LangChain + LangGraph | CrewAI | OpenAI Agents SDK (TS) | Mastra | Haystack + deepset | n8n |
|---|---|---|---|---|---|---|---|---|
| **Audit-Log unter eigener Kontrolle + Manipulationserkennung** | ✅ Hash-verkettetes append-only Log, `verifyChain()` deterministisch | ❌ loggt nach stdout/Konsole, kein unveränderliches Event-Log [W] | ⚠️ OSS loggt nach stdout; strukturiertes Audit nur via **LangSmith**; Self-hosted-Audit existiert, aber Enterprise + closed-source + nur Admin-Aktionen (nicht die Tool-Call-Kette) [L] | ⚠️ Audit nur im **Enterprise-Tier**, nicht im offenen Framework [R] | ❌ kein eingebautes Audit-Log; Default-Tracing geht auf die OpenAI-Plattform [W] | ❌ kein unveränderliches Audit-Log im Kern [W] | ✅* Audit in der **deepset-Enterprise/Sovereign-Stack** (air-gapped) — nicht in der bloßen OSS-Lib [D] | ⚠️ Ausführungs-Historie; tamper-evidenter Audit-Log-Stream erst im Enterprise-Tier [N] |
| **HITL-Approval fail-closed** | ✅ SSE-Freigabe; kein Kanal/Timeout/Fremduser ⇒ **deny fail-closed** | ⚠️ `step_callbacks` / `agent.interrupt()` + Plan-Review, aber interaktiv & in-process, kein serverseitiges fail-closed Tool-Gate [S] | ✅ reifes `interrupt`/`resume` mit Checkpointing (Approval-Pattern) [L] | ⚠️ `human_input` auf Task-Ebene, kein fail-closed Pre-Dispatch-Gate [R] | ✅ `needsApproval` + Run-Interruptions (nicht genehmigt ⇒ Tool läuft nicht) [O] | ⚠️ Workflow `suspend`/`resume` (HITL für Workflows), kein Tool-Dispatch-Gate [M] | ⚠️ Pipeline-Framework; agentisches Approval kein natives Primitiv [D] | ⚠️ via „Wait"/Webhook-Node baubar, kein agentisches fail-closed Gate [N] |
| **DSGVO-Auskunft/-Löschung per API** | ✅ `GET`/`DELETE /v1/sessions/{id}`, pro User gescoped | ❌ keine Auskunfts-/Lösch-API, In-Process-Memory [W] | ❌ keine Betroffenen-API; unbefristete Checkpoint-Retention = DSGVO-Risiko [W] | ❌ keine eingebaute Betroffenen-API [W] | ❌ keine eingebaute Betroffenen-API (SDK) [W] | ❌ keine eingebaute Betroffenen-API [W] | ⚠️ Enterprise-Data-Governance, keine dokumentierte Per-Subjekt-Lösch-API über den RAG-Index [D] | ❌ keine Per-Subjekt-Lösch-API für Agent-Memory [W] |
| **KI-Kennzeichnung maschinenlesbar (Art. 50)** | ✅ `aiGenerated:true` + Header `X-AI-Generated`, Disclosure 1. Turn | ❌ kein Art.-50-Primitiv [W] | ❌ kein Art.-50-Primitiv [W] | ❌ kein Art.-50-Primitiv [W] | ❌ kein Art.-50-Primitiv [W] | ❌ kein Art.-50-Primitiv [W] | ❌ kein Art.-50-Primitiv [W] | ❌ kein Art.-50-Primitiv [W] |
| **Mandanten-/User-Isolation** | ✅ userId **nur** aus API-Key, Session-Scope `userId:sessionId` | ❌ Ein-Prozess, In-Memory, kein Multi-User/Auth [W] | ⚠️ `thread_id`-Namespacing, aber kein eingebautes Auth/Tenant-Enforcement | ⚠️ RBAC nur im Enterprise-Tier [R] | ❌ kein eingebauter Multi-User-Server (SDK) | ⚠️ Thread-/Resource-Scoping, kein eingebautes Auth/Tenant | ✅ Multi-Tenancy/RBAC im deepset-Enterprise-Stack [D] | ⚠️ User/Projekte/RBAC im Enterprise-Tier [N] |
| **On-Prem ohne Cloud-Zwang** | ✅ Ollama-first, `node:sqlite`, keine externen Calls | ✅ lokal lauffähig (Code-Exec-Sandbox nötig) [W] | ✅ OSS-Lib lokal; Observability/Audit drängt aber Richtung LangSmith | ✅ lokal lauffähig (lokale LLMs möglich) [W] | ⚠️ SDK lokal, aber OpenAI-Modell-orientiert; Default-Tracing zur OpenAI-Plattform [O] | ✅ lokal & modell-agnostisch (Ollama möglich) [W] | ✅ air-gapped/self-hosted ist Kern-Verkaufsargument [D] | ✅ self-host, EU (Berlin) [W] |
| **Betrieb ohne ML-Team (deps, Artefakt, Docker)** | ✅ `dependencies: {}`, ein Artefakt `dist/server-main.js`, Multi-Stage-Dockerfile | ⚠️ Python-Deps; CodeAgent braucht Sandbox (Code-Exec-Risiko) [W] | ❌ dependency-schwer (Bloat) [W] | ⚠️ Python, auf große Modelle ausgelegt [W] | ✅ lean TS, wenige Deps [W] | ✅ lean TS (~2 Deps) [W] | ⚠️ schwerer Stack, Enterprise-Preis [W] | ✅ No-Code, einfacher Betrieb [W] |
| **Metriken/Logs ohne Inhalte** | ✅ `GET /metrics` (Prometheus); Run-Log = nur Metadaten, „never message content" | ⚠️ OTel-Telemetrie vorhanden, erfasst standardmäßig Inhalte [W] | ⚠️ LangSmith-Traces reich, aber inhaltserfassend (Prompts/Outputs) [W] | ⚠️ Observability-Integrationen, inhaltserfassend [W] | ⚠️ Tracing eingebaut, aber zur OpenAI-Plattform & inhaltserfassend [O] | ⚠️ OTel-Telemetrie, inhaltserfassend [M] | ⚠️ Enterprise-Observability, inhaltserfassend [D] | ⚠️ Ausführungs-Logging + Prometheus (Enterprise); Execution-Data enthält Inhalte [N] |

\*Haystack-Audit-„✅" bezieht sich auf den **kostenpflichtigen deepset-Enterprise-/Sovereign-Stack**, nicht auf die frei einbettbare OSS-Bibliothek — das ist die im Wettbewerbs-Bericht benannte Plattform-Schwere.

## Nachweis pro minimal-harness-Zeile (selbst verifizierbar)

Jede Zeile ist deterministisch prüfbar — kein LLM-Judge. Testkommandos laufen mit
`npm test`; die Endpoints gegen einen laufenden Server (`docs/deployment.md`).

| Anforderung | Modul / Endpoint | Verifikation in einem Kommando |
|---|---|---|
| Audit-Log + Manipulationserkennung | `src/audit/audit-log.ts` (`verifyChain`, `pruneOlderThan`), `src/audit/with-audit.ts`, `GET /v1/audit/verify` → `{ok, brokenAtSeq?, events}` | `npm test -- audit-log` — u. a. *„builds a valid, verifiable hash chain across appends"*, *„detects tampering of a row and reports brokenAtSeq"*, *„detects deletion of the last row (chain truncation at the end)"* |
| HITL-Approval fail-closed | `src/server/agent-server.ts` (`requireApproval`, `streamApproval`, `POST /v1/agent/approvals/{id}`) | `npm test -- approval-gate` — *„deny → tool never runs"*, *„a different user cannot answer the approval (404), timeout denies fail-closed"*, *„non-streaming requests deny gated tools fail-closed"* |
| DSGVO-Auskunft/-Löschung | `GET /v1/sessions/{id}` (Art. 15), `DELETE /v1/sessions/{id}` (Art. 17), userId-gescoped | `npm test -- agent-server` — *„session API: lists, returns and deletes only the caller's sessions"* |
| KI-Kennzeichnung maschinenlesbar | `agent-server.ts`: `aiGenerated:true` + `X-AI-Generated`-Header + `disclosure` (1. Turn); Opt-out `AI_DISCLOSURE=false` | `npm test -- audit-server` — *„marks answers as AI-generated (field + header) and discloses on the first turn only"*, *„omits the AI-generated field and header when disabled"* |
| Mandanten-/User-Isolation | `agent-server.ts` + `src/server/auth.ts`: userId ausschließlich aus dem API-Key, Session-Key `userId:sessionId` | `npm test -- agent-server` — *„isolates sessions between users sharing the same sessionId"*, *„concurrency smoke: 20 parallel requests from 2 users over a real SQLite file stay isolated"* |
| On-Prem ohne Cloud-Zwang | Ollama-Backend, `node:sqlite`, `src/rag/` (`SqliteKnowledgeStore`); keine externen Netzwerk-Calls | `node -e "console.log(require('./package.json').dependencies)"` → `{}`; `docs/deployment.md` (Docker/systemd, alles lokal) |
| Betrieb ohne ML-Team | `dependencies: {}`, Build-Artefakt `dist/server-main.js`, Multi-Stage-`Dockerfile` | `node -e "console.log(require('./package.json').dependencies)"` → `{}`; `npm run build` → Boot-Smoke `/healthz` 200 (siehe `docs/mittelstand-validierung.md` §6f) |
| Metriken/Logs ohne Inhalte | `GET /metrics` (Prometheus); `recordRun()` schreibt eine JSON-Zeile — Kommentar *„metadata only, never message content"* | `npm test -- agent-server` — *„GET /metrics exposes request and run counters in Prometheus format"* |

**Retention (Art. 26(6)):** Der Audit-Log erzwingt eine Untergrenze von
`DEFAULT_RETENTION_DAYS = 186` (≥ 6 Monate). `pruneOlderThan(days)` löscht nur ein
zusammenhängendes Präfix und speichert einen Checkpoint-Hash, sodass `verifyChain`
ab dem Löschpunkt lückenlos weiterprüft — verifizierbar in `npm test -- audit-log`.

## Ehrliche Grenzen

Nachprüfbarkeit heißt auch, die eigenen Lücken zu benennen.

**Was Wettbewerber heute besser können:**

- **smolagents — Recherche-Ausdauer.** Der HF-`ToolCallingAgent`-Scaffold erzwingt
  Beharrlichkeit strukturell (`final_answer` ist der einzige Loop-Ausgang) und
  erreicht auf qwen3:8b **63–65 % pass@1** im Company-Test, gegen **50 %** unserer
  besten qwen-Config (`docs/mittelstand-validierung.md`). Die Lücke ist
  Recherche-Ausdauer, nicht Korrektheit — root-caused, aber offen.
- **Haystack/deepset — Enterprise-Reife.** Air-gapped Sovereign-Stack mit
  Enterprise-Support, Multi-Tenancy und Audit als Produkt-Default. Für Kunden, die
  einen Vertragspartner mit SLA statt einer einbettbaren Bibliothek wollen, ist das
  überlegen.
- **Plattform-UIs (n8n, Langdock, deepset).** Visuelle No-Code-/Low-Code-Oberflächen
  für Fachanwender. minimal-harness ist eine Entwickler-Bibliothek + Server — es gibt
  keine grafische Oberfläche.
- **LangGraph / OpenAI Agents SDK — HITL-Reife.** Beide haben ausgereifte,
  dokumentierte Interrupt-/Resume- bzw. `needsApproval`-Muster mit
  State-Serialisierung; unser Ansatz ist bewusst schlanker (SSE + fail-closed).

**Was bei uns offen ist:**

- **Kein WORM-Storage.** Der Audit-Log ist append-only + hash-verkettet
  (Manipulation *nachweisbar*), aber liegt in einer normalen SQLite-Datei — kein
  hardware-seitiges Write-Once-Read-Many, das Manipulation *verhindert*.
- **Kein RBAC auf Tool-Ebene.** User-/Mandanten-Isolation ist vorhanden, aber es
  gibt keine Rollen→Tool-Berechtigungsmatrix (Checkliste #5: „welcher Nutzer darf
  welches ERP-/Fileserver-Tool"). Freigabe ist heute pro Tool-Name global, nicht
  pro Rolle.
- **Kein automatischer Prune-Scheduler.** `pruneOlderThan()` existiert und ist
  getestet, muss aber extern getriggert werden (Cron/systemd-Timer) — kein
  eingebauter Retention-Scheduler.
- **Kein Betriebsrat-/Beschäftigten-Report** (Checkliste #9, Art. 26(7)/BetrVG). Die
  Rohdaten (Audit-Log, Tool-Registry) liegen vor, aber ein generierbarer
  Einsatz-Report für den Betriebsrat fehlt.

Diese vier Punkte sind bewusste Scope-Grenzen des „minimalen" Ansatzes, keine
verdeckten Mängel — sie stehen hier, damit die Matrix nachprüfbar bleibt.

## Quellen

**Code-Belege (minimal-harness):** verifizierbar im Repo — `src/audit/audit-log.ts`,
`src/audit/with-audit.ts`, `src/server/agent-server.ts`, `src/server/auth.ts`,
`src/rag/`, sowie die Tests `tests/audit-log.test.ts`, `tests/audit-server.test.ts`,
`tests/approval-gate.test.ts`, `tests/agent-server.test.ts`. Feature-Commit `de35f92`
(*„feat(compliance): hash-chained audit log (AI Act Art. 12/19) + Art. 50 AI disclosure"*).
Betriebsdoku: `docs/deployment.md`. Messungen: `docs/mittelstand-validierung.md`.

**Regulatorik & Wettbewerb (interne Berichte mit Primärquellen):**
`docs/research/2026-07-11-eu-regulatorik-agent-pflichten.md` (AI Act Art. 4/12/14/19/26/50,
DSGVO Art. 15/17/22/30/32, NIS2, DSK-OH, EDPB 28/2024) ·
`docs/research/2026-07-11-wettbewerbslandschaft-agent-harnesses.md` (Framework-Matrix,
Quell-URLs).

**Wettbewerber-Zellen — Kürzel:**
- **[W]** Wettbewerbs-Bericht (o. g.), inkl. dessen Quell-URLs.
- **[R]** Regulatorik-Bericht Abschnitt 5 („Compliance-Features nur in teuren
  Enterprise-Tiers — CrewAI Enterprise: SSO/RBAC/Audit").
- **[D]** deepset Haystack / Sovereign-Stack: https://www.deepset.ai/products-and-services/haystack ·
  https://www.deepset.ai/blog/sovereign-ai-deutschland-stack-and-haystack
- **[N]** n8n self-host/Enterprise (Log-Streaming, RBAC): https://docs.n8n.io/ ·
  Community-Threads zu Tool-Calling im Wettbewerbs-Bericht.
- **[O]** OpenAI Agents SDK (JS) — `needsApproval`/Interruptions + Tracing:
  https://openai.github.io/openai-agents-js/
- **[M]** Mastra — Workflow suspend/resume + Telemetrie: https://mastra.ai/

**Live nachrecherchiert am 2026-07-11 (Ergänzung/Korrektur zu den Berichten):**
- **[L] LangSmith Self-hosted-Audit — GEÄNDERT seit dem Bericht.** Der
  Wettbewerbs-Bericht notierte „Audit-Trail nur via Cloud-Produkt LangSmith".
  Aktueller Stand: Self-hosted LangSmith (Helm-Chart ≥ 0.12.33) bietet
  **tamper-resistant Audit-Logs im OCSF-Format** — aber (a) nur auf **Enterprise-Plänen**
  und **closed-source** (Self-host nur unter Enterprise-Vertrag), und (b) protokolliert
  ~70 **Administrations-/Konfigurationsaktionen** (API-Keys, User/Rollen, SSO), **nicht**
  die agentische Tool-Call-Ereigniskette. Deshalb ⚠️ statt ❌ in der Matrix.
  Quellen: https://docs.langchain.com/langsmith/audit-logs ·
  https://kb.langchain.com/articles/5478528798-enabling-audit-logs-in-self-hosted-langsmith ·
  https://www.langchain.com/blog/langsmith-langchain-oss-eu-ai-act
- **[S] smolagents HITL — TEILWEISE NEU seit dem Bericht.** Der Bericht notierte
  „kein Compliance-Layer". smolagents hat inzwischen **`step_callbacks` /
  `agent.interrupt()` und interaktive Plan-Customization-HITL** — aber in-process,
  ohne State-Serialisierung (Issue #364 offen) und ohne serverseitiges,
  fail-closed Pre-Dispatch-Tool-Gate. Deshalb ⚠️ (nicht ✅, nicht ❌) bei „HITL".
  Quelle: https://huggingface.co/docs/smolagents/en/examples/plan_customization
