/**
 * The simplex noise the wave is built from, in TSL.
 *
 * A direct port of the `simplex2d` GLSL chunk in `../shaders.ts` — an xxHash-seeded unit-vector
 * gradient feeding a Gustavson simplex. Keep the two in lockstep: every wave's silhouette comes out
 * of this function, so a divergence here shows up as a different shape on every preset, not as a
 * subtle shading difference. `parity/` is what catches that.
 *
 * The hash needs integer bit ops on the float's raw bits. Those exist in TSL as `floatBitsToUint` /
 * `uintBitsToFloat` and compile to both WGSL (`bitcast<u32>`) and GLSL ES 3.00 (`floatBitsToUint`),
 * so the same graph serves the WebGPU and WebGL backends.
 */
import { asFloat, asUVec2, type Vec2Node } from "./types";
import {
  Fn,
  float,
  uint,
  uintBitsToFloat,
  floatBitsToUint,
  vec2,
  vec3,
  cos,
  sin,
  floor,
  step,
  max,
  dot,
} from "three/tsl";

/** xxHash32 over the two float lanes, returned as a float in [0,1). */
const xxhash = /*@__PURE__*/ Fn(([x]: [Vec2Node]) => {
  const t = asUVec2(floatBitsToUint(x)).toVar();
  // Every step below is a u32 op; both targets wrap on overflow, which is what the hash relies on.
  const h = uint(0xc2b2ae3d).mul(t.x).add(uint(0x165667b9)).toVar();
  h.assign(
    h
      .shiftLeft(uint(17))
      .bitOr(h.shiftRight(uint(15)))
      .mul(uint(0x27d4eb2f)),
  );
  h.addAssign(uint(0xc2b2ae3d).mul(t.y));
  h.assign(
    h
      .shiftLeft(uint(17))
      .bitOr(h.shiftRight(uint(15)))
      .mul(uint(0x27d4eb2f)),
  );
  h.assign(h.bitXor(h.shiftRight(uint(15))));
  h.mulAssign(uint(0x85ebca77));
  h.assign(h.bitXor(h.shiftRight(uint(13))));
  h.mulAssign(uint(0xc2b2ae3d));
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  // Take the top mantissa bits into the exponent of 1.0 → a float in [1,2), then shift to [0,1).
  return asFloat(uintBitsToFloat(h.shiftRight(uint(9)).bitOr(uint(0x3f800000)))).sub(1.0);
}).setLayout({
  name: "wave_xxhash",
  type: "float",
  inputs: [{ name: "x", type: "vec2" }],
});

/** A unit vector whose angle is the hashed cell — the simplex gradient. */
const gradHash = /*@__PURE__*/ Fn(([x]: [Vec2Node]) => {
  const k = xxhash(x).mul(6.283185307);
  return vec2(cos(k), sin(k));
}).setLayout({
  name: "wave_gradHash",
  type: "vec2",
  inputs: [{ name: "x", type: "vec2" }],
});

const K1 = 0.366025404; // (sqrt(3)-1)/2
const K2 = 0.211324865; // (3-sqrt(3))/6

/** 2D simplex noise, output roughly in [-1,1]. The GLSL twin is `simplexNoise` in `../shaders.ts`. */
export const simplexNoise = /*@__PURE__*/ Fn(([p]: [Vec2Node]) => {
  const i = floor(p.add(p.x.add(p.y).mul(K1))).toVar();
  const a = p.sub(i).add(i.x.add(i.y).mul(K2)).toVar();
  const m = step(a.y, a.x);
  const o = vec2(m, float(1.0).sub(m)).toVar();
  const b = a.sub(o).add(K2).toVar();
  const c = a
    .sub(1.0)
    .add(2.0 * K2)
    .toVar();
  const h = max(float(0.5).sub(vec3(dot(a, a), dot(b, b), dot(c, c))), 0.0).toVar();
  const n = h
    .mul(h)
    .mul(h)
    .mul(vec3(dot(a, gradHash(i)), dot(b, gradHash(i.add(o))), dot(c, gradHash(i.add(1.0)))));
  return dot(n, vec3(32.99)); // analytic normalisation (= 2916*sqrt(2)/125)
}).setLayout({
  name: "wave_simplexNoise",
  type: "float",
  inputs: [{ name: "p", type: "vec2" }],
});

/** The cheap value hash behind the optional grain overlay (`grainHash` in `../shaders.ts`). */
export const grainHash = /*@__PURE__*/ Fn(([p]: [Vec2Node]) => {
  return sin(dot(p, vec2(12.9898, 78.233)))
    .mul(43758.5453)
    .fract();
}).setLayout({
  name: "wave_grainHash",
  type: "float",
  inputs: [{ name: "p", type: "vec2" }],
});
