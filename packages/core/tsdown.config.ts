import { defineConfig } from "tsdown";

// The publishable @wave3d/core build: one output module per source module (unbundled), so the
// dynamic import of ./core-loader stays a separate chunk and three tree-shakes out of the shell.
// three stays external (a peer dependency). The single-file CDN build is separate — see
// tsdown.standalone.config.ts.
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/renderer/index.ts",
    "src/presets.ts",
    "src/studio/index.ts",
    // Included for its .d.ts (the ./standalone export's `default` points at the vite single-file
    // build, which emits no types); this also gives bundler users an external-three standalone entry.
    "src/standalone.ts",
  ],
  format: "esm",
  dts: true,
  sourcemap: true,
  unbundle: true,
  external: ["three", /^three\//],
  platform: "browser",
  target: "es2022",
  outDir: "dist",
});
