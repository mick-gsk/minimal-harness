/** Dev tasks (spec §4.4b): allowed for harness tuning, never reported. */
import type { BenchTask } from "../types.js";
import { WorldState, makeKvTools } from "../world.js";
import { calculatorTool } from "../../src/index.js";

const finalOk = (r: { terminatedReason: string; finalAnswer: string | null }): boolean =>
  r.terminatedReason === "final_answer" && !!r.finalAnswer;

export const devTasks: BenchTask[] = [
  {
    id: "dev-calc",
    category: "single-tool",
    prompt: "What is 9 * 8? Use the calculator tool.",
    maxTurns: 6,
    makeTools: () => [calculatorTool],
    check: (r) => finalOk(r) && /\b72\b/.test(r.finalAnswer!),
  },
  {
    id: "dev-calc-two-step",
    category: "multi-step",
    prompt: "Compute 6 * 7 with the calculator, then subtract 2 from the result. Tell me the final number.",
    maxTurns: 8,
    makeTools: () => [calculatorTool],
    check: (r) => finalOk(r) && /\b40\b/.test(r.finalAnswer!),
  },
  {
    id: "dev-kv-set",
    category: "world-state",
    prompt: "Store the value 'ready' under the key 'status'.",
    maxTurns: 6,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r, world) => finalOk(r) && world.kv.get("status") === "ready",
  },
  {
    id: "dev-no-tool",
    category: "no-tool",
    prompt: "How many days are in a leap year? Answer with just the number.",
    maxTurns: 4,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r) => finalOk(r) && /\b366\b/.test(r.finalAnswer!),
  },
];
