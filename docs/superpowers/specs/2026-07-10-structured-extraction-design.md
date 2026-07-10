# Strukturierte Extraktion (responseSchema) — Design

**Teilprojekt 6c der Mittelstands-Roadmap.** Marktbezug (Recherche 2026-07-10):
Die KMU-Anwendungsfälle mit dem klarsten ROI — Rechnungs-/Bestellverarbeitung
(12–25 €/Dokument manuell vs. 2–4 € mit KI), Angebotserstellung, E-Mail-Triage —
sind alle „unstrukturierter Text rein → validiertes JSON raus". Genau diese
Fähigkeit bekommt die Loop als Vertrag, nicht als Hoffnung.

## Änderung

`AgentLoopInput.responseSchema?: ToolInputSchema` (pro Run, auch im Server-Body).
Wenn gesetzt:

1. **Prompt-Vertrag:** Die System-Instruktion bekommt einen Block „Your final
   answer must be a single valid JSON object matching this schema: …" —
   das Modell kennt das Zielformat von Anfang an.
2. **Validierung am Ende:** Der finale Antworttext wird JSON-geparst
   (Code-Fences werden toleriert und entfernt) und gegen das Schema geprüft —
   mit dem vorhandenen `validateToolInput` aus `tools/schema.ts`.
3. **Korrektur-Retry:** Bei Parse-/Schema-Fehler geht der konkrete Fehler als
   Korrektur-Prompt zurück ans Modell (max. `defaultRetryStrategy.maxRetries`,
   wie beim Text-Protokoll). Danach: `terminatedReason: "validation_failed"` —
   ein Unternehmen bekommt **nie** stillschweigend kaputtes JSON.
4. **Ergebnis:** `AgentLoopResult.structuredAnswer?: unknown` — das geparste,
   validierte Objekt; `finalAnswer` bleibt der Rohtext (Kompatibilität).

Gilt für beide Pfade (Text-Protokoll und `nativeToolCalling`).

## Nebenbei: Validator-Lücke schließen

`validateToolInput` prüft laut Docstring „required fields and property types",
implementiert Typen aber nicht. Ergänzt um Typ-Checks (string/number/boolean/
array/object) — zugleich härtet das die Tool-Argument-Validierung.

## Validierung

1. **Jest:** Schema landet im System-Prompt; ungültiges JSON → Retry mit
   Fehlertext → gültige Antwort wird `structuredAnswer`; Code-Fence-JSON wird
   akzeptiert; dauerhaft ungültig → `validation_failed`; Typfehler
   (`"amount": "viel"` statt number) wird abgewiesen; ohne `responseSchema`
   unverändertes Verhalten.
2. **GPU-Probe (`bench/extraction-probe.ts`):** 5 deutsche Beleg-/Bestell-Texte
   mit Ground-Truth-Feldern, gemessen wird **Feld-Genauigkeit** (exakter
   Vergleich) mit `responseSchema` (Vertrag + Retry) vs. reinem
   Prompt-Wunsch („antworte als JSON") — llama3.1, Seeds 1001–1005.
