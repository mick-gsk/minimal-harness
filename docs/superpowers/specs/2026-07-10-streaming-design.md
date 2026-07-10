# Streaming (Token-Streaming Ende-zu-Ende) — Design

**Teilprojekt 3 von 5 der Mittelstands-Roadmap.** Ziel: Token-Streaming vom Backend
bis zum Aufrufer der AgentLoop — gemessen über Time-to-first-Token (TTFT).

## Ausgangslage

Beide Adapter streamen bereits, wenn `onToken` in den `LLMGenerateOptions` steckt:
`OllamaClient` liest NDJSON, `OpenAiCompatAdapter` liest SSE. Was fehlt, ist die
Durchreichung durch die `DefaultAgentLoop` — Aufrufer der Loop kommen an die
Chunks nicht heran.

## Änderung

`AgentLoopInput` bekommt ein optionales `onToken?: (chunk: string) => void`.
Die Loop reicht es an die **Haupt-Turn-Aufrufe** von `llm.generate` weiter.

Bewusste Abgrenzung (dokumentiert):
- **Retry- und Verify-Aufrufe streamen nicht.** Sie sind Korrekturschleifen; ihr
  Output ersetzt ggf. den vorherigen — doppeltes Streamen würde dem Konsumenten
  widersprüchliche Chunks liefern.
- Im **Text-Protokoll-Modus** enthalten die Chunks Protokoll-Markup
  (`ACTION: …`) — der Konsument sieht die rohe Modellausgabe. Im
  `nativeToolCalling`-Modus ohne Tool-Turns ist der Stream die reine Antwort.

Kein neues Interface, keine neue Abstraktion — ein optionales Feld, das die
vorhandene Adapter-Fähigkeit nach außen führt.

## Validierung

1. **Jest:** Mock-Adapter, der bei gesetztem `onToken` den Content in Chunks
   emittiert. Erwartung: Chunks kommen beim Loop-Aufrufer an, über mehrere Turns;
   ohne `onToken` unverändertes Verhalten (kein Options-Feld gesetzt).
2. **GPU-PC (Probe):** `bench/ttft-probe.ts` misst TTFT (erster Chunk) vs.
   Gesamtlatenz, Streaming vs. Non-Streaming, identischer Prompt/Seed, N=5.
   Erwartung: TTFT ≪ Gesamtlatenz (der messbare UX-Gewinn); Gesamtlatenz
   vergleichbar (Streaming kostet praktisch nichts).
