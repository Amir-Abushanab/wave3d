/**
 * Configuration schema for the wave. Mirrors the knob set from Stripe's own
 * tool/shader: a flat sheet displaced by noise (X/Z frequency + amount) then
 * twisted by three axis-rotations (twistFrequency + twistPower per axis), then
 * scaled / rotated / positioned. Plain JSON — doubles as the save-state format.
 */

export const MAX_COLORS = 8;
export const MAX_LIGHTS = 8;
export const MAX_NOISE_BANDS = 4;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Per-strand overrides (the panel's "> Per…" groups). */
export interface LayerConfig {
  opacity: number;
  /** Hue rotation for this strand, in degrees. */
  hueShift: number;
  /** Width multiplier. */
  widthMul: number;
  /** Animation speed multiplier. */
  speed: number;
  /** Phase/seed so strands don't move in lockstep. */
  seed: number;
  /** Position offset in world units. */
  offset: Vec3;
  /** Extra twist for this strand, in degrees. */
  twistOffset: number;
}

export type BlendMode = "normal" | "additive";

/** How the palette is mapped across the surface. */
export type GradientType = "linear" | "radial" | "conic";

/** A positionable light. `position` lives in the same 3D space as the wave. */
export interface LightConfig {
  position: Vec3;
  color: string;
  intensity: number;
}

/** A default light; pass overrides for added fill lights. */
export function createLight(position: Vec3 = { x: 3, y: 5, z: 8 }, intensity = 1): LightConfig {
  return { position: { ...position }, color: "#ffffff", intensity };
}

/**
 * A noise band (Stripe's USE_NOISE_BANDS): inside a rectangular uv region
 * (startX..endX along the length, startY..endY across the width, softened by
 * `feather`), the fiber streaks are overridden — strength, frequency (density),
 * colourAttenuation (how much the local colour suppresses them), and the
 * end-weighting parabolaPower. Lets the fibers vary per region instead of uniform.
 */
export interface NoiseBand {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  feather: number;
  strength: number;
  frequency: number;
  colorAttenuation: number;
  parabolaPower: number;
}

/** A default band: a strong, coarse streak region over the first half (like Stripe's). */
export function createNoiseBand(): NoiseBand {
  return {
    startX: 0.0,
    endX: 0.5,
    startY: 0.0,
    endY: 1.0,
    feather: 0.3,
    strength: 1.0,
    frequency: 220,
    colorAttenuation: 0.0,
    parabolaPower: 2.0,
  };
}

/** One gradient stop: a colour at a normalized position (0–1) across the width. */
export interface ColorStop {
  color: string;
  pos: number;
}

/** Build evenly-spaced stops from a plain list of colours. */
export function makeStops(colors: string[]): ColorStop[] {
  const n = colors.length;
  return colors.map((color, i) => ({ color, pos: n > 1 ? i / (n - 1) : 0 }));
}

export interface WaveConfig {
  // ---- Global ----
  background: string;
  transparentBackground: boolean;
  blendMode: BlendMode;
  /** Number of stacked strands. */
  strandCount: number;
  /** Geometry subdivision multiplier (0.25–2). */
  quality: number;
  dprMax: number;
  speed: number;
  paused: boolean;
  /** Distance from camera to target (kept in sync with cameraPosition/Target). */
  cameraDistance: number;
  /** Camera world position — updated live by orbit so exports match the view. */
  cameraPosition: Vec3;
  /** Orbit/look-at target (pan) — updated live by orbit. */
  cameraTarget: Vec3;

  // ---- Color & finish ----
  /** Colour-band stops across the width (each has a 0–1 position), up to MAX_COLORS. */
  palette: ColorStop[];
  /** How the palette maps onto the surface (linear / radial / conic). */
  gradientType: GradientType;
  /** Linear-gradient angle in degrees (0 = across width, 90 = along length). */
  gradientAngle: number;
  /** 2D warp of the gradient (0 = flat 1-D bands; higher = colour varies in 2D). */
  gradientShift: number;
  /** Global hue rotation in degrees (colorHueShift). */
  hueShift: number;
  colorContrast: number;
  colorSaturation: number;
  /** Number of lengthwise fiber lines. */
  fiberCount: number;
  /** Fiber line width (0–1). */
  fiberThickness: number;
  /** Per-region fiber overrides (Stripe's noise bands); empty = uniform fibers. */
  noiseBands: NoiseBand[];
  /** Film grain amount (dither). */
  grain: number;
  /** Procedural fine-texture overlay amount. */
  texture: number;
  /** Soft-focus blur amount (viewport edges). */
  blur: number;

  // ---- Sheet + displacement (noise pushes the flat sheet along Y) ----
  /** Sheet length, in world units. */
  spineLength: number;
  /** Sheet width, in world units. */
  waveWidth: number;
  /** End taper (0 = none). */
  widthTaper: number;
  /** Hairpin fold: layer half-separation in Y (0 = flat strip). */
  foldRadius: number;
  /** Hairpin fold: half-length of the U-bend joining the two arms. */
  foldGap: number;
  /** Hairpin fold: where the fold sits along the length (−1..1; 0 = centre). */
  foldCenter: number;
  /** Displacement noise frequency: x = along length, y = across width (X/Z). */
  displaceFrequency: Vec2;
  displaceAmount: number;

  // ---- Twist: three axis-rotations, each freq * expStep(uv, power) ----
  twistFrequency: Vec3;
  twistPower: Vec3;

  // ---- Transform ----
  position: Vec3;
  /** Rotation in degrees. */
  rotation: Vec3;
  scale: Vec3;

  // ---- Light ----
  /** Bevel: darkens toward the grazing silhouette (0–1). */
  bezelPower: number;
  glowAmount: number;
  glowPower: number;
  /** Glow ramp (softness of the rim glow). */
  glowRamp: number;
  /** Fade the wave only near the viewport edges (0 = off). */
  edgeFade: number;
  /** Base ambient light level (0–1). */
  ambient: number;
  /** Positionable lights, up to MAX_LIGHTS. */
  lights: LightConfig[];

  // ---- Per-strand ----
  layers: LayerConfig[];
}

/** A spread of strands for `count` overlapping waves. */
export function makeLayers(count: number): LayerConfig[] {
  const layers: LayerConfig[] = [];
  for (let i = 0; i < count; i++) {
    const f = count > 1 ? i / (count - 1) : 0;
    layers.push({
      opacity: 1.0 - f * 0.3,
      hueShift: i * 18,
      widthMul: 1 - f * 0.2,
      speed: 1 + f * 0.15,
      seed: i * 3.3,
      offset: { x: 0, y: (f - 0.5) * 0.4, z: -i * 0.1 },
      twistOffset: i * 20,
    });
  }
  return layers;
}

/** Resize `layers` to match `strandCount`, preserving existing entries. */
export function resizeLayers(config: WaveConfig): void {
  const target = config.strandCount;
  const defaults = makeLayers(target);
  const next: LayerConfig[] = [];
  for (let i = 0; i < target; i++) next.push(config.layers[i] ?? defaults[i]);
  config.layers = next;
}

export function createDefaultConfig(): WaveConfig {
  const strandCount = 1;
  return {
    background: "#ffffff",
    transparentBackground: true,
    blendMode: "normal",
    strandCount,
    quality: 1,
    dprMax: 2,
    speed: 0.3,
    paused: false,
    cameraDistance: 10.5,
    cameraPosition: { x: 0, y: 0, z: 10.5 },
    cameraTarget: { x: 0, y: 0, z: 0 },

    // Stripe's distribution: a thin periwinkle→lavender tail, a magenta/coral accent,
    // then ORANGE→cream owning the broad face (positions weight orange-dominant, not a
    // big magenta band). The 2D gradientShift warps it organically.
    palette: [
      { color: "#aeb8ff", pos: 0 }, // periwinkle tail
      { color: "#c3a0f2", pos: 0.1 }, // lavender
      { color: "#ff5fae", pos: 0.22 }, // magenta accent
      { color: "#ff7a5e", pos: 0.4 }, // coral
      { color: "#ff9a3d", pos: 0.66 }, // orange (dominant)
      { color: "#ffce7e", pos: 1.0 }, // cream highlight
    ],
    gradientType: "linear",
    gradientAngle: 0,
    gradientShift: 0.15,
    hueShift: 0,
    colorContrast: 1.0,
    colorSaturation: 1.15,
    // Lengthwise striations: fiberCount = how many fibers across the width
    // (spacing), fiberThickness = strength. Fewer than Stripe's 600 since ours run
    // across the narrow width axis, not the long length axis.
    fiberCount: 130,
    fiberThickness: 0.16,
    noiseBands: [],
    grain: 1.0,
    texture: 0,
    // Angular spin-blur angle (radians); weighted to the top/bottom edges.
    blur: 0.05,

    spineLength: 13.0,
    waveWidth: 3.0,
    widthTaper: 0.22,
    // Hairpin fold — the strip doubles back on itself (Stripe's folded geometry).
    // Off-centre fold = a long sweep + a short folded-over tip, not a middle crease.
    foldRadius: 1.1,
    foldGap: 0.7,
    foldCenter: 0.55,
    // Gentle single bend along the length; almost no cross-width ripple.
    displaceFrequency: { x: 0.35, y: 0.0 },
    displaceAmount: 0.28,

    // Subtle now — the hairpin fold provides the fold-over; the twist just adds life.
    // Higher twistPower (toward Stripe's ~4–6) concentrates the twist nearer the edge.
    twistFrequency: { x: 0.4, y: 0.25, z: -0.4 },
    twistPower: { x: 3.0, y: 1.5, z: 4.0 },

    position: { x: 0, y: 0, z: 0 },
    rotation: { x: -52, y: 0, z: -38 },
    // Slightly depth-compressed like Stripe's scale (10,10,7), but keep the fold.
    scale: { x: 1, y: 0.9, z: 1 },

    bezelPower: 0.2,
    // glow* drive the dFdy-based pdy term (volume + where streaks show).
    glowAmount: 1.5,
    glowPower: 0.9,
    glowRamp: 0.9,
    edgeFade: 0.04,
    ambient: 0.45,
    lights: [createLight()],

    layers: makeLayers(strandCount),
  };
}

export function cloneConfig(config: WaveConfig): WaveConfig {
  return structuredClone(config);
}

/** Backfill legacy `string[]` palettes (pre-gradient-stops) into ColorStop[]. */
export function normalizePalette(config: WaveConfig): void {
  const p = config.palette as unknown as Array<string | ColorStop>;
  if (p.length > 0 && typeof p[0] === "string") {
    config.palette = makeStops(p as string[]);
  }
}

/** Backfill camera position/target for states saved before they existed. */
export function ensureCamera(config: WaveConfig): void {
  if (!config.cameraPosition) config.cameraPosition = { x: 0, y: 0, z: config.cameraDistance ?? 10.5 };
  if (!config.cameraTarget) config.cameraTarget = { x: 0, y: 0, z: 0 };
}

// ---- Presets ----

export const PRESETS: Record<string, () => WaveConfig> = {
  Stripe: () => createDefaultConfig(),
  "Neon Dark": () => {
    const c = createDefaultConfig();
    c.background = "#05060c";
    c.blendMode = "additive";
    c.palette = makeStops(["#00f5d4", "#00bbf9", "#9b5de5", "#f15bb5", "#fee440"]);
    c.glowAmount = 1.0;
    c.strandCount = 3;
    c.layers = makeLayers(3);
    return c;
  },
  Sunset: () => {
    const c = createDefaultConfig();
    c.palette = makeStops(["#fde047", "#fb923c", "#f43f5e", "#a21caf", "#4c1d95"]);
    c.twistPower = { x: 2.6, y: 1.8, z: 2.0 };
    c.glowAmount = 0.5;
    return c;
  },
  Chrome: () => {
    const c = createDefaultConfig();
    c.palette = makeStops(["#e2e8f0", "#94a3b8", "#cbd5e1", "#64748b", "#f8fafc"]);
    c.colorSaturation = 0.5;
    c.bezelPower = 0.7;
    return c;
  },
};

// ---- Randomize ----

const RANDOM_PALETTES: string[][] = [
  ["#9bb0ff", "#ffb14e", "#ff6aa8", "#b15cff", "#6f7bff"],
  ["#ffd166", "#ff6b6b", "#c44dff", "#4d79ff", "#22d3ee"],
  ["#f97316", "#ec4899", "#8b5cf6", "#3b82f6", "#06b6d4"],
  ["#00f5d4", "#00bbf9", "#9b5de5", "#f15bb5", "#fee440"],
  ["#7c3aed", "#db2777", "#f59e0b", "#10b981", "#06b6d4"],
];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Randomize the aesthetic parameters, keeping background/blend/strand count. */
export function randomizeConfig(base: WaveConfig): WaveConfig {
  const cfg = createDefaultConfig();
  cfg.background = base.background;
  cfg.transparentBackground = base.transparentBackground;
  cfg.blendMode = base.blendMode;
  cfg.strandCount = base.strandCount;
  cfg.layers = makeLayers(base.strandCount);

  cfg.palette = makeStops(pick(RANDOM_PALETTES));
  cfg.hueShift = Math.round(rand(0, 360));
  cfg.colorContrast = rand(0.9, 1.3);
  cfg.colorSaturation = rand(0.85, 1.35);
  cfg.displaceFrequency = { x: rand(0.6, 1.8), y: rand(0.5, 1.3) };
  cfg.displaceAmount = rand(0.3, 0.8);
  cfg.rotation = { x: rand(-25, 5), y: rand(-15, 15), z: rand(-40, 10) };
  cfg.twistFrequency = { x: rand(0.4, 1.6), y: rand(0.3, 1.2), z: rand(0.3, 1.2) };
  cfg.twistPower = { x: rand(1.0, 3.0), y: rand(1.0, 3.0), z: rand(1.0, 3.0) };
  cfg.glowAmount = rand(0.2, 0.8);
  return cfg;
}

// ---- Per-section randomizers (each mutates only its own fields, in place) ----

function r2(x: number): number {
  return Math.round(x * 100) / 100;
}
function r3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

const LIGHT_TINTS = ["#ffffff", "#ffffff", "#fff0e0", "#e2e8ff", "#ffe2f0", "#e2fff4", "#fff6cc"];

/** Random sorted positions in [0,1] with the ends pinned to 0 and 1. */
function randomSortedPositions(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [0, 1];
  const inner = Array.from({ length: n - 2 }, () => r2(rand(0.06, 0.94))).sort((a, b) => a - b);
  return [0, ...inner, 1];
}

export function randomizeGradient(c: WaveConfig): void {
  const colors = pick(RANDOM_PALETTES);
  const count = Math.max(3, Math.min(colors.length, Math.round(rand(3, colors.length))));
  const chosen = colors.slice(0, count);
  const positions = randomSortedPositions(count);
  c.palette = chosen.map((color, i) => ({ color, pos: positions[i] }));
  // Bias toward linear, but occasionally radial/conic for variety.
  c.gradientType = pick(["linear", "linear", "linear", "radial", "conic"] as GradientType[]);
  c.gradientAngle = Math.round(rand(0, 180));
}

export function randomizeColor(c: WaveConfig): void {
  c.hueShift = Math.round(rand(0, 360));
  c.colorContrast = r2(rand(0.9, 1.3));
  c.colorSaturation = r2(rand(0.8, 1.35));
  c.fiberCount = Math.round(rand(200, 900));
  c.fiberThickness = r2(rand(0.1, 0.35));
  c.grain = r2(rand(0, 1.5));
  c.texture = r2(rand(0, 0.35));
  c.blur = r3(rand(0, 0.02));
}

export function randomizeSpine(c: WaveConfig): void {
  c.spineLength = r2(rand(6, 11));
  c.displaceFrequency = { x: r2(rand(0.1, 1.0)), y: r2(rand(0, 0.5)) };
  c.displaceAmount = r2(rand(0.1, 0.7));
}

export function randomizeTransform(c: WaveConfig): void {
  c.rotation = { x: Math.round(rand(-25, 5)), y: Math.round(rand(-40, 40)), z: Math.round(rand(5, 60)) };
  c.scale = { x: r2(rand(0.8, 1.3)), y: r2(rand(0.8, 1.3)), z: r2(rand(0.8, 1.3)) };
  c.position = { x: r2(rand(-0.8, 0.8)), y: r2(rand(-0.8, 0.8)), z: r2(rand(-0.8, 0.8)) };
}

export function randomizeTwist(c: WaveConfig): void {
  const sgn = (): number => (Math.random() < 0.5 ? -1 : 1);
  c.twistFrequency = { x: r2(sgn() * rand(1.5, 4.5)), y: r2(sgn() * rand(0, 1.5)), z: r2(sgn() * rand(0, 1.0)) };
  c.twistPower = { x: r2(rand(0.6, 2.4)), y: r2(rand(0.6, 2.4)), z: r2(rand(0.6, 2.4)) };
}

/** "Wave & Light" folder: the surface/finish params (not the light objects). */
export function randomizeSurface(c: WaveConfig): void {
  c.waveWidth = r2(rand(1.0, 2.8));
  c.widthTaper = r2(rand(0, 0.5));
  c.glowAmount = r2(rand(0.8, 2.5));   // pdy strength (volume + streaks)
  c.glowPower = r2(rand(0.6, 1.4));
  c.glowRamp = r2(rand(0.6, 1.2));
  c.edgeFade = r2(rand(0, 0.08));
}

export function randomizeLights(c: WaveConfig): void {
  c.ambient = r2(rand(0.25, 0.6));
  for (const l of c.lights) {
    l.position = { x: r2(rand(-10, 10)), y: r2(rand(-5, 10)), z: r2(rand(-5, 12)) };
    l.intensity = r2(rand(0.5, 1.6));
    l.color = pick(LIGHT_TINTS);
  }
}

export function randomizeGlobal(c: WaveConfig): void {
  c.speed = r2(rand(0.1, 0.6));
  c.cameraDistance = r2(rand(8, 13));
  c.cameraPosition = { x: 0, y: 0, z: c.cameraDistance };
  c.cameraTarget = { x: 0, y: 0, z: 0 };
}

export function randomizeStrands(c: WaveConfig): void {
  for (const l of c.layers) {
    l.opacity = r2(rand(0.6, 1));
    l.hueShift = Math.round(rand(-60, 60));
    l.widthMul = r2(rand(0.7, 1.2));
    l.speed = r2(rand(0.7, 1.3));
    l.seed = r2(rand(0, 12));
    l.offset = { x: r2(rand(-0.5, 0.5)), y: r2(rand(-0.5, 0.5)), z: r2(rand(-0.5, 0.5)) };
    l.twistOffset = Math.round(rand(-40, 40));
  }
}
