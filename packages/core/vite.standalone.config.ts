import { defineConfig } from "vite";
import { resolve } from "node:path";

// Interim standalone build (Phase 1): a single ES module with Three.js bundled in, exposing
// mountWave() — the drop-in runtime the studio's HTML export inlines. Output:
// dist/standalone/wave3d.standalone.js. Phase 6 replaces this with a tsdown-driven build.
export default defineConfig({
  build: {
    outDir: "dist/standalone",
    emptyOutDir: true,
    target: "es2022",
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      name: "Wave3D",
      fileName: () => "wave3d.standalone.js",
      formats: ["es"],
    },
    rolldownOptions: {
      output: { codeSplitting: false },
    },
  },
});
