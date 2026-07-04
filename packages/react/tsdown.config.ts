import { defineConfig } from "tsdown";

// @wave3d/react: a single ESM entry with types. react and @wave3d/core stay external (peers).
export default defineConfig({
  entry: ["src/index.tsx"],
  format: "esm",
  dts: true,
  sourcemap: true,
  external: ["react", "react/jsx-runtime", "@wave3d/core", /^@wave3d\/core\//],
  platform: "browser",
  target: "es2022",
  outDir: "dist",
});
