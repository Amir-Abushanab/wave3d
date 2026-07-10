import { defineConfig } from "tsdown";

// @wave3d/vite: two ESM entries with types — the Node plugin (`.`) and the browser client
// (`./client`, `registerPoster`). The neutral platform keeps output as `.js` (matching publishConfig),
// so vite (a peer) and the node builtins the plugin uses are externalized explicitly.
export default defineConfig({
  entry: ["src/index.ts", "src/client.ts"],
  format: "esm",
  dts: true,
  sourcemap: true,
  external: ["vite", /^node:/],
  platform: "neutral",
  target: "es2022",
  outDir: "dist",
});
