import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

/**
 * Revisionssicheres, hash-verkettetes Audit-Log (AI Act Art. 12/19/26(6), NIS2).
 *
 * Jede Zeile trägt den Hash der Vorgängerzeile: manipuliert oder entfernt man
 * eine Zeile, bricht die Kette an genau dieser Stelle — deterministisch per
 * `verifyChain()` nachweisbar, ohne LLM-Judge. Append-only: es gibt bewusst
 * keine update/delete-Methoden außer der dokumentierten Retention-Löschung.
 */

export type AuditEventType =
  | "run_start"
  | "tool_call"
  | "tool_result"
  | "approval"
  | "final_answer"
  | "run_end";

export interface AuditEventInput {
  userId: string;
  sessionId: string;
  event: AuditEventType;
  payload?: unknown;
}

export interface AuditRow {
  seq: number;
  ts: number;
  userId: string;
  sessionId: string;
  event: AuditEventType;
  payload: unknown;
  prevHash: string;
  hash: string;
}

export interface VerifyResult {
  ok: boolean;
  /** Seq der ersten Zeile, an der die Kette bricht (fehlt, wenn ok). */
  brokenAtSeq?: number;
}

export interface AuditExportFilter {
  userId?: string;
  sessionId?: string;
  event?: AuditEventType;
  sinceTs?: number;
  untilTs?: number;
}

export interface AuditLogOptions {
  /**
   * Max. serialisierte Bytes eines tool_result-Payloads, bevor gekürzt wird.
   * Tool-Ausgaben (Dateiinhalte, Query-Dumps) können beliebig groß werden;
   * das Log soll die Ereigniskette dokumentieren, kein Datensee sein.
   */
  maxPayloadBytes?: number;
  /**
   * Aufbewahrungs-Untergrenze in Tagen. Art. 26(6) AI Act verlangt mind.
   * 6 Monate automatisch erzeugte Logs — 186 Tage decken jeden 6-Monats-Block
   * (auch 31-Tage-Monate) sicher ab.
   */
  retentionDays?: number;
  /** Injizierbare Uhr für Tests. */
  now?: () => number;
}

/** 6 Monate ≈ 186 Tage — deckt jeden Kalender-Halbjahresblock ab (Art. 26(6)). */
export const DEFAULT_RETENTION_DAYS = 186;

const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024;

/** Verankerung der Kette, wenn nie etwas gelöscht wurde. */
const GENESIS = "0".repeat(64);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS audit_events (
  seq        INTEGER PRIMARY KEY,
  ts         INTEGER NOT NULL,
  user_id    TEXT    NOT NULL,
  session_id TEXT    NOT NULL,
  event      TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  prev_hash  TEXT    NOT NULL,
  hash       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events(ts);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_events(session_id, seq);
CREATE TABLE IF NOT EXISTS audit_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

interface EventRow {
  seq: number;
  ts: number;
  user_id: string;
  session_id: string;
  event: string;
  payload: string;
  prev_hash: string;
  hash: string;
}

export class AuditLog {
  private readonly db: DatabaseSync;
  private readonly maxPayloadBytes: number;
  private readonly retentionDays: number;
  private readonly now: () => number;
  private closed = false;

  constructor(path: string, options: AuditLogOptions = {}) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA user_version = 1");
    this.db.exec(SCHEMA);
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.now = options.now ?? Date.now;
    if (this.getMeta("next_seq") === undefined) this.setMeta("next_seq", "1");
  }

  /**
   * Hängt ein Ereignis an das Ende der Kette. Synchron (DatabaseSync), damit
   * Reihenfolge und Verkettung auch bei parallelen Tool-Calls atomar bleiben.
   */
  append(input: AuditEventInput): AuditRow {
    const seq = Number(this.getMeta("next_seq") ?? "1");
    const ts = this.now();
    const payloadJson = this.serializePayload(input.event, input.payload);
    const prevHash = this.tailHash();
    const hash = rowHash({
      seq,
      ts,
      userId: input.userId,
      sessionId: input.sessionId,
      event: input.event,
      payloadJson,
      prevHash,
    });

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "INSERT INTO audit_events (seq, ts, user_id, session_id, event, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(seq, ts, input.userId, input.sessionId, input.event, payloadJson, prevHash, hash);
      this.setMeta("next_seq", String(seq + 1));
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }

    return {
      seq,
      ts,
      userId: input.userId,
      sessionId: input.sessionId,
      event: input.event,
      payload: JSON.parse(payloadJson) as unknown,
      prevHash,
      hash,
    };
  }

  /**
   * Prüft die gesamte Kette deterministisch neu: jede Zeile wird nachgerechnet
   * und gegen ihren gespeicherten Hash sowie den Vorgänger-Hash geprüft. Nach
   * einer Retention-Löschung setzt die Prüfung am gespeicherten Checkpoint-Hash
   * an (siehe pruneOlderThan). Erkennt auch das Abschneiden am Ende der Kette
   * (Vergleich der höchsten Seq mit dem Zähler next_seq).
   */
  verifyChain(): VerifyResult {
    const rows = this.db
      .prepare("SELECT seq, ts, user_id, session_id, event, payload, prev_hash, hash FROM audit_events ORDER BY seq")
      .all() as unknown as EventRow[];

    let expectedPrev = this.getMeta("checkpoint_hash") ?? GENESIS;
    for (const row of rows) {
      const recomputed = rowHash({
        seq: row.seq,
        ts: row.ts,
        userId: row.user_id,
        sessionId: row.session_id,
        event: row.event as AuditEventType,
        payloadJson: row.payload,
        prevHash: row.prev_hash,
      });
      if (row.prev_hash !== expectedPrev || recomputed !== row.hash) {
        return { ok: false, brokenAtSeq: row.seq };
      }
      expectedPrev = row.hash;
    }

    // Ende-Abschneiden: der höchste vergebene Seq muss dem Zähler entsprechen.
    const nextSeq = Number(this.getMeta("next_seq") ?? "1");
    const checkpointSeq = Number(this.getMeta("checkpoint_seq") ?? "0");
    const lastSeq = rows.length > 0 ? rows[rows.length - 1]!.seq : checkpointSeq;
    if (lastSeq !== nextSeq - 1) {
      return { ok: false, brokenAtSeq: lastSeq + 1 };
    }
    return { ok: true };
  }

  /** Anzahl aktuell gespeicherter Ereignisse (für den Verify-Endpoint). */
  countEvents(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as unknown as { n: number };
    return row.n;
  }

  /** Export als JSONL (eine Zeile je Ereignis) für die Marktaufsicht. */
  export(filter: AuditExportFilter = {}): string {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter.userId !== undefined) {
      clauses.push("user_id = ?");
      params.push(filter.userId);
    }
    if (filter.sessionId !== undefined) {
      clauses.push("session_id = ?");
      params.push(filter.sessionId);
    }
    if (filter.event !== undefined) {
      clauses.push("event = ?");
      params.push(filter.event);
    }
    if (filter.sinceTs !== undefined) {
      clauses.push("ts >= ?");
      params.push(filter.sinceTs);
    }
    if (filter.untilTs !== undefined) {
      clauses.push("ts <= ?");
      params.push(filter.untilTs);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT seq, ts, user_id, session_id, event, payload, prev_hash, hash FROM audit_events${where} ORDER BY seq`)
      .all(...params) as unknown as EventRow[];
    return rows.map((row) => JSON.stringify(toAuditRow(row))).join("\n");
  }

  /**
   * Löscht Ereignisse, die älter als `days` sind (Default: Retention-Untergrenze).
   *
   * Retention ohne Kettenbruch: gelöscht wird stets ein *zusammenhängendes
   * Präfix* (bis zur höchsten Seq unterhalb der Grenze). Der Hash der letzten
   * gelöschten Zeile wird als Checkpoint gespeichert — er ist exakt der
   * `prevHash` der ersten verbleibenden Zeile, sodass verifyChain ab dem
   * Checkpoint lückenlos weiterprüft. Gibt die Anzahl gelöschter Zeilen zurück.
   */
  pruneOlderThan(days: number = this.retentionDays): number {
    const cutoff = this.now() - days * 86_400_000;
    const boundary = this.db
      .prepare("SELECT seq, hash FROM audit_events WHERE ts < ? ORDER BY seq DESC LIMIT 1")
      .get(cutoff) as unknown as { seq: number; hash: string } | undefined;
    if (!boundary) return 0;

    this.db.exec("BEGIN");
    try {
      // Nach Seq löschen (nicht nach ts) — garantiert ein lückenloses Präfix.
      const info = this.db.prepare("DELETE FROM audit_events WHERE seq <= ?").run(boundary.seq);
      this.setMeta("checkpoint_hash", boundary.hash);
      this.setMeta("checkpoint_seq", String(boundary.seq));
      this.db.exec("COMMIT");
      return Number(info.changes);
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  /** prevHash für den nächsten Append: Hash der letzten Zeile bzw. Checkpoint/Genesis. */
  private tailHash(): string {
    const row = this.db.prepare("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1").get() as unknown as
      | { hash: string }
      | undefined;
    if (row) return row.hash;
    return this.getMeta("checkpoint_hash") ?? GENESIS;
  }

  private serializePayload(event: AuditEventType, payload: unknown): string {
    let json = canonicalJson(payload ?? null);
    if (event === "tool_result") {
      const bytes = Buffer.byteLength(json, "utf8");
      if (bytes > this.maxPayloadBytes) {
        const preview = Buffer.from(json, "utf8").subarray(0, this.maxPayloadBytes).toString("utf8");
        json = canonicalJson({ truncated: true, originalBytes: bytes, preview });
      }
    }
    return json;
  }

  private getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM audit_meta WHERE key = ?").get(key) as unknown as
      | { value: string }
      | undefined;
    return row?.value;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO audit_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }
}

function toAuditRow(row: EventRow): AuditRow {
  return {
    seq: row.seq,
    ts: row.ts,
    userId: row.user_id,
    sessionId: row.session_id,
    event: row.event as AuditEventType,
    payload: JSON.parse(row.payload) as unknown,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

interface HashInput {
  seq: number;
  ts: number;
  userId: string;
  sessionId: string;
  event: AuditEventType;
  payloadJson: string;
  prevHash: string;
}

/** hash = sha256(prevHash + kanonisches JSON der Zeile). */
function rowHash(r: HashInput): string {
  const canonical =
    `{"event":${JSON.stringify(r.event)},"payload":${r.payloadJson},"prevHash":${JSON.stringify(r.prevHash)},` +
    `"seq":${r.seq},"sessionId":${JSON.stringify(r.sessionId)},"ts":${r.ts},"userId":${JSON.stringify(r.userId)}}`;
  return createHash("sha256").update(r.prevHash + canonical).digest("hex");
}

/**
 * Deterministische JSON-Serialisierung: Objekt-Schlüssel rekursiv sortiert,
 * damit derselbe Payload immer denselben Hash ergibt (First-Principles-Check
 * statt Verlass auf Einfüge-Reihenfolge).
 */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
