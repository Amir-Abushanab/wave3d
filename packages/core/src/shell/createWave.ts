import type { StudioConfig } from "../config/model";
import type { WaveRenderer, WaveRendererOptions } from "../renderer/WaveRenderer";
import { hasWebGL, prefersReducedMotion, prefersReducedData } from "./probe";
import { setupPoster, ensurePositioned, type Poster } from "./poster";

/** Why the shell showed the poster instead of a live wave. */
export type FallbackReason =
  | "no-webgl"
  | "reduced-motion"
  | "save-data"
  | "context-lost"
  | "load-error";

/** poster → loading → running, or → fallback (permanent poster). */
export type WaveState = "poster" | "loading" | "running" | "fallback";

/** The heavy module fetched on upgrade. */
type CoreModule = typeof import("../core-loader");

export interface WaveOptions {
  /** Poster URL / data-URI. Defaults to adopting the container's `<img data-wave3d-poster>` (SSR). */
  poster?: string;
  /** Wait until the container nears the viewport before fetching the engine. Default true. */
  lazy?: boolean;
  /** IntersectionObserver margin for the lazy trigger. Default "200px". */
  rootMargin?: string;
  /** "auto" probes WebGL (with failIfMajorPerformanceCaveat); "force" skips the probe; "off" stays a poster. */
  webgl?: "auto" | "force" | "off";
  /** Forward prefers-reduced-motion to the renderer (freezes to a full static frame). Default true. */
  respectReducedMotion?: boolean;
  /** With reduced motion: "static" upgrades to a frozen frame; "poster" stays a poster. Default "static". */
  reducedMotionBehavior?: "static" | "poster";
  /** Keep a permanent poster when the user has Save-Data on. Default true. */
  respectSaveData?: boolean;
  /** Poster→canvas crossfade duration (ms). Default 300. */
  fadeMs?: number;
  /** Start paused. */
  paused?: boolean;
  onReady?(renderer: WaveRenderer): void;
  onFallback?(reason: FallbackReason): void;
  onStateChange?(state: WaveState): void;
  /** Seam for the standalone/CDN build to supply the core synchronously (three already bundled). */
  loadCore?(): Promise<CoreModule>;
}

export interface WaveHandle {
  readonly state: WaveState;
  readonly renderer: WaveRenderer | null;
  /** Merge a partial config. Staged before upgrade; after, setConfig() then refreshPlayback(). */
  set(config: Partial<StudioConfig>): void;
  play(): void;
  pause(): void;
  /** Safe to call in any state (aborts a pending upgrade, disposes a live renderer, removes the poster). */
  destroy(): void;
}

/**
 * The shell implementation. `loadCore` is an explicit parameter (not read from options) so the
 * standalone/CDN build can pass a synchronous core and NOT bundle the dynamic-import path — its
 * output stays a single file. The public {@link createWave} supplies the dynamic-import default.
 */
export function createWaveImpl(
  loadCore: () => Promise<CoreModule>,
  container: HTMLElement,
  config: Partial<StudioConfig>,
  options: WaveOptions,
): WaveHandle {
  const {
    lazy = true,
    rootMargin = "200px",
    webgl = "auto",
    respectReducedMotion = true,
    reducedMotionBehavior = "static",
    respectSaveData = true,
    fadeMs = 300,
  } = options;

  let state: WaveState = "poster";
  let renderer: WaveRenderer | null = null;
  let staged: Partial<StudioConfig> = { ...config };
  if (options.paused !== undefined) staged.paused = options.paused;

  let aborted = false;
  let io: IntersectionObserver | null = null;
  let lostTimer: ReturnType<typeof setTimeout> | undefined;
  let lossCount = 0;

  ensurePositioned(container);
  const poster: Poster | null = setupPoster(container, options.poster);

  function setState(next: WaveState): void {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  }

  function fallback(reason: FallbackReason): void {
    setState("fallback");
    poster?.show();
    options.onFallback?.(reason);
  }

  function onContextRestored(): void {
    clearTimeout(lostTimer); // three rebuilt the context in time; stay live
  }

  function onContextLost(): void {
    lossCount += 1;
    clearTimeout(lostTimer);
    if (lossCount >= 2) {
      teardownRenderer();
      fallback("context-lost");
      return;
    }
    // three (WaveRenderer) tries to restore; if it hasn't within ~4s, give up to the poster.
    lostTimer = setTimeout(() => {
      teardownRenderer();
      fallback("context-lost");
    }, 4000);
  }

  function teardownRenderer(): void {
    if (!renderer) return;
    const canvas = renderer.renderer.domElement;
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    renderer.dispose();
    renderer = null;
  }

  async function upgrade(): Promise<void> {
    setState("loading");
    let core: CoreModule;
    try {
      core = await loadCore();
    } catch {
      if (!aborted) fallback("load-error");
      return;
    }
    if (aborted) return;

    const full: StudioConfig = { ...core.createDefaultConfig(), ...staged };
    const rendererOptions: WaveRendererOptions = { respectReducedMotion };
    renderer = new core.WaveRenderer(container, full, rendererOptions);
    const canvas = renderer.renderer.domElement;
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);
    renderer.start();
    setState("running");
    options.onReady?.(renderer);

    if (poster) {
      // Crossfade only after two frames, so the wave has definitely painted first.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!aborted && renderer) poster.fadeOut(fadeMs);
        }),
      );
    }
  }

  function probeAndUpgrade(): void {
    if (aborted) return;
    if (webgl === "auto" && !hasWebGL()) {
      fallback("no-webgl");
      return;
    }
    void upgrade();
  }

  function begin(): void {
    // Permanent-poster gates (checked before any lazy wait or engine fetch).
    if (webgl === "off") return; // deliberate poster-only mode — stay "poster", no fallback callback
    if (respectSaveData && prefersReducedData()) return fallback("save-data");
    if (respectReducedMotion && reducedMotionBehavior === "poster" && prefersReducedMotion()) {
      return fallback("reduced-motion");
    }
    if (lazy && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io?.disconnect();
            io = null;
            probeAndUpgrade();
          }
        },
        { rootMargin },
      );
      io.observe(container);
    } else {
      probeAndUpgrade();
    }
  }

  const handle: WaveHandle = {
    get state() {
      return state;
    },
    get renderer() {
      return renderer;
    },
    set(next) {
      if (renderer) {
        renderer.setConfig({ ...renderer.getConfig(), ...next });
        renderer.refreshPlayback(); // setConfig doesn't re-evaluate `paused` on its own
      } else {
        staged = { ...staged, ...next };
      }
    },
    play() {
      if (renderer) {
        renderer.getConfig().paused = false;
        renderer.refreshPlayback();
      } else {
        staged.paused = false;
      }
    },
    pause() {
      if (renderer) {
        renderer.getConfig().paused = true;
        renderer.refreshPlayback();
      } else {
        staged.paused = true;
      }
    },
    destroy() {
      aborted = true;
      io?.disconnect();
      io = null;
      clearTimeout(lostTimer);
      teardownRenderer();
      poster?.remove();
    },
  };

  begin();
  return handle;
}

/**
 * Mount a self-optimizing wave into a container: shows a poster immediately, then — lazily, and only
 * when the browser can actually run it — fetches the engine, builds the renderer, and crossfades in.
 * Falls back to the poster on no-WebGL / save-data / reduced-motion / context-loss / load errors.
 * No static three import: the engine arrives via a dynamic import, so the shell stays tiny.
 */
export function createWave(
  container: HTMLElement,
  config: Partial<StudioConfig> = {},
  options: WaveOptions = {},
): WaveHandle {
  return createWaveImpl(
    options.loadCore ?? (() => import("../core-loader")),
    container,
    config,
    options,
  );
}

/** The drop-in embed contract: an alias of {@link createWave}. */
export const mountWave = createWave;
