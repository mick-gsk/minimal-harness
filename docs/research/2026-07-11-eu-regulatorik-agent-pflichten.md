# EU-Regulatorik für LLM-Agenten im Mittelstand — Recherchebericht (Stand Juli 2026)

> Erstellt von einem Opus-Recherche-Agenten im Auftrag des Orchestrators.
> Zweck: Feature-Ableitung für das minimal-harness („EU-ready Agent-Harness").

## 0. Kernaussage vorab (First Principles)

Für einen **internen LLM-Agenten** (Recherche-Assistent / Dokumenten-Extraktion mit Tool-Zugriff auf ERP/Fileserver) gilt regulatorisch eine **Zweiteilung**, die man sauber trennen muss:

- **Immer** anwendbar, unabhängig von der Risikoklasse: **AI Act Art. 4 (KI-Kompetenz)** und **Art. 50 (Transparenz)** sowie das **gesamte DSGVO-Regime** (personenbezogene Daten landen fast garantiert im Agenten). Das ist der Pflichtteil, der praktisch jeden KMU-Betreiber trifft.
- **Nur bei High-Risk-Nutzung** (Annex III: Personalauswahl, Bonitätsbewertung, kritische Infrastruktur etc.): das schwere Paket **Art. 26 (Betreiberpflichten), Art. 14 (Human Oversight), Art. 12/19 (Logging), Art. 27 (FRIA)**.

**Wichtig:** Es gibt **keine „interne Nutzung"-Ausnahme** im AI Act. Ein reiner Recherche-/Zusammenfassungs-Assistent ist i. d. R. **minimal/limited risk**. Genau *derselbe* Agent wird aber **high-risk**, sobald er in einem Annex-III-Kontext eingesetzt wird (z. B. Kandidaten-Ranking im Recruiting, Mitarbeiter-Performance, Kreditvergabe). Ein „EU-ready" Harness muss deshalb so gebaut sein, dass es den *schweren* Pflichtenkatalog per Konfiguration einschalten kann — das ist das eigentliche Verkaufsargument.

## 1. Fristen-Übersicht — inkl. „Digital Omnibus"-Verschiebung (kritisches 2026-Update)

Die ursprünglichen AI-Act-Fristen wurden durch das **Digital/AI-Omnibus-Paket** (Kommissionsvorschlag 19.11.2025, politische Einigung Rat/Parlament 07.05.2026, Parlaments-Zustimmung 16.06.2026, finale Rats-Zustimmung 29.06.2026, Inkrafttreten mit Veröffentlichung im Amtsblatt) **entschärft**:

| Datum | Was gilt | Status |
|---|---|---|
| **02.02.2025** | Verbotene Praktiken (Art. 5) **+ KI-Kompetenz (Art. 4)** anwendbar | in Kraft |
| **02.08.2025** | GPAI-Pflichten, Governance-Struktur, Sanktionsregime | in Kraft |
| **02.08.2026** | **Art. 50 Transparenzpflichten** anwendbar; Enforcement Art. 4 startet | gilt |
| **02.12.2026** | Maschinenlesbare Kennzeichnung Bestands-GenAI (Art. 50(2)); neue Verbote (NCII/CSAM) | neu |
| **02.08.2027** | KI-Reallabore (national) | verschoben (+1 J.) |
| **02.12.2027** | **High-Risk Annex III** (nutzungsbasiert) — inkl. Art. 12/14/26/27 | **verschoben** von 02.08.2026 |
| **02.08.2028** | **High-Risk Annex I** (produktintegriert) | verschoben von 02.08.2027 |

**Konsequenz fürs Produkt-Framing:** Die schweren High-Risk-Pflichten sind nun bis **Ende 2027** aufgeschoben — Zeit, aber kein Grund zur Untätigkeit, weil Standards/Normen erst entstehen. **Art. 4 und Art. 50 sowie die DSGVO sind dagegen *jetzt* scharf.** Für Marketing gilt: nicht mit „ab August 2026 High-Risk-Pflicht" argumentieren (das ist überholt), sondern mit dem *unmittelbar* geltenden Pflichtteil + „High-Risk-ready bis 2027".

## 2. EU AI Act — konkrete Betreiberpflichten (in Software abbildbar)

**Art. 4 KI-Kompetenz (Pflicht, gilt seit 02/2025, für alle Risikoklassen):** Betreiber müssen ausreichende KI-Kompetenz des Personals sicherstellen. Softwareseitig abbildbar als: rollenbasierte Onboarding-Hinweise, dokumentierte Nutzerbelehrung, Nachweis wer geschult/eingewiesen wurde.

**Art. 50 Transparenz (Pflicht ab 08/2026):** Vier Fallgruppen relevant — (a) Nutzer muss erkennen, dass er mit einem KI-System interagiert; (b) maschinenlesbare Markierung synthetischer Ausgaben; (c) Deepfake-Offenlegung; (d) Kennzeichnung KI-generierter Texte von öffentlichem Interesse *außer* bei menschlicher Redaktionsverantwortung. Für den internen Recherche-Assistenten praktisch: **klare KI-Kennzeichnung im Output** und, wo Inhalte extern publiziert werden, maschinenlesbare Markierung.

**Art. 26 Betreiberpflichten (nur High-Risk, ab 12/2027):** Nutzung gemäß Anleitung; **menschliche Aufsicht durch kompetente Personen zuweisen**; Sicherstellung relevanter Eingabedaten; **Monitoring des Betriebs**; **automatisch erzeugte Logs mindestens 6 Monate aufbewahren** (Art. 26(6)); bei Risiko-/Vorfall Provider + Marktaufsicht informieren und Nutzung ggf. aussetzen; **Beschäftigte/Betriebsrat informieren** bei Einsatz am Arbeitsplatz.

**Art. 14 Human Oversight (nur High-Risk):** System muss so gestaltet sein, dass wirksame menschliche Aufsicht möglich ist (Eingreifen, Stopp, „Human-in-the-loop"). Betreiber muss Aufsicht organisatorisch sicherstellen — Softwareseite: **Approval-Gates / Stop-Button / Override**.

**Art. 12 + Art. 19 Record-keeping (nur High-Risk):** Automatische Ereignisaufzeichnung über die Lebensdauer; Mindest-Aufbewahrung 6 Monate. Für einen Agenten heißt „Ereignis" konkret: jeder Tool-Call, jede Eingabe, jede Entscheidung.

**Art. 27 FRIA (nur High-Risk, spezielle Betreiber):** Grundrechte-Folgenabschätzung *vor* Inbetriebnahme — v. a. öffentliche Stellen, Betreiber öffentlicher Dienste, Bonitäts-/Versicherungs-Scoring. **Kann eine bestehende DSGVO-DSFA teilweise miterfüllen.**

## 3. DSGVO — was das Agent-System technisch können muss

Das ist der **härteste Pflichtteil für den KMU**, weil personenbezogene Daten unvermeidlich durch den Agenten fließen (ERP, Fileserver, Chatverläufe).

- **Art. 15 Auskunft:** System muss auf Betroffenen-ID alle verarbeiteten personenbezogenen Daten *auffindbar* machen — auch in Prompt-Historie, RAG-Index, Logs, Tool-Outputs.
- **Art. 17 Löschung („Recht auf Vergessenwerden"):** gezielte Löschung einer Person aus Chat-Historie, Vektor-/RAG-Index und Caches. Die **EDPB Opinion 28/2024** setzt eine *hohe* Anonymitäts-Schwelle: ein Modell gilt nur dann als anonym, wenn Personen weder identifizierbar noch per Query extrahierbar sind — praktisch heißt das: Retrieval-Schicht/Index muss löschbar sein, nicht „im Modellgewicht versteckt".
- **Art. 30 Verzeichnis von Verarbeitungstätigkeiten (VVT):** Zwecke, Datenkategorien, Empfänger dokumentieren — ableitbar aus einer sauberen Tool-/Datenfluss-Registry.
- **Art. 32 TOMs:** Verschlüsselung, Zugriffskontrolle, Pseudonymisierung, Belastbarkeit — überschneidet sich mit NIS2.
- **Art. 35 DSFA:** bei hohem Risiko (automatisierte Verarbeitung, große Datenmengen) verpflichtend; komplementär zur AI-Act-FRIA.
- **Art. 22 (relevant, oft übersehen):** Verbot rein automatisierter Einzelentscheidungen mit rechtlicher Wirkung → Agent darf solche Aktionen nicht ohne menschliche Freigabe auslösen.

**Behörden-Konkretisierung:** Die **DSK-Orientierungshilfe „KI und Datenschutz" (06.05.2024)** fokussiert explizit auf **LLMs** und liefert eine Checkliste für Auswahl/Einsatz: Zweckbindung, Rechtsgrundlage, Transparenz, **Verbot automatisierter Letztentscheidungen**, Betroffenenrechte, Korrektur/Fine-Tuning bei falschen Ausgaben, Richtigkeit der Ergebnisse. Die **EDPB Opinion 28/2024** klärt Anonymität, berechtigtes Interesse als Rechtsgrundlage (3-Stufen-Test) und Folgen unrechtmäßigen Trainings.

## 4. NIS2 (soweit fürs Harness relevant)

Das deutsche **NIS2UmsuCG** ist am **06.12.2025** im BGBl. verkündet und gilt **ohne Übergangsfrist**; ~29.500 Unternehmen betroffen (ab 50 MA *oder* 10 Mio. € Umsatz in regulierten Sektoren). Registrierungspflicht war 06.03.2026. Für ein Agent-Harness direkt relevant sind zwei der zehn Risikomanagement-Maßnahmen: **(7) Zugriffskontrolle & Authentifizierung** (Konzepte, MFA) und **(10) Netzwerk-Monitoring/Logging**. Plus **Meldepflichten** (24 h Erstmeldung / 72 h / 1 Monat Abschluss) — was ein revisionssicheres Log praktisch voraussetzt. Bußgelder bis 10 Mio. € / 2 % Weltumsatz.

## 5. Wettbewerbslücke — was LangChain/AutoGen/CrewAI heute NICHT eingebaut haben

Klar recherchierte Marktlücke, die ein Differenzierungsmerkmal ist:

- **Keine der großen Frameworks liefert Governance „built-in".** Sie orchestrieren Tool-Calls, bieten aber **keine Out-of-Process-Approval-Gates vor riskanten Aktionen** — man muss extra „Control Planes" danebenstellen.
- **Audit-Lücke:** Frameworks loggen nach *stdout*; es fehlen **strukturierte, abfragbare, unveränderliche (immutable) Audit-Logs**. Ein Agent ist ohne das ein „shadow user mit Vollzugriff und null Nachvollziehbarkeit". Der dynamische Ausführungspfad macht die Rekonstruktion der Ereigniskette nachträglich fast unmöglich — genau das, was Art. 12/26(6) und NIS2 verlangen.
- **Compliance-Features nur in teuren Enterprise-Tiers** (CrewAI Enterprise: SSO/RBAC/Audit; SOC-2 teils noch offen) — nicht im offenen Framework.

**Fazit für die These des Harness:** Ein schlankes, lokal-first Harness, das **Audit-Log, Approval-Hooks, KI-Kennzeichnung und DSGVO-Löschbarkeit als deterministische Kernfeatures** mitbringt, besetzt genau die Lücke, die die Platzhirsche in kostenpflichtige Add-ons ausgelagert haben.

## 6. Feature-Checkliste „EU-ready Agent-Harness" (priorisiert, Pflicht vs. Kür)

Priorisierung nach **Idiot-Index** (Aufwand ÷ Wert): billig + hoher Pflicht-Nutzen zuerst. „Pflicht" = ergibt sich unmittelbar aus geltendem Recht für typische KMU-Nutzung; „bedingte Pflicht" = nur bei High-Risk-Einsatz; „Kür" = starkes Verkaufsargument, rechtlich (noch) nicht zwingend.

| # | Feature | Rechtsgrundlage | Software-Umsetzung | Status |
|---|---|---|---|---|
| 1 | **Revisionssicheres Audit-Log jedes Tool-Calls** (append-only/immutable, Input+Output+Zeitstempel+Nutzer, Retention-Policy ≥ 6 Monate) | AI Act Art. 12/19/26(6); NIS2 Logging; DSGVO Art. 5(2) Rechenschaft | Strukturiertes, hash-verkettetes Event-Log jeder Loop-Iteration; konfigurierbare Retention; Export für Marktaufsicht | **Pflicht** (High-Risk) / dringend empfohlen sonst |
| 2 | **KI-Kennzeichnung im Output** (Interaktionshinweis „Sie sprechen mit KI"; maschinenlesbare Markierung generierter Inhalte) | AI Act Art. 50(1)(2)(4) | Standardisierter Output-Header/Disclaimer; optional C2PA-/Metadaten-Markierung bei Publikation | **Pflicht** ab 08/2026 |
| 3 | **Erzwungener Approval-Hook für Aktionskategorien** (schreibende/irreversible Tool-Calls, personenbezogene Entscheidungen → Human-in-the-loop, Stop/Override) | AI Act Art. 14; DSGVO Art. 22 (keine autom. Letztentscheidung); DSK-OH | Tool-Policy mit Kategorien (read/write/personal); Pre-Dispatch-Gate; Approve/Reject/Timeout; Stop-Button | **Pflicht** (High-Risk) / stark empfohlen |
| 4 | **DSGVO-Löschbarkeit & Auskunft nach Betroffenen-ID** (targeted delete aus Historie, RAG-Index, Caches, Logs; Auskunfts-Export) | DSGVO Art. 15/17; EDPB 28/2024 | Subject-ID-Tagging aller gespeicherten Datenpunkte; Delete-/Export-API über Vektorindex + Historie | **Pflicht** |
| 5 | **Zugriffskontrolle & Authentifizierung auf Tool-Ebene** (RBAC: welcher Nutzer/Agent darf welches ERP-/Fileserver-Tool; MFA-fähig) | NIS2 (7); DSGVO Art. 32; AI Act Art. 26 | Rollen-→Tool-Berechtigungsmatrix; Least-Privilege-Default; Auth-Hook | **Pflicht** (NIS2-Unternehmen) / empfohlen |
| 6 | **Datenfluss-/Tool-Registry als VVT-Baustein** (welche Tools, welche Datenkategorien, welche Zwecke/Empfänger) | DSGVO Art. 30; AI Act Art. 26 Monitoring | Deklarative Tool-Manifeste (purpose, data categories); automatisch generierter VVT-Auszug | **Pflicht** |
| 7 | **Eingabedaten-Kontrolle & Monitoring/Drift-Signale** (Input-Relevanz, Fehler-/Halluzinations-Flags) | AI Act Art. 26(1)(4) | Input-Validierung; Confidence-/Verifikations-Check (vgl. verifyFinalAnswer); Anomalie-Alerts | bedingte **Pflicht** (High-Risk) |
| 8 | **TOMs: Verschlüsselung & Pseudonymisierung im Datenfluss** (at-rest/in-transit; PII-Redaction vor Prompt) | DSGVO Art. 32; NIS2 | Verschlüsselte Log-/Index-Speicher; optionaler PII-Redaction-Filter vor LLM-Call | **Pflicht** |
| 9 | **Beschäftigten-/Betriebsrat-Transparenz-Report** (Nachweis bei Einsatz am Arbeitsplatz) | AI Act Art. 26(7); BetrVG | Generierbarer Einsatz-Report (welche Aufgaben, welche Daten) | bedingte **Pflicht** (High-Risk am Arbeitsplatz) |
| 10 | **KI-Kompetenz-/Onboarding-Nachweis** (rollenbasierte Nutzerbelehrung, Einweisungs-Log) | AI Act Art. 4 | Pflicht-Hinweis beim ersten Einsatz; dokumentierter Nachweis | **Pflicht** (seit 02/2025) |
| 11 | **DSFA/FRIA-Assistent** (vorausgefüllte Vorlage aus Tool-Registry + Datenflüssen; DSFA↔FRIA-Mapping) | DSGVO Art. 35; AI Act Art. 27 | Export einer DSFA/FRIA-Rohfassung aus Metadaten; Wiederverwendung DSFA→FRIA | **Kür** (Pflicht nur High-Risk/spez. Betreiber) |
| 12 | **Vorfall-/Incident-Export für Meldepflichten** (24 h/72 h-Report-Vorlage) | NIS2 Meldepflichten; AI Act Art. 26 | Ein-Klick-Incident-Bündel aus Audit-Log | **Kür** (Pflicht NIS2-Unternehmen) |

## 7. Quellen

**EU AI Act — Pflichten & Artikel**
- Art. 26 Betreiberpflichten: https://artificialintelligenceact.eu/article/26/ · https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-26
- Art. 50 Transparenz: https://artificialintelligenceact.eu/article/50/ · https://ai-act-law.eu/de/artikel/50/ · https://artificialintelligenceact.eu/transparency-rules-article-50/
- Art. 4 KI-Kompetenz: https://artificialintelligenceact.eu/article/4/ · https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers
- Art. 14 Human Oversight / Art. 12 Record-keeping: https://artificialintelligenceact.eu/article/12/ · https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-14
- Art. 27 FRIA: https://securiti.ai/eu-ai-act/article-27/ · https://digital.nemko.com/insights/fundamental-rights-impact-assessments-frias-under-the-eu-ai-act-what-you-need-to-know
- Risikoklassifizierung (interne Nutzung, keine Ausnahme): https://blog.premai.io/eu-ai-act-llm-guide-high-risk-classification-documentation-requirements-2026-deadlines/ · https://www.glocertinternational.com/resources/guides/eu-ai-act-risk-classification-playbook/

**Fristen / Digital Omnibus (2026-Update)**
- Offizielle Timeline: https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act
- Rat/Consilium 07.05.2026: https://www.consilium.europa.eu/en/press/press-releases/2026/05/07/artificial-intelligence-council-and-parliament-agree-to-simplify-and-streamline-rules/
- Kanzlei-Analysen Omnibus-Verschiebung: https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/ · https://www.cooley.com/news/insight/2025/2025-11-24-eu-ai-act-proposed-digital-omnibus-on-ai-will-impact-businesses-ai-compliance-roadmaps · https://www.insideprivacy.com/artificial-intelligence/eu-ai-act-update-timeline-relief-targeted-simplification-and-new-prohibitions/

**DSGVO / Behörden**
- DSK-Orientierungshilfe KI und Datenschutz (PDF, 06.05.2024): https://www.datenschutzkonferenz-online.de/media/oh/20240506_DSK_Orientierungshilfe_KI_und_Datenschutz.pdf · https://www.ldi.nrw.de/dsk-orientierungshilfe-ki-fuer-unternehmen-und-behoerden
- EDPB Opinion 28/2024 (PDF): https://www.edpb.europa.eu/system/files/2024-12/edpb_opinion_202428_ai-models_en.pdf · https://iapp.org/news/a/edpb-weighs-in-on-key-questions-on-personal-data-in-ai-models

**NIS2**
- NIS2UmsuCG Deutschland: https://www.secjur.com/blog/nis2-umsetzung · https://www.grantthornton.de/themen/2026/umsetzung-von-nis-2-in-deutsches-recht-neue-anforderungen-an-cybersicherheit-im-unternehmen/

**Wettbewerber-Lücke (Frameworks)**
- Governance-/Audit-Gap: https://www.loginradius.com/blog/engineering/auditing-and-logging-ai-agent-activity · https://microsoft.github.io/agent-governance-toolkit/

---

**Hinweis zur Verlässlichkeit:** Die zentrale Fristen-Aussage (High-Risk Annex III verschoben von 02.08.2026 auf **02.12.2027** via Digital-Omnibus) stützt sich auf mehrere übereinstimmende Kanzlei-Quellen und die Consilium-Pressemitteilung; die formale Amtsblatt-Veröffentlichung sollte vor finaler Kommunikation an einen Kunden noch gegen EUR-Lex geprüft werden. Die *unmittelbar geltenden* Pflichten (Art. 4, Art. 50, DSGVO, NIS2) sind davon unberührt und bilden das belastbare Fundament der Feature-Checkliste.
