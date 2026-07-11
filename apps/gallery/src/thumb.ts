/**
 * Offscreen thumbnail rendering: turn a config into a still frame with one hidden, reused
 * WaveRenderer. A copy of apps/studio/src/ui/thumbnailRender.ts.
 * TODO: lift this into @wave3d/core/studio so the studio and gallery share a single copy.
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

/** Mutate `cfg` for a thumbnail still: static frame, opaque, white page behind solid themes. */
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
  const out = document.createElement("canvas");
  out.width = gl.width;
  out.height = gl.height;
  out.getContext("2d")?.drawImage(gl, 0, 0);
  return out;
}
