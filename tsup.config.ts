import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "server-main": "src/server/main.ts" },
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  sourcemap: true,
  clean: true,
  target: "es2022",
  // tsup v8 strips the node: protocol by default; "sqlite" only exists AS
  // node:sqlite, so the stripped import crashes at runtime.
  removeNodeProtocol: false,
});
