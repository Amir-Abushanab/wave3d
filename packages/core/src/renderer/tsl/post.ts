/**
 * The base post pass in TSL — the port of `postFragmentShader` in `../shaders.ts`.
 *
 * Angular (spin) blur plus static film grain, applied to the composed scene. Alpha is carried
 * through so a transparent background survives the pass, exactly as in the GLSL.
 *
 * The GLSL runs this as a `ShaderPass` inside an `EffectComposer`; here it is a node graph over the
 * scene `pass()`, driven by `PostProcessing`. The sample count stays a uniform-bounded loop rather
 * than a JS-unrolled one, because `uBlurSamples` changes with quality settings at runtime.
 */
import {
  Fn,
  Loop,
  If,
  Break,
  float,
  vec2,
  vec4,
  mat2,
  cos,
  sin,
  mix,
  fract,
  dot,
  smoothstep,
  screenCoordinate,
  screenSize,
  uv,
  vec2 as tvec2,
} from "three/tsl";
import type { FloatUniform, Vec2Node, Vec4Node } from "./types";

/** The GLSL's `random2` — a cheap value hash, deliberately the same constants. */
const random2 = /*@__PURE__*/ Fn(([st]: [Vec2Node]) =>
  fract(sin(dot(st, vec2(12.9898, 78.233))).mul(43758.5453)),
).setLayout({
  name: "wave_random2",
  type: "float",
  inputs: [{ name: "st", type: "vec2" }],
});

/** How the caller exposes the scene texture: a function of uv, so the pass source stays pluggable. */
export type SceneSampler = (at: Vec2Node) => Vec4Node;

export interface PostUniforms {
  uBlurAmount: FloatUniform;
  uBlurSamples: FloatUniform;
  uGrainAmount: FloatUniform;
}

/**
 * Angular (spin) blur: rotate the sample coord around the centre and accumulate — a tangential
 * smear that grows toward the edges.
 *
 * The GLSL caps the loop at a literal 64 and breaks on `uBlurSamples`; that shape is kept because
 * the bound must be a compile-time constant on either backend.
 */
function blurAngular(
  sample: SceneSampler,
  at: Vec2Node,
  angle: FloatUniform,
  samples: FloatUniform,
) {
  const total = vec4(0).toVar("blurTotal");
  const dist = float(1).div(samples).toVar("blurStep");
  const dir = vec2(cos(angle.mul(dist)), sin(angle.mul(dist))).toVar();
  // The GLSL writes `coord * rot` (ROW-vector order), which is what sets the spin direction.
  //
  // Note the arguments below are in the same order as the GLSL's `mat2(dir.x, dir.y, -dir.y, dir.x)`
  // even though this multiplies the other way round (`rot.mul(coord)`). That is not an oversight:
  // TSL's `mat2(a, b, c, d)` fills ROW-major where GLSL's fills COLUMN-major, so the two
  // conventions cancel. Getting this backwards reverses the smear direction — verified by
  // `parity:math`, and worth ~6 mae on a blurred preset.
  const rot = mat2(dir.x, dir.y, dir.y.negate(), dir.x).toVar();
  const coord = at.sub(0.5).toVar("blurCoord");
  Loop({ start: 0, end: 64, type: "int" }, ({ i }) => {
    If(float(i).greaterThanEqual(samples), () => {
      Break();
    });
    total.addAssign(sample(coord.add(0.5)));
    coord.assign(rot.mul(coord));
  });
  return total.mul(dist);
}

/** Build the base post graph over a scene sampler. */
export function buildBasePost(sample: SceneSampler, u: PostUniforms): Vec4Node {
  return Fn(() => {
    const vUv = uv();
    const sceneColor = sample(vUv).toVar("sceneColor");
    const blurColor = blurAngular(sample, vUv, u.uBlurAmount, u.uBlurSamples).toVar("blurColor");
    // blurPower: keep a sharp band weighted to the middle, blurring toward top & bottom.
    const blurPower = smoothstep(0.0, 0.7, vUv.y).sub(smoothstep(0.2, 1.0, vUv.y));
    const color = mix(blurColor, sceneColor, blurPower).toVar("postColor");
    // Static film grain: keyed off the fragment coordinate only (no uTime), so it doesn't flicker.
    //
    // `screenCoordinate` follows the WebGPU convention (origin TOP-left) and flips Y on the WebGL
    // backend so both agree — but the GLSL this ports keys the hash off `gl_FragCoord`, whose
    // origin is BOTTOM-left. Left unflipped the hash samples a mirrored coordinate and produces a
    // completely different grain pattern: visually similar, but speckle across every pixel of a
    // parity diff.
    const fragCoord = tvec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y));
    const g = mix(u.uGrainAmount, u.uGrainAmount.negate(), random2(fragCoord.mul(0.01)));
    color.rgb.addAssign(g.mul(4.0 / 255.0));
    return color; // alpha preserved → transparent background works
  })();
}
