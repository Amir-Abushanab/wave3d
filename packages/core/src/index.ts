import { WaveRenderer } from "./renderer/WaveRenderer";
import type { WaveRendererOptions } from "./renderer/WaveRenderer";
import { createDefaultConfig } from "./config/model";
import type { StudioConfig } from "./config/model";

// Re-export the full config model (types, factories, MAX_* constants, presets, normalizers) so
// consumers can `import { PRESETS, createDefaultConfig, StudioConfig, … } from "@wave3d/core"`.
export * from "./config/model";
export { WaveRenderer };
export type { WaveRendererOptions };

export interface WaveHandle {
  readonly renderer: WaveRenderer;
  /** Replace the whole config and re-render. */
  set(config: StudioConfig): void;
  destroy(): void;
}

/**
 * Mount a wave into a container. Pass a config exported from Wave Studio
 * (a full {@link StudioConfig}); omitted fields fall back to the defaults.
 */
export function mountWave(
  container: HTMLElement,
  config?: Partial<StudioConfig>,
  options?: WaveRendererOptions,
): WaveHandle {
  const full: StudioConfig = { ...createDefaultConfig(), ...config };
  const renderer = new WaveRenderer(container, full, options);
  renderer.start();
  return {
    renderer,
    set(next: StudioConfig) {
      renderer.setConfig(next);
    },
    destroy() {
      renderer.dispose();
    },
  };
}
