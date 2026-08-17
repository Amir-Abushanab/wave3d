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

/** URLs the renderer fetches ASYNCHRONOUSLY for a config — palette textures and the background
 *  image. A thumbnail snapshotted before they load is blank; that is why the wireframe + additive
 *  "Spider-Man" preset (its web lines AND its background are both image-driven, and additive blend
 *  means an unloaded texture contributes nothing) rendered empty. */
function asyncImageUrls(cfg: StudioConfig): string[] {
  const urls: string[] = [];
  for (const w of cfg.waves ?? []) {
    if (w.usePaletteTexture && w.paletteImageUrl) urls.push(w.paletteImageUrl);
  }
  if (cfg.backgroundMode === "image" && cfg.backgroundImageUrl) urls.push(cfg.backgroundImageUrl);
  return urls;
}

/** Resolve once every url has loaded (or failed) — priming the browser's decode cache so the
 *  renderer's own load of the same url settles promptly, then we snapshot. */
function preloadImages(urls: string[]): Promise<unknown> {
  return Promise.all(
    urls.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          // resolve on either outcome — a broken asset shouldn't hang thumbnail generation.
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
          img.src = src;
        }),
    ),
  );
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
      const urls = asyncImageUrls(cfg);
      await preloadImages(urls); // prime the decode cache before the renderer loads the same urls
      if (!renderer) renderer = new WaveRenderer(host, cfg);
      else renderer.setConfig(cfg);
      // Image-driven presets load their textures asynchronously; give the renderer's onloads a beat
      // to fire (and upload) before we snapshot, or the frame captures blank. Cheap and only for the
      // handful of presets that use an image (the cache is primed, so the loads settle fast).
      if (urls.length) await wait(120);
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
