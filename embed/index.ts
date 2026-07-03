import { WaveRenderer } from "../src/wave/WaveRenderer";
import type { WaveRendererOptions } from "../src/wave/WaveRenderer";
import { createDefaultConfig } from "../src/wave/config";
import type { StudioConfig } from "../src/wave/config";

export { WaveRenderer, createDefaultConfig };
export type { StudioConfig, WaveRendererOptions };

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
