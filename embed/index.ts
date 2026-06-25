import { WaveRenderer } from "../src/wave/WaveRenderer";
import type { WaveRendererOptions } from "../src/wave/WaveRenderer";
import { createDefaultConfig } from "../src/wave/config";
import type { WaveConfig } from "../src/wave/config";

export { WaveRenderer, createDefaultConfig };
export type { WaveConfig, WaveRendererOptions };

export interface WaveHandle {
  readonly renderer: WaveRenderer;
  /** Replace the whole config and re-render. */
  set(config: WaveConfig): void;
  destroy(): void;
}

/**
 * Mount a wave into a container. Pass a config exported from Wave Studio
 * (a full {@link WaveConfig}); omitted fields fall back to the defaults.
 */
export function mountWave(
  container: HTMLElement,
  config?: Partial<WaveConfig>,
  options?: WaveRendererOptions,
): WaveHandle {
  const full: WaveConfig = { ...createDefaultConfig(), ...config };
  const renderer = new WaveRenderer(container, full, options);
  renderer.start();
  return {
    renderer,
    set(next: WaveConfig) {
      renderer.setConfig(next);
    },
    destroy() {
      renderer.dispose();
    },
  };
}
