import { defineConfig } from "vite";

// The studio app. The embeddable runtime is built separately via
// `vite.embed.config.ts` (pnpm build:embed).
export default defineConfig({
  base: "./",
  // Serve the pre-bundled framework-free runtime in dev and copy it into the studio build.
  // The HTML exporter fetches this asset and inlines it into the downloaded file.
  publicDir: "dist-embed",
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
