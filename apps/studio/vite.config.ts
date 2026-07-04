import { defineConfig } from "vite";

// The studio app. The embeddable @wave3d/core runtime is built separately via the core package's
// `build:standalone` script (run by this app's predev/prebuild hooks).
export default defineConfig({
  base: "./",
  // Serve the pre-bundled framework-free runtime in dev and copy it into the studio build.
  // The HTML exporter fetches this asset and inlines it into the downloaded file.
  publicDir: "../../packages/core/dist/standalone",
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
