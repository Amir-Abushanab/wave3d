/**
 * The single-file CDN / standalone build WITH the TSL (WebGPU) backend bundled in.
 *
 * A second artifact rather than an option on the first: this build has code splitting disabled so
 * it stays one file (the studio inlines it as a single Blob into exported embed HTML), which means
 * a dynamic import would be inlined rather than split out. Every consumer of the plain standalone
 * would then pay for three's node system — 419 KB gzipped against 197 KB — whether or not they
 * ever ask for WebGPU. Keeping them separate lets each artifact carry exactly what it needs.
 *
 * Defaults to `backend: "auto"`, since anyone reaching for this file has already chosen to pay for
 * the backend and would otherwise get the WebGL renderer with the node system dead-weight beside it.
 */
import * as core from "./core-loader";
import { createWaveImpl } from "./shell/createWave";
import type { WaveOptions, WaveHandle } from "./shell/createWave";
import type { StudioConfig } from "./config/model";

const loadCore = (): Promise<typeof core> => Promise.resolve(core);
const loadGpu = () => import("./renderer/gpu-loader");

/** {@link createWaveImpl} with both the engine and the TSL backend bundled in. */
export function createWave(
  container: HTMLElement,
  config: Partial<StudioConfig> = {},
  options: WaveOptions = {},
): WaveHandle {
  return createWaveImpl(loadCore, loadGpu, container, config, {
    backend: "auto",
    ...options,
  });
}

/** The drop-in embed contract: an alias of {@link createWave}. */
export const mountWave = createWave;

export { WaveRenderer } from "./renderer/WaveRenderer";
export { WaveRendererGPU } from "./renderer/WaveRendererGPU";
export { PRESETS } from "./presets";
export * from "./config/model";
export type {
  WaveOptions,
  WaveHandle,
  WaveState,
  FallbackReason,
  SnapshotOptions,
} from "./shell/createWave";
