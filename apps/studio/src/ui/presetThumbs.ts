/**
 * Preset thumbnails: a small wave-shape snapshot of each preset, rendered ONCE offscreen and
 * cached, so the preset picker can show what each wave looks like (most presets share the hero
 * palette, so a colour swatch wouldn't distinguish them — the shape does). Generation reuses a
 * single hidden WaveRenderer and runs after the app has painted, so it doesn't block startup.
 */
import { WaveRenderer } from "@wave3d/core/renderer";
import type { StudioConfig } from "@wave3d/core";
import { createThumbHost, prepThumbConfig, renderThumbFrame } from "@wave3d/core/studio";

const cache = new Map<string, HTMLCanvasElement>();
let started = false;

/** A neutral placeholder shown until a preset's real thumbnail has rendered. */
const PLACEHOLDER = (() => {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 5;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#2a2a32";
    ctx.fillRect(0, 0, 8, 5);
  }
  return c;
})();

export function getPresetThumb(name: string): HTMLCanvasElement {
  return cache.get(name) ?? PLACEHOLDER;
}

/** Render a thumbnail for every preset (once), then call onReady. Safe to call repeatedly. */
export async function generatePresetThumbnails(
  presets: Record<string, () => StudioConfig>,
  onReady: () => void,
): Promise<void> {
  if (started) return;
  started = true;

  const host = createThumbHost(240, 150);

  let renderer: WaveRenderer | null = null;
  try {
    for (const [name, make] of Object.entries(presets)) {
      const cfg = make();
      prepThumbConfig(cfg);
      if (!renderer) renderer = new WaveRenderer(host, cfg);
      else renderer.setConfig(cfg);
      const c = renderThumbFrame(renderer, host);
      if (c) cache.set(name, c);
      // Rendering is intentionally sequential because every iteration reuses the same renderer.
      await new Promise((r) => setTimeout(r, 0)); // yield so the UI stays responsive
    }
  } catch (err) {
    console.warn("Preset thumbnail generation failed:", err);
  } finally {
    renderer?.dispose();
    host.remove();
  }
  onReady();
}
