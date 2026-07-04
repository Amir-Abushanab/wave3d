// The single-file CDN / standalone build entry. Unlike the `.` shell — which fetches the engine on
// demand — this statically imports the engine (three bundled in) and pre-binds createWave/mountWave
// with a synchronous loadCore, so a plain <script type="module"> from a CDN upgrades with no extra
// network round-trip. This is also the runtime the studio inlines into its exported embed HTML.
import * as core from "./core-loader";
import { createWave as createWaveShell } from "./shell/createWave";
import type { WaveOptions, WaveHandle } from "./shell/createWave";
import type { StudioConfig } from "./config/model";

const loadCore = (): Promise<typeof core> => Promise.resolve(core);

/** {@link createWave} with the engine already bundled in (synchronous upgrade). */
export function createWave(
  container: HTMLElement,
  config?: Partial<StudioConfig>,
  options?: WaveOptions,
): WaveHandle {
  return createWaveShell(container, config, { loadCore, ...options });
}

/** The drop-in embed contract: an alias of {@link createWave}. */
export const mountWave = createWave;

// CDN users get the raw engine, presets, and full model directly too.
export { WaveRenderer } from "./renderer/WaveRenderer";
export { PRESETS } from "./presets";
export * from "./config/model";
export type { WaveOptions, WaveHandle, WaveState, FallbackReason } from "./shell/createWave";
