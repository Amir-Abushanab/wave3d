/**
 * Configuration schema for the wave: a flat sheet displaced by noise (X/Z frequency
 * + amount) then twisted by three axis-rotations (twistFrequency + twistPower per
 * axis), then scaled / rotated / positioned. Plain JSON — doubles as the save-state
 * format.
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

// "squared" = the hero material blend: SrcColor × Zero (framebuffer = fragColor²), which
// deepens the colours — the faithful default. "normal"/"additive" are authoring overrides.
export type BlendMode = "squared" | "normal" | "additive";

/** How the palette is mapped across the surface. */
export type GradientType = "linear" | "radial" | "conic";

/** What fills the 2D palette texture: the baked hero LUT, our editable stops, or
 *  a named built-in map (see PALETTE_MAPS). Any string is allowed for forward-compat. */
export type PaletteSource = "hero" | "stops" | (string & {});

/** A positionable light. `position` lives in the same 3D space as the wave. */
export interface LightConfig {
  position: Vec3;
  color: string;
  intensity: number;
}

/** A default light; pass overrides for added fill lights. */
export function createLight(
  position: Vec3 = { x: 300, y: 500, z: 800 },
  intensity = 1,
): LightConfig {
  return { position: { ...position }, color: "#ffffff", intensity };
}

/**
 * A noise band: inside a rectangular uv region (startX..endX along the length,
 * startY..endY across the width, softened by `feather`), the fiber streaks are
 * overridden — strength, frequency (density), colourAttenuation (how much the local
 * colour suppresses them), and the end-weighting parabolaPower. Lets the fibers vary
 * per region instead of uniform.
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

/** A default band: a strong, coarse streak region over the first half. */
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
  /** Noise phase offset added to time before the speed multiply — scrubs the noise
   *  pattern; handy for picking a still frame. Default 0. */
  timeOffset?: number;
  /** Ease the animation in over ~1s on load. Default on; off = start at full speed.
   *  Only affects the first second after load, never the steady-state look. */
  introRamp?: boolean;
  /** Perspective field of view in degrees (lower = flatter/more telephoto). */
  fov: number;
  /** Studio-only: show the corner camera-rig minimap. */
  showCameraRig: boolean;
  /** Distance from camera to target (kept in sync with cameraPosition/Target). */
  cameraDistance: number;
  /** Orthographic zoom — the camera is orthographic, so this replaces fov as the framing knob. */
  cameraZoom: number;
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
  /** Sample a baked 2D palette TEXTURE instead of computing the gradient
   *  procedurally. Gives a real second colour axis across the width. */
  usePaletteTexture: boolean;
  /** What fills that texture: "hero" = baked hero LUT, "stops" = our editable
   *  gradient stops + edge tint, or a built-in map name (PALETTE_MAPS). */
  paletteSource: PaletteSource;
  /** Optional custom palette image (URL or object-URL) — overrides paletteSource when set. */
  paletteImageUrl?: string;
  /** Cross-width edge tint for the "stops" palette texture (the cool periwinkle edges). */
  paletteEdgeColor: string;
  /** Strength of the edge tint (0 = flat 1-D gradient). */
  paletteEdgeAmount: number;
  /** Global hue rotation in degrees (colorHueShift). */
  hueShift: number;
  colorContrast: number;
  colorSaturation: number;
  /** Number of lengthwise fiber lines. */
  fiberCount: number;
  /** Fiber line width (0–1). */
  fiberThickness: number;
  /** Per-region fiber overrides (noise bands); empty = uniform fibers. */
  noiseBands: NoiseBand[];
  /** Film grain amount (dither). */
  grain: number;
  /** Procedural fine-texture overlay amount. */
  texture: number;
  /** Soft-focus blur amount (viewport edges). */
  blur: number;
  /** Spin-blur sample count. Higher = smoother blur, costlier. Default 6. */
  blurSamples?: number;

  // ---- Displacement (noise pushes the baked folded() geometry along Y) ----
  /** Displacement noise frequency on the native folded() geometry: x along the
   *  length, y across the width. Hero default: (0.003234, 0.00799). */
  displaceFrequency: Vec2;
  /** Displacement amount in native geometry units. Hero default: 6.051. */
  displaceAmount: number;

  // ---- Twist: three axis-rotations, each freq * expStep(uv, power) ----
  twistFrequency: Vec3;
  twistPower: Vec3;
  /** Animate the X-twist: modulate twistFrequencyX with simplex noise over time so the
   *  ribbon's twist breathes. Used only by the Wave 4 preset; the hero uses a static twist. */
  twistMotion?: boolean;

  // ---- Theme: render mode — "solid" (surface) vs "wireframe" (fine line shader) ----
  /** "solid" = the surfaceColor shader; "wireframe" = a line shader: the same
   *  geometry carved into fine vertical lines on the background colour. */
  theme?: "solid" | "wireframe";
  /** Wireframe theme: number of vertical lines across the length (default: 425). */
  lineAmount?: number;
  /** Wireframe theme: line thickness multiplier (default: 1). */
  lineThickness?: number;
  /** Wireframe theme: exponent on the screen-space derivative that sets line width (default: 0.95). */
  lineDerivativePower?: number;
  /** Wireframe theme: derivative scale feeding the line thickness (default: 1232). */
  maxWidth?: number;

  // ---- Transform ----
  position: Vec3;
  /** Rotation in degrees. */
  rotation: Vec3;
  scale: Vec3;
  /** Mirror the whole wave on screen (world-space flip): horizontal / vertical. */
  mirrorH: boolean;
  mirrorV: boolean;

  // ---- Light ----
  glowAmount: number;
  glowPower: number;
  /** Glow ramp (softness of the rim glow). */
  glowRamp: number;
  /** Strength of the pdy white-lift (1 = full; pose-dependent). */
  pdyLift: number;
  /** Pose-robust volume: normal-based shading that gives the ribbon rounded "thickness". */
  volume: number;
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
      offset: { x: 0, y: (f - 0.5) * 1.5, z: -i * 0.8 },
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
    blendMode: "squared", // the hero squaring blend (SrcColor²) — the faithful default
    strandCount,
    quality: 1,
    dprMax: 2,
    // Hero speed: original 4e-5 against ms-time ≈ 0.04/s in our seconds-based time. Very slow.
    speed: 0.04,
    paused: false,
    timeOffset: 0, // noise phase (0 = current look). Scrub to pick a still.
    introRamp: true, // ease the animation in over ~1s on load
    fov: 44, // vestigial (camera is orthographic; cameraZoom is the framing knob now)
    // Camera-rig minimap off by default: its 3rd-person camera/markers were sized for the
    // old tiny world and need rework for the ×10 ortho scene (scene now spans origin→z5000).
    showCameraRig: false,
    // The hero camera: ORTHOGRAPHIC at (100,0,5000) looking at the origin, zoom 1. The ortho
    // frustum = the canvas in pixels (WaveRenderer) and the mesh is scaled ×10, so the wave
    // overflows the frame and only the twist shows — which is why the hairpin's open ends/bend
    // sit off-screen (no visible "U").
    cameraDistance: 5001,
    cameraPosition: { x: 100, y: 0, z: 5000 },
    // We frame a tight crop of the twist: pan the look-at to the twist (world ~(-44,-250)).
    // cameraZoom is a USER MULTIPLIER on the responsive base zoom (WaveRenderer maps a fixed
    // world-width to the canvas), so the twist frames the same at any window size/dpr —
    // 1 = the hero crop.
    cameraTarget: { x: -44, y: -250, z: 0 },
    cameraZoom: 1.0,

    // The hero palette: a periwinkle tip/edge, a dominant orange core, then coral → magenta
    // → pink, with a violet twist tip. The 2D gradientShift warps it to mimic a baked 2D
    // palette texture.
    palette: [
      { color: "#8e9dff", pos: 0 }, // periwinkle (blue tip/edge)
      { color: "#c98fd0", pos: 0.14 }, // lavender transition
      { color: "#ff9326", pos: 0.3 }, // orange (rising)
      { color: "#fd8108", pos: 0.52 }, // orange core
      { color: "#fb7a36", pos: 0.64 }, // orange-coral (keeps orange dominant)
      { color: "#d24ecc", pos: 0.78 }, // true magenta (hue ~303, not pink)
      { color: "#e95cae", pos: 0.9 }, // pink-magenta
      { color: "#9b6ae0", pos: 1.0 }, // violet (twist tip)
    ],
    gradientType: "linear",
    // 90° = the gradient runs ALONG the length (uv.x), matching the baked palette texture.
    gradientAngle: 90,
    gradientShift: 0.15,
    // Use a 2D palette texture. Default to the baked hero LUT; "stops" generates an
    // editable one with cool periwinkle edges.
    usePaletteTexture: true,
    paletteSource: "hero",
    paletteEdgeColor: "#8e9dff",
    paletteEdgeAmount: 0.3,
    // Hero defaults: colorHueShift -0.0316 rad ≈ -1.81°, colorContrast 1, colorSaturation
    // 1.15. (The vivid look comes from the SrcColor² blend in WaveRenderer, not from grading
    // — see the material's CustomBlending.)
    hueShift: -1.81,
    colorContrast: 1.0,
    colorSaturation: 1.15,
    // Hero fibers: the solid/hero fragment's surfaceColor HARDCODES freq 600 and strength 0.2
    // (the lineAmount 425 / lineThickness 1 below feed the *wireframe*-theme line shader, which
    // the hero doesn't use — so those are dead for the solid theme).
    fiberCount: 600,
    fiberThickness: 0.2,
    noiseBands: [],
    // Hero post defaults: grainAmount 1.1, blurAmount 0.02.
    grain: 1.1,
    texture: 0,
    blur: 0.02,
    blurSamples: 6, // spin-blur quality

    // Hero defaults (on the native 400-unit folded() geometry).
    displaceFrequency: { x: 0.003234, y: 0.00799 },
    displaceAmount: 6.051,

    // Hero twist: small frequencies + high powers — a gentle twist on the raw geometry. The
    // hero's drama comes from the ortho crop, NOT a strong twist.
    twistFrequency: { x: -0.055, y: 0.077, z: -0.518 },
    twistPower: { x: 3.95, y: 5.85, z: 6.33 },
    twistMotion: false, // hero uses the static twist (no animated wobble)
    theme: "solid", // "solid" = surfaceColor shader; "wireframe" = the line shader
    lineAmount: 425, // wireframe-theme line params (defaults)
    lineThickness: 1,
    lineDerivativePower: 0.95,
    maxWidth: 1232,

    // Hero mesh transform at FULL scale (not downscaled — the ortho camera frames in pixels).
    // rotation = Euler XYZ in degrees (≈ -0.1596, -0.2836, -2.8156 rad).
    position: { x: -24.3, y: -56.4, z: -11.1 },
    rotation: { x: -9.14, y: -16.25, z: -161.32 },
    scale: { x: 10, y: 10, z: 7 },
    // No mirror needed — with the ortho camera + transform, THREE reproduces the hero natively.
    mirrorH: false,
    mirrorV: false,

    // glow* drive the dFdy-based pdy term (volume + where streaks show). Hero defaults.
    glowAmount: 0.6,
    glowPower: 0.589,
    glowRamp: 1.0,
    // The hero pairs `col += (1-pdy)*0.25` (pdyLift 1) with the SrcColor² blend: the lift
    // whitens, the squaring deepens it back. That balance relies on a HIGH pdy
    // (dFdy·resolution) — but our ortho crop makes pdy low everywhere, so the full lift
    // washes uniformly to near-white, which the squaring can't recover. So pdyLift 0 here:
    // the SrcColor² blend + the palette's own light regions give the vivid hero look without
    // the wash. Volume stays 0 (the hero has no normal-volume term).
    pdyLift: 0.0,
    volume: 0.0,
    edgeFade: 0.04,
    ambient: 0.45,
    // The hero has no lights (lights:[]) — colour comes purely from the palette gradient +
    // the pdy white-lift. Lights stay an opt-in feature; off by default.
    lights: [],

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
  if (!config.cameraPosition)
    config.cameraPosition = { x: 0, y: 0, z: config.cameraDistance ?? 62 };
  if (!config.cameraTarget) config.cameraTarget = { x: 0, y: 0, z: 0 };
  if (typeof config.cameraZoom !== "number") config.cameraZoom = 1;
}

// ---- Presets ----

const RAD = 180 / Math.PI;

/** Build a preset from a set of wave parameters. rotation/hue are given in RADIANS and
 *  converted to degrees. All presets are solid-theme, so they reuse the hero palette +
 *  surfaceColor fibers (600/0.2) and pdyLift 0, like the hero. camTarget/zoom frame the
 *  wave (we pan the look-at to centre each one). */
function buildPreset(p: {
  speed: number;
  contrast: number;
  sat: number;
  hueRad: number;
  dispX: number;
  dispZ: number;
  dispAmt: number;
  pos: [number, number, number];
  rotRad: [number, number, number];
  scale: [number, number, number];
  twF: [number, number, number];
  twP: [number, number, number];
  glow: [number, number, number];
  grain: number;
  blur: number;
  zoom: number;
  camTarget: [number, number];
  noiseBands?: NoiseBand[];
  twistMotion?: boolean;
}): WaveConfig {
  const c = createDefaultConfig();
  c.speed = p.speed;
  c.colorContrast = p.contrast;
  c.colorSaturation = p.sat;
  c.hueShift = p.hueRad * RAD;
  c.displaceFrequency = { x: p.dispX, y: p.dispZ };
  c.displaceAmount = p.dispAmt;
  c.position = { x: p.pos[0], y: p.pos[1], z: p.pos[2] };
  c.rotation = { x: p.rotRad[0] * RAD, y: p.rotRad[1] * RAD, z: p.rotRad[2] * RAD };
  c.scale = { x: p.scale[0], y: p.scale[1], z: p.scale[2] };
  c.twistFrequency = { x: p.twF[0], y: p.twF[1], z: p.twF[2] };
  c.twistPower = { x: p.twP[0], y: p.twP[1], z: p.twP[2] };
  c.glowAmount = p.glow[0];
  c.glowPower = p.glow[1];
  c.glowRamp = p.glow[2];
  c.grain = p.grain;
  c.blur = p.blur;
  c.cameraPosition = { x: 100, y: 0, z: 5000 };
  c.cameraTarget = { x: p.camTarget[0], y: p.camTarget[1], z: 0 };
  c.cameraZoom = p.zoom;
  if (p.noiseBands) c.noiseBands = p.noiseBands;
  if (p.twistMotion) c.twistMotion = true;
  return c;
}

export const PRESETS: Record<string, () => WaveConfig> = {
  "Stripe Hero": () => createDefaultConfig(),
  // The remaining wave presets. camTarget is a first-pass centring; tune per-wave. NOTE:
  // Wave 4 also uses a variant vertex shader (animated twist-X wobble) we don't fully
  // replicate — its STATIC frame is close, the motion differs.
  // The app's default wave. Centred framing in the window-independent model.
  "Stripe Wave 2": () =>
    buildPreset({
      speed: 0.04,
      contrast: 1,
      sat: 1,
      hueRad: -0.00159265,
      dispX: 0.005831,
      dispZ: 0.016001,
      dispAmt: -7.821,
      pos: [380, -301.7, -11.1],
      rotRad: [-0.44959, -0.11759, 1.874407],
      scale: [9, 8, 5],
      twF: [-0.65, 0.41, -0.58],
      twP: [3.63, 0.7, 3.95],
      glow: [1.98, 0.806, 0.834],
      grain: 1.1,
      blur: 0.02,
      zoom: 0.55,
      camTarget: [-420, -200], // user-tuned default framing
    }),
  "Stripe Wave 3": () =>
    buildPreset({
      speed: 0.08,
      contrast: 1,
      sat: 1,
      hueRad: -0.00159265,
      dispX: 0.005831,
      dispZ: 0.016001,
      dispAmt: -7.821,
      pos: [-200.7, -65.4, -11.1],
      rotRad: [-2.875593, 3.095927, -2.925927],
      scale: [3, 3, 3],
      twF: [0.059, 0.32, -0.397],
      twP: [3.63, 0.44, 5.99],
      glow: [3.86, 0.923, 1],
      grain: 1.2,
      blur: 0.02,
      zoom: 1.3,
      camTarget: [-104, 13], // centred; zoomed in (wide/flat wave)
    }),
  "Stripe Wave 4": () =>
    buildPreset({
      speed: 0.0525,
      contrast: 0.969,
      sat: 1.383,
      hueRad: 0.0376991,
      dispX: 0.005,
      dispZ: 0.0212,
      dispAmt: 6.68,
      pos: [206.1, -438, -11.1],
      rotRad: [-0.666018, -0.031416, 0.779115],
      scale: [6.0501, 8.3983, 6.9854],
      twF: [-0.424, 0.024, -1.312],
      twP: [1.81, 0.94, 4.76],
      glow: [1.55, 1.174, 0.972],
      grain: 0.576,
      blur: 0,
      zoom: 0.9316,
      camTarget: [194, -402], // centred on the wave
      twistMotion: true, // variant vertex shader — animated twist-X wobble
      noiseBands: [
        {
          startX: 0.856,
          endX: 1,
          startY: 0,
          endY: 0.913,
          feather: 0.5,
          strength: 0.346,
          frequency: 1018,
          colorAttenuation: 1,
          parabolaPower: 0,
        },
        {
          startX: 0.038,
          endX: 0.538,
          startY: 0.105,
          endY: 1,
          feather: 0.3315,
          strength: 1,
          frequency: 190,
          colorAttenuation: 0,
          parabolaPower: 2.11,
        },
      ],
    }),
  // Three more presets, each a clone of a base preset + a few overrides: 2b/2c clone
  // Wave 2, 4b clones Wave 4 (rotations radians→deg via RAD). We re-tune the framing since
  // the new pose shifts the wave.
  "Stripe Wave 2b": () => {
    const c = PRESETS["Stripe Wave 2"]();
    c.position.x = 525;
    c.rotation.x = -0.64 * RAD;
    c.rotation.z = 1.68 * RAD;
    c.cameraZoom = 1.1;
    c.cameraTarget = { x: 150, y: 360, z: 0 }; // centred (window-independent model)
    return c;
  },
  "Stripe Wave 2c": () => {
    const c = PRESETS["Stripe Wave 2"]();
    c.position.x = 320;
    c.position.y = -315;
    c.rotation.x = -0.5 * RAD;
    c.rotation.z = 1.64 * RAD;
    c.cameraZoom = 1.1;
    c.cameraTarget = { x: 40, y: 360, z: 0 }; // centred (window-independent model)
    return c;
  },
  "Stripe Wave 4b": () => {
    const c = PRESETS["Stripe Wave 4"]();
    c.rotation.y = -0.1 * RAD;
    return c;
  },
  // The dark-background hero: identical geometry/camera to the default hero, but theme
  // "wireframe" → the line shader on a dark page background, with grain 1.2. Same palette.
  "Stripe Hero (dark)": () => {
    const c = createDefaultConfig();
    c.theme = "wireframe";
    c.grain = 1.2;
    c.background = "#0a2540"; // dark navy page background
    c.transparentBackground = false;
    return c;
  },
  "Neon Dark": () => {
    const c = createDefaultConfig();
    c.theme = "wireframe"; // line shader on the near-black background — neon wireframe look
    c.background = "#05060c";
    c.transparentBackground = false; // fill the dark bg so the neon lines read on black (not the page)
    c.blendMode = "additive";
    c.palette = makeStops(["#00f5d4", "#00bbf9", "#9b5de5", "#f15bb5", "#fee440"]);
    c.glowAmount = 1.0;
    c.strandCount = 3;
    c.layers = makeLayers(3);
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
  // Keep the user's session/output choices (not visual style): background, blend, strands.
  cfg.background = base.background;
  cfg.transparentBackground = base.transparentBackground;
  cfg.blendMode = base.blendMode;
  cfg.strandCount = base.strandCount;
  cfg.layers = makeLayers(base.strandCount);
  // "Randomize All" = run every per-section randomizer, so it truly covers everything the
  // individual 🎲 buttons do (it used to touch only ~half the fields — no scale/position,
  // surface finish, fibers, grain, speed, strand params, etc.).
  randomizeGradient(cfg); // palette + gradient type/angle
  randomizeColor(cfg); // hue / contrast / saturation
  randomizeSpine(cfg); // displacement
  randomizeTransform(cfg); // rotation + scale + position
  randomizeTwist(cfg); // twist frequency + power
  randomizeFinish(cfg); // fibers/grain/texture/blur + volume/glow/edge
  randomizeLights(cfg); // ambient (+ any existing light objects)
  randomizeStrands(cfg); // per-strand opacity/hue/width/speed/seed
  cfg.speed = r2(rand(0.02, 0.15));
  // NB: we deliberately keep the camera (zoom/target) at the hero framing so the random
  // result always lands in view — randomizing scale/position/rotation already varies the
  // composition plenty, and random zoom on top frequently pushed the wave off-frame.
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

/** "Color" folder: hue / contrast / saturation grading. */
export function randomizeColor(c: WaveConfig): void {
  c.hueShift = Math.round(rand(0, 360));
  c.colorContrast = r2(rand(0.9, 1.3));
  c.colorSaturation = r2(rand(0.8, 1.35));
}

export function randomizeSpine(c: WaveConfig): void {
  c.displaceFrequency = { x: r3(rand(0.002, 0.008)), y: r3(rand(0.004, 0.014)) };
  c.displaceAmount = r2(rand(3, 9));
}

export function randomizeTransform(c: WaveConfig): void {
  c.rotation = { x: r2(rand(-20, 5)), y: r2(rand(-25, 10)), z: r2(rand(-170, -150)) };
  // Full scale (×10) — the mesh lives in the tens, not fractions.
  const s = r2(rand(6, 14));
  c.scale = { x: s, y: s, z: r2(s * rand(0.6, 0.8)) };
  c.position = { x: r2(rand(-60, 60)), y: r2(rand(-60, 60)), z: 0 };
}

export function randomizeTwist(c: WaveConfig): void {
  c.twistFrequency = { x: r3(rand(-0.5, 0.5)), y: r3(rand(-0.3, 0.5)), z: r3(rand(-1.6, -0.6)) };
  c.twistPower = { x: r2(rand(2, 6)), y: r2(rand(2, 6)), z: r2(rand(2, 7)) };
}

/** "Finish" folder: surface texture (fibers/grain/texture/blur) + volume/glow/edge. */
export function randomizeFinish(c: WaveConfig): void {
  c.fiberCount = Math.round(rand(200, 900));
  c.fiberThickness = r2(rand(0.1, 0.35));
  c.grain = r2(rand(0, 1.5));
  c.texture = r2(rand(0, 0.35));
  c.blur = r3(rand(0, 0.02));
  c.volume = r2(rand(0.3, 0.8)); // rounded thickness
  c.pdyLift = r2(rand(0.2, 0.9));
  c.glowAmount = r2(rand(0.4, 1.0)); // pdy strength (where streaks appear)
  c.glowPower = r2(rand(0.45, 0.8));
  c.glowRamp = r2(rand(0.8, 1.2));
  c.edgeFade = r2(rand(0, 0.08));
}

export function randomizeLights(c: WaveConfig): void {
  c.ambient = r2(rand(0.25, 0.6));
  for (const l of c.lights) {
    l.position = { x: r2(rand(-1000, 1000)), y: r2(rand(-500, 1000)), z: r2(rand(-500, 1200)) };
    l.intensity = r2(rand(0.5, 1.6));
    l.color = pick(LIGHT_TINTS);
  }
}

export function randomizeGlobal(c: WaveConfig): void {
  c.speed = r2(rand(0.02, 0.15));
  // Ortho: vary the zoom (framing), keep the camera pose/target — distance doesn't size it.
  c.cameraZoom = r2(rand(1.2, 2.6));
}

export function randomizeStrands(c: WaveConfig): void {
  for (const l of c.layers) {
    l.opacity = r2(rand(0.6, 1));
    l.hueShift = Math.round(rand(-60, 60));
    l.widthMul = r2(rand(0.7, 1.2));
    l.speed = r2(rand(0.7, 1.3));
    l.seed = r2(rand(0, 12));
    l.offset = { x: r2(rand(-3, 3)), y: r2(rand(-3, 3)), z: r2(rand(-3, 3)) };
    l.twistOffset = Math.round(rand(-40, 40));
  }
}
