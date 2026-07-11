/**
 * End-to-end production-path test on the demo company: the REAL server stack
 * (createAgentServer: API-key auth, per-user session isolation, SSE streaming,
 * approval gate, GDPR routes, metrics) answering company questions over the
 * deployment tools — not the bare in-process loop the probe exercises.
 *
 * Deterministic pass/fail checks, no judge. Probe only — never BENCHMARKS.md.
 *
 *   OLLAMA_BASE_URL=http://127.0.0.1:21434 npx tsx bench/company/server-e2e.ts
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createAgentServer } from "../../src/server/agent-server.js";
import { SqliteMemory } from "../../src/memory/sqlite-memory.js";
import { OllamaClient } from "../../src/llm/ollama-client.js";
import { makeCompanyTools } from "./tools.js";

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const PORT = 8791;
const API = `http://127.0.0.1:${PORT}`;
// Ground truth for the approval check, read straight from the corpus fixture.
const KUNDEN_COUNT = "52";

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "company", "out", "corpus");

const SYSTEM_INSTRUCTION =
  "Du bist der interne Wissensassistent der Selkinghaus Federn- und Stanztechnik GmbH (Lüdenscheid). " +
  "Dir stehen vier Datenquellen zur Verfügung: der Fileserver (Ordner 'fileserver/', per fs.list erkunden und fs.read lesen), " +
  "das E-Mail-Archiv (Ordner 'mail/'), die Active-Directory-Exporte (Ordner 'ad/') " +
  "und das ERP (per erp.query, SQL). Mit fs.search durchsuchst du alle Dateien und Mails im Volltext. " +
  "Nenne konkrete Zahlen und Quellen. Antworte auf Deutsch.";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 140)}` : ""}`);
}

interface JsonResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assertions probe arbitrary response shapes
  body: any;
}

async function json(path: string, init?: RequestInit): Promise<JsonResponse> {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const AUTH_ANNA = { Authorization: "Bearer sk-e2e-anna", "Content-Type": "application/json" };
const AUTH_BEN = { Authorization: "Bearer sk-e2e-ben", "Content-Type": "application/json" };

async function main(): Promise<void> {
  const dbDir = mkdtempSync(join(tmpdir(), "company-e2e-"));
  const memory = new SqliteMemory(join(dbDir, "memory.db"));
  const server = createAgentServer({
    llm: new OllamaClient({ baseUrl: BASE_URL, model: MODEL, defaultSeed: 1001, defaultTemperature: 0.1, think: true, numCtx: 16384 }),
    tools: makeCompanyTools(CORPUS),
    memory,
    apiKeys: { "sk-e2e-anna": "anna", "sk-e2e-ben": "ben" },
    systemInstruction: SYSTEM_INSTRUCTION,
    maxTurns: 12,
    requireApproval: ["erp.query"],
    approvalTimeoutMs: 300_000,
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  console.log(`\n=== company server e2e → ${API} model=${MODEL} corpus=${CORPUS} ===\n`);

  try {
    // 1. Liveness
    const health = await json("/healthz");
    check("healthz liefert 200", health.status === 200);

    // 2. Auth: kein Key -> 401; falscher Key -> 401
    const noKey = await json("/v1/agent/run", { method: "POST", body: "{}" });
    check("Run ohne API-Key wird abgelehnt (401)", noKey.status === 401);
    const badKey = await json("/v1/sessions", { headers: { Authorization: "Bearer sk-falsch" } });
    check("Falscher API-Key wird abgelehnt (401)", badKey.status === 401);

    // 3. Echte Recherche über den Server (Fileserver-Frage, kein ERP nötig)
    const research = await json("/v1/agent/run", {
      method: "POST",
      headers: AUTH_ANNA,
      body: JSON.stringify({ sessionId: "e2e", message: "Welche Revision der Arbeitsanweisung AA-032 ist gültig?", maxTurns: 12 }),
    });
    const answer: string = research.body?.finalAnswer ?? "";
    check(
      "Recherche-Frage über den Server beantwortet (AA-032 → Revision C)",
      research.status === 200 && research.body?.terminatedReason === "final_answer" && /revision c|rev\.?\s?c\b/i.test(answer),
      `turns=${research.body?.turns} tools=${research.body?.toolCallCount} :: ${answer}`,
    );

    // 4. Session-Isolation: anna sieht ihre Session, ben nicht
    const annaList = await json("/v1/sessions", { headers: AUTH_ANNA });
    check("Anna sieht ihre Session (Art. 15)", annaList.status === 200 && annaList.body?.sessions?.includes("e2e"));
    const benRead = await json("/v1/sessions/e2e", { headers: AUTH_BEN });
    check("Ben kann Annas Session nicht lesen (404)", benRead.status === 404);
    const benList = await json("/v1/sessions", { headers: AUTH_BEN });
    check("Bens Session-Liste ist leer", benList.status === 200 && benList.body?.sessions?.length === 0);

    // 5. Approval fail-closed: non-streaming hat keinen Kanal zum Menschen ->
    //    erp.query wird verweigert; die echte Kundenzahl darf NICHT erscheinen.
    const denied = await json("/v1/agent/run", {
      method: "POST",
      headers: AUTH_BEN,
      body: JSON.stringify({ sessionId: "erp-denied", message: "Wie viele Kunden sind im ERP hinterlegt? Frage die Datenbank per SQL ab.", maxTurns: 6 }),
    });
    const deniedAnswer: string = denied.body?.finalAnswer ?? "";
    check(
      "Approval-Gate fail-closed: ERP-Zahl bleibt ohne Freigabe unzugänglich",
      denied.status === 200 && !deniedAnswer.includes(KUNDEN_COUNT),
      deniedAnswer,
    );

    // 6. Approval über SSE: approval_request beantworten -> echte Zahl kommt.
    const sse = await fetch(`${API}/v1/agent/run`, {
      method: "POST",
      headers: AUTH_ANNA,
      body: JSON.stringify({ sessionId: "erp-ok", message: "Wie viele Kunden sind im ERP hinterlegt? Frage die Datenbank per SQL ab.", maxTurns: 6, stream: true }),
    });
    check("Streaming-Run startet (SSE)", sse.status === 200 && (sse.headers.get("content-type") ?? "").includes("text/event-stream"));
    const reader = sse.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawToken = false;
    let approvalsAnswered = 0;
    let finalResult: { finalAnswer?: string; terminatedReason?: string } | null = null;
    while (finalResult === null) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const dataText = /^data: (.+)$/m.exec(block)?.[1];
        if (!event || !dataText) continue;
        const data = JSON.parse(dataText);
        if (event === "token") sawToken = true;
        if (event === "approval_request") {
          approvalsAnswered++;
          await json(`/v1/agent/approvals/${data.approvalId}`, { method: "POST", headers: AUTH_ANNA, body: JSON.stringify({ approve: true }) });
        }
        if (event === "result" || event === "error") finalResult = data;
      }
    }
    check("Token-Streaming liefert Chunks", sawToken);
    check("approval_request kam an und wurde freigegeben", approvalsAnswered >= 1, `${approvalsAnswered} Freigabe(n)`);
    check(
      "Nach Freigabe liefert das ERP die echte Kundenzahl",
      (finalResult?.finalAnswer ?? "").includes(KUNDEN_COUNT),
      finalResult?.finalAnswer ?? "(kein result-Event)",
    );

    // 7. DSGVO Art. 17: Löschung wirkt und ist idempotent
    const del = await json("/v1/sessions/e2e", { method: "DELETE", headers: AUTH_ANNA });
    const afterDel = await json("/v1/sessions/e2e", { headers: AUTH_ANNA });
    check("Session-Löschung (Art. 17): 204, danach 404", del.status === 204 && afterDel.status === 404);

    // 8. Betrieb: Metriken zählen die Läufe
    const metrics = await fetch(`${API}/metrics`).then((r) => r.text());
    check("Prometheus-Metriken zählen Runs und Tool-Calls", /harness_runs_total\{terminated_reason="final_answer"\} [1-9]/.test(metrics) && /harness_tool_calls_total [1-9]/.test(metrics));
  } finally {
    server.close();
    memory.close();
    rmSync(dbDir, { recursive: true, force: true });
  }

  console.log(`\ngesamt: ${passed} bestanden, ${failed} fehlgeschlagen\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
