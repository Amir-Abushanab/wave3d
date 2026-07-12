import { defineConfig } from "vite";
import { resolve } from "node:path";

// One app, two pages: the studio at "/" and the wave gallery at "/gallery/". The embeddable
// @wave3d/core runtime is built separately via the core package's `build:standalone` (predev/prebuild);
// the HTML exporter fetches that asset and inlines it into the downloaded file.
const root = import.meta.dirname;
export default defineConfig({
  base: "/",
  publicDir: "../../packages/core/dist/standalone",
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      input: {
        studio: resolve(root, "index.html"),
        gallery: resolve(root, "gallery/index.html"),
      },
    },
  },
});
