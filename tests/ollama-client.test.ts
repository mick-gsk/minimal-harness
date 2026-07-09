import { describe, it, expect } from "@jest/globals";
import { OllamaClient } from "../src/llm/ollama-client.js";

describe("OllamaClient", () => {
  it("throws on non-200 response", async () => {
    // Mock fetch to simulate a server error
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 500, statusText: "Internal Server Error" });

    const client = new OllamaClient({ baseUrl: "http://localhost:11434", model: "llama3" });
    await expect(client.generate([{ role: "user", content: "hi" }])).rejects.toThrow(
      "Ollama request failed: 500",
    );

    globalThis.fetch = originalFetch;
  });

  it("sends tool specs and surfaces native tool_calls", async () => {
    const originalFetch = globalThis.fetch;
    let sentBody: { tools?: Array<{ type: string; function: { name: string } }> } = {};
    globalThis.fetch = async (_url, init) => {
      sentBody = JSON.parse((init as RequestInit).body as string);
      return new Response(
        JSON.stringify({
          model: "llama3",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ function: { name: "calculator.evaluate", arguments: { expression: "2+2" } } }],
          },
        }),
        { status: 200 },
      );
    };

    const client = new OllamaClient({ baseUrl: "http://x", model: "llama3" });
    const res = await client.generate([{ role: "user", content: "2+2?" }], {
      tools: [{ name: "calculator.evaluate", description: "calc", parameters: { type: "object", properties: {} } }],
    });

    expect(sentBody.tools).toHaveLength(1);
    expect(sentBody.tools?.[0]?.type).toBe("function");
    expect(sentBody.tools?.[0]?.function.name).toBe("calculator.evaluate");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls?.[0]?.name).toBe("calculator.evaluate");
    expect(res.toolCalls?.[0]?.arguments).toEqual({ expression: "2+2" });

    globalThis.fetch = originalFetch;
  });

  it("parses stringified native tool_call arguments", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          model: "llama3",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ function: { name: "t", arguments: '{"x":1}' } }],
          },
        }),
        { status: 200 },
      );

    const client = new OllamaClient({ baseUrl: "http://x", model: "llama3" });
    const res = await client.generate([{ role: "user", content: "hi" }]);
    expect(res.toolCalls?.[0]?.arguments).toEqual({ x: 1 });

    globalThis.fetch = originalFetch;
  });

  it("streams tokens via onToken and returns the accumulated content", async () => {
    const originalFetch = globalThis.fetch;
    let sentStream: boolean | undefined;
    // Deliberately split lines across chunk boundaries to exercise buffering.
    const wire = [
      '{"message":{"role":"assistant","content":"Hel"},"done":false}\n{"message":{"rol',
      'e":"assistant","content":"lo"},"done":false}\n',
      '{"message":{"role":"assistant","content":"!"},"done":true,"model":"llama3"}\n',
    ];
    globalThis.fetch = async (_url, init) => {
      sentStream = JSON.parse((init as RequestInit).body as string).stream;
      const enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of wire) controller.enqueue(enc.encode(part));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    };

    const client = new OllamaClient({ baseUrl: "http://x", model: "llama3" });
    const chunks: string[] = [];
    const res = await client.generate([{ role: "user", content: "hi" }], {
      onToken: (c) => chunks.push(c),
    });

    expect(sentStream).toBe(true);
    expect(chunks).toEqual(["Hel", "lo", "!"]);
    expect(res.content).toBe("Hello!");
    expect(res.model).toBe("llama3");

    globalThis.fetch = originalFetch;
  });
});
