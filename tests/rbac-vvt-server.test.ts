import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentServer } from "../src/server/agent-server.js";
import { InMemoryMemory } from "../src/memory/in-memory.js";
import { adapterFromFn } from "../src/llm/llm-adapter.js";
import { calculatorTool } from "../src/tools/builtins/calculator.js";
import { clockTool } from "../src/tools/builtins/clock.js";
import { AuditLog } from "../src/audit/audit-log.js";
import type { ToolDefinition } from "../src/types/tool.js";

const API_KEYS = { "sk-alice": "alice", "sk-bob": "bob", "sk-dave": "dave" };

// An ERP tool with a full Art. 30 manifest (purpose + data categories + recipient).
const erpBookTool: ToolDefinition = {
  name: "erp.book",
  description: "Books an invoice into the ERP ledger.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
  manifest: {
    purpose: "Verbuchung von Rechnungen im ERP-Hauptbuch",
    dataCategories: ["Rechnungsdaten", "Lieferantenstammdaten"],
    recipients: ["ERP-System (intern)"],
  },
  async execute() {
    return { booked: true };
  },
};

/** Captures the system prompt of the most recent request, then answers immediately. */
function makeCapturingLlm(sink: { last: string }) {
  return adapterFromFn(async (messages) => {
    sink.last = messages.find((m) => m.role === "system")?.content ?? "";
    return { content: "ACTION: final_answer\nANSWER: ok" };
  });
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      if (typeof address === "object" && address) resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe("tool-RBAC + VVT export", () => {
  let dir: string;
  let auditDbPath: string;
  let server: Server;
  let base: string;
  const sink = { last: "" };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "rbac-vvt-"));
    auditDbPath = join(dir, "audit.db");
    server = createAgentServer({
      llm: makeCapturingLlm(sink),
      // calculator has a minimal manifest, clock has none, erp.book a full one.
      tools: [calculatorTool, clockTool, erpBookTool],
      memory: new InMemoryMemory(),
      apiKeys: API_KEYS,
      maxTurns: 3,
      auditDb: auditDbPath,
      toolPolicy: {
        roles: { analyst: ["*"], viewer: ["clock.*"] },
        userRoles: { alice: "analyst", bob: "viewer" },
        // dave is unmapped → fail-closed, no tools.
      },
    });
    base = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    rmSync(dir, { recursive: true, force: true });
  });

  function run(key: string, sessionId: string): Promise<Response> {
    return fetch(`${base}/v1/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ sessionId, message: "hi" }),
    });
  }

  it("the analyst role sees every tool in the prompt", async () => {
    await run("sk-alice", "a1");
    expect(sink.last).toContain("calculator.evaluate");
    expect(sink.last).toContain("clock.now");
    expect(sink.last).toContain("erp.book");
  });

  it("the viewer role only sees clock.* — forbidden tools are absent from the prompt", async () => {
    await run("sk-bob", "b1");
    expect(sink.last).toContain("clock.now");
    expect(sink.last).not.toContain("calculator.evaluate");
    expect(sink.last).not.toContain("erp.book");
  });

  it("an unmapped user is fail-closed: no tools offered at all", async () => {
    await run("sk-dave", "d1");
    expect(sink.last).not.toContain("clock.now");
    expect(sink.last).not.toContain("calculator.evaluate");
    expect(sink.last).not.toContain("erp.book");
  });

  it("GET /v1/compliance/vvt returns manifest data, gaps and rbac roles", async () => {
    const res = await fetch(`${base}/v1/compliance/vvt`, { headers: { Authorization: "Bearer sk-alice" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      records: Array<{
        name: string;
        purpose: string;
        dataCategories: string[];
        recipients: string[];
        rbacRoles: string[];
        auditRetentionDays?: number;
      }>;
    };
    const byName = Object.fromEntries(body.records.map((r) => [r.name, r]));

    // Declared manifest surfaces purpose + recipients.
    expect(byName["erp.book"]!.purpose).toContain("ERP");
    expect(byName["erp.book"]!.recipients).toEqual(["ERP-System (intern)"]);
    expect(byName["erp.book"]!.rbacRoles).toEqual(["analyst"]);

    // Undeclared tool honestly shows the documentation gap.
    expect(byName["clock.now"]!.purpose).toBe("(nicht deklariert)");
    expect(byName["clock.now"]!.dataCategories).toEqual([]);
    // Both roles may use clock.* (analyst via "*", viewer via "clock.*").
    expect(byName["clock.now"]!.rbacRoles).toEqual(["analyst", "viewer"]);

    // Audit active → retention is reported.
    expect(byName["erp.book"]!.auditRetentionDays).toBe(186);
  });

  it("GET /v1/compliance/vvt requires authentication (401)", async () => {
    expect((await fetch(`${base}/v1/compliance/vvt`)).status).toBe(401);
  });

  it("the audit run_start line records the effective role + granted toolset", async () => {
    // Read the same audit file via a second connection and inspect run_start payloads.
    const audit = new AuditLog(auditDbPath);
    try {
      const lines = audit
        .export({ event: "run_start" })
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { userId: string; payload: { role: string; tools: string[] } });
      const alice = lines.find((l) => l.userId === "alice");
      const bob = lines.find((l) => l.userId === "bob");
      expect(alice?.payload.role).toBe("analyst");
      expect(alice?.payload.tools).toEqual(expect.arrayContaining(["calculator.evaluate", "clock.now", "erp.book"]));
      expect(bob?.payload.role).toBe("viewer");
      expect(bob?.payload.tools).toEqual(["clock.now"]);
    } finally {
      audit.close();
    }
  });
});

describe("tool-RBAC disabled (regression)", () => {
  let server: Server;
  let base: string;
  const sink = { last: "" };

  beforeAll(async () => {
    server = createAgentServer({
      llm: makeCapturingLlm(sink),
      tools: [calculatorTool, clockTool],
      memory: new InMemoryMemory(),
      apiKeys: API_KEYS,
      // No toolPolicy: every authenticated user gets every tool.
    });
    base = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  it("without a policy every user sees every tool", async () => {
    await fetch(`${base}/v1/agent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-dave" },
      body: JSON.stringify({ sessionId: "x", message: "hi" }),
    });
    expect(sink.last).toContain("calculator.evaluate");
    expect(sink.last).toContain("clock.now");
  });

  it("VVT without a policy marks every tool usable by all (rbacRoles ['*'])", async () => {
    const res = await fetch(`${base}/v1/compliance/vvt`, { headers: { Authorization: "Bearer sk-dave" } });
    const body = (await res.json()) as { records: Array<{ name: string; rbacRoles: string[]; auditRetentionDays?: number }> };
    expect(body.records.every((r) => r.rbacRoles.includes("*"))).toBe(true);
    // No audit configured here → retention field omitted.
    expect(body.records[0]!.auditRetentionDays).toBeUndefined();
  });
});
