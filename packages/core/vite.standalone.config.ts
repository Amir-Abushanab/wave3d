import { defineConfig } from "vite";
import { resolve } from "node:path";

// Two artifacts, selected by WAVE3D_STANDALONE:
//   (default) wave3d.standalone.js        — WebGL only, ~197 KB gzipped
//   webgpu    wave3d.standalone.webgpu.js — adds the TSL backend, ~419 KB gzipped
//
// They cannot be one file with an option. codeSplitting is off so the output stays a single file
// (the studio inlines it as one Blob into exported embed HTML), which means a dynamic import is
// INLINED rather than split out — so a combined build would charge every plain-standalone consumer
// for three's node system. See src/standalone.webgpu.ts.
const webgpu = process.env.WAVE3D_STANDALONE === "webgpu";

// The single-file CDN / standalone build. Vite's lib mode with codeSplitting disabled reliably
// emits ONE self-contained file (three bundled, runtime helpers inlined) — required because the
// studio inlines this file as one Blob into its exported embed HTML. (tsdown/rolldown extracts a
// shared runtime-helper chunk here, which would break the single-Blob inline; tsdown builds the
// tree-shakeable main package — see tsdown.config.ts.) Output: dist/standalone/wave3d.standalone.js
export default defineConfig({
  build: {
    outDir: "dist/standalone",
    emptyOutDir: !webgpu, // the second pass must not delete the first artifact
    target: "es2022",
    lib: {
      entry: resolve(
        import.meta.dirname,
        webgpu ? "src/standalone.webgpu.ts" : "src/standalone.ts",
      ),
      name: "Wave3D",
      fileName: () => (webgpu ? "wave3d.standalone.webgpu.js" : "wave3d.standalone.js"),
      formats: ["es"],
    },
    rolldownOptions: {
      output: { codeSplitting: false },
    },
  },
});
