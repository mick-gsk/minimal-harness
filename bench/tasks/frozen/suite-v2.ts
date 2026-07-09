/**
 * FROZEN SUITE v2 (spec §4.4b) — 50 tasks, 6 categories.
 * Report-only. Never tune the harness against individual failures here.
 * Additions/changes go into a new file (suite-v3.ts) with a version bump.
 *
 * Hardening over v1 (spec amendment 2026-07-09):
 * - decimal-safe number matching (lookaround instead of \b)
 * - result values never appear in the task inputs
 * - case requirements are explicit in the prompt
 * - new categories: error-recovery (flaky tools) and multi-tool (kv + calculator)
 */
import type { BenchTask, BenchRunResult } from "../../types.js";
import { WorldState, makeKvTools, makeUnstableTool, makeFlakyKvSet } from "../../world.js";
import { calculatorTool, clockTool } from "../../../src/index.js";

export const SUITE_V2_VERSION = "suite-v2";

const finalOk = (r: BenchRunResult): boolean =>
  r.terminatedReason === "final_answer" && !!r.finalAnswer;

/**
 * Decimal-safe number match: not preceded by digit/./,/- and not followed by
 * a digit or a decimal/thousands continuation. "The result is 437." matches;
 * "1437", "43.7", "3.437" do not.
 */
const num = (n: number): RegExp => new RegExp(`(?<![\\d.,-])${n}(?!\\d|[.,]\\d)`);
const numOk = (r: BenchRunResult, n: number): boolean => finalOk(r) && num(n).test(r.finalAnswer!);
const TIME_RE = /\d{1,2}:\d{2}/;

export const suiteV2: BenchTask[] = [
  // ── single-tool (10) ────────────────────────────────────────────────
  {
    id: "v2-s1-calc-mult",
    category: "single-tool",
    prompt: "What is 23 * 19? Use the calculator tool.",
    maxTurns: 6,
    makeTools: () => [calculatorTool],
    check: (r) => numOk(r, 437),
  },
  {
    id: "v2-s2-calc-add-mult",
    category: "single-tool",
    prompt: "Compute (14 + 9) * 6 using the calculator tool.",
    maxTurns: 6,
    makeTools: () => [calculatorTool],
    check: (r) => numOk(r, 138),
  },
  {
    id: "v2-s3-calc-div",
    category: "single-tool",
    prompt: "What is 156 divided by 12? Use the calculator tool.",
    maxTurns: 6,
    makeTools: () => [calculatorTool],
    check: (r) => numOk(r, 13),
  },
  {
    id: "v2-s4-calc-sub",
    category: "single-tool",
    prompt: "Compute 503 - 78 with the calculator tool.",
    maxTurns: 6,
    makeTools: () => [calculatorTool],
    check: (r) => numOk(r, 425),
  },
  {
    id: "v2-s5-calc-nested",
    category: "single-tool",
    prompt: "Compute ((7 + 5) * 3) / 4 using the calculator tool.",
    maxTurns: 6,
    makeTools: () => [calculatorTool],
    check: (r) => numOk(r, 9),
  },
  {
    id: "v2-s6-calc-big",
    category: "single-tool",
    prompt: "What is 127 * 43? Use the calculator tool.",
    maxTurns: 6,
    makeTools: () => [calculatorTool],
    // Accepts "5461" and the common thousands-separator rendering "5,461".
    check: (r) => finalOk(r) && /(?<![\d.,-])5,?461(?!\d|[.,]\d)/.test(r.finalAnswer!),
  },
  {
    id: "v2-s7-clock-utc",
    category: "single-tool",
    prompt: "What time is it right now in UTC? Use the clock tool.",
    maxTurns: 6,
    makeTools: () => [clockTool],
    check: (r) => finalOk(r) && r.toolCallCount >= 1 && TIME_RE.test(r.finalAnswer!),
  },
  {
    id: "v2-s8-clock-ny",
    category: "single-tool",
    prompt: "What time is it right now in the timezone America/New_York? Use the clock tool.",
    maxTurns: 6,
    makeTools: () => [clockTool],
    check: (r) => finalOk(r) && r.toolCallCount >= 1 && TIME_RE.test(r.finalAnswer!),
  },
  {
    id: "v2-s9-kv-read",
    category: "single-tool",
    prompt: "Read the value stored under the key 'token' and tell me what it is.",
    maxTurns: 6,
    makeTools: (world: WorldState) => {
      world.kv.set("token", "K7X9Q");
      return makeKvTools(world);
    },
    check: (r) => finalOk(r) && r.finalAnswer!.includes("K7X9Q"),
  },
  {
    id: "v2-s10-kv-read-missing",
    category: "single-tool",
    prompt: "Read the value stored under the key 'ghost' and tell me what you find.",
    maxTurns: 6,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r) =>
      finalOk(r) &&
      r.toolCallCount >= 1 &&
      /not|null|exist|empty|missing|no value|nothing/i.test(r.finalAnswer!),
  },

  // ── multi-step (10) ─────────────────────────────────────────────────
  {
    id: "v2-m1-calc-2step",
    category: "multi-step",
    prompt: "First compute 18 * 7 with the calculator. Then add 59 to that result and tell me the final number.",
    maxTurns: 10,
    makeTools: () => [calculatorTool],
    check: (r) => numOk(r, 185),
  },
  {
    id: "v2-m2-calc-3step",
    category: "multi-step",
    prompt: "Start with 240. Divide it by 8, then multiply the result by 13. Use the calculator and tell me the final number.",
    maxTurns: 10,
    makeTools: () => [calculatorTool],
    check: (r) => numOk(r, 390),
  },
  {
    id: "v2-m3-calc-2step-sub",
    category: "multi-step",
    prompt: "Compute 91 - 36 with the calculator, then multiply the result by 11. Tell me the final number.",
    maxTurns: 10,
    makeTools: () => [calculatorTool],
    check: (r) => numOk(r, 605),
  },
  {
    id: "v2-m4-kv-cond-big",
    category: "multi-step",
    prompt:
      "Read the number stored under the key 'threshold2'. If it is greater than 25, store the word 'big' (exactly, lowercase) under the key 'size'; otherwise store 'small' (lowercase).",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("threshold2", "42");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("size") === "big",
  },
  {
    id: "v2-m5-kv-cond-under",
    category: "multi-step",
    prompt:
      "Read the number stored under the key 'limit2'. If it is greater than 20, store the word 'over' (exactly, lowercase) under the key 'state'; otherwise store 'under' (lowercase).",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("limit2", "8");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("state") === "under",
  },
  {
    id: "v2-m6-kv-two-writes",
    category: "multi-step",
    prompt: "First store 'alpha' under the key 'k1'. Then store 'beta' under the key 'k2'.",
    maxTurns: 10,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r, world) => finalOk(r) && world.kv.get("k1") === "alpha" && world.kv.get("k2") === "beta",
  },
  {
    id: "v2-m7-kv-read-write",
    category: "multi-step",
    prompt: "Read the value stored under the key 'color2', then store that same value under the key 'backup'.",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("color2", "crimson");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("backup") === "crimson",
  },
  {
    id: "v2-m8-calc-2step-mixed",
    category: "multi-step",
    prompt: "Compute 75 * 4 with the calculator, then subtract 113 from the result. Tell me the final number.",
    maxTurns: 10,
    makeTools: () => [calculatorTool],
    check: (r) => numOk(r, 187),
  },
  {
    id: "v2-m9-kv-chain",
    category: "multi-step",
    prompt:
      "Read the value under the key 'a2', store that same value under the key 'b2', then read 'b2' back and tell me the value.",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("a2", "zebra42");
      return makeKvTools(world);
    },
    check: (r, world) =>
      finalOk(r) && world.kv.get("b2") === "zebra42" && r.finalAnswer!.includes("zebra42"),
  },
  {
    id: "v2-m10-calc-4step",
    category: "multi-step",
    prompt:
      "With the calculator: add 12 and 13, multiply the result by 4, then subtract 27. Tell me the final number.",
    maxTurns: 12,
    makeTools: () => [calculatorTool],
    check: (r) => numOk(r, 73),
  },

  // ── world-state (10) ────────────────────────────────────────────────
  {
    id: "v2-w1-set-simple",
    category: "world-state",
    prompt: "Store the value 'ready' under the key 'phase' in the key-value store.",
    maxTurns: 6,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r, world) => finalOk(r) && world.kv.get("phase") === "ready",
  },
  {
    id: "v2-w2-set-two",
    category: "world-state",
    prompt: "Store 'x1' under the key 'left' and 'y2' under the key 'right'.",
    maxTurns: 8,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r, world) => finalOk(r) && world.kv.get("left") === "x1" && world.kv.get("right") === "y2",
  },
  {
    id: "v2-w3-transfer",
    category: "world-state",
    prompt: "Read the value stored under the key 'src2' and store that same value under the key 'dst2'.",
    maxTurns: 8,
    makeTools: (world: WorldState) => {
      world.kv.set("src2", "falcon");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("dst2") === "falcon",
  },
  {
    id: "v2-w4-swap",
    category: "world-state",
    prompt:
      "Swap the values stored under the keys 'p' and 'q': afterwards 'p' must hold what 'q' held and vice versa.",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("p", "one");
      world.kv.set("q", "two");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("p") === "two" && world.kv.get("q") === "one",
  },
  {
    id: "v2-w5-overwrite",
    category: "world-state",
    prompt: "The key 'mode' currently holds an old value. Overwrite it with the value 'new'.",
    maxTurns: 6,
    makeTools: (world: WorldState) => {
      world.kv.set("mode", "old");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("mode") === "new",
  },
  {
    id: "v2-w6-copy-twice",
    category: "world-state",
    prompt: "Read the value under the key 'base' and store it under BOTH keys 'c1' and 'c2'.",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("base", "m3W");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("c1") === "m3W" && world.kv.get("c2") === "m3W",
  },
  {
    id: "v2-w7-append",
    category: "world-state",
    prompt:
      "Read the value under the key 'name', append the text '-1' to it, and store the combined value under the key 'name-v2'.",
    maxTurns: 8,
    makeTools: (world: WorldState) => {
      world.kv.set("name", "ada");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("name-v2") === "ada-1",
  },
  {
    id: "v2-w8-numeric-string",
    category: "world-state",
    prompt: "Store the value '12345' under the key 'code'.",
    maxTurns: 6,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r, world) => finalOk(r) && world.kv.get("code") === "12345",
  },
  {
    id: "v2-w9-conditional-copy",
    category: "world-state",
    prompt:
      "Read the value under the key 'flag'. Only if it is exactly 'yes', read the value under 'data' and store it under 'out'.",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("flag", "yes");
      world.kv.set("data", "gold");
      return makeKvTools(world);
    },
    check: (r, world) => finalOk(r) && world.kv.get("out") === "gold",
  },
  {
    id: "v2-w10-report-two",
    category: "world-state",
    prompt: "Read the values under the keys 'u1' and 'u2' and tell me both.",
    maxTurns: 8,
    makeTools: (world: WorldState) => {
      world.kv.set("u1", "red");
      world.kv.set("u2", "blue");
      return makeKvTools(world);
    },
    check: (r) => finalOk(r) && /red/i.test(r.finalAnswer!) && /blue/i.test(r.finalAnswer!),
  },

  // ── no-tool (5) ─────────────────────────────────────────────────────
  {
    id: "v2-n1-capital-japan",
    category: "no-tool",
    prompt: "What is the capital of Japan? Answer with just the city name.",
    maxTurns: 4,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r) => finalOk(r) && /tokyo/i.test(r.finalAnswer!),
  },
  {
    id: "v2-n2-days-week",
    category: "no-tool",
    prompt: "How many days are in a week? Answer with just the number.",
    maxTurns: 4,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r) => numOk(r, 7),
  },
  {
    id: "v2-n3-symbol-gold",
    category: "no-tool",
    prompt: "What is the chemical symbol for gold? Answer with just the symbol.",
    maxTurns: 4,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r) => finalOk(r) && /\bau\b/i.test(r.finalAnswer!),
  },
  {
    id: "v2-n4-continent-egypt",
    category: "no-tool",
    prompt: "On which continent is Egypt? Answer with just the continent name.",
    maxTurns: 4,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r) => finalOk(r) && /africa/i.test(r.finalAnswer!),
  },
  {
    id: "v2-n5-sqrt-81",
    category: "no-tool",
    prompt: "What is the square root of 81? Answer with just the number.",
    maxTurns: 4,
    makeTools: (world: WorldState) => makeKvTools(world),
    check: (r) => numOk(r, 9),
  },

  // ── error-recovery (7) ──────────────────────────────────────────────
  {
    id: "v2-e1-unstable-1",
    category: "error-recovery",
    prompt:
      "Use the unstable.lookup tool to fetch the secret value and tell me what it is. The service may fail transiently — retry if it does.",
    maxTurns: 8,
    makeTools: (world: WorldState) => [makeUnstableTool(world, 1, "orchid7")],
    check: (r, world) =>
      finalOk(r) &&
      r.finalAnswer!.includes("orchid7") &&
      (world.counters.get("unstable.lookup") ?? 0) >= 2,
  },
  {
    id: "v2-e2-unstable-2",
    category: "error-recovery",
    prompt:
      "Use the unstable.lookup tool to fetch the secret value and tell me what it is. The service may fail transiently — retry if it does.",
    maxTurns: 10,
    makeTools: (world: WorldState) => [makeUnstableTool(world, 2, "binary9")],
    check: (r, world) =>
      finalOk(r) &&
      r.finalAnswer!.includes("binary9") &&
      (world.counters.get("unstable.lookup") ?? 0) >= 3,
  },
  {
    id: "v2-e3-unstable-store",
    category: "error-recovery",
    prompt:
      "Fetch the secret value with the unstable.lookup tool (retry on transient failures), then store it under the key 'result'.",
    maxTurns: 10,
    makeTools: (world: WorldState) => [makeUnstableTool(world, 1, "copper3"), ...makeKvTools(world)],
    check: (r, world) => finalOk(r) && world.kv.get("result") === "copper3",
  },
  {
    id: "v2-e4-flaky-set-1",
    category: "error-recovery",
    prompt:
      "Store the value 'done' under the key 'job'. The store may fail transiently — retry until it succeeds.",
    maxTurns: 8,
    makeTools: (world: WorldState) => [makeFlakyKvSet(world, 1)],
    check: (r, world) =>
      finalOk(r) && world.kv.get("job") === "done" && (world.counters.get("kv.set") ?? 0) >= 2,
  },
  {
    id: "v2-e5-unstable-1b",
    category: "error-recovery",
    prompt:
      "Use the unstable.lookup tool to fetch the secret value and tell me what it is. The service may fail transiently — retry if it does.",
    maxTurns: 8,
    makeTools: (world: WorldState) => [makeUnstableTool(world, 1, "quartz5")],
    check: (r, world) =>
      finalOk(r) &&
      r.finalAnswer!.includes("quartz5") &&
      (world.counters.get("unstable.lookup") ?? 0) >= 2,
  },
  {
    id: "v2-e6-flaky-set-2",
    category: "error-recovery",
    prompt:
      "Store the value 'ok' under the key 'status2'. The store may fail transiently — retry until it succeeds.",
    maxTurns: 10,
    makeTools: (world: WorldState) => [makeFlakyKvSet(world, 2)],
    check: (r, world) =>
      finalOk(r) && world.kv.get("status2") === "ok" && (world.counters.get("kv.set") ?? 0) >= 3,
  },
  {
    id: "v2-e7-unstable-calc",
    category: "error-recovery",
    prompt:
      "Fetch the secret number with the unstable.lookup tool (retry on transient failures), then multiply it by 3 with the calculator and tell me the result.",
    maxTurns: 10,
    makeTools: (world: WorldState) => [makeUnstableTool(world, 1, "17"), calculatorTool],
    check: (r, world) => numOk(r, 51) && (world.counters.get("unstable.lookup") ?? 0) >= 2,
  },

  // ── multi-tool (8) ──────────────────────────────────────────────────
  {
    id: "v2-x1-price-double",
    category: "multi-tool",
    prompt:
      "Read the number under the key 'price', double it with the calculator, and store the result under the key 'total'.",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("price", "21"); // doubled → total must be "42"
      return [...makeKvTools(world), calculatorTool];
    },
    check: (r, world) => finalOk(r) && world.kv.get("total") === "42",
  },
  {
    id: "v2-x2-sum-two-keys",
    category: "multi-tool",
    prompt:
      "Read the numbers under the keys 'a1' and 'b1', add them with the calculator, and tell me the sum.",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("a1", "19");
      world.kv.set("b1", "34");
      return [...makeKvTools(world), calculatorTool];
    },
    check: (r) => numOk(r, 53),
  },
  {
    id: "v2-x3-calc-store",
    category: "multi-tool",
    prompt: "Compute 37 * 3 with the calculator and store the result under the key 'calc-out'.",
    maxTurns: 10,
    makeTools: (world: WorldState) => [...makeKvTools(world), calculatorTool],
    check: (r, world) => finalOk(r) && world.kv.get("calc-out") === "111",
  },
  {
    id: "v2-x4-read-subtract",
    category: "multi-tool",
    prompt:
      "Read the numbers under the keys 'budget' and 'spent', subtract spent from budget with the calculator, and tell me what is left.",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("budget", "500");
      world.kv.set("spent", "137");
      return [...makeKvTools(world), calculatorTool];
    },
    check: (r) => numOk(r, 363),
  },
  {
    id: "v2-x5-conditional-calc",
    category: "multi-tool",
    prompt:
      "Read the number under the key 'n'. If it is greater than 10, multiply it by 5 with the calculator; otherwise multiply it by 2. Tell me the result.",
    maxTurns: 10,
    makeTools: (world: WorldState) => {
      world.kv.set("n", "16");
      return [...makeKvTools(world), calculatorTool];
    },
    check: (r) => numOk(r, 80),
  },
  {
    id: "v2-x6-sum-store",
    category: "multi-tool",
    prompt: "Compute 29 + 46 with the calculator and store the result under the key 'sum-out'.",
    maxTurns: 10,
    makeTools: (world: WorldState) => [...makeKvTools(world), calculatorTool],
    check: (r, world) => finalOk(r) && world.kv.get("sum-out") === "75",
  },
  {
    id: "v2-x7-square-store",
    category: "multi-tool",
    prompt:
      "Read the number under the key 'base2', square it with the calculator (multiply it by itself), and store the result under the key 'squared'.",
    maxTurns: 12,
    makeTools: (world: WorldState) => {
      world.kv.set("base2", "11");
      return [...makeKvTools(world), calculatorTool];
    },
    check: (r, world) => finalOk(r) && world.kv.get("squared") === "121",
  },
  {
    id: "v2-x8-clock-log",
    category: "multi-tool",
    prompt:
      "Get the current time in the timezone Europe/Berlin with the clock tool, tell me the time, and store the value 'checked' under the key 'clock-log'.",
    maxTurns: 10,
    makeTools: (world: WorldState) => [...makeKvTools(world), clockTool],
    check: (r, world) =>
      finalOk(r) && world.kv.get("clock-log") === "checked" && TIME_RE.test(r.finalAnswer!),
  },
];
