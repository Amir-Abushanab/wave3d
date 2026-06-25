import { defineConfig } from "vite";
import { resolve } from "node:path";

// Builds the drop-in embed runtime: a single ES module with Three.js bundled in,
// exposing mountWave(). Output: dist-embed/wave-studio-embed.js
export default defineConfig({
  build: {
    outDir: "dist-embed",
    emptyOutDir: true,
    target: "es2022",
    lib: {
      entry: resolve(import.meta.dirname, "embed/index.ts"),
      name: "WaveStudio",
      fileName: () => "wave-studio-embed.js",
      formats: ["es"],
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
