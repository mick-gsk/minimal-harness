# Wettbewerbslandschaft: Agent-Harnesses für on-premise LLM-Agenten im europäischen Mittelstand (Stand 2025/2026)

> Erstellt von einem Opus-Recherche-Agenten. Zweck: Lücken-Matrix für die Positionierung des minimal-harness.

## Kernbefund vorweg

Die Landschaft zerfällt in **drei Lager**, und keines besetzt gleichzeitig alle vier Eigenschaften (minimal/zero-dep, DSGVO-nativ, klein-lokal-optimiert, deterministisch gemessen):

1. **OS-Agent-Frameworks (Python-first):** LangChain/LangGraph, CrewAI, AutoGen/AG2, LlamaIndex, smolagents, PydanticAI, Haystack. Technisch stark, aber dependency-schwer und implizit für **GPT-4-Klasse-Function-Calling** gebaut. DSGVO/Audit ist Bolt-on.
2. **Souveräne EU-Plattformen:** Aleph Alpha PhariaAI, Mistral/Le Chat Enterprise, deepset Haystack Enterprise, Langdock, localmind, meinGPT, Zive. DSGVO/Air-Gap top — aber schwere Plattformen, oft an eigene Modelle gebunden, hohe Seat-Minima. Kein embeddebarer Agent-Loop.
3. **Schlanke TypeScript-Frameworks:** OpenAI Agents SDK (JS), Mastra, VoltAgent, AXAR, Google ADK-TS. Lean — aber verlassen sich auf **natives/JSON-Tool-Calling** (das kleine Modelle reißen), ohne DSGVO/AI-Act-native Primitive.

## Die technische Grundlage der These ist belegt

**Kleine lokale Modelle scheitern reproduzierbar an naivem Tool-Calling:**
- ReAct-Benchmark: **Llama-3B rief über 9 Tasks kein einziges Mal ein Tool auf**; unter 7B ist Tool-Calling „ein Glücksspiel". Empfehlung: 3–5 Tools, Grammar + strikte Validierung. Modell-**Familie** schlägt Parameterzahl. (dev.to Llama-3B-Benchmark, promptquorum, bswen)
- GAIA klein: **Qwen3-8B 23,6 %, Qwen3-14B 22,4 %, Llama-3.1-8B 1,8 %** Basis; Härtungs-Framework EffGen hebt 7B von 12,5 % auf 21,9 % → **das Harness, nicht das Modell, macht den Unterschied.** (arXiv 2602.00887)
- 7B: **78 %** einfache Tool-Calls, aber nur **52 %** ReAct. (pooya.blog)
- **Code-Aktionen schlagen JSON-Tool-Calling um 2–7 pp** (HF structured-codeagent, beating-gaia).

**Compliance-Hebel belegt:**
- AI Act **Art. 12**: automatische Logs min. 6 Monate; **Art. 19**: Logs unter *eigener* Kontrolle → **Cloud-Logging genügt nicht, on-prem-Logging faktisch Pflicht.** Strafen bis 15 Mio €/3 %.
- LangGraph: **unbefristete Checkpoint-Retention = DSGVO-Problem**; Audit-Trail nur via **Cloud**-Produkt LangSmith.

## Kandidaten-Matrix

Skala: ++ stark / + ok / ~ teils / – schwach. „Klein-lokal" = Loop läuft *zuverlässig* auf 8–14B-Ollama-Klasse.

| Kandidat | Sprache/Deps | Klein-lokal | DSGVO/AI-Act-nativ | Ohne ML-Team | Klein-Modell-Zahlen | Hauptlücke |
|---|---|---|---|---|---|---|
| smolagents (CodeAgent) | Python, mittel | + | – | ~ (Sandbox nötig) | GAIA-Fokus | Kein Compliance-Layer; Code-Exec-Risiko |
| LangChain/LangGraph | Py/JS, **schwer** | ~ | ~ (Cloud-LangSmith; Retention-Risiko) | – (Bloat) | keine | Dependency-Bloat, Cloud-Audit |
| CrewAI | Python | ~ | ~ | ~ | 7B ReAct ~52 % | Auf große Modelle ausgelegt |
| AutoGen/AG2 | Python | ~ | – | – | – | Experimentell, API-Brüche |
| LlamaIndex | Python | + (RAG) | ~ | + | – | Agent-Loop dünn |
| Haystack/deepset | Python, mittel | + | **++ (air-gapped, Audit default, DE-Stack)** | ~ (Enterprise-Preis) | – | Schwerer Stack; keine Klein-Modell-Härtung |
| PydanticAI | Python | + | – | + | – | Kein Audit/HITL/Mandanten |
| OpenAI Agents SDK (TS) | TS, lean | ~ (natives TC) | – | + | – | Natives Tool-Calling; keine Compliance |
| Mastra | TS, ~2 Deps | ~ | – | + | – | JSON-TC, kein DSGVO-Layer |
| VoltAgent/AXAR | TS, lean | ~ | – | + | – | dito |
| Flowise | No-Code | ~ | ~ | + | – | Workday-übernommen; Loop nicht härtbar |
| n8n | No-Code, Berlin | ~ („kann keine Tools rufen"-Threads) | + (self-host EU) | ++ | – | Automations-Tool, kein Harness |
| Dify / RAGFlow | OS-Plattform | + | + (self-host) | + | – | Plattform, kein embeddebarer Kern |
| Aleph Alpha PhariaAI | Plattform, DE | ~ (eigene Modelle) | **++ (air-gapped, AI-Act-by-design)** | ~ | – | Modell-/Infra-gebunden; von Cohere übernommen |
| Mistral/Le Chat Enterprise | Plattform, FR | + (open-weight) | **++ (EU-Residency)** | ~ | – | Plattform, kein leichtes Harness |
| Langdock | Plattform, Berlin | – (Cloud-Frontier) | ++ | + | – | On-Prem erst ab **5.000 Seats** |
| localmind/meinGPT/Zive | Plattform, DACH | + | ++ | + | – | Chat-Plattform, kein Dev-Harness |

## Fazit: Die unbesetzte Lücke

Vier gleichzeitige Anforderungen eines 50–500-MA-Mittelständlers ohne ML-Team — **kein Anbieter erfüllt alle vier:**

- **A) Zuverlässiger Loop auf 8–14B lokal:** Nur smolagents adressiert das Protokoll-Problem (CodeAgent), aber Python + Code-Exec-Risiko + null Compliance.
- **B) DSGVO/AI-Act nativ:** Souverän-Plattformen haben es, aber als schwere Plattform (Langdock on-prem ab 5.000 Seats). Leichte Dev-Frameworks: **null** Art.-12-Logging, Löschkonzept, HITL, Mandanten.
- **C) Deploybar ohne ML-Team:** TS-lean ist nah dran, aber ohne Compliance nutzlos für regulierte Prozesse.
- **D) Deterministisch bewiesener Uplift:** **Niemand** führt diesen Beweis für die Ollama-Klasse.

> **Die Lücke in einem Satz:** Ein Mittelständler, der einen 8–14B-Ollama-Agenten für einen regulierten Prozess selbst betreiben will, findet heute entweder ein leichtes TS-Framework, das auf seinem Modell unzuverlässig tool-callt und kein DSGVO/AI-Act-Primitiv mitbringt — oder eine schwere, teure Souverän-Plattform, die er nicht als schlanke Bibliothek einbetten kann.

Das Harness gewinnt, wenn es vier sonst getrennte Dinge bündelt:
1. **Robustes Aktions-Protokoll + Validator + Retry** (smolagents-Einsicht in TS, zero-dep, ohne Code-Exec-Risiko) + Klein-Modell-Härtung.
2. **AI-Act-native Primitive im Kern:** Art.-12-Audit-Log unter eigener Kontrolle, Löschkonzept, HITL-Approval, Mandantenfähigkeit.
3. **Betreibbar ohne ML-Team:** `dependencies: {}`, Ollama-first, ein Artefakt, Docker.
4. **Deterministisch gemessener Uplift** als nachweisbare Kern-Aussage.

**Realismus-Hinweis:** GAIA-Zahlen (8–14B: ~20–24 %) heißen: Positionierung auf **enge, verifizierbare Business-Tasks** (Tool-Ketten, RAG-Abfragen, Extraktions-Workflows), nicht offene Autonomie.

**Neu entdeckte Rivalen im Auge behalten:** Mastra, VoltAgent, AXAR (direkteste technische TS-Rivalen), Google ADK-TS, meinGPT, Zive.

## Quellen

- Klein-Modell-Tool-Calling: https://dev.to/anak_wannaphaschaiyong_11/why-small-llms-fail-at-tool-calling-the-shocking-discovery-from-our-llama-3b-benchmark-5lg · https://www.promptquorum.com/power-local-llm/best-local-models-tool-calling-2026 · https://docs.bswen.com/blog/2026-03-21-local-llm-tool-calling-fails/ · https://arxiv.org/pdf/2602.00887 · https://pooya.blog/blog/ai-agents-frameworks-local-llm-2026/ · https://huggingface.co/blog/structured-codeagent · https://huggingface.co/blog/beating-gaia
- AI-Act-Logging: https://www.helpnetsecurity.com/2026/04/16/eu-ai-act-logging-requirements/ · https://predictionguard.com/blog/eu-ai-act-compliance-audit-log-what-regulators-expect-and-how-to-document-it · https://truescreen.io/insights/ai-act-record-keeping-requirements/
- LangGraph/LangChain: https://alicelabs.ai/en/insights/langgraph-guide-2026 · https://ravoid.com/blog/langchain-exit-raw-sdk-migration-2026
- Plattformen: https://www.deepset.ai/products-and-services/haystack · https://www.deepset.ai/blog/sovereign-ai-deutschland-stack-and-haystack · https://www.ki-company.ai/en/blog-beitraege/phariaai-put-to-the-test-sovereign-ai-platform-for-companies · https://schwarz-digits.de/en/product-portfolio/data-ai/aleph-alpha · https://futurumgroup.com/insights/cohere-acquires-aleph-alpha-a-deal-born-of-sovereignty-necessity/ · https://mistral.ai/news/le-chat-enterprise/ · https://langdock.com/security · https://langdock.com/pricing · https://meingpt.com/blog/localmind-alternative-sicherste-ki-plattformen-2025 · https://fast.io/resources/best-self-hosted-ai-agent-platforms/ · https://community.n8n.io/t/locally-hosted-llm-is-not-able-to-call-tools/138631
- TS-Frameworks: https://openai.github.io/openai-agents-js/ · https://mastra.ai/ · https://github.com/voltagent/voltagent · https://github.com/axar-ai/axar · https://localaimaster.com/blog/ollama-vercel-ai-sdk · https://langcopilot.com/posts/2025-11-01-best-multi-agent-ai-frameworks-2026
