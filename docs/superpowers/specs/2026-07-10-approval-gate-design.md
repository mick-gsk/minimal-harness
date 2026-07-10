# Approval-Gate (Human-in-the-Loop) — Design

**Teilprojekt 6e der Mittelstands-Roadmap.** Marktbezug: Die wertvollsten
KMU-Automationen führen **schreibende** Aktionen aus (ERP-Buchung, E-Mail-Versand,
Bestellfreigabe). Vertrauensbedingung im Mittelstand — und Argument im
EU-AI-Act-Kontext (menschliche Aufsicht) — ist, dass ein Mensch solche Aktionen
freigibt, bevor sie passieren.

## Loop-Ebene (Library)

`AgentLoopDeps.onToolApproval?: (call: {name, arguments}) => Promise<boolean>` —
wird, wenn gesetzt, **vor jeder Tool-Ausführung** gefragt (beide Pfade,
Text-Protokoll und nativ; bei `parallelToolCalls` sequenziell vor dem Batch-Start).

- `true` → Ausführung wie bisher.
- `false` → Tool wird **nicht** ausgeführt; der Fehler-Record
  `"not executed: denied by approval policy"` geht als Tool-Message zurück ans
  Modell (Muster wie Cap-Drop-Feedback) — kein Phantom-Erfolg, das Modell kann
  sich dem Nutzer gegenüber ehrlich erklären.

Wer den Hook nicht setzt, hat exakt das bisherige Verhalten.

## Server-Ebene

`AgentServerOptions.requireApproval?: string[]` (Tool-Namen) +
`approvalTimeoutMs` (Default 120 000 — Menschen brauchen Zeit, aber ein Run darf
nicht ewig hängen; Timeout ⇒ **deny**, fail-closed).

Ablauf (nur im SSE-Modus, weil der Client in-flight informiert werden muss):
1. Agent will gated Tool ausführen → Server sendet
   `event: approval_request` `{approvalId, tool, arguments}` und parkt den Run.
2. Client antwortet `POST /v1/agent/approvals/{approvalId}` `{approve: bool}`
   (nur derselbe User; fremde/unbekannte IDs → 404).
3. approve → Ausführung; deny/Timeout → Denial-Record ans Modell.

**Non-Streaming-Requests mit gated Tool → automatisches Deny** (dokumentiert):
ohne Rückkanal gibt es keine Freigabe — fail-closed statt stiller Ausführung.

## Validierung (Jest)

Loop: approve → Tool läuft; deny → Denial-Record, Modell antwortet weiter;
parallel-Modus fragt vor Batch-Start. Server (SSE): approval_request-Event →
approve → Tool ausgeführt + result; deny → Denial im Verlauf; Timeout (kurz
konfiguriert) → deny; fremder User kann nicht freigeben (404); non-stream mit
gated Tool → deny-Pfad.
