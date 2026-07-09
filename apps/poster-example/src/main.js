import "@wave3d/element"; // registers <wave-3d>
import { createWave } from "@wave3d/core";
import { registerPoster } from "@wave3d/vite/client";
import { tweak } from "./wave-config.js";

// (1) The <wave-3d> element is auto-captured by the plugin (its data-wave3d-poster-out attribute).
const el = document.querySelector("wave-3d");
const apply = (t) => {
  el.config = t;
};
apply(tweak);

// (2) A second wave via createWave() — no <wave-3d> node, so opt it in explicitly. registerPoster()
// takes a handle (here) or a WaveRenderer (React's onReady). Each poster is keyed by its output
// filename, so multiple waves capture and dedup independently.
const second = createWave(document.getElementById("second"), {}, { webgl: "force", lazy: false });
registerPoster(second, "second.webp");

// HMR: edit wave-config.js to change the <wave-3d> — @wave3d/vite re-captures hero.webp. Edit any
// other file and the config-hash dedup skips the write. The plugin is dev-only; `vite build` just
// references the committed posters.
if (import.meta.hot) {
  import.meta.hot.accept("./wave-config.js", (mod) => {
    if (mod) apply(mod.tweak);
  });
}
