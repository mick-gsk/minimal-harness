import { describe, it, expect } from "@jest/globals";
import { WorldState } from "../bench/world.js";
import { makeKvTools } from "../bench/world.js";

describe("WorldState kv tools", () => {
  it("kv.set writes into the world's map", async () => {
    const world = new WorldState();
    const tools = makeKvTools(world);
    const set = tools.find((t) => t.name === "kv.set")!;
    await set.execute({ key: "color", value: "blue" });
    expect(world.kv.get("color")).toBe("blue");
  });

  it("kv.get reads from the world's map", async () => {
    const world = new WorldState();
    world.kv.set("answer", "42");
    const tools = makeKvTools(world);
    const get = tools.find((t) => t.name === "kv.get")!;
    const out = (await get.execute({ key: "answer" })) as { value: string | null };
    expect(out.value).toBe("42");
  });

  it("kv.get returns null for a missing key", async () => {
    const world = new WorldState();
    const get = makeKvTools(world).find((t) => t.name === "kv.get")!;
    const out = (await get.execute({ key: "nope" })) as { value: string | null };
    expect(out.value).toBeNull();
  });

  it("two worlds are isolated", async () => {
    const a = new WorldState();
    const b = new WorldState();
    const setA = makeKvTools(a).find((t) => t.name === "kv.set")!;
    await setA.execute({ key: "k", value: "v" });
    expect(b.kv.has("k")).toBe(false);
  });
});

describe("flaky tools (error-recovery category)", () => {
  it("makeUnstableTool fails the first N calls, then returns the value and counts attempts", async () => {
    const { makeUnstableTool } = await import("../bench/world.js");
    const world = new WorldState();
    const tool = makeUnstableTool(world, 2, "orchid7");
    await expect(tool.execute({})).rejects.toThrow(/temporarily unavailable/);
    await expect(tool.execute({})).rejects.toThrow(/temporarily unavailable/);
    const out = (await tool.execute({})) as { value: string };
    expect(out.value).toBe("orchid7");
    expect(world.counters.get("unstable.lookup")).toBe(3);
  });

  it("makeFlakyKvSet fails the first N calls, then stores and counts attempts", async () => {
    const { makeFlakyKvSet } = await import("../bench/world.js");
    const world = new WorldState();
    const tool = makeFlakyKvSet(world, 1);
    expect(tool.name).toBe("kv.set");
    await expect(tool.execute({ key: "job", value: "done" })).rejects.toThrow(/temporarily unavailable/);
    expect(world.kv.has("job")).toBe(false);
    await tool.execute({ key: "job", value: "done" });
    expect(world.kv.get("job")).toBe("done");
    expect(world.counters.get("kv.set")).toBe(2);
  });

  it("counters are isolated between worlds", async () => {
    const { makeUnstableTool } = await import("../bench/world.js");
    const a = new WorldState();
    const b = new WorldState();
    const toolA = makeUnstableTool(a, 0, "x");
    await toolA.execute({});
    expect(b.counters.has("unstable.lookup")).toBe(false);
  });
});
