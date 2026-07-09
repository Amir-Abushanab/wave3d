import { defineConfig } from "tsdown";

// @wave3d/vite: two ESM entries with types — the Node plugin (`.`) and the browser client
// (`./client`, `registerPoster`). vite stays external (a peer); node builtins are external on the
// node platform.
export default defineConfig({
  entry: ["src/index.ts", "src/client.ts"],
  format: "esm",
  dts: true,
  sourcemap: true,
  external: ["vite"],
  platform: "neutral",
  target: "es2022",
  outDir: "dist",
});
