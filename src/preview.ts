// Dev-only: renders the wave full-frame on white (no UI panel) so the default
// composition/colours can be checked in isolation. Not part of the production build.
import { WaveRenderer } from "./wave/WaveRenderer";
import { createDefaultConfig } from "./wave/config";

const stage = document.getElementById("stage") as HTMLElement;
const config = createDefaultConfig();
config.transparentBackground = false;
config.background = "#ffffff";
const renderer = new WaveRenderer(stage, config);
renderer.start();
(window as unknown as { wave: unknown }).wave = { renderer, config };
