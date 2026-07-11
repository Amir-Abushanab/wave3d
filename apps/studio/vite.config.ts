import { defineConfig } from "vite";

// The studio app. The embeddable @wave3d/core runtime is built separately via the core package's
// `build:standalone` script (run by this app's predev/prebuild hooks).
export default defineConfig({
  base: "./",
  // Serve the pre-bundled framework-free runtime in dev and copy it into the studio build.
  // The HTML exporter fetches this asset and inlines it into the downloaded file.
  publicDir: "../../packages/core/dist/standalone",
  // Dev only: proxy /gallery to the gallery's own dev server (:5174) so dev matches the deployed
  // layout, where the studio is at / and the gallery at /gallery/. `pnpm dev:site` runs both.
  server: {
    proxy: {
      "/gallery": { target: "http://localhost:5174", ws: true },
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
