import { describe, it, expect } from "@jest/globals";
import {
  normalizeBfclParameters,
  matchesGroundTruth,
  buildBfclTasks,
  type BfclEntry,
  type BfclGroundTruth,
} from "../bench/bfcl/convert.js";
import { WorldState } from "../bench/world.js";
import type { BenchRunResult } from "../bench/types.js";

// Fixtures mirror the real BFCL_v4_simple_python.json shapes (pinned 6ea5797).
const simpleEntry: BfclEntry = {
  id: "simple_python_0",
  question: [
    [{ role: "user", content: "Find the area of a triangle with a base of 10 units and height of 5 units." }],
  ],
  function: [
    {
      name: "calculate_triangle_area",
      description: "Calculate the area of a triangle given its base and height.",
      parameters: {
        type: "dict",
        properties: {
          base: { type: "integer", description: "The base of the triangle." },
          height: { type: "integer", description: "The height of the triangle." },
          unit: { type: "string", description: "The unit of measure" },
        },
        required: ["base", "height"],
      },
    },
  ],
};

const groundTruth: BfclGroundTruth = [
  { calculate_triangle_area: { base: [10], height: [5], unit: ["units", ""] } },
];

function resultStub(overrides: Partial<BenchRunResult> = {}): BenchRunResult {
  return {
    finalAnswer: "answer",
    terminatedReason: "final_answer",
    turns: 2,
    llmCalls: 2,
    tokens: 10,
    latencyMs: 5,
    toolCallCount: 1,
    ...overrides,
  };
}

describe("normalizeBfclParameters", () => {
  it("maps BFCL's dict/float/tuple types to JSON Schema recursively", () => {
    const norm = normalizeBfclParameters({
      type: "dict",
      properties: {
        ratio: { type: "float", description: "x" },
        pair: { type: "tuple", items: { type: "float" } },
        nested: { type: "dict", properties: { n: { type: "integer" } } },
      },
      required: ["ratio"],
    });
    expect(norm.type).toBe("object");
    const props = norm.properties as Record<string, { type?: string; items?: { type?: string } }>;
    expect(props.ratio!.type).toBe("number");
    expect(props.pair!.type).toBe("array");
    expect(props.pair!.items!.type).toBe("number");
    expect(props.nested!.type).toBe("object");
    expect(norm.required).toEqual(["ratio"]);
  });
});

describe("matchesGroundTruth", () => {
  it("accepts a call whose args hit the allowed values (optional param omitted)", () => {
    expect(
      matchesGroundTruth({ name: "calculate_triangle_area", args: { base: 10, height: 5 } }, groundTruth),
    ).toBe(true);
  });

  it("accepts an optional param when it matches an allowed value", () => {
    expect(
      matchesGroundTruth(
        { name: "calculate_triangle_area", args: { base: 10, height: 5, unit: "Units" } },
        groundTruth,
      ),
    ).toBe(true); // string compare is case-insensitive
  });

  it("rejects wrong values, wrong names, missing required and unknown params", () => {
    expect(matchesGroundTruth({ name: "calculate_triangle_area", args: { base: 11, height: 5 } }, groundTruth)).toBe(false);
    expect(matchesGroundTruth({ name: "other_function", args: { base: 10, height: 5 } }, groundTruth)).toBe(false);
    expect(matchesGroundTruth({ name: "calculate_triangle_area", args: { base: 10 } }, groundTruth)).toBe(false);
    expect(
      matchesGroundTruth({ name: "calculate_triangle_area", args: { base: 10, height: 5, extra: 1 } }, groundTruth),
    ).toBe(false);
  });

  it("compares numbers by value (int 10 == float 10.0) but not strings to numbers", () => {
    expect(matchesGroundTruth({ name: "calculate_triangle_area", args: { base: 10.0, height: 5 } }, groundTruth)).toBe(true);
    expect(matchesGroundTruth({ name: "calculate_triangle_area", args: { base: "10", height: 5 } }, groundTruth)).toBe(false);
  });

  it("compares lists elementwise", () => {
    const gt: BfclGroundTruth = [{ fn: { xs: [[1, 2]] } }];
    expect(matchesGroundTruth({ name: "fn", args: { xs: [1, 2] } }, gt)).toBe(true);
    expect(matchesGroundTruth({ name: "fn", args: { xs: [2, 1] } }, gt)).toBe(false);
  });
});

describe("buildBfclTasks", () => {
  it("builds a simple task that records the first executed call and scores it", async () => {
    const [task] = buildBfclTasks({
      simple: [{ entry: simpleEntry, groundTruth }],
      irrelevance: [],
    });
    const world = new WorldState();
    const tools = task!.makeTools(world);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("calculate_triangle_area");

    await tools[0]!.execute({ base: 10, height: 5 });
    expect(task!.check(resultStub(), world)).toBe(true);

    const world2 = new WorldState();
    const tools2 = task!.makeTools(world2);
    await tools2[0]!.execute({ base: 3, height: 5 });
    expect(task!.check(resultStub(), world2)).toBe(false);
  });

  it("scores irrelevance as success only when no tool call was attempted", () => {
    const [task] = buildBfclTasks({
      simple: [],
      irrelevance: [{ entry: simpleEntry }],
    });
    const world = new WorldState();
    task!.makeTools(world);
    expect(task!.check(resultStub({ toolCallCount: 0 }), world)).toBe(true);
    expect(task!.check(resultStub({ toolCallCount: 1 }), world)).toBe(false);
    expect(task!.check(resultStub({ toolCallCount: 0, finalAnswer: null }), world)).toBe(false);
  });
});
