/**
 * Preset thumbnails: a small wave-shape snapshot of each preset, rendered ONCE offscreen and
 * cached, so the preset picker can show what each wave looks like (most presets share the hero
 * palette, so a colour swatch wouldn't distinguish them — the shape does). Generation reuses a
 * single hidden WaveRenderer and runs after the app has painted, so it doesn't block startup.
 */
import { WaveRenderer } from "../wave/WaveRenderer";
import type { WaveConfig } from "../wave/config";

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
  presets: Record<string, () => WaveConfig>,
  onReady: () => void,
): Promise<void> {
  if (started) return;
  started = true;

  const host = document.createElement("div");
  // In layout (so clientWidth/Height are real) but parked off-screen and invisible.
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:240px;height:150px;opacity:0;pointer-events:none;";
  document.body.appendChild(host);

  let renderer: WaveRenderer | null = null;
  try {
    for (const [name, make] of Object.entries(presets)) {
      const cfg = make();
      cfg.paused = true; // static frame for the snapshot
      cfg.transparentBackground = false; // opaque bg so the thumbnail isn't see-through
      if (cfg.theme !== "wireframe") cfg.background = "#ffffff"; // wireframe themes keep their own bg
      if (!renderer) renderer = new WaveRenderer(host, cfg);
      else renderer.setConfig(cfg);
      renderer.resize();
      renderer.renderOnce();
      renderer.renderOnce(); // 2nd pass so any shader recompile (theme/variant) is applied
      const src = host.querySelector("canvas");
      if (src) {
        const c = document.createElement("canvas");
        c.width = src.width;
        c.height = src.height;
        c.getContext("2d")?.drawImage(src, 0, 0);
        cache.set(name, c);
      }
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
