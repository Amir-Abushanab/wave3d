import { defineConfig } from "vite";
import { resolve } from "node:path";

// The single-file CDN / standalone build. Vite's lib mode with codeSplitting disabled reliably
// emits ONE self-contained file (three bundled, runtime helpers inlined) — required because the
// studio inlines this file as one Blob into its exported embed HTML. (tsdown/rolldown extracts a
// shared runtime-helper chunk here, which would break the single-Blob inline; tsdown builds the
// tree-shakeable main package — see tsdown.config.ts.) Output: dist/standalone/wave3d.standalone.js
export default defineConfig({
  build: {
    outDir: "dist/standalone",
    emptyOutDir: true,
    target: "es2022",
    lib: {
      entry: resolve(import.meta.dirname, "src/standalone.ts"),
      name: "Wave3D",
      fileName: () => "wave3d.standalone.js",
      formats: ["es"],
    },
    rolldownOptions: {
      output: { codeSplitting: false },
    },
  },
});
