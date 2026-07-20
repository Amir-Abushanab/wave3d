/**
 * The "Randomize" helpers: `randomizeConfig` ("Tasteful Randomize") plus the per-section randomizers
 * the studio wires to each folder's 🎲. Studio-facing (not part of the renderer core), exposed via
 * the `@wave3d/core/studio` entry.
 */
import { clamp, roundTo } from "../util/math";
import type {
  StudioConfig,
  WaveConfig,
  MeshGradientPoint,
  ColorStop,
  GradientType,
} from "../config/model";

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

/** "Tasteful Randomize": keep the scene (background, camera, lights, quality) and randomize the
 *  post-fx plus every wave independently — so a multi-wave stack becomes visibly varied.
 *  The camera is deliberately left alone so the result always lands in view. */
export function randomizeConfig(base: StudioConfig): StudioConfig {
  const cfg = structuredClone(base);
  cfg.grain = r2(rand(0, 1.5));
  cfg.blur = r3(rand(0, 0.02));
  for (const s of cfg.waves) randomizeWave(s);
  return cfg;
}

/** Randomize a whole wave: colour, shape (displacement/twist), transform, finish + the
 *  compositing knobs (speed/opacity/seed/blend). Used by each wave's 🎲 and by "Tasteful Randomize". */
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
  // Occasional slow colour flow along the ribbon (inert on mesh / procedural palettes).
  c.paletteDriftX = rand(0, 1) < 0.25 ? r2(rand(-0.25, 0.25)) : 0;
  c.paletteDriftY = 0;
}

/** "Background" folder: a fresh random gradient (linear/radial/conic) or mesh backdrop. Left out
 *  of "Tasteful Randomize", which deliberately preserves the background. */
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

/** "Post FX" folder: enable a single random effect (the rest off) with random shape params — one
 *  post effect reads cleaner than a stack, so this stays tasteful. */
export function randomizePostFx(c: StudioConfig): void {
  c.dither = 0;
  c.halftone = 0;
  c.halftoneCmyk = 0;
  c.heatmap = 0;
  c.paperTexture = 0;
  c.innerLight = 0;
  switch (pick(["dither", "halftone", "cmyk", "heatmap", "paper", "light"])) {
    case "dither":
      c.dither = r2(rand(0.6, 1));
      c.ditherScale = Math.round(rand(1, 5));
      c.ditherSteps = Math.round(rand(2, 6));
      break;
    case "halftone":
      c.halftone = r2(rand(0.7, 1));
      c.halftoneCell = r2(rand(4, 12));
      c.halftoneAngle = r2(rand(0, 1.2));
      break;
    case "cmyk":
      c.halftoneCmyk = r2(rand(0.7, 1));
      c.halftoneCmykCell = r2(rand(4, 10));
      break;
    case "heatmap":
      c.heatmap = r2(rand(0.6, 1));
      break;
    case "paper":
      c.paperTexture = r2(rand(0.4, 0.9));
      c.paperTextureScale = r2(rand(1, 4));
      break;
    case "light":
      c.innerLight = r2(rand(0.4, 0.9));
      c.innerLightDensity = r2(rand(0.3, 0.8));
      c.innerLightDecay = r3(rand(0.9, 0.98));
      c.innerLightX = r2(rand(0.2, 0.8));
      c.innerLightY = r2(rand(0, 0.4));
      break;
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
  // Occasionally layer a finer second octave for a richer, two-scale shape.
  if (rand(0, 1) < 0.35) {
    c.detailFrequency = r3(rand(0.03, 0.08));
    c.detailAmount = r2(rand(0.8, 2.5)) * pick([1, -1]);
  } else {
    c.detailAmount = 0;
  }
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
  c.edgeFeather = r2(rand(0.03, 0.22)); // crisp graphic ↔ soft vapor edges
  c.depthTint = rand(0, 1) < 0.3 ? r2(rand(0.2, 0.6)) : 0; // occasional atmospheric depth fade
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
