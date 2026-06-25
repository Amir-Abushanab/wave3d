import { defineConfig } from "vite";

// The studio app. The embeddable runtime is built separately via
// `vite.embed.config.ts` (pnpm build:embed).
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
