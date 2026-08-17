/**
 * Offscreen thumbnail rendering: turn a config into a still frame with one hidden, reused
 * WaveRenderer. Used by the studio's preset + history thumbnails and by the wave gallery grid.
 */
import type { WaveRenderer } from "../renderer/WaveRenderer";
import type { StudioConfig } from "../config/model";

/** A hidden host div that is in layout (so clientWidth/Height are real) but off-screen. */
export function createThumbHost(width: number, height: number): HTMLDivElement {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;opacity:0;pointer-events:none;`;
  document.body.appendChild(host);
  return host;
}

/** Luminance (0..1) of a solid `#rrggbb` background, or null if the background isn't a plain colour
 *  (gradient / image — no single swatch to judge). */
function solidBgLuminance(cfg: StudioConfig): number | null {
  if (cfg.backgroundMode !== "color") return null;
  const m = /^#?([\da-f]{6})$/i.exec(cfg.background ?? "");
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/** Mutate `cfg` for a thumbnail still: static frame, opaque, and a background chosen to show the
 *  wave off. */
export function prepThumbConfig(cfg: StudioConfig): void {
  cfg.paused = true;
  cfg.transparentBackground = false;
  // Keep the authored background when the preset was designed on a dark ground: wireframe (its
  // between-line colour keys off the dark page), or any solid theme on its own dark, opaque colour
  // (e.g. Latte Ring — a warm ring that a white card just washes out). A bright wave reads fine
  // against dark and bloom behaves there.
  const lum = solidBgLuminance(cfg);
  if (cfg.waves[0]?.theme === "wireframe" || (lum !== null && lum < 0.22)) return;
  // Otherwise swap in a white card so the SHAPE stands out, and zero the light-scatter passes: they
  // were tuned against the dark original, and white sits far above any sane threshold, so they'd
  // bloom the card itself and wash the frame out (a bloomed preset rendered a blank white thumbnail
  // — 0.3% non-white pixels — until this zeroed them).
  cfg.background = "#ffffff";
  cfg.bloomStrength = 0;
  cfg.innerLight = 0;
}

/** Render the current config to a fresh 2D canvas (null if the WebGL canvas is missing). */
export function renderThumbFrame(
  renderer: WaveRenderer,
  host: HTMLElement,
): HTMLCanvasElement | null {
  renderer.resize();
  renderer.renderOnce();
  renderer.renderOnce(); // 2nd pass so any shader recompile (theme/blend variant) is applied
  const gl = host.querySelector("canvas");
  if (!gl) return null;
  // Copy to a 2D canvas before encoding (reliable read of the WebGL drawing buffer).
  const out = document.createElement("canvas");
  out.width = gl.width;
  out.height = gl.height;
  out.getContext("2d")?.drawImage(gl, 0, 0);
  return out;
}
