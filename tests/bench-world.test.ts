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
