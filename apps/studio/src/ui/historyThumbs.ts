/**
 * On-demand thumbnail renderer for the version-history panel. Reuses the same trick as
 * presetThumbs.ts: a single hidden, low-res WaveRenderer that renders a snapshot's config to a
 * still frame, captured as a data URL and cached by entry id. Rendering is lazy (only when the
 * history panel asks, i.e. when a row scrolls into view) and sequential (one shared renderer), so
 * it never touches the main 60fps loop and stays cheap even for a long history.
 */
import { WaveRenderer } from "@wave3d/core/renderer";
import type { StudioConfig } from "@wave3d/core";
import { createThumbHost, prepThumbConfig, renderThumbFrame } from "@wave3d/core/studio";

const RW = 128; // render size (16:9); displayed much smaller, so this is plenty crisp
const RH = 72;

export class HistoryThumbnailer {
  private readonly cache = new Map<number, string>(); // entry id → data URL
  private readonly waiters = new Map<number, Array<(url: string | null) => void>>();
  private readonly queue: number[] = [];
  private running = false;
  private disposed = false;
  private host?: HTMLDivElement;
  private renderer?: WaveRenderer;

  constructor(private readonly getConfig: (id: number) => StudioConfig | null) {}

  /** Synchronous cache hit, if the thumbnail is already rendered. */
  cached(id: number): string | undefined {
    return this.cache.get(id);
  }

  /** Get (or render) the thumbnail for an entry; `cb` fires with the data URL (or null on failure). */
  request(id: number, cb: (url: string | null) => void): void {
    if (this.disposed) return;
    const hit = this.cache.get(id);
    if (hit !== undefined) {
      cb(hit);
      return;
    }
    const waiting = this.waiters.get(id);
    if (waiting) {
      waiting.push(cb); // a render is already queued for this id
      return;
    }
    this.waiters.set(id, [cb]);
    this.queue.push(id);
    void this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.waiters.clear();
    this.cache.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.host?.remove();
    this.host = undefined;
  }

  private async pump(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const id = this.queue.shift();
        if (id === undefined) break;
        let url: string | null = null;
        try {
          url = this.renderOne(id);
        } catch (err) {
          console.warn("History thumbnail render failed:", err);
        }
        if (url) {
          this.cache.set(id, url);
          // Bound memory: the timeline caps at ~80 entries, but ids from undone/truncated branches
          // linger in the cache — evict the oldest beyond a generous ceiling.
          if (this.cache.size > 240) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
          }
        }
        const cbs = this.waiters.get(id) ?? [];
        this.waiters.delete(id);
        for (const cb of cbs) cb(url);
        await new Promise((r) => setTimeout(r, 0)); // yield between renders so the UI stays smooth
      }
    } finally {
      this.running = false;
    }
  }

  private renderOne(id: number): string | null {
    const src = this.getConfig(id);
    if (!src) return null;
    // Clone before touching it — WaveRenderer.setConfig normalizes in place, and we must never
    // mutate the History-owned snapshot.
    const cfg = structuredClone(src);
    prepThumbConfig(cfg);
    cfg.dprMax = 1; // thumbnails don't need HiDPI
    cfg.quality = Math.min(cfg.quality, 0.6); // lower geometry res — imperceptible this small, cheaper

    if (!this.host) this.host = createThumbHost(RW, RH);
    if (!this.renderer) this.renderer = new WaveRenderer(this.host, cfg);
    else this.renderer.setConfig(cfg);
    const out = renderThumbFrame(this.renderer, this.host);
    return out ? out.toDataURL("image/webp", 0.72) : null;
  }
}
