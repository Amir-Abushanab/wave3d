import { defineConfig } from "vite";
import { resolve } from "node:path";

// Serves the parity harness. `root` is this directory; the gallery JSON it globs lives two levels
// up, so `fs.allow` has to reach the repo root.
export default defineConfig({
  root: resolve(import.meta.dirname),
  server: {
    port: 5177,
    strictPort: true,
    fs: { allow: [resolve(import.meta.dirname, "../../..")] },
  },
});
