"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode, ReactElement } from "react";
import { createWave, createDefaultConfig, makeStops } from "@wave3d/core";
import type {
  StudioConfig,
  WaveConfig,
  ColorStop,
  BlendMode,
  WaveInteractionConfig,
  WaveHandle,
  WaveOptions,
  WaveRenderer,
  FallbackReason,
} from "@wave3d/core";

/** Flat props mapped onto the first wave. */
interface FlatWaveProps {
  palette?: string[] | ColorStop[];
  fiberCount?: number;
  fiberStrength?: number;
  sheen?: number;
  iridescence?: number;
  displaceAmount?: number;
  speed?: number;
  opacity?: number;
  blendMode?: BlendMode;
  theme?: "solid" | "wireframe";
  /** Per-wave interactivity for the first wave (hover field / click / bindings). Off when omitted.
   *  Scene-level shared inputs + scene bindings go through the `config` prop. */
  interaction?: WaveInteractionConfig;
}

/** Flat props mapped onto the scene. */
interface FlatSceneProps {
  background?: string;
  transparentBackground?: boolean;
  quality?: number;
  dprMax?: number;
  loopSeconds?: number;
  introRamp?: boolean;
  paused?: boolean;
}

export interface Wave3DProps extends FlatWaveProps, FlatSceneProps {
  /** A preset: a function (tree-shakeable) or a name string (lazy-imports the presets chunk). */
  preset?: string | (() => Partial<StudioConfig>);
  /** Escape hatch: a full/partial config, applied last. Precedence: default ← preset ← flat props ← config. */
  config?: Partial<StudioConfig>;
  poster?: string;
  lazy?: boolean;
  webgl?: "auto" | "force" | "off";
  respectReducedMotion?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Custom SSR poster markup, e.g. `<img data-wave3d-poster src="…" />` — the shell adopts it. */
  children?: ReactNode;
  onReady?: (renderer: WaveRenderer) => void;
  onFallback?: (reason: FallbackReason) => void;
}

function normalizePalette(p: string[] | ColorStop[]): ColorStop[] {
  return p.length > 0 && typeof p[0] === "string" ? makeStops(p as string[]) : (p as ColorStop[]);
}

/** Resolve the base config: function preset (sync) → its config; string preset → lazy-load presets. */
async function resolveBase(preset: Wave3DProps["preset"]): Promise<StudioConfig> {
  if (typeof preset === "function") return { ...createDefaultConfig(), ...preset() };
  if (typeof preset === "string") {
    const { PRESETS } = await import("@wave3d/core/presets");
    const make = PRESETS[preset];
    if (make) return make();
  }
  return createDefaultConfig();
}

/** Base config we can build synchronously (function preset / default) — a string preset resolves later. */
function syncBase(preset: Wave3DProps["preset"]): StudioConfig {
  return typeof preset === "function"
    ? { ...createDefaultConfig(), ...preset() }
    : createDefaultConfig();
}

/** Apply the flat props (and the config escape hatch) onto a full base config. */
function buildConfig(base: StudioConfig, props: Wave3DProps): Partial<StudioConfig> {
  const w: WaveConfig = base.waves[0];
  if (props.palette !== undefined) w.palette = normalizePalette(props.palette);
  if (props.fiberCount !== undefined) w.fiberCount = props.fiberCount;
  if (props.fiberStrength !== undefined) w.fiberStrength = props.fiberStrength;
  if (props.sheen !== undefined) w.sheen = props.sheen;
  if (props.iridescence !== undefined) w.iridescence = props.iridescence;
  if (props.displaceAmount !== undefined) w.displaceAmount = props.displaceAmount;
  if (props.speed !== undefined) w.speed = props.speed;
  if (props.opacity !== undefined) w.opacity = props.opacity;
  if (props.blendMode !== undefined) w.blendMode = props.blendMode;
  if (props.theme !== undefined) w.theme = props.theme;
  if (props.interaction !== undefined) w.interaction = props.interaction;
  if (props.background !== undefined) base.background = props.background;
  if (props.transparentBackground !== undefined)
    base.transparentBackground = props.transparentBackground;
  if (props.quality !== undefined) base.quality = props.quality;
  if (props.dprMax !== undefined) base.dprMax = props.dprMax;
  if (props.loopSeconds !== undefined) base.loopSeconds = props.loopSeconds;
  if (props.introRamp !== undefined) base.introRamp = props.introRamp;
  if (props.paused !== undefined) base.paused = props.paused;
  return { ...base, ...props.config };
}

/** A stable string that changes whenever the resolved config would — keys the update effect. */
function configKey(props: Wave3DProps): string {
  const flat: Record<string, unknown> = {};
  const keys = [
    "palette",
    "fiberCount",
    "fiberStrength",
    "sheen",
    "iridescence",
    "displaceAmount",
    "speed",
    "opacity",
    "blendMode",
    "theme",
    "background",
    "transparentBackground",
    "quality",
    "dprMax",
    "loopSeconds",
    "introRamp",
    "paused",
    "interaction",
  ] as const;
  for (const k of keys) if (props[k] !== undefined) flat[k] = props[k];
  return JSON.stringify({
    preset: typeof props.preset === "function" ? "fn" : props.preset,
    flat,
    config: props.config,
  });
}

/**
 * A drop-in, self-optimizing gradient wave. Renders a `<div>` (SSR-safe; pass an
 * `<img data-wave3d-poster>` child for a server-rendered poster) and, on the client, mounts the
 * shell — poster-first, lazy, WebGL/reduced-motion/save-data aware, with the engine code-split out.
 */
export function Wave3D(props: Wave3DProps): ReactElement {
  const { className, style, children } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<WaveHandle | null>(null);
  // Keep the latest callbacks in a ref so they never force a remount.
  const cbRef = useRef<Pick<Wave3DProps, "onReady" | "onFallback">>({});
  cbRef.current.onReady = props.onReady;
  cbRef.current.onFallback = props.onFallback;

  // Mount once. StrictMode double-mount is safe: destroy() aborts a pending upgrade, and the
  // pre-upgrade create/destroy is DOM-only (poster + IntersectionObserver).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const options: WaveOptions = {
      poster: props.poster,
      lazy: props.lazy,
      webgl: props.webgl,
      respectReducedMotion: props.respectReducedMotion,
      onReady: (r) => cbRef.current.onReady?.(r),
      onFallback: (reason) => cbRef.current.onFallback?.(reason),
    };
    const handle = createWave(container, buildConfig(syncBase(props.preset), props), options);
    handleRef.current = handle;
    // A string preset resolves asynchronously; stage/set the real config once it loads.
    if (typeof props.preset === "string") {
      void resolveBase(props.preset).then((base) => {
        if (!cancelled && handleRef.current === handle) handle.set(buildConfig(base, props));
      });
    }
    return () => {
      cancelled = true;
      handle.destroy();
      handleRef.current = null;
    };
    // Mount-time only (options are captured once; config changes flow through the effect below).
  }, []);

  // Push config changes (flat props / config / preset) to the live handle.
  const key = configKey(props);
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const apply = (base: StudioConfig): void => {
      if (handleRef.current === handle) handle.set(buildConfig(base, props));
    };
    if (typeof props.preset === "string") void resolveBase(props.preset).then(apply);
    else apply(syncBase(props.preset));
    // Re-runs only when the serialized config (`key`) changes; `props` is read fresh inside.
  }, [key]);

  return (
    <div ref={containerRef} className={className} style={style}>
      {children}
    </div>
  );
}

export default Wave3D;
export type {
  StudioConfig,
  WaveHandle,
  WaveRenderer,
  FallbackReason,
  SnapshotOptions,
} from "@wave3d/core";
