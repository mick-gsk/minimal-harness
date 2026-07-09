import { createServer } from "node:http";
import type { ToolDefinition } from "../../src/index.js";

export interface WorldBridgeHandle {
  /** Base URL like http://127.0.0.1:<port> the sidecar posts tool calls to. */
  url: string;
  close(): Promise<void>;
}

/**
 * Exposes a set of in-process JS tools over localhost HTTP so an out-of-process
 * contestant (smolagents in Python) can invoke them — keeping the WorldState the
 * SINGLE source of truth in Node. No duplicated world, same `check()`.
 *
 * Protocol:
 *   POST /tool/<name>  body {"args": {...}}
 *     -> 200 {"ok": true,  "result": <toolOutput>}   on success
 *     -> 200 {"ok": false, "error": "<msg>"}         on tool throw (agent may retry)
 *     -> 404 {"ok": false, "error": "unknown tool"}  unknown tool
 *
 * Ephemeral OS-assigned port, bound to 127.0.0.1, lifetime = one run.
 */
export async function startWorldBridge(tools: ToolDefinition[]): Promise<WorldBridgeHandle> {
  const byName = new Map(tools.map((t) => [t.name, t]));

  const server = createServer((req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method !== "POST" || !req.url?.startsWith("/tool/")) {
      send(404, { ok: false, error: "not found" });
      return;
    }
    const name = decodeURIComponent(req.url.slice("/tool/".length));

    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const tool = byName.get(name);
      if (!tool) {
        send(404, { ok: false, error: `unknown tool: ${name}` });
        return;
      }
      let args: unknown;
      try {
        const parsed = raw ? (JSON.parse(raw) as { args?: unknown }) : {};
        args = parsed.args ?? {};
      } catch {
        send(200, { ok: false, error: "invalid JSON body" });
        return;
      }
      // Execute against the real in-process world; mirror it to the HTTP response.
      void tool
        .execute(args)
        .then((result) => send(200, { ok: true, result }))
        .catch((err) =>
          send(200, { ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
