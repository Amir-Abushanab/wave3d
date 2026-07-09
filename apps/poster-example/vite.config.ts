import { defineConfig } from "vite";
import { wave3dPoster } from "@wave3d/vite";

export default defineConfig({
  plugins: [wave3dPoster()],
});
