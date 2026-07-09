/**
 * FROZEN SUITE v1 (spec §4.4b).
 * Report-only. Never tune the harness against individual failures here.
 * Additions/changes go into a new file (suite-v2.ts) with a version bump.
 */
import type { BenchTask } from "../../types.js";
import { WorldState, makeKvTools } from "../../world.js";
import { calculatorTool, clockTool } from "../../../src/index.js";

export const SUITE_VERSION = "suite-v1";

const finalOk = (r: { terminatedReason: string; finalAnswer: string | null }): boolean =>
  r.terminatedReason === "final_answer" && !!r.finalAnswer;

export const suiteV1: BenchTask[] = [
  {
    id: "calc-simple",
    category: "single-tool",
    prompt: "What is 17 * 23? Use the calculator tool.",
    maxTurns: 6,
    makeTools: () => [calculatorTool],
    check: (r) => finalOk(r) && r.finalAnswer!.includes("391"),
  },
  {
    id: "calc-nested",
    category: "single-tool",
    prompt: "Compute ((5 + 3) * 12) / 4 using the calculator tool.",
    maxTurns: 6,
    makeTools: () => [calculatorTool],
    check: (r) => finalOk(r) && /\b24\b/.test(r.finalAnswer!),
  },
  {
    id: "calc-two-step",
    category: "multi-step",
    prompt: "First compute 15 * 4 with the calculator. Then add 17 to that result and tell me the final number.",
    maxTurns: 8,
    makeTools: () => [calculatorTool],
    check: (r) => finalOk(r) && /\b77\b/.test(r.finalAnswer!),
  },
  {
    id: "calc-chain-3",
    category: "multi-step",
    prompt: "Start with 100. Subtract 37, then multiply the result by 3. Use the calculator and tell me the final number.",
    maxTurns: 10,
    makeTools: () => [calculatorTool],
    check: (r) => finalOk(r) && /\b189\b/.test(r.finalAnswer!),
  },
  {
    id: "kv-set",
    category: "world-state",
    prompt: "Store the value 'blue' under the key 'color' in the key-value store.",
    maxTurns: 6,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r, world) => finalOk(r) && world.kv.get("color") === "blue",
  },
  {
    id: "kv-set-get",
    category: "world-state",
    prompt: "Store the value '42' under the key 'answer'. Then read it back with kv.get and tell me the value you read.",
    maxTurns: 8,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r, world) =>
      finalOk(r) && world.kv.get("answer") === "42" && r.finalAnswer!.includes("42"),
  },
  {
    id: "kv-transfer",
    category: "world-state",
    prompt: "Read the value stored under the key 'src' and store that same value under the key 'dst'.",
    maxTurns: 8,
    makeTools: (world: WorldState) => {
      world.kv.set("src", "hello");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("dst") === "hello",
  },
  {
    id: "kv-conditional",
    category: "multi-step",
    prompt:
      "Read the number stored under the key 'threshold'. If it is greater than 10, store 'high' under the key 'level'; otherwise store 'low' under 'level'.",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("threshold", "15");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("level") === "high",
  },
  {
    id: "clock-tz",
    category: "single-tool",
    prompt: "What time is it right now in the timezone Asia/Tokyo? Use the clock tool.",
    maxTurns: 6,
    makeTools: () => [clockTool],
    check: (r) => finalOk(r) && r.toolCallCount >= 1,
  },
  {
    id: "no-tool-capital",
    category: "no-tool",
    prompt: "What is the capital of France? Answer with just the city name.",
    maxTurns: 4,
    makeTools: (world: WorldState) => makeKvTools(world), // tools offered but not needed
    check: (r) => finalOk(r) && /paris/i.test(r.finalAnswer!),
  },
];
