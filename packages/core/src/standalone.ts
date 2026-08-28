// The single-file CDN / standalone build entry. Unlike the `.` shell — which fetches the engine on
// demand — this statically imports the engine (three bundled in) and pre-binds createWave/mountWave
// with a synchronous loadCore, so a plain <script type="module"> from a CDN upgrades with no extra
// network round-trip. This is also the runtime the studio inlines into its exported embed HTML.
import * as core from "./core-loader";
import { createWaveImpl, noGpuBackend } from "./shell/createWave";
import type { WaveOptions, WaveHandle } from "./shell/createWave";
import type { StudioConfig } from "./config/model";

// Synchronous core — the engine is already bundled into this file, so there is no dynamic import
// (which is exactly why the standalone stays a single file: createWaveImpl never references the
// public createWave's `import("./core-loader")` default).
const loadCore = (): Promise<typeof core> => Promise.resolve(core);

/**
 * {@link createWaveImpl} with the engine already bundled in (synchronous upgrade).
 *
 * WebGL only. This artifact is emitted with code splitting disabled — the studio inlines it as a
 * single Blob into exported embed HTML — so a dynamic import here would be INLINED rather than
 * split out, taking the whole node system with it (419 KB gzipped against 197 KB). Builds that
 * want the TSL backend use `standalone.webgpu.ts`, which is a separate artifact.
 */
export function createWave(
  container: HTMLElement,
  config: Partial<StudioConfig> = {},
  options: WaveOptions = {},
): WaveHandle {
  return createWaveImpl(loadCore, noGpuBackend, container, config, options);
}

/** The drop-in embed contract: an alias of {@link createWave}. */
export const mountWave = createWave;

// CDN users get the raw engine, presets, and full model directly too.
export { WaveRenderer } from "./renderer/WaveRenderer";
export { PRESETS } from "./presets";
export * from "./config/model";
export type {
  WaveOptions,
  WaveHandle,
  WaveState,
  FallbackReason,
  SnapshotOptions,
} from "./shell/createWave";
