/**
 * The offscreen-thumbnail core shared by presetThumbs.ts and historyThumbs.ts. Both render a
 * config to a still frame with one hidden reused WaveRenderer; only their orchestration differs
 * (one-shot loop over presets vs a lazy queue keyed by history-entry id).
 */
import type { WaveRenderer } from "@wave3d/core/renderer";
import type { StudioConfig } from "@wave3d/core";

/** A hidden host div that is in layout (so clientWidth/Height are real) but off-screen. */
export function createThumbHost(width: number, height: number): HTMLDivElement {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;opacity:0;pointer-events:none;`;
  document.body.appendChild(host);
  return host;
}

/** Mutate `cfg` for a thumbnail still: static frame, opaque, white page behind solid themes
 *  (wireframe keys its between-line colour off the dark page background, so keep it). */
export function prepThumbConfig(cfg: StudioConfig): void {
  cfg.paused = true;
  cfg.transparentBackground = false;
  if (cfg.waves[0]?.theme !== "wireframe") cfg.background = "#ffffff";
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
