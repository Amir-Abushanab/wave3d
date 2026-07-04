import { defineConfig } from "tsdown";

// @wave3d/element: a single ESM entry with types. @wave3d/core stays external (a peer).
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  sourcemap: true,
  external: ["@wave3d/core", /^@wave3d\/core\//],
  platform: "browser",
  target: "es2022",
  outDir: "dist",
});
