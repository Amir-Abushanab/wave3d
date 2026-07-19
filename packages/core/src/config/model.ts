/**
 * Configuration schema for the wave: a flat sheet displaced by noise (X/Z frequency
 * + amount) then twisted by three axis-rotations (twistFrequency + twistPower per
 * axis), then scaled / rotated / positioned. Plain JSON — doubles as the save-state
 * format.
 */

import { clamp, clamp01 } from "../util/math";

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
  /** Palette-offset drift per second (animates colour independently of the geometry; 0 = static).
   *  Applies to any texture palette (not mesh / procedural stops). */
  paletteDriftX: number;
  paletteDriftY: number;
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
  /** Softness of the ribbon's long edges (smoothstep width across uv.y). 0.1 = the original
   *  hardcoded value; smaller = razor-crisp graphic ribbons, larger = soft vapor. */
  edgeFeather: number;
  /** Depth tint (solid theme): fade far fragments toward depthTintColor for atmospheric
   *  separation in multi-wave stacks (0 = off). */
  depthTint: number;
  depthTintColor: string;
  // Displacement + twist (the wave shape)
  displaceFrequency: Vec2;
  displaceAmount: number;
  /** Optional 2nd displacement octave: finer ripples riding on the broad swell (amount 0 = off). */
  detailFrequency: number;
  detailAmount: number;
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
  /** Optional per-wave interactivity: how THIS wave reacts to the shared pointer + inputs (hover
   *  field, click ripples, param bindings). ABSENT = this wave is inert / byte-identical. */
  interaction?: WaveInteractionConfig;
}

// ---------------------------------------------------------------------------------------------
// Interactivity layer (optional, additive, default-off). Split by concern: the SHARED inputs (one
// cursor + scroll + smoothing/touch) and scene-param effects live on SceneConfig.interaction; each
// wave's own RESPONSE (hover field, click ripples, param bindings) lives on WaveConfig.interaction.
// ABSENT blocks mean fully off — the compiled shader and rendered pixels stay byte-identical to a
// non-interactive wave (the normalizers below run present-only; ensureSceneDefaults never calls them).
// ---------------------------------------------------------------------------------------------

/** The built-in interaction input names (the open-ended `custom:*` family is handled separately).
 *  Kept in sync by hand with the {@link InteractionSource} union below. */
const INTERACTION_SOURCE_NAMES = [
  "scroll",
  "hover",
  "pointerX",
  "pointerY",
  "pointerSpeed",
  "press",
  "scrollVelocity",
  "appear",
] as const;

/**
 * An interaction INPUT: a normalized signal that can smoothly drive config params through an
 * {@link InteractionBinding}. Every source is exponentially smoothed before it is applied.
 */
export type InteractionSource =
  | "scroll" // container progress through the viewport, 0 (entering) .. 1 (scrolled past)
  | "hover" // smoothed pointer presence over the container, 0..1
  | "pointerX" // smoothed pointer X across the container, 0..1; relaxes to 0.5 on leave
  | "pointerY" // smoothed pointer Y across the container, 0..1; relaxes to 0.5 on leave
  | "pointerSpeed" // normalized smoothed pointer speed, 0..1
  | "press" // pointer button / touch held, smoothed 0..1
  | "scrollVelocity" // normalized smoothed |d(scroll progress)/dt|, 0..1
  | "appear" // one-shot 0→1 latch on first visibility (entrance choreography)
  | `custom:${string}`; // developer-fed each frame via setInteractionInput(name, value)

/** Per-WAVE params a binding may drive. Single source of truth for WAVE_APPLIERS in
 *  renderer/interaction.ts (checked via `satisfies`) and validated by normalizeWaveInteraction. */
const WAVE_TARGET_NAMES = [
  "displaceAmount",
  "detailAmount",
  "twistPowerX",
  "twistPowerY",
  "twistPowerZ",
  "twistFrequencyX",
  "twistFrequencyY",
  "twistFrequencyZ",
  "hueShift",
  "gradientShift",
  "colorSaturation",
  "opacity",
  "lineThickness",
  "lineAmount",
  "fiberStrength",
  "sheen",
  "iridescence",
  "positionX",
  "positionY",
] as const;
/** A per-wave param a {@link WaveInteractionBinding} can drive. */
export type WaveInteractionTarget = (typeof WAVE_TARGET_NAMES)[number];

/** SCENE params a binding may drive (post / camera / time — shared, not per wave). Single source of
 *  truth for SCENE_APPLIERS in renderer/interaction.ts, validated by normalizeSceneInteraction. */
const SCENE_TARGET_NAMES = ["timeOffset", "cameraZoom", "blur", "grain"] as const;
/** A scene-level param a {@link SceneInteractionBinding} can drive. */
export type SceneInteractionTarget = (typeof SCENE_TARGET_NAMES)[number];

/** Shared fields of an input→param binding: per frame `value = mix(from ?? authoredBase, to,
 *  smoothedSource)`, written straight to uniforms — never mutates config, so any refresh restores
 *  the authored base (removal needs no undo step). */
interface InteractionBindingBase {
  /** The input signal driving this binding. */
  source: InteractionSource;
  /** Value at source = 0. OMITTED = the authored base value, so at rest the authored look shows. */
  from?: number;
  /** Value at source = 1. */
  to: number;
  /** Exponential smoothing time constant, seconds (default 0.25); also shapes the `appear` ramp. */
  smoothing?: number;
}
/** A binding on a wave, driving one of that wave's params. */
export interface WaveInteractionBinding extends InteractionBindingBase {
  target: WaveInteractionTarget;
}
/** A scene-level binding, driving a shared scene param. */
export interface SceneInteractionBinding extends InteractionBindingBase {
  target: SceneInteractionTarget;
}

/** Hover pointer-field: localized effects that follow the cursor over this wave. Present ⇒ the
 *  POINTER_FX shader path compiles for this wave; an absent effect is 0 (inert). */
export interface WaveHoverConfig {
  /** Local churn-octave amplitude near the cursor — the wave agitates under the pointer. The studio
   *  defaults this positive when you enable a hover field, so a fresh hover reacts out of the box. */
  agitate?: number;
  /** Membrane push/pull: a smooth dome at the cursor that swells toward you (repel, +) or dents away
   *  (attract, −), carried by the sprung field so it drags like a poke under fabric. World units;
   *  0 = off. */
  push?: number;
  /** Drag-wake: while the cursor moves, the surface just BEHIND it is pulled into a trailing trough
   *  that heals once you stop; scales with pointer speed. World units; 0 = off. */
  wake?: number;
  /** 0..1 — wireframe strands taper to hairlines; solid gains local translucency. */
  thin?: number;
  /** Local hue rotation near the cursor, degrees. */
  hueShift?: number;
  /** Local brightness lift near the cursor, -1..1. */
  lighten?: number;
  /** Pointer-follow smoothing for THIS wave's hover field, seconds — how quickly the swell trails
   *  the cursor. Vary it across a stack so strands lag at different rates (a parallax drag).
   *  Default 0.12. */
  smoothing?: number;
}

/** Click / touch pointer-field: what a tap or click on this wave triggers. */
export interface WavePressConfig {
  /** Click-ripple amplitude; 0 keeps this wave's POINTER_RIPPLES path uncompiled. */
  ripple?: number;
}

/** Per-wave interactivity: this wave's own reaction to the shared pointer + inputs. ABSENT ⇒ inert. */
export interface WaveInteractionConfig {
  /** Hover field (cursor-follow agitation / thinning / hue-lighten). */
  hover?: WaveHoverConfig;
  /** Click & touch (ripples radiating from a tap/click on this wave). */
  press?: WavePressConfig;
  /** Input→param bindings driving THIS wave's params (any source, incl. scroll / hover / custom). */
  bindings?: WaveInteractionBinding[];
}

/** Scene-level interactivity: the SHARED inputs (one cursor + scroll, touch) plus bindings that
 *  drive shared scene params. Pointer-follow smoothing is per-wave (see WaveHoverConfig.smoothing).
 *  ABSENT ⇒ inputs use defaults; `enabled: false` is the master OFF switch for the whole layer. */
export interface SceneInteractionConfig {
  /** Master switch for the whole interaction layer. Default true (only `false` turns it all off). */
  enabled?: boolean;
  /** Pointer falloff radius, as a fraction of viewport height. Default 0.3. */
  radius?: number;
  /** Follow coarse (touch) pointers. Default false — touch is ignored unless this is true. */
  touch?: boolean;
  /** Input→param bindings driving SCENE params (timeOffset, cameraZoom, blur, grain). */
  bindings?: SceneInteractionBinding[];
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
  /** Ordered (Bayer) dithering over the finished composite — a self-contained "layered" post
   *  shader in the spirit of paper-design/shaders. 0 removes the pass entirely (cost/pixels match
   *  dither-off); scale & steps only bite once dither > 0. Runs last, after tone-map + sRGB. */
  dither?: number;
  /** Dither cell size in device pixels (>=1) — larger = chunkier pattern. */
  ditherScale?: number;
  /** Quantization levels per channel (>=2) — lower = heavier posterization. */
  ditherSteps?: number;
  /** Domain-warp (liquid distortion) over the scene — another "layered" post shader in the spirit
   *  of paper-design/shaders. 0 removes the pass entirely; scale & speed only bite once warp > 0.
   *  Runs in the scene zone (under the film grain) and is time-driven (animated). */
  warp?: number;
  /** Warp field spatial frequency (higher = finer ripples). */
  warpScale?: number;
  /** Warp animation speed (0 = frozen distortion). */
  warpSpeed?: number;
  /** Base ambient light level (0–1). */
  ambient: number;
  lights: LightConfig[];
  /** Mirror the whole composition on screen (world-space flip). */
  mirrorH: boolean;
  mirrorV: boolean;
  /** Shared interaction inputs (one cursor + scroll) + scene-param bindings. Per-wave response
   *  lives on each WaveConfig.interaction. ABSENT = defaults; `enabled:false` disables the layer. */
  interaction?: SceneInteractionConfig;
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
    paletteDriftX: 0,
    paletteDriftY: 0,
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
    edgeFeather: 0.1, // the original hardcoded ribbon-edge softness
    depthTint: 0,
    depthTintColor: "#0a2540",
    // Hero deformation on the native 400-unit folded() geometry.
    displaceFrequency: { x: 0.003234, y: 0.00799 },
    displaceAmount: 6.051,
    detailFrequency: 0.04, // finer than the base swell; only bites once detailAmount > 0
    detailAmount: 0,
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
    dither: 0, // off by default — the hero look is unchanged (the pass isn't inserted)
    ditherScale: 2,
    ditherSteps: 4,
    warp: 0, // off by default (animated liquid distortion; keeps the hero deterministic)
    warpScale: 3,
    warpSpeed: 0.3,
    ambient: 0.45,
    lights: [], // hero has no lights — colour is the palette + the SrcColor² blend
    mirrorH: false,
    mirrorV: false,
    waves: [defaultWave()],
  };
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
  if (typeof s.paletteDriftX !== "number") s.paletteDriftX = 0;
  if (typeof s.paletteDriftY !== "number") s.paletteDriftY = 0;
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
  if (typeof s.edgeFeather !== "number") s.edgeFeather = 0.1;
  if (typeof s.depthTint !== "number") s.depthTint = 0;
  if (typeof s.depthTintColor !== "string") s.depthTintColor = "#0a2540";
  if (!s.displaceFrequency) s.displaceFrequency = { x: 0.003234, y: 0.00799 };
  if (typeof s.displaceAmount !== "number") s.displaceAmount = 6.051;
  if (typeof s.detailFrequency !== "number") s.detailFrequency = 0.04;
  if (typeof s.detailAmount !== "number") s.detailAmount = 0;
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
  if (s.interaction) normalizeWaveInteraction(s); // present-only; absence stays inert
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
  if (typeof config.dither !== "number") config.dither = 0;
  if (typeof config.ditherScale !== "number") config.ditherScale = 2;
  if (typeof config.ditherSteps !== "number") config.ditherSteps = 4;
  if (typeof config.warp !== "number") config.warp = 0;
  if (typeof config.warpScale !== "number") config.warpScale = 3;
  if (typeof config.warpSpeed !== "number") config.warpSpeed = 0.3;
  if (typeof config.showCameraRig !== "boolean") config.showCameraRig = false;
  if (typeof config.paused !== "boolean") config.paused = false;
  if (typeof config.loopSeconds !== "number") config.loopSeconds = 0;
  if (typeof config.mirrorH !== "boolean") config.mirrorH = false;
  if (typeof config.mirrorV !== "boolean") config.mirrorV = false;
  // NOTE: `interaction` (scene + per-wave) is deliberately NOT backfilled — absence is semantically
  // "off" and keeps the compiled shader byte-identical. The present-only normalizers below run from
  // ensureStudioConfig / normalizeWave only when a block is actually present.
}

/** Clamp an untrusted numeric field, falling back to `dflt` when it isn't a finite number. */
function clampNumber(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, min, max) : dflt;
}

/** True for a valid interaction source string: a built-in name or a non-empty `custom:<name>`. */
function isInteractionSource(v: unknown): v is InteractionSource {
  return (
    typeof v === "string" &&
    ((INTERACTION_SOURCE_NAMES as readonly string[]).includes(v) ||
      (v.startsWith("custom:") && v.length > "custom:".length))
  );
}

/** Rebuild an untrusted bindings array into valid bindings for `valid` targets (loaded share-links /
 *  presets are untrusted JSON; we validate source/target/to and rebuild clean objects). */
function cleanBindings<T extends string>(
  raw: unknown,
  valid: readonly string[],
): Array<InteractionBindingBase & { target: T }> {
  const out: Array<InteractionBindingBase & { target: T }> = [];
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    if (!isInteractionSource(b.source)) continue;
    if (!valid.includes(b.target as string)) continue;
    const to = Number(b.to);
    if (!Number.isFinite(to)) continue;
    const clean: InteractionBindingBase & { target: T } = {
      source: b.source,
      target: b.target as T,
      to,
    };
    if (b.from !== undefined) {
      const f = Number(b.from);
      if (Number.isFinite(f)) clean.from = f;
    }
    if (b.smoothing !== undefined) clean.smoothing = clampNumber(b.smoothing, 0, 2, 0.25);
    out.push(clean);
  }
  return out;
}

/**
 * Present-only normalizer for a WAVE's interaction block: clamp the hover/press numerics that are
 * present (absent fields stay absent, so the block stays lean and the renderer's defaults apply) and
 * drop bindings with an unknown source/target or a non-finite `to`. NEVER call when the block is
 * absent — absence is inert and byte-identical (normalizeWave gates on presence).
 */
export function normalizeWaveInteraction(wave: WaveConfig): void {
  const it = wave.interaction;
  if (!it) return;
  const h = it.hover;
  if (h) {
    if (h.agitate !== undefined) h.agitate = clampNumber(h.agitate, 0, 60, 0);
    if (h.push !== undefined) h.push = clampNumber(h.push, -40, 40, 0);
    if (h.wake !== undefined) h.wake = clampNumber(h.wake, 0, 40, 0);
    if (h.thin !== undefined) h.thin = clampNumber(h.thin, 0, 1, 0);
    if (h.hueShift !== undefined) h.hueShift = clampNumber(h.hueShift, -360, 360, 0);
    if (h.lighten !== undefined) h.lighten = clampNumber(h.lighten, -1, 1, 0);
    if (h.smoothing !== undefined) h.smoothing = clampNumber(h.smoothing, 0, 2, 0.12);
  }
  if (it.press && it.press.ripple !== undefined) {
    it.press.ripple = clampNumber(it.press.ripple, 0, 60, 0);
  }
  if (it.bindings !== undefined) {
    it.bindings = cleanBindings<WaveInteractionTarget>(it.bindings, WAVE_TARGET_NAMES);
  }
}

/** Present-only normalizer for the SCENE interaction block: clamp the shared pointer inputs and drop
 *  invalid scene bindings. NEVER call when the block is absent. */
export function normalizeSceneInteraction(config: StudioConfig): void {
  const it = config.interaction;
  if (!it) return;
  if (it.radius !== undefined) it.radius = clampNumber(it.radius, 0.02, 2, 0.3);
  if (it.bindings !== undefined) {
    it.bindings = cleanBindings<SceneInteractionTarget>(it.bindings, SCENE_TARGET_NAMES);
  }
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
  config.waves.forEach(normalizeWave); // each wave's normalizeWave runs normalizeWaveInteraction
  config.waveCount = config.waves.length;
  // Present-only: a config without a scene `interaction` block is left untouched (stays "off").
  if (config.interaction) normalizeSceneInteraction(config);
  return config;
}
