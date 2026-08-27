/**
 * Colour: the palette/gradient sampler and the colour grade, in TSL.
 *
 * The port of the `colorFns` GLSL chunk in `../shaders.ts`, shared by both fragment themes exactly
 * as it is there. Uniform-count loops become `Loop` + `Break` rather than JS-level unrolling,
 * because the counts (`uColorCount`, `uMeshPointCount`) are live uniforms the studio changes without
 * rebuilding the material — unrolling them would force a graph rebuild on every stop added.
 */
import {
  Fn,
  Loop,
  If,
  Break,
  float,
  vec2,
  vec3,
  cos,
  sin,
  atan,
  dot,
  cross,
  mix,
  max,
  clamp,
  fract,
  length,
  pow,
  radians,
  select,
} from "three/tsl";
import { simplexNoise } from "./noise";
import { MAX_COLORS, MAX_MESH_POINTS } from "../../config/model";
import type { FloatNode, Vec2Node, Vec3Node } from "./types";
import type { WaveTslUniforms } from "./uniforms";

// The GLSL writes the literal 3.14159265359; it and Math.PI round to the same float32, so the
// shader sees an identical value either way.
const PI = Math.PI;

/** `(v - 0.5) * a + 0.5` */
export const contrastFn = (v: Vec3Node, a: FloatNode): Vec3Node => v.sub(0.5).mul(a).add(0.5);

/** Pull `color` toward its luminance by `factor`. */
export const desaturate = (color: Vec3Node, factor: FloatNode): Vec3Node =>
  mix(color, vec3(dot(vec3(0.299, 0.587, 0.114), color)), factor);

/** Rotate hue by `shift` RADIANS about the grey axis (the GLSL takes radians here too). */
export const hueShift = (color: Vec3Node, shift: FloatNode): Vec3Node => {
  const g = vec3(0.57735);
  const proj = g.mul(dot(g, color));
  const u = color.sub(proj);
  const w = cross(g, u);
  return u
    .mul(cos(shift))
    .add(w.mul(sin(shift)))
    .add(proj);
};

/**
 * Interpolate the gradient stops by their positions (`uColorPos` sorted ascending).
 *
 * Faithful to the GLSL, which does NOT break once it finds the bracketing stop — it keeps
 * overwriting for every qualifying `i`, so the LAST qualifying stop wins. That is what makes
 * out-of-order or coincident stops behave the way the studio's presets expect.
 */
export function grad(u: WaveTslUniforms, t: FloatNode): Vec3Node {
  const uu = clamp(t, 0, 1).toVar();
  const col = u.uColors.el(0).toVar("gradCol");
  Loop({ start: 0, end: MAX_COLORS - 1, type: "int" }, ({ i }) => {
    If(float(i).greaterThanEqual(float(u.uColorCount).sub(1)), () => {
      Break();
    });
    const p0 = u.uColorPos.el(i).toVar();
    const p1 = u.uColorPos.el(float(i).add(1)).toVar();
    If(uu.greaterThanEqual(p0), () => {
      const k = clamp(uu.sub(p0).div(max(p1.sub(p0), 1e-5)), 0, 1);
      col.assign(mix(u.uColors.el(i), u.uColors.el(float(i).add(1)), k));
    });
  });
  return col;
}

/**
 * iOS-style 2D colour field: each control point contributes an inverse-distance weight, and
 * normalising the sum fills the whole surface without dark seams.
 */
export function meshGradient(u: WaveTslUniforms, uvIn: Vec2Node): Vec3Node {
  const colorSum = vec3(0).toVar("meshColorSum");
  const weightSum = float(0).toVar("meshWeightSum");
  const exponent = mix(4.8, 1.35, clamp(u.uMeshSoftness, 0, 1)).toVar();
  Loop({ start: 0, end: MAX_MESH_POINTS, type: "int" }, ({ i }) => {
    If(float(i).greaterThanEqual(float(u.uMeshPointCount)), () => {
      Break();
    });
    const influence = max(u.uMeshPointInfluence.el(i), 0.05);
    const d = length(uvIn.sub(u.uMeshPointPos.el(i))).div(influence);
    const weight = float(1).div(pow(max(d, 0.012), exponent).add(0.002));
    colorSum.addAssign(u.uMeshPointColor.el(i).mul(weight));
    weightSum.addAssign(weight);
  });
  return colorSum.div(max(weightSum, 0.0001));
}

/**
 * Map a surface uv to the 0–1 gradient coordinate per gradient type. `uGradShift` adds a
 * low-frequency simplex warp so the colour varies in 2D — a 2D palette feel rather than flat bands.
 */
export function gradCoord(u: WaveTslUniforms, uvIn: Vec2Node): FloatNode {
  const warp = u.uGradShift.mul(simplexNoise(uvIn.mul(1.6).add(4.0))).toVar();
  const radial = clamp(length(uvIn.sub(0.5)).mul(2.0).add(warp), 0, 1);
  const conic = fract(
    atan(uvIn.y.sub(0.5), uvIn.x.sub(0.5))
      .div(2.0 * PI)
      .add(0.5)
      .add(warp),
  );
  const dir = vec2(sin(u.uGradAngle), cos(u.uGradAngle));
  const linear = clamp(dot(uvIn.sub(0.5), dir).add(0.5).add(warp), 0, 1);
  return select(u.uGradType.equal(1), radial, select(u.uGradType.equal(2), conic, linear));
}

/**
 * One base-colour sample for the whole surface: rotate/scale/offset the raw-palette uv, then pick
 * the mesh field / baked 2D texture / procedural stops by mode. The raw palette is sampled by
 * (uv.x, uv.y) directly; the stops-generated texture goes through `gradCoord` so its angle, type
 * and warp still apply.
 */
export function waveBaseColor(u: WaveTslUniforms, uvIn: Vec2Node): Vec3Node {
  const gc = gradCoord(u, uvIn).toVar();
  const mediaCos = cos(u.uPaletteRotation);
  const mediaSin = sin(u.uPaletteRotation);
  const rel = uvIn.sub(0.5).toVar();
  const rotated = vec2(
    mediaCos.mul(rel.x).add(mediaSin.mul(rel.y)),
    mediaSin.negate().mul(rel.x).add(mediaCos.mul(rel.y)),
  );
  const mediaUv = rotated.mul(u.uPaletteScale).add(0.5).add(u.uPaletteOffset);
  const puv = select(
    u.uPaletteRaw.greaterThan(0.5),
    clamp(mediaUv, vec2(0), vec2(1)),
    vec2(gc, clamp(uvIn.y, 0, 1)),
  );
  const sampled = u.uPalette.sample(puv).rgb;
  const proceduralOrTexture = select(u.uUsePalette.greaterThan(0.5), sampled, grad(u, gc));
  return select(u.uGradType.equal(3), meshGradient(u, uvIn), proceduralOrTexture);
}

/** The shared colour grade: contrast → desaturate → hue rotate (uHueShift is in DEGREES). */
export function applyColorGrade(u: WaveTslUniforms, c: Vec3Node): Vec3Node {
  const contrasted = contrastFn(c, u.uContrast);
  const desaturated = desaturate(contrasted, float(1).sub(u.uSaturation));
  return hueShift(desaturated, radians(u.uHueShift));
}

/** Striation helpers shared with the solid theme. */
export const parabola = /*@__PURE__*/ Fn(([x, k]: [FloatNode, FloatNode]) =>
  pow(x.mul(4.0).mul(float(1).sub(x)), k),
).setLayout({
  name: "wave_parabola",
  type: "float",
  inputs: [
    { name: "x", type: "float" },
    { name: "k", type: "float" },
  ],
});

/** `mapLinear(v, a, b, c, d)` — the GLSL helper of the same name. */
export const mapLinear = (v: FloatNode, a: number, b: number, c: number, d: number): FloatNode =>
  float(c).add(v.sub(a).mul((d - c) / (b - a)));
