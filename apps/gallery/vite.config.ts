import { defineConfig } from "vite";

// Deployed under /gallery/ on the studio's origin: the studio serves "/", the gallery "/gallery/".
// Reads gallery/waves/*.json from the repo root (Vite allows the pnpm workspace root by default).
export default defineConfig({
  base: "/gallery/",
  // Fixed port so the studio's dev server can proxy /gallery here (see apps/studio/vite.config.ts).
  server: { port: 5174, strictPort: true },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
