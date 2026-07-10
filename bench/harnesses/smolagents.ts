import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import type { LLMAdapter, ToolDefinition } from "../../src/index.js";
import type { BenchRunResult, BenchTask, HarnessAdapter, RunContext } from "../types.js";
import { startWorldBridge } from "../bridge/world-http-bridge.js";

const here = dirname(fileURLToPath(import.meta.url));
export const SMOLAGENTS_PYTHON = join(here, "..", "smolagents", ".venv", "bin", "python");
const SIDECAR = join(here, "..", "smolagents", "agent_runner.py");

/** True when the Python venv + sidecar are present (runner preflight). */
export function smolagentsAvailable(): boolean {
  return existsSync(SMOLAGENTS_PYTHON) && existsSync(SIDECAR);
}

interface SidecarResult {
  finalAnswer: string | null;
  terminatedReason: string;
  toolCalls: number;
  tokens: number;
  steps: number;
  agentMs: number;
  /** Bridge-transport faults counted inside the sidecar (seam, not harness). */
  seamErrors?: number;
  error: string | null;
}

/** Spawn failure, timeout kill, unparseable result — all seam, not harness. */
function errorResult(msg: string): SidecarResult {
  return {
    finalAnswer: null,
    terminatedReason: "error",
    toolCalls: 0,
    tokens: 0,
    steps: 0,
    agentMs: 0,
    seamErrors: 1,
    error: msg,
  };
}

function runSidecar(jobJson: string, maxTurns: number): Promise<SidecarResult> {
  return new Promise((resolve) => {
    const child = spawn(SMOLAGENTS_PYTHON, [SIDECAR], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    // Generous hard cap: a slow local model over several steps can take minutes.
    const timeoutMs = Math.max(180_000, maxTurns * 60_000);
    const killTimer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);

    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", (e) => {
      clearTimeout(killTimer);
      resolve(errorResult(`spawn failed: ${e.message}`));
    });
    child.on("close", () => {
      clearTimeout(killTimer);
      const line = out
        .split("\n")
        .reverse()
        .find((l) => l.startsWith("SMOLARESULT:"));
      if (!line) {
        resolve(errorResult(`no result line; stderr tail: ${err.slice(-600)}`));
        return;
      }
      try {
        resolve(JSON.parse(line.slice("SMOLARESULT:".length)) as SidecarResult);
      } catch (e) {
        resolve(errorResult(`bad result json: ${e instanceof Error ? e.message : String(e)}`));
      }
    });

    child.stdin.write(jobJson);
    child.stdin.end();
  });
}

function makeSmolagentsHarness(
  name: "smolagents-tool" | "smolagents-code",
  agentType: "tool" | "code",
): HarnessAdapter {
  return {
    name,
    async run(
      task: BenchTask,
      _llm: LLMAdapter,
      tools: ToolDefinition[],
      ctx: RunContext,
    ): Promise<BenchRunResult> {
      const bridge = await startWorldBridge(tools);
      try {
        const apiBase = `${ctx.model.baseUrl.replace(/\/$/, "")}/v1`;
        // Equal-effort knob (bench/FAIRNESS.md): BENCH_SMOLAGENTS_IMPORTS="math,json"
        // authorizes extra CodeAgent imports via the library's own option.
        // Unset = off-the-shelf defaults (the official claim).
        const codeImports = (process.env.BENCH_SMOLAGENTS_IMPORTS ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const job = {
          prompt: task.prompt,
          maxSteps: task.maxTurns,
          bridgeUrl: bridge.url,
          agentType,
          ...(agentType === "code" && codeImports.length > 0 ? { codeImports } : {}),
          model: {
            id: ctx.model.name,
            apiBase,
            apiKey: "ollama",
            temperature: ctx.model.temperature,
            seed: ctx.seed,
          },
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        };
        const res = await runSidecar(JSON.stringify(job), task.maxTurns);
        const out: BenchRunResult = {
          finalAnswer: res.error ? null : res.finalAnswer,
          terminatedReason: res.error ? "error" : res.terminatedReason,
          turns: res.steps,
          llmCalls: res.steps, // proxy: ~one model call per step (no planning interval)
          tokens: res.tokens,
          latencyMs: 0, // filled by runner (wall-clock incl. python boot)
          toolCallCount: res.toolCalls,
          agentMs: res.agentMs,
        };
        if (res.seamErrors) out.seamErrors = res.seamErrors;
        if (res.error) out.error = res.error;
        return out;
      } finally {
        await bridge.close();
      }
    },
  };
}

/**
 * Contestant: Hugging Face smolagents `ToolCallingAgent` (JSON tool calls —
 * apples-to-apples with minimal-harness). Runs as a Python sidecar; its tools
 * are HTTP wrappers over the Node WorldState bridge, so `check()` scores the one
 * real world. smolagents keeps its OWN system prompt/scaffold (that's the rival).
 */
export const smolagentsToolHarness = makeSmolagentsHarness("smolagents-tool", "tool");

/**
 * Contestant: smolagents `CodeAgent` — HF's recommended default and the
 * library's actual thesis (actions as Python code instead of JSON tool calls).
 * Same sidecar/bridge; only the agent class differs.
 */
export const smolagentsCodeHarness = makeSmolagentsHarness("smolagents-code", "code");
