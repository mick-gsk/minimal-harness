/**
 * Isolated bridge smoke (no model): proves the World-HTTP-Bridge mutates the one
 * real WorldState and reports tool errors. Run: npx tsx bench/smoke-bridge.ts
 */
import { WorldState, makeKvTools, makeUnstableTool } from "./world.js";
import { startWorldBridge } from "./bridge/world-http-bridge.js";

const world = new WorldState();
const tools = [...makeKvTools(world), makeUnstableTool(world, 1, "SECRET42")];
const bridge = await startWorldBridge(tools);

async function call(name: string, args: unknown): Promise<unknown> {
  const r = await fetch(`${bridge.url}/tool/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args }),
  });
  return { status: r.status, body: await r.json() };
}

console.log("set:", JSON.stringify(await call("kv.set", { key: "a", value: "hello" })));
console.log("get:", JSON.stringify(await call("kv.get", { key: "a" })));
console.log("unknown:", JSON.stringify(await call("nope", {})));
console.log("unstable#1 (should fail):", JSON.stringify(await call("unstable.lookup", {})));
console.log("unstable#2 (should ok):", JSON.stringify(await call("unstable.lookup", {})));

await bridge.close();

const ok =
  world.kv.get("a") === "hello" && (world.counters.get("unstable.lookup") ?? 0) === 2;
console.log(ok ? "BRIDGE_OK" : "BRIDGE_FAIL");
process.exit(ok ? 0 : 1);
