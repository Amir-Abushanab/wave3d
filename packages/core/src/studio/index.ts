// The `@wave3d/core/studio` entry: studio-facing helpers layered on the renderer core.
import type { StudioWaveRenderer } from "./StudioWaveRenderer";

export * from "./randomize";
export { StudioWaveRenderer } from "./StudioWaveRenderer";
export { createThumbHost, prepThumbConfig, renderThumbFrame } from "./thumbnail";

/**
 * Fetch the TSL/WebGPU studio renderer — a drop-in for {@link StudioWaveRenderer} (construct, then
 * `await renderer.init()` before the first draw). Behind a dynamic import so `three/webgpu`
 * (~197 KB gzipped) never enters the eager studio graph; the boundary is enforced by
 * `scripts/check-webgpu-chunk.mjs`.
 */
export async function loadStudioWaveRendererGPU(): Promise<typeof StudioWaveRenderer> {
  return (await import("./StudioWaveRendererGPU")).StudioWaveRendererGPU;
}
