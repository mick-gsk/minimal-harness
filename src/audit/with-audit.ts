import type { ToolDefinition } from "../types/tool.js";
import type { AuditLog } from "./audit-log.js";

export interface AuditContext {
  userId: string;
  sessionId: string;
}

/**
 * Decorator: umhüllt eine Tool-Liste so, dass jeder Aufruf (tool_call) und
 * jedes Ergebnis (tool_result) revisionssicher geloggt wird — der Kern
 * (AgentLoop/ToolBridge) bleibt unberührt (CLAUDE.md-Prinzip 2: Decorator
 * statt Kern-Umbau, Vorbild bench/telemetry.ts). Die Ergebnisse werden
 * unverändert durchgereicht; das Log ist reiner Nebeneffekt.
 */
export function withAudit(tools: ToolDefinition[], auditLog: AuditLog, ctx: AuditContext): ToolDefinition[] {
  return tools.map((tool) => ({
    // Spread erhält optionale Metadaten (z. B. `manifest`); nur execute wird
    // umhüllt, alles andere bleibt unverändert.
    ...tool,
    async execute(input: unknown): Promise<unknown> {
      auditLog.append({ ...ctx, event: "tool_call", payload: { tool: tool.name, arguments: input } });
      try {
        const output = await tool.execute(input);
        auditLog.append({ ...ctx, event: "tool_result", payload: { tool: tool.name, output } });
        return output;
      } catch (err) {
        auditLog.append({
          ...ctx,
          event: "tool_result",
          payload: { tool: tool.name, error: err instanceof Error ? err.message : String(err) },
        });
        throw err;
      }
    },
  }));
}
