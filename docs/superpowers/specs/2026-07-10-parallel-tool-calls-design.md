# Parallele Tool-Calls — Design

**Teilprojekt 4 von 5 der Mittelstands-Roadmap.** Ziel: mehrere native Tool-Calls
eines Turns nebenläufig ausführen — gemessen und validiert.

## Wo Parallelität überhaupt entsteht

Im **Text-Protokoll** erlaubt das Format genau einen Call pro Antwort — dort gibt es
nichts zu parallelisieren. Nur der **native Pfad** (`nativeToolCalling` bzw. Backends
mit `tool_calls[]`) liefert mehrere Calls pro Turn. Deshalb setzt die Änderung
ausschließlich dort an.

Der messbare Gewinn liegt im **Executor**, nicht im Modell: bei k unabhängigen Calls
mit Latenz t fällt die Tool-Phase von k·t auf ~t. Die Validierung braucht dafür kein
LLM — sie misst den Executor direkt (deterministisch, ohne GPU).

## Änderung

`AgentLoopDeps.parallelToolCalls?: boolean` (Default `false` — Verhalten bleibt
unverändert, Opt-in wie `nativeToolCalling`).

Bei `true` im nativen Pfad:
1. **Policy zuerst, vollständig:** alle akzeptierten Calls werden gegen
   `isToolAllowed` geprüft, bevor irgendeiner startet (bisher konnte ein
   Policy-Verstoß mitten in der Sequenz abbrechen — halb ausgeführte Turns).
2. **Ausführung:** `Promise.all` über `executeToolSafely` (Fehler sind dort schon
   als Error-Records gekapselt; ein fehlschlagendes Tool reißt den Turn nicht ab).
3. **Determinismus:** Ergebnisse werden in **Aufruf-Reihenfolge** in toolTrace und
   Memory geschrieben, unabhängig von der Fertigstellungs-Reihenfolge —
   reproduzierbare Transcripts trotz Nebenläufigkeit.

Cap (`maxToolCallsPerTurn`) und Dropped-Call-Feedback bleiben unverändert davor.

## Validierung

**Jest, deterministisch (kein Timing-Flake):**
- Nebenläufigkeits-Zähler im Mock-Tool: `maxConcurrent === n` bei parallel,
  `=== 1` bei sequenziell.
- Reihenfolge-Garantie: Tool B wird vor Tool A fertig → toolTrace bleibt [A, B].
- Fehler-Isolation: ein Call schlägt fehl → übrige liefern, Error-Record korrekt.
- Policy: verbotener Call im Batch → Turn wirft, kein Tool wurde gestartet.

**Wall-Time-Messung (Perf-Smoke im Testoutput, kein Gate):** zwei Tools à ~100 ms —
gemessene Zeiten für sequenziell vs. parallel werden geloggt und in der
Ergebnis-Doku festgehalten. Kein GPU-Lauf nötig (Begründung oben).
