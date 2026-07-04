/**
 * Configuration schema for the wave: a flat sheet displaced by noise (X/Z frequency
 * + amount) then twisted by three axis-rotations (twistFrequency + twistPower per
 * axis), then scaled / rotated / positioned. Plain JSON — doubles as the save-state
 * format.
 */

import onePieceLogoUrl from "../assets/one-piece-logo.png?inline";
import spiderManComicPanelsUrl from "../assets/spider-man-comic-panels.webp?inline";
import spiderManLogoUrl from "../assets/spider-man-logo.svg?inline";
import { clamp, clamp01, roundTo } from "../util/math";

export const MAX_COLORS = 8;
export const MAX_MESH_POINTS = 8;
export const MAX_LIGHTS = 8;
export const MAX_NOISE_BANDS = 4;
/** Cap on stacked waves (keeps total geometry bounded — see WaveRenderer segment scaling). */
export const MAX_WAVES = 6;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// "squared" = the hero material blend: SrcColor × Zero (framebuffer = fragColor²), which
// deepens the colours — the faithful default. "normal"/"additive"/"multiply" are authoring
// overrides ("multiply" darkens where waves/background overlap).
export type BlendMode = "squared" | "normal" | "additive" | "multiply";

/** How the palette is mapped across the surface. */
export type BasicGradientType = "linear" | "radial" | "conic";
export type GradientType = BasicGradientType | "mesh";

export type BackgroundMode = "color" | "gradient" | "image";
export type BackgroundImageFit = "cover" | "contain" | "stretch";

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

/** Where the first light lands when you engage lights from an empty scene. Shared by the
 *  "drag in 3D" control and the camera-rig minimap, which previews a light marker here so the
 *  rig always shows the light — even before one has been explicitly added. */
export const DEFAULT_LIGHT_POSITION: Vec3 = { x: 800, y: 900, z: 1100 };

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

/** One colour influence point in the 2D mesh-gradient field. */
export interface MeshGradientPoint {
  color: string;
  /** Horizontal UV position (0–1). */
  x: number;
  /** Vertical UV position (0–1). */
  y: number;
  /** Relative reach of this point's colour field. */
  influence: number;
}

/** Build evenly-spaced stops from a plain list of colours. */
export function makeStops(colors: string[]): ColorStop[] {
  const n = colors.length;
  return colors.map((color, i) => ({ color, pos: n > 1 ? i / (n - 1) : 0 }));
}

/** A balanced iOS-style field shown the first time Mesh is selected. */
export function createDefaultMeshPoints(): MeshGradientPoint[] {
  return [
    { color: "#5e5ce6", x: 0.08, y: 0.12, influence: 0.78 },
    { color: "#64d2ff", x: 0.88, y: 0.08, influence: 0.72 },
    { color: "#ff375f", x: 0.12, y: 0.88, influence: 0.72 },
    { color: "#ff9f0a", x: 0.9, y: 0.86, influence: 0.78 },
    { color: "#bf5af2", x: 0.5, y: 0.48, influence: 0.58 },
  ];
}

/**
 * A single wave: a COMPLETE, self-contained wave — its own shape, twist, colour, finish,
 * transform and blend. Stacking waves composites independent waves; there is no shared
 * "base wave" any more, so nothing is duplicated between a global section and the waves.
 * Field names mirror the legacy top-level wave fields so migration + the per-section helpers
 * (normalizeWaveColour, randomize*) map 1:1.
 */
export interface WaveConfig {
  // Colour & gradient
  palette: ColorStop[];
  gradientType: GradientType;
  gradientAngle: number;
  gradientShift: number;
  meshGradientPoints: MeshGradientPoint[];
  meshGradientSoftness: number;
  usePaletteTexture: boolean;
  paletteSource: PaletteSource;
  paletteImageUrl?: string;
  paletteVideoUrl?: string;
  paletteTextureScale: Vec2;
  paletteTextureOffset: Vec2;
  paletteTextureRotation: number;
  paletteEdgeColor: string;
  paletteEdgeAmount: number;
  hueShift: number;
  colorContrast: number;
  colorSaturation: number;
  // Surface finish
  fiberCount: number;
  fiberStrength: number;
  noiseBands: NoiseBand[];
  texture: number;
  creaseLight: number;
  creaseSharpness: number;
  creaseSoftness: number;
  sheen: number;
  roundness: number;
  /** Thin-film / holographic hue response that shifts with view angle (0 = off). */
  iridescence: number;
  edgeFade: number;
  // Displacement + twist (the wave shape)
  displaceFrequency: Vec2;
  displaceAmount: number;
  twistFrequency: Vec3;
  twistPower: Vec3;
  twistMotion?: boolean;
  // Material ("solid" surface vs "wireframe" line shader)
  theme?: "solid" | "wireframe";
  lineAmount?: number;
  lineThickness?: number;
  lineDerivativePower?: number;
  maxWidth?: number;
  // Transform (absolute — no shared base to offset from)
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  // Compositing
  blendMode: BlendMode;
  /** Absolute animation speed for this wave (legacy global speed × per-layer multiplier). */
  speed: number;
  /** Overall opacity of this wave. */
  opacity: number;
  /** Phase/seed so waves don't move in lockstep. */
  seed: number;
}

/**
 * Scene-level settings shared by every wave: output/background/camera/lights, the post-fx
 * pass (grain/blur), playback, quality, and the whole-composition mirror. Everything that
 * describes an individual wave lives on WaveConfig instead.
 */
export interface SceneConfig {
  background: string;
  transparentBackground: boolean;
  backgroundMode: BackgroundMode;
  backgroundPalette: ColorStop[];
  backgroundGradientType: GradientType;
  backgroundGradientAngle: number;
  backgroundGradientSource: PaletteSource;
  backgroundMeshPoints: MeshGradientPoint[];
  backgroundMeshSoftness: number;
  backgroundImageSource: PaletteSource;
  backgroundImageUrl?: string;
  backgroundVideoUrl?: string;
  backgroundImageFit: BackgroundImageFit;
  backgroundImageZoom: number;
  backgroundImagePosition: Vec2;
  /** Number of stacked waves (kept in sync with waves.length). */
  waveCount: number;
  quality: number;
  dprMax: number;
  paused: boolean;
  /** Noise phase offset — scrubs the noise pattern to pick a still frame. */
  timeOffset?: number;
  /** Seamless-loop period in seconds (0 = off). When >0, the motion is mapped onto a circle in
   *  noise space so it repeats exactly every `loopSeconds` — scene-level so a multi-wave stack
   *  shares one period and the whole composite loops. */
  loopSeconds?: number;
  introRamp?: boolean;
  showCameraRig: boolean;
  cameraDistance: number;
  cameraZoom: number;
  cameraPosition: Vec3;
  cameraTarget: Vec3;
  /** Film grain amount (post pass). */
  grain: number;
  /** Soft-focus / spin blur amount (post pass). */
  blur: number;
  blurSamples?: number;
  /** Bloom (post pass, UnrealBloomPass). strength 0 removes the pass entirely, so cost and pixels
   *  are identical to bloom-off; radius/threshold only take effect once strength > 0. */
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  /** Base ambient light level (0–1). */
  ambient: number;
  lights: LightConfig[];
  /** Mirror the whole composition on screen (world-space flip). */
  mirrorH: boolean;
  mirrorV: boolean;
}

/** The full save-state: scene settings + one or more complete waves. */
export interface StudioConfig extends SceneConfig {
  waves: WaveConfig[];
}

/** Spread a base wave into `count` overlapping waves — each with a slightly varied hue, width,
 *  speed, phase, vertical offset and roll so a stack reads as one composition. `count === 1`
 *  returns the base unchanged. Used to author multi-wave presets. */
export function makeWaveSpread(base: WaveConfig, count: number): WaveConfig[] {
  if (count <= 1) return [structuredClone(base)];
  const out: WaveConfig[] = [];
  for (let i = 0; i < count; i++) {
    const f = i / (count - 1);
    const w = structuredClone(base);
    w.opacity = 1.0 - f * 0.3;
    w.hueShift = base.hueShift + i * 18;
    w.scale = { x: base.scale.x, y: base.scale.y * (1 - f * 0.2), z: base.scale.z };
    w.speed = base.speed * (1 + f * 0.15);
    w.seed = i * 3.3;
    w.position = {
      x: base.position.x,
      y: base.position.y + (f - 0.5) * 1.5,
      z: base.position.z - i * 0.8,
    };
    w.rotation = { x: base.rotation.x, y: base.rotation.y, z: base.rotation.z + i * 20 };
    out.push(w);
  }
  return out;
}

/** The hero wave (a single complete wave) — the base for the default config and most presets. */
function defaultWave(): WaveConfig {
  return {
    // The hero palette: a periwinkle tip/edge, a dominant orange core, then coral → magenta →
    // pink, with a violet twist tip. gradientShift warps it to mimic a baked 2D palette texture.
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
    gradientAngle: 90, // 90° = the gradient runs ALONG the length (uv.x)
    gradientShift: 0.15,
    meshGradientPoints: createDefaultMeshPoints(),
    meshGradientSoftness: 0.62,
    usePaletteTexture: true, // default to the baked hero LUT
    paletteSource: "hero",
    paletteTextureScale: { x: 1, y: 1 },
    paletteTextureOffset: { x: 0, y: 0 },
    paletteTextureRotation: 0,
    paletteEdgeColor: "#8e9dff",
    paletteEdgeAmount: 0.3,
    hueShift: -1.81, // hero colorHueShift ≈ -1.81°
    colorContrast: 1.0,
    colorSaturation: 1.15,
    // Hero fibers: the surfaceColor fragment hardcodes freq 600 / strength 0.2; the line* fields
    // feed the wireframe theme (unused by the solid hero).
    fiberCount: 600,
    fiberStrength: 0.2,
    noiseBands: [],
    texture: 0,
    creaseLight: 0.6,
    creaseSharpness: 0.589,
    creaseSoftness: 1.0,
    // sheen 0 + roundness 0: the ortho crop makes crease low, so the hero look comes from the
    // SrcColor² blend + the palette, not the derivative white-lift.
    sheen: 0.0,
    roundness: 0.0,
    iridescence: 0,
    edgeFade: 0.04,
    // Hero deformation on the native 400-unit folded() geometry.
    displaceFrequency: { x: 0.003234, y: 0.00799 },
    displaceAmount: 6.051,
    // Small twist frequencies + high powers — a gentle twist; the drama is the ortho crop.
    twistFrequency: { x: -0.055, y: 0.077, z: -0.518 },
    twistPower: { x: 3.95, y: 5.85, z: 6.33 },
    twistMotion: false,
    theme: "solid",
    lineAmount: 425, // wireframe-theme line params (defaults)
    lineThickness: 1,
    lineDerivativePower: 0.95,
    maxWidth: 1232,
    // Hero mesh transform at FULL scale (the ortho camera frames in pixels).
    position: { x: -24.3, y: -56.4, z: -11.1 },
    rotation: { x: -9.14, y: -16.25, z: -161.32 },
    scale: { x: 10, y: 10, z: 7 },
    blendMode: "squared", // the hero squaring blend (SrcColor²)
    speed: 0.04, // hero speed: 4e-5 vs ms-time ≈ 0.04/s
    opacity: 1,
    seed: 0,
  };
}

/** A fresh default wave (the hero wave as one complete wave). */
export function makeWave(): WaveConfig {
  return defaultWave();
}

/** Resize `waves` to match `waveCount`. New waves CLONE the last one (inherit every
 *  property of the preceding wave); extras are dropped. */
export function resizeWaves(config: StudioConfig): void {
  const target = Math.max(1, Math.round(config.waveCount) || 1);
  if (!Array.isArray(config.waves) || config.waves.length === 0) {
    config.waves = [makeWave()];
  }
  while (config.waves.length < target) {
    config.waves.push(structuredClone(config.waves[config.waves.length - 1]));
  }
  while (config.waves.length > target) config.waves.pop();
  config.waveCount = config.waves.length;
}

/** The default studio config: the hero wave + its scene, in the canonical wave model. */
export function createDefaultConfig(): StudioConfig {
  return {
    background: "#ffffff",
    transparentBackground: true,
    backgroundMode: "color",
    backgroundPalette: makeStops(["#0a2540", "#425466", "#7a73ff", "#f6f9fc"]),
    backgroundGradientType: "linear",
    backgroundGradientAngle: 135,
    backgroundGradientSource: "stops",
    backgroundMeshPoints: createDefaultMeshPoints(),
    backgroundMeshSoftness: 0.62,
    backgroundImageSource: "vaporwave",
    backgroundImageFit: "cover",
    backgroundImageZoom: 1,
    backgroundImagePosition: { x: 0, y: 0 },
    waveCount: 1,
    quality: 1,
    dprMax: 2,
    paused: false,
    timeOffset: 0, // noise phase (scrub to pick a still)
    introRamp: true, // ease the animation in over ~1s on load (skipped in dev; see WaveRenderer.updateTime)
    showCameraRig: false,
    // The hero camera: ORTHOGRAPHIC at (100,0,5000) looking at the origin. The mesh is ×10 so
    // the wave overflows the frame and only the twist shows. cameraZoom is a user multiplier on
    // the responsive base zoom (1 = the hero crop); cameraTarget pans the look-at to the twist.
    cameraDistance: 5001,
    cameraPosition: { x: 100, y: 0, z: 5000 },
    cameraTarget: { x: -44, y: -250, z: 0 },
    cameraZoom: 1.0,
    // Post (one pass over the whole composite): hero grain 1.1, blur 0.02.
    grain: 1.1,
    blur: 0.02,
    blurSamples: 6,
    ambient: 0.45,
    lights: [], // hero has no lights — colour is the palette + the SrcColor² blend
    mirrorH: false,
    mirrorV: false,
    waves: [defaultWave()],
  };
}

function cloneConfig(config: StudioConfig): StudioConfig {
  return structuredClone(config);
}

/** Clamp/backfill a single wave's colour + palette fields (legacy `string[]` palettes become
 *  ColorStop[]; mesh points + texture transform are clamped). */
function normalizeWaveColour(config: WaveConfig): void {
  const p = config.palette as unknown as Array<string | ColorStop>;
  if (p.length > 0 && typeof p[0] === "string") {
    config.palette = makeStops(p as string[]);
  }
  if (
    config.gradientType !== "radial" &&
    config.gradientType !== "conic" &&
    config.gradientType !== "mesh" &&
    config.gradientType !== "linear"
  ) {
    config.gradientType = "linear";
  }
  const rawMeshPoints = config.meshGradientPoints as MeshGradientPoint[] | undefined;
  if (!Array.isArray(rawMeshPoints) || rawMeshPoints.length < 2) {
    config.meshGradientPoints = createDefaultMeshPoints();
  } else {
    const defaults = createDefaultMeshPoints();
    config.meshGradientPoints = rawMeshPoints.slice(0, MAX_MESH_POINTS).map((point, index) => {
      const fallback = defaults[index] ?? defaults[defaults.length - 1];
      const x = Number(point.x);
      const y = Number(point.y);
      const influence = Number(point.influence);
      return {
        color: typeof point.color === "string" ? point.color : fallback.color,
        x: clamp01(Number.isFinite(x) ? x : fallback.x),
        y: clamp01(Number.isFinite(y) ? y : fallback.y),
        influence: clamp(Number.isFinite(influence) ? influence : fallback.influence, 0.15, 1.5),
      };
    });
  }
  if (!Number.isFinite(config.meshGradientSoftness)) config.meshGradientSoftness = 0.62;
  config.meshGradientSoftness = clamp01(config.meshGradientSoftness);
  if (!config.paletteTextureScale) config.paletteTextureScale = { x: 1, y: 1 };
  if (!config.paletteTextureOffset) config.paletteTextureOffset = { x: 0, y: 0 };
  config.paletteTextureScale.x = clamp(Number(config.paletteTextureScale.x) || 1, 0.1, 8);
  config.paletteTextureScale.y = clamp(Number(config.paletteTextureScale.y) || 1, 0.1, 8);
  config.paletteTextureOffset.x = clamp(Number(config.paletteTextureOffset.x) || 0, -4, 4);
  config.paletteTextureOffset.y = clamp(Number(config.paletteTextureOffset.y) || 0, -4, 4);
  config.paletteTextureRotation = clamp(Number(config.paletteTextureRotation) || 0, -180, 180);
}

/** Backfill background styling for states saved before gradient/image backgrounds existed. */
export function normalizeBackground(config: StudioConfig): void {
  if (
    config.backgroundMode !== "gradient" &&
    config.backgroundMode !== "image" &&
    config.backgroundMode !== "color"
  ) {
    config.backgroundMode = "color";
  }
  const palette = config.backgroundPalette as unknown as Array<string | ColorStop> | undefined;
  if (!palette || palette.length < 2) {
    config.backgroundPalette = makeStops(["#0a2540", "#425466", "#7a73ff", "#f6f9fc"]);
  } else if (typeof palette[0] === "string") {
    config.backgroundPalette = makeStops(palette as string[]);
  }
  if (
    config.backgroundGradientType !== "radial" &&
    config.backgroundGradientType !== "conic" &&
    config.backgroundGradientType !== "mesh" &&
    config.backgroundGradientType !== "linear"
  ) {
    config.backgroundGradientType = "linear";
  }
  const bgMesh = config.backgroundMeshPoints as MeshGradientPoint[] | undefined;
  if (!Array.isArray(bgMesh) || bgMesh.length < 2) {
    config.backgroundMeshPoints = createDefaultMeshPoints();
  }
  if (!Number.isFinite(config.backgroundMeshSoftness)) config.backgroundMeshSoftness = 0.62;
  config.backgroundMeshSoftness = clamp01(config.backgroundMeshSoftness);
  if (typeof config.backgroundGradientAngle !== "number") config.backgroundGradientAngle = 135;
  if (typeof config.backgroundGradientSource !== "string")
    config.backgroundGradientSource = "stops";
  if (typeof config.backgroundImageSource !== "string") config.backgroundImageSource = "vaporwave";
  if (
    config.backgroundImageFit !== "contain" &&
    config.backgroundImageFit !== "stretch" &&
    config.backgroundImageFit !== "cover"
  ) {
    config.backgroundImageFit = "cover";
  }
  if (typeof config.backgroundImageZoom !== "number") config.backgroundImageZoom = 1;
  config.backgroundImageZoom = clamp(config.backgroundImageZoom, 0.1, 8);
  if (!config.backgroundImagePosition) config.backgroundImagePosition = { x: 0, y: 0 };
  if (typeof config.backgroundImagePosition.x !== "number") config.backgroundImagePosition.x = 0;
  if (typeof config.backgroundImagePosition.y !== "number") config.backgroundImagePosition.y = 0;
  config.backgroundImagePosition.x = clamp(config.backgroundImagePosition.x, -100, 100);
  config.backgroundImagePosition.y = clamp(config.backgroundImagePosition.y, -100, 100);
}

/** Backfill camera position/target for states saved before they existed. */
export function ensureCamera(config: StudioConfig): void {
  if (!config.cameraPosition)
    config.cameraPosition = { x: 0, y: 0, z: config.cameraDistance ?? 62 };
  if (!config.cameraTarget) config.cameraTarget = { x: 0, y: 0, z: 0 };
  if (typeof config.cameraZoom !== "number") config.cameraZoom = 1;
}

/** Backfill/repair a wave so the renderer can consume it (covers partial wave-model JSON). */
export function normalizeWave(s: WaveConfig): void {
  normalizeWaveColour(s);
  if (typeof s.gradientAngle !== "number") s.gradientAngle = 90;
  if (typeof s.gradientShift !== "number") s.gradientShift = 0.15;
  if (typeof s.usePaletteTexture !== "boolean") s.usePaletteTexture = true;
  if (typeof s.paletteSource !== "string") s.paletteSource = "hero";
  if (typeof s.paletteEdgeColor !== "string") s.paletteEdgeColor = "#8e9dff";
  if (typeof s.paletteEdgeAmount !== "number") s.paletteEdgeAmount = 0.3;
  if (typeof s.hueShift !== "number") s.hueShift = 0;
  if (typeof s.colorContrast !== "number") s.colorContrast = 1;
  if (typeof s.colorSaturation !== "number") s.colorSaturation = 1;
  if (typeof s.fiberCount !== "number") s.fiberCount = 600;
  if (typeof s.fiberStrength !== "number") s.fiberStrength = 0.2;
  if (!Array.isArray(s.noiseBands)) s.noiseBands = [];
  if (typeof s.texture !== "number") s.texture = 0;
  if (typeof s.creaseLight !== "number") s.creaseLight = 0.6;
  if (typeof s.creaseSharpness !== "number") s.creaseSharpness = 0.589;
  if (typeof s.creaseSoftness !== "number") s.creaseSoftness = 1;
  if (typeof s.sheen !== "number") s.sheen = 0;
  if (typeof s.roundness !== "number") s.roundness = 0;
  if (typeof s.iridescence !== "number") s.iridescence = 0;
  if (typeof s.edgeFade !== "number") s.edgeFade = 0.04;
  if (!s.displaceFrequency) s.displaceFrequency = { x: 0.003234, y: 0.00799 };
  if (typeof s.displaceAmount !== "number") s.displaceAmount = 6.051;
  if (!s.twistFrequency) s.twistFrequency = { x: -0.055, y: 0.077, z: -0.518 };
  if (!s.twistPower) s.twistPower = { x: 3.95, y: 5.85, z: 6.33 };
  if (typeof s.theme !== "string") s.theme = "solid";
  if (typeof s.lineAmount !== "number") s.lineAmount = 425;
  if (typeof s.lineThickness !== "number") s.lineThickness = 1;
  if (typeof s.lineDerivativePower !== "number") s.lineDerivativePower = 0.95;
  if (typeof s.maxWidth !== "number") s.maxWidth = 1232;
  if (!s.position) s.position = { x: 0, y: 0, z: 0 };
  if (!s.rotation) s.rotation = { x: 0, y: 0, z: 0 };
  if (!s.scale) s.scale = { x: 10, y: 10, z: 7 };
  if (typeof s.blendMode !== "string") s.blendMode = "squared";
  if (typeof s.speed !== "number") s.speed = 0.04;
  if (typeof s.opacity !== "number") s.opacity = 1;
  if (typeof s.seed !== "number") s.seed = 0;
}

/** Backfill scene-level defaults (background/camera/post/lights/quality/mirror). */
export function ensureSceneDefaults(config: StudioConfig): void {
  normalizeBackground(config);
  ensureCamera(config);
  if (typeof config.ambient !== "number") config.ambient = 0.45;
  if (!Array.isArray(config.lights)) config.lights = [];
  if (typeof config.quality !== "number") config.quality = 1;
  if (typeof config.dprMax !== "number") config.dprMax = 2;
  if (typeof config.grain !== "number") config.grain = 1.1;
  if (typeof config.blur !== "number") config.blur = 0.02;
  if (typeof config.blurSamples !== "number") config.blurSamples = 6;
  if (typeof config.bloomStrength !== "number") config.bloomStrength = 0;
  if (typeof config.bloomRadius !== "number") config.bloomRadius = 0.4;
  if (typeof config.bloomThreshold !== "number") config.bloomThreshold = 0.85;
  if (typeof config.showCameraRig !== "boolean") config.showCameraRig = false;
  if (typeof config.paused !== "boolean") config.paused = false;
  if (typeof config.loopSeconds !== "number") config.loopSeconds = 0;
  if (typeof config.mirrorH !== "boolean") config.mirrorH = false;
  if (typeof config.mirrorV !== "boolean") config.mirrorV = false;
}

/** Normalize an ingested config to the wave model: backfill the scene + every wave, and drop in
 *  a default wave if none are present. Idempotent, so it is safe on the renderer's own config as
 *  well as freshly loaded save-states / share links. */
export function ensureStudioConfig(input: StudioConfig): StudioConfig {
  const config = input;
  ensureSceneDefaults(config);
  if (!Array.isArray(config.waves) || config.waves.length === 0) {
    config.waves = [makeWave()];
  }
  config.waves.forEach(normalizeWave);
  config.waveCount = config.waves.length;
  return config;
}

// ---- Presets ----

const RAD = 180 / Math.PI;

/** Build a preset from a set of wave parameters. rotation/hue are given in RADIANS and
 *  converted to degrees. All presets are solid-theme, so they reuse the hero palette +
 *  surfaceColor fibers (600/0.2) and sheen 0, like the hero. camTarget/zoom frame the
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
}): StudioConfig {
  const c = createDefaultConfig();
  const w = c.waves[0];
  w.speed = p.speed;
  w.colorContrast = p.contrast;
  w.colorSaturation = p.sat;
  w.hueShift = p.hueRad * RAD;
  w.displaceFrequency = { x: p.dispX, y: p.dispZ };
  w.displaceAmount = p.dispAmt;
  w.position = { x: p.pos[0], y: p.pos[1], z: p.pos[2] };
  w.rotation = { x: p.rotRad[0] * RAD, y: p.rotRad[1] * RAD, z: p.rotRad[2] * RAD };
  w.scale = { x: p.scale[0], y: p.scale[1], z: p.scale[2] };
  w.twistFrequency = { x: p.twF[0], y: p.twF[1], z: p.twF[2] };
  w.twistPower = { x: p.twP[0], y: p.twP[1], z: p.twP[2] };
  w.creaseLight = p.glow[0];
  w.creaseSharpness = p.glow[1];
  w.creaseSoftness = p.glow[2];
  if (p.noiseBands) w.noiseBands = p.noiseBands;
  if (p.twistMotion) w.twistMotion = true;
  c.grain = p.grain;
  c.blur = p.blur;
  c.cameraPosition = { x: 100, y: 0, z: 5000 };
  c.cameraTarget = { x: p.camTarget[0], y: p.camTarget[1], z: 0 };
  c.cameraZoom = p.zoom;
  return c;
}

/** Presets: each a complete studio config (scene + one or more waves) in the wave model. */
export const PRESETS: Record<string, () => StudioConfig> = {
  // The app's default wave: a centred, full-frame ribbon (window-independent framing).
  // Shown first and named "Stripe Hero"; several presets below derive from it.
  "Stripe Hero": () =>
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
  // Stripe's real hero, recreated faithfully (this preset used to be named "Stripe Hero"):
  // an orthographic ×10 scene that overflows the frame, so only the twisted crop shows.
  "Stripe Wave 2": () => createDefaultConfig(),
  // camTarget on the waves below is a first-pass centring; tune per-wave. NOTE: Wave 4 also
  // uses a variant vertex shader (animated twist-X wobble) we don't fully replicate — its
  // STATIC frame is close, the motion differs.
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
  // The dark-background hero: identical geometry/camera to the default hero, but theme
  // "wireframe" → the line shader on a dark page background, with grain 1.2. Same palette.
  "Stripe Wireframe": () => {
    const c = createDefaultConfig();
    c.waves[0].theme = "wireframe";
    c.grain = 1.2;
    c.background = "#0a2540"; // dark navy page background
    c.transparentBackground = false;
    return c;
  },
  "Neon Dark Multistrand": () => {
    const c = createDefaultConfig();
    const w = c.waves[0];
    w.theme = "wireframe"; // line shader on the near-black background — neon wireframe look
    w.blendMode = "additive";
    w.palette = makeStops(["#00f5d4", "#00bbf9", "#9b5de5", "#f15bb5", "#fee440"]);
    w.creaseLight = 1.0;
    c.background = "#05060c";
    c.transparentBackground = false; // fill the dark bg so the neon lines read on black (not the page)
    c.waves = makeWaveSpread(w, 3); // three overlapping neon waves
    c.waveCount = 3;
    return c;
  },
  "Mesh Gradient": () => {
    const c = PRESETS["Stripe Hero"](); // the centred default wave (formerly "Stripe Wave 2")
    const w = c.waves[0];
    w.gradientType = "mesh";
    w.meshGradientPoints = [
      { color: "#0a84ff", x: 0.06, y: 0.9, influence: 0.68 },
      { color: "#64d2ff", x: 0.88, y: 0.92, influence: 0.72 },
      { color: "#bf5af2", x: 0.5, y: 0.64, influence: 0.58 },
      { color: "#ff375f", x: 0.1, y: 0.14, influence: 0.7 },
      { color: "#ff9f0a", x: 0.84, y: 0.12, influence: 0.74 },
      { color: "#30d158", x: 0.94, y: 0.5, influence: 0.54 },
    ];
    w.meshGradientSoftness = 0.68;
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.06;
    w.colorSaturation = 1.12;
    w.fiberStrength = 0.14;
    c.grain = 0.3;
    c.blur = 0.008;
    c.background = "#070914";
    c.backgroundMode = "color";
    c.transparentBackground = false;
    return c;
  },
  "Solar Bloom": () => {
    // Radial gradient: a warm core blooming out to a deep-indigo edge. usePaletteTexture off so
    // our own stops map along the radial gradCoord instead of sampling the baked hero LUT.
    const c = PRESETS["Stripe Hero"]();
    const w = c.waves[0];
    w.usePaletteTexture = false;
    w.gradientType = "radial";
    w.gradientShift = 0.14;
    w.palette = [
      { color: "#fff3c4", pos: 0 }, // warm-white core
      { color: "#ffd166", pos: 0.22 }, // gold
      { color: "#ff8c42", pos: 0.42 }, // orange
      { color: "#ff5d8f", pos: 0.62 }, // coral-pink
      { color: "#a64dff", pos: 0.82 }, // violet
      { color: "#241246", pos: 1 }, // deep indigo edge
    ];
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.05;
    w.colorSaturation = 1.18;
    w.fiberStrength = 0.12;
    c.grain = 0.3;
    c.blur = 0.01;
    // Deep warm radial vignette behind the bloom.
    c.background = "#0a0714";
    c.backgroundMode = "gradient";
    c.backgroundGradientType = "radial";
    c.backgroundGradientSource = "stops";
    c.backgroundPalette = makeStops(["#2a1330", "#08040f"]);
    c.transparentBackground = false;
    return c;
  },
  Holographic: () => {
    // Conic gradient: an iridescent oil-slick sweep. The palette wraps (first ≈ last stop) so
    // the conic seam is invisible.
    const c = PRESETS["Stripe Hero"]();
    const w = c.waves[0];
    w.usePaletteTexture = false;
    w.gradientType = "conic";
    w.gradientShift = 0.08;
    w.palette = [
      { color: "#8ef6e4", pos: 0 }, // mint (seam)
      { color: "#6ec3ff", pos: 0.18 }, // sky
      { color: "#9b8cff", pos: 0.36 }, // periwinkle
      { color: "#ff8ad8", pos: 0.54 }, // pink
      { color: "#ffd98e", pos: 0.72 }, // peach
      { color: "#a0f0c8", pos: 0.88 }, // seafoam
      { color: "#8ef6e4", pos: 1 }, // mint again (seamless wrap)
    ];
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.04;
    w.colorSaturation = 1.12;
    w.fiberStrength = 0.12;
    c.grain = 0.28;
    c.blur = 0.01;
    // Subtle deep teal → violet wash behind the iridescence.
    c.background = "#05060c";
    c.backgroundMode = "gradient";
    c.backgroundGradientType = "linear";
    c.backgroundGradientAngle = 135;
    c.backgroundGradientSource = "stops";
    c.backgroundPalette = makeStops(["#04121a", "#0a0518"]);
    c.transparentBackground = false;
    return c;
  },
  Aurora: () => {
    // Mesh gradient: a moody aurora — teals/greens drifting into violet over a night-sky base
    // (distinct from the brighter iOS-style "Mesh Gradient").
    const c = PRESETS["Stripe Hero"]();
    const w = c.waves[0];
    w.gradientType = "mesh";
    w.meshGradientPoints = [
      { color: "#0a1f3c", x: 0.08, y: 0.12, influence: 0.62 },
      { color: "#1fddb0", x: 0.3, y: 0.7, influence: 0.78 },
      { color: "#57f5a3", x: 0.58, y: 0.86, influence: 0.7 },
      { color: "#3a86ff", x: 0.82, y: 0.55, influence: 0.62 },
      { color: "#a15cff", x: 0.5, y: 0.32, influence: 0.7 },
      { color: "#071433", x: 0.92, y: 0.08, influence: 0.6 },
    ];
    w.meshGradientSoftness = 0.72;
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.05;
    w.colorSaturation = 1.18;
    w.fiberStrength = 0.12;
    c.grain = 0.3;
    c.blur = 0.008;
    // Dark night-sky MESH backdrop (also shows off the mesh background type).
    c.background = "#03060f";
    c.backgroundMode = "gradient";
    c.backgroundGradientType = "mesh";
    c.backgroundMeshPoints = [
      { color: "#02040c", x: 0.15, y: 0.85, influence: 0.7 },
      { color: "#08243a", x: 0.5, y: 0.5, influence: 0.75 },
      { color: "#0a0f2e", x: 0.85, y: 0.7, influence: 0.7 },
      { color: "#04121a", x: 0.7, y: 0.2, influence: 0.6 },
      { color: "#000208", x: 0.12, y: 0.12, influence: 0.6 },
    ];
    c.backgroundMeshSoftness = 0.75;
    c.transparentBackground = false;
    return c;
  },
  Palestine: () => {
    const c = PRESETS["Stripe Hero"](); // the centred default wave (formerly "Stripe Wave 2")
    const w = c.waves[0];
    w.paletteSource = "palestine";
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1;
    w.colorSaturation = 1;
    c.grain = 0.35;
    c.background = "#f2efe8";
    c.transparentBackground = true;
    return c;
  },
  "One Piece — Grand Line": () => {
    const c = PRESETS["Stripe Wave 3"]();
    const w = c.waves[0];
    w.paletteImageUrl = onePieceLogoUrl;
    w.usePaletteTexture = true;
    w.paletteTextureScale = { x: 1, y: 1 };
    w.paletteTextureOffset = { x: 0, y: 0 };
    w.paletteTextureRotation = 90;
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1;
    w.colorSaturation = 1;
    w.creaseLight = 0.65;
    w.creaseSoftness = 0.8;
    w.speed = 0.065;
    c.grain = 0.25;
    c.blur = 0.006;
    c.cameraZoom = 1;
    c.background = "#061426";
    c.backgroundMode = "gradient";
    c.backgroundGradientSource = "grandLine";
    c.backgroundGradientType = "conic";
    c.backgroundGradientAngle = 180;
    c.transparentBackground = false;
    return c;
  },
  "Spider-Man — Webbed City": () => {
    const c = PRESETS["Stripe Wave 3"]();
    const w = c.waves[0];
    w.paletteImageUrl = spiderManLogoUrl;
    w.usePaletteTexture = true;
    w.paletteTextureScale = { x: 1, y: 1 };
    w.paletteTextureOffset = { x: 0, y: -0.28 };
    w.paletteTextureRotation = 90;
    w.theme = "wireframe";
    // Tuned in the studio and imported from spiderman-wave.json for a denser,
    // irregular filament field that reads more like a web than parallel ribbons.
    w.fiberCount = 1;
    w.fiberStrength = 0.96;
    w.lineAmount = 1200;
    w.lineThickness = 1.89;
    w.lineDerivativePower = 0.41;
    w.maxWidth = 392;
    w.blendMode = "additive";
    w.hueShift = 0;
    w.colorContrast = 1;
    w.colorSaturation = 0;
    w.creaseLight = 1;
    w.creaseSoftness = 0.9;
    w.speed = 0.075;
    // Flatten the strong Wave-3 twist so the whole "SPIDER-MAN" wordmark lies readably
    // across the ribbon instead of the "SPIDER" end folding/compressing away.
    w.displaceAmount = -5.0;
    w.twistFrequency = { x: 0.02, y: 0.08, z: -0.12 };
    w.twistPower = { x: 3.0, y: 2.0, z: 3.0 };
    c.grain = 0.25;
    c.blur = 0.012;
    // Camera framing exported from the studio (spidey-wave.json), positioned so the wave's
    // edges just touch the frame border.
    c.cameraPosition = { x: -186.495, y: -4.931, z: 603.82 };
    c.cameraTarget = { x: -210.954, y: -3.372, z: 4.321 };
    c.cameraDistance = 600;
    c.cameraZoom = 1.208;
    // Black contributes nothing under additive blending, so only the white web lines
    // brighten the comic-panel image. The logo remains visible as a cutout in the web.
    c.background = "#000000";
    c.backgroundMode = "image";
    c.backgroundImageUrl = spiderManComicPanelsUrl;
    c.backgroundImageFit = "cover";
    c.backgroundImageZoom = 1;
    c.backgroundImagePosition = { x: 0, y: 0 };
    c.transparentBackground = false;
    return c;
  },
  "Vaporwave Sunset": () => {
    // Wave 2 with a re-posed/re-framed pose (formerly the "Stripe Wave 2b" clone, inlined
    // here now that 2b is gone) plus the vaporwave palette.
    const c = PRESETS["Stripe Hero"](); // the centred default wave (formerly "Stripe Wave 2")
    const w = c.waves[0];
    w.position.x = 525;
    w.rotation.x = -0.64 * RAD;
    w.rotation.z = 1.68 * RAD;
    w.paletteSource = "vaporwave";
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.08;
    w.colorSaturation = 1.15;
    w.creaseLight = 1.25;
    c.cameraZoom = 1.1;
    c.cameraTarget = { x: 150, y: 360, z: 0 };
    c.background = "#09051f";
    c.transparentBackground = false;
    return c;
  },
  Kaleidoscope: () => {
    const c = PRESETS["Stripe Wave 3"]();
    const w = c.waves[0];
    w.paletteSource = "kaleidoscope";
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.05;
    w.colorSaturation = 1.12;
    c.grain = 0.5;
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

/** "Randomize All": keep the scene (background, camera, lights, quality) and randomize the
 *  post-fx plus every wave independently — so a multi-wave stack becomes visibly varied.
 *  The camera is deliberately left alone so the result always lands in view. */
export function randomizeConfig(base: StudioConfig): StudioConfig {
  const cfg = cloneConfig(base);
  cfg.grain = r2(rand(0, 1.5));
  cfg.blur = r3(rand(0, 0.02));
  for (const s of cfg.waves) randomizeWave(s);
  return cfg;
}

/** Randomize a whole wave: colour, shape (displacement/twist), transform, finish + the
 *  compositing knobs (speed/opacity/seed/blend). Used by each wave's 🎲 and by "Randomize All". */
export function randomizeWave(s: WaveConfig): void {
  randomizeGradient(s);
  randomizeColor(s);
  randomizeSpine(s);
  randomizeTransform(s);
  randomizeTwist(s);
  randomizeFinish(s);
  s.speed = r2(rand(0.02, 0.15));
  s.opacity = r2(rand(0.6, 1));
  s.seed = r2(rand(0, 12));
  // Bias to the vivid squared blend; occasionally normal/additive (skip multiply — it muddies
  // the wave on light/transparent backgrounds).
  s.blendMode = pick(["squared", "squared", "normal", "additive"]);
}

// ---- Per-section randomizers (each mutates only its own fields, in place) ----

function r2(x: number): number {
  return roundTo(x, 2);
}
function r3(x: number): number {
  return roundTo(x, 3);
}

const LIGHT_TINTS = ["#ffffff", "#ffffff", "#fff0e0", "#e2e8ff", "#ffe2f0", "#e2fff4", "#fff6cc"];

/** Random sorted positions in [0,1] with the ends pinned to 0 and 1. */
function randomSortedPositions(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [0, 1];
  const inner = Array.from({ length: n - 2 }, () => r2(rand(0.06, 0.94))).sort((a, b) => a - b);
  return [0, ...inner, 1];
}

function randomMeshPoints(colors: string[]): MeshGradientPoint[] {
  return colors.map((color) => ({
    color,
    x: r2(rand(0.08, 0.92)),
    y: r2(rand(0.08, 0.92)),
    influence: r2(rand(0.5, 0.95)),
  }));
}

function randomStops(colors: string[]): ColorStop[] {
  const positions = randomSortedPositions(colors.length);
  return colors.map((color, i) => ({ color, pos: positions[i] }));
}

export function randomizeGradient(c: WaveConfig): void {
  const colors = pick(RANDOM_PALETTES);
  const count = clamp(Math.round(rand(3, colors.length)), 3, colors.length);
  const chosen = colors.slice(0, count);
  c.palette = randomStops(chosen);
  // Bias toward linear, occasionally radial/conic/mesh for variety.
  c.gradientType = pick([
    "linear",
    "linear",
    "linear",
    "radial",
    "conic",
    "mesh",
  ] as GradientType[]);
  c.gradientAngle = Math.round(rand(0, 180));
  c.gradientShift = r2(rand(0, 0.4)); // 2D warp
  // Also refresh the mesh field + edge tint so the whole colour section changes regardless of the
  // active source (both are inert unless gradientType is "mesh" / the source is "stops").
  c.meshGradientPoints = randomMeshPoints(colors);
  c.meshGradientSoftness = r2(rand(0.45, 0.85));
  c.paletteEdgeColor = pick(chosen);
  c.paletteEdgeAmount = r2(rand(0, 0.5));
  // Colour engine: mostly the editable stops (as a 2D texture or procedurally), occasionally the
  // baked hero LUT. Clear any loaded custom image/video so the picked source actually shows.
  c.paletteImageUrl = undefined;
  c.paletteVideoUrl = undefined;
  const engine = pick(["stops-tex", "stops-tex", "procedural", "hero"]);
  c.usePaletteTexture = engine !== "procedural";
  c.paletteSource = engine === "hero" ? "hero" : "stops";
}

/** "Background" folder: a fresh random gradient (linear/radial/conic) or mesh backdrop. Left out
 *  of "Randomize All", which deliberately preserves the background. */
export function randomizeBackground(c: StudioConfig): void {
  const colors = pick(RANDOM_PALETTES);
  c.transparentBackground = false;
  c.backgroundMode = "gradient";
  c.backgroundGradientType = pick(["linear", "radial", "conic", "mesh"] as GradientType[]);
  c.backgroundGradientAngle = Math.round(rand(0, 360));
  c.background = colors[0]; // matte fallback (shown only if a gradient ever fails to cover)
  if (c.backgroundGradientType === "mesh") {
    c.backgroundMeshPoints = randomMeshPoints(colors);
    c.backgroundMeshSoftness = r2(rand(0.45, 0.85));
  } else {
    c.backgroundGradientSource = "stops";
    c.backgroundPalette = randomStops(colors);
  }
}

/** "Color" folder: hue / contrast / saturation grading. */
export function randomizeColor(c: WaveConfig): void {
  c.hueShift = Math.round(rand(0, 360));
  c.colorContrast = r2(rand(0.9, 1.3));
  c.colorSaturation = r2(rand(0.8, 1.35));
}

export function randomizeSpine(c: WaveConfig): void {
  // Wider frequency spread than before so a re-roll is actually visible (the old range barely
  // moved). Amount takes either sign so the ribbon folds either way.
  c.displaceFrequency = { x: r3(rand(0.002, 0.016)), y: r3(rand(0.004, 0.02)) };
  c.displaceAmount = r2(rand(3, 10)) * pick([1, -1]);
}

export function randomizeTransform(c: WaveConfig): void {
  c.rotation = { x: r2(rand(-20, 5)), y: r2(rand(-25, 10)), z: r2(rand(-170, -150)) };
  // Full scale (×10) — the mesh lives in the tens, not fractions.
  const s = r2(rand(6, 14));
  c.scale = { x: s, y: s, z: r2(s * rand(0.6, 0.8)) };
  // z is modest — the ortho camera barely shows depth, and a big z can clip the near/far planes.
  c.position = { x: r2(rand(-60, 60)), y: r2(rand(-60, 60)), z: r2(rand(-20, 20)) };
}

export function randomizeTwist(c: WaveConfig): void {
  c.twistFrequency = { x: r3(rand(-0.5, 0.5)), y: r3(rand(-0.3, 0.5)), z: r3(rand(-1.6, -0.6)) };
  c.twistPower = { x: r2(rand(2, 6)), y: r2(rand(2, 6)), z: r2(rand(2, 7)) };
  c.twistMotion = rand(0, 1) < 0.25; // occasionally enable the breathing wobble
}

/** A wave's surface finish: fibers/texture + roundness/crease/edge. Grain & blur are scene post-fx
 *  (see randomizeGlobal), so they're not touched here. */
export function randomizeFinish(c: WaveConfig): void {
  c.fiberCount = Math.round(rand(200, 900));
  c.fiberStrength = r2(rand(0.1, 0.35));
  c.texture = r2(rand(0, 0.35));
  c.roundness = r2(rand(0.3, 0.8)); // rounded-solid shading
  c.sheen = r2(rand(0.2, 0.9));
  c.iridescence = rand(0, 1) < 0.35 ? r2(rand(0.15, 0.6)) : 0; // occasional thin-film sheen
  c.creaseLight = r2(rand(0.4, 1.0)); // crease strength (where streaks appear)
  c.creaseSharpness = r2(rand(0.45, 0.8));
  c.creaseSoftness = r2(rand(0.8, 1.2));
  c.edgeFade = r2(rand(0, 0.08));
  // Wireframe line params (inert unless theme is "wireframe") — randomized too so a wireframe
  // wave's Finish 🎲 refreshes its whole look, not just the solid-shader knobs.
  c.lineAmount = Math.round(rand(200, 900));
  c.lineThickness = r2(rand(0.5, 2));
  c.lineDerivativePower = r2(rand(0.4, 1.2));
  c.maxWidth = Math.round(rand(400, 1600));
  c.theme = rand(0, 1) < 0.2 ? "wireframe" : "solid"; // occasionally flip the material
}

export function randomizeLights(c: StudioConfig): void {
  c.ambient = r2(rand(0.25, 0.6));
  for (const l of c.lights) {
    l.position = { x: r2(rand(-1000, 1000)), y: r2(rand(-500, 1000)), z: r2(rand(-500, 1200)) };
    l.intensity = r2(rand(0.5, 1.6));
    l.color = pick(LIGHT_TINTS);
  }
}

/** Scene knobs: the post-fx (grain/blur) + camera framing (zoom). */
export function randomizeGlobal(c: StudioConfig): void {
  c.grain = r2(rand(0, 1.5));
  c.blur = r3(rand(0, 0.02));
  // Ortho: vary the zoom (framing), keep the camera pose/target — distance doesn't size it.
  c.cameraZoom = r2(rand(1.2, 2.6));
}
