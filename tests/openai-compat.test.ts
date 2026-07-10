import { describe, it, expect, afterEach } from "@jest/globals";
import { OpenAiCompatAdapter } from "../src/llm/openai-compat.js";
import { LMStudioAdapter } from "../src/llm/lmstudio-adapter.js";
import { LlamaCppAdapter } from "../src/llm/llamacpp-adapter.js";

const originalFetch = globalThis.fetch;

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join("");
  return new Response(body, { status: 200 });
}

describe("OpenAiCompatAdapter", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts to /chat/completions and parses content", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    let auth: string | null = null;
    globalThis.fetch = async (input, init) => {
      url = String(input);
      body = JSON.parse((init as RequestInit).body as string);
      auth = new Headers((init as RequestInit).headers).get("authorization");
      return jsonResponse({
        model: "m",
        choices: [{ message: { role: "assistant", content: "hello" } }],
      });
    };

    const adapter = new OpenAiCompatAdapter({ baseUrl: "http://x/v1", model: "m", apiKey: "sk-test" });
    const res = await adapter.generate([{ role: "user", content: "hi" }], { temperature: 0.1, seed: 7 });

    expect(url).toBe("http://x/v1/chat/completions");
    expect(body.model).toBe("m");
    expect(body.temperature).toBe(0.1);
    expect(body.seed).toBe(7);
    expect(body.stream).toBe(false);
    expect(auth).toBe("Bearer sk-test");
    expect(res.content).toBe("hello");
  });

  it("sends tools in OpenAI function format and parses string tool_call arguments", async () => {
    let body: { tools?: Array<{ type: string; function: { name: string } }> } = {};
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse((init as RequestInit).body as string);
      return jsonResponse({
        model: "m",
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                { function: { name: "calculator.evaluate", arguments: '{"expression":"2+2"}' } },
              ],
            },
          },
        ],
      });
    };

    const adapter = new OpenAiCompatAdapter({ baseUrl: "http://x/v1", model: "m" });
    const res = await adapter.generate([{ role: "user", content: "2+2?" }], {
      tools: [{ name: "calculator.evaluate", description: "calc", parameters: { type: "object", properties: {} } }],
    });

    expect(body.tools).toHaveLength(1);
    expect(body.tools?.[0]?.type).toBe("function");
    expect(body.tools?.[0]?.function.name).toBe("calculator.evaluate");
    expect(res.toolCalls).toEqual([{ name: "calculator.evaluate", arguments: { expression: "2+2" } }]);
  });

  it("throws with status and body excerpt on non-2xx", async () => {
    globalThis.fetch = async () => new Response('{"error":"model not found"}', { status: 404, statusText: "Not Found" });
    const adapter = new OpenAiCompatAdapter({ baseUrl: "http://x/v1", model: "m" });
    await expect(adapter.generate([{ role: "user", content: "hi" }])).rejects.toThrow(/404.*model not found/s);
  });

  it("streams SSE chunks through onToken and returns the full content", async () => {
    let body: { stream?: boolean } = {};
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse((init as RequestInit).body as string);
      return sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
        JSON.stringify({ choices: [{ delta: { content: "lo" } }] }),
        "[DONE]",
      ]);
    };

    const chunks: string[] = [];
    const adapter = new OpenAiCompatAdapter({ baseUrl: "http://x/v1", model: "m" });
    const res = await adapter.generate([{ role: "user", content: "hi" }], { onToken: (c) => chunks.push(c) });

    expect(body.stream).toBe(true);
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(res.content).toBe("Hello");
  });

  it("accumulates streamed tool_call deltas by index", async () => {
    globalThis.fetch = async () =>
      sseResponse([
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "kv.set", arguments: '{"key":' } }] } }],
        }),
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"color","value":"blue"}' } }] } }],
        }),
        "[DONE]",
      ]);

    const adapter = new OpenAiCompatAdapter({ baseUrl: "http://x/v1", model: "m" });
    const res = await adapter.generate([{ role: "user", content: "store" }], { onToken: () => {} });

    expect(res.toolCalls).toEqual([{ name: "kv.set", arguments: { key: "color", value: "blue" } }]);
  });

  it("LMStudioAdapter and LlamaCppAdapter default to their conventional ports", async () => {
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      return jsonResponse({ model: "m", choices: [{ message: { role: "assistant", content: "ok" } }] });
    };

    await new LMStudioAdapter().generate([{ role: "user", content: "hi" }]);
    await new LlamaCppAdapter().generate([{ role: "user", content: "hi" }]);

    expect(urls[0]).toBe("http://localhost:1234/v1/chat/completions");
    expect(urls[1]).toBe("http://localhost:8080/v1/chat/completions");
  });
});
