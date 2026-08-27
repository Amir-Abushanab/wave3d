/**
 * The wave SHAPE deform in TSL — the port of the `waveShapeChunk` GLSL in `../shaders.ts`.
 *
 * A baked hairpin position + its uv become the displaced / helixed / twisted / fanned local
 * position, plus the three twists the pointer field needs. The particle emitter calls this too, so
 * a wave and the dust it sheds ride one deform.
 *
 * The GLSL `#ifdef` gates (LOOP_MOTION, DETAIL_OCTAVE, HELIX, TWIST_MOTION, RADIAL) become plain JS
 * flags: the graph is built per material, so an unused branch is simply never constructed. That is
 * strictly better than the define-based variants — there is no dead uniform to declare and no
 * program-key bookkeeping — but it does mean the "byte-identical when off" contract the GLSL
 * comments assert is no longer a thing to verify. `parity/` covers the behaviour instead.
 */
import {
  Fn,
  float,
  vec2,
  vec3,
  cos,
  sin,
  radians,
  exp2,
  pow,
  max,
  clamp,
  mix,
  cross,
  dot,
  normalize,
} from "three/tsl";
import { RIBBON_Z_CENTER } from "../WaveGeometry";
import { simplexNoise } from "./noise";
import type { FloatNode, Vec2Node, Vec3Node } from "./types";
import type { WaveTslUniforms } from "./uniforms";

/**
 * A falloff from 1 (at x=0) toward 0, sharpness set by n. `max()` guards `pow(0, n)` (= Infinity →
 * NaN), which also makes negative n safe — it just concentrates the twist toward the other end.
 */
export const expStep = /*@__PURE__*/ Fn(([x, n]: [FloatNode, FloatNode]) =>
  exp2(
    exp2(n)
      .mul(pow(max(x, 1.0e-3), n))
      .negate(),
  ),
).setLayout({
  name: "wave_expStep",
  type: "float",
  inputs: [
    { name: "x", type: "float" },
    { name: "n", type: "float" },
  ],
});

/**
 * One twist: an axis and the angle the GLSL passes to `rotationMatrix`.
 *
 * The GLSL builds a matrix and applies it ROW-vector style — `(vec4(pos,1) * R).xyz`. Note the
 * matrix it builds is the TRANSPOSE of the standard Rodrigues matrix (GLSL's `mat4(...)` fills
 * column-major, and the literal is laid out by rows), so `v * R` is `transpose(R) * v`, which is a
 * plain rotation by +angle. Check with axis = +z and v = (1,0,0): `v * R` = (cos, sin, 0).
 *
 * `applyTwist` performs that rotation directly, so there is no matrix-storage-order assumption to
 * get wrong between GLSL's `mat4(...)` and WGSL's `mat4x4<f32>(...)`. Rotations are linear, so the
 * same helper serves direction vectors (the pointer field's displacement axis and ribbon tangent)
 * with no w-component special case. `parity:math` pins this against the original.
 */
export interface Twist {
  axis: Vec3Node;
  angle: FloatNode;
}

/** Rotate `v` about `t.axis` by `t.angle` — the row-vector product the GLSL performs. */
export const applyTwist = (v: Vec3Node, t: Twist): Vec3Node => {
  const k = normalize(t.axis);
  const c = cos(t.angle);
  const s = sin(t.angle);
  return v
    .mul(c)
    .add(cross(k, v).mul(s))
    .add(k.mul(dot(k, v)).mul(float(1).sub(c)));
};

/** Which optional blocks this material's graph includes — the JS twin of the GLSL `#ifdef` set. */
export interface WaveShapeFlags {
  loopMotion: boolean;
  detailOctave: boolean;
  helix: boolean;
  twistMotion: boolean;
  radial: boolean;
}

export interface WaveShapeResult {
  pos: Vec3Node;
  /** The three twists, in application order — the pointer field carries its axes through these. */
  twists: [Twist, Twist, Twist];
}

/**
 * Deform one vertex. `t` is linear time and `loopOff` the orbit offset; only the one selected by
 * `flags.loopMotion` is read, exactly as in the GLSL where the other is a dead argument.
 */
export function waveShape(
  u: WaveTslUniforms,
  flags: WaveShapeFlags,
  position: Vec3Node,
  uv: Vec2Node,
  t: FloatNode,
  loopOff: Vec2Node,
): WaveShapeResult {
  const pos = position.toVar();

  // Displacement lifts Y by simplex noise of the (x,z) position.
  const dispArg = flags.loopMotion
    ? vec2(pos.x.mul(u.uDispFreqX), pos.z.mul(u.uDispFreqZ)).add(loopOff)
    : vec2(pos.x.mul(u.uDispFreqX).add(t), pos.z.mul(u.uDispFreqZ).add(t));
  pos.y.addAssign(simplexNoise(dispArg).mul(u.uDispAmount));

  if (flags.detailOctave) {
    // A second, finer octave riding on the broad swell (loop-orbit shared so it stays periodic).
    const detailArg = flags.loopMotion
      ? vec2(pos.x.mul(u.uDetailFreq), pos.z.mul(u.uDetailFreq)).add(loopOff)
      : vec2(pos.x.mul(u.uDetailFreq).add(t), pos.z.mul(u.uDetailFreq).add(t));
    pos.y.addAssign(simplexNoise(detailArg).mul(u.uDetailAmount));
  }

  if (flags.helix) {
    // The periodic sweep the three twists (monotone falloffs) can't reach. Runs AFTER displacement
    // (so the noise still samples undeformed pos) and BEFORE the twist (so they compose).
    const hAng = float(6.28318530718)
      .mul(u.uHelixTurns)
      .mul(uv.y)
      .add(radians(u.uHelixPhase))
      .toVar();
    // Roll about the ribbon's width centre, not the origin — see RIBBON_Z_CENTER in WaveGeometry.
    const rollA = hAng.mul(u.uHelixRoll);
    const rollC = cos(rollA);
    const rollS = sin(rollA);
    const rel = vec2(pos.y, pos.z.sub(RIBBON_Z_CENTER)).toVar();
    pos.y.assign(rel.x.mul(rollC).sub(rel.y.mul(rollS)));
    pos.z.assign(float(RIBBON_Z_CENTER).add(rel.x.mul(rollS)).add(rel.y.mul(rollC)));
    pos.y.addAssign(u.uHelixRadius.mul(cos(hAng)));
    pos.z.addAssign(u.uHelixRadius.mul(sin(hAng)));
  }

  // The X-twist frequency feeding the second rotation. Under TWIST_MOTION it is modulated by
  // simplex noise indexed along the ribbon (uv.y), so the twist breathes over time.
  let twistXFreq: FloatNode = u.uTwFreqX;
  if (flags.twistMotion) {
    const noiseArg = flags.loopMotion
      ? vec2(uv.y.mul(2.0), 0.0).add(loopOff)
      : vec2(uv.y.mul(2.0), t);
    twistXFreq = u.uTwFreqX.sub(simplexNoise(noiseArg).mul(0.1));
  }

  // Three-axis twist. rotA keys off uv.x (the folded WIDTH), rotB/rotC off uv.y (the LENGTH).
  const twists: [Twist, Twist, Twist] = [
    { axis: vec3(0.5, 0.0, 0.5), angle: u.uTwFreqY.mul(expStep(uv.x, u.uTwPowY)) },
    { axis: vec3(0.0, 0.5, 0.5), angle: twistXFreq.mul(expStep(uv.y, u.uTwPowX)) },
    { axis: vec3(0.5, 0.0, 0.5), angle: u.uTwFreqZ.mul(expStep(uv.y, u.uTwPowZ)) },
  ];
  const twisted = applyTwist(applyTwist(applyTwist(pos, twists[0]), twists[1]), twists[2]).toVar();

  if (!flags.radial) return { pos: twisted, twists };

  // Radial fan: remap the ribbon to polar around the LOCAL origin so its LENGTH fans into a plume.
  // uv.x (folded WIDTH) → fan ANGLE across uRadialArc; uv.y (LENGTH) → RADIUS, so a constant-uv.x
  // combed fiber becomes a constant-angle radial spoke. Amount 0 is the identity mix.
  const rAng = radians(u.uRadialCenter).add(clamp(uv.x, 0, 1).sub(0.5).mul(radians(u.uRadialArc)));
  const rRho = u.uRadialRadius.add(uv.y.mul(400.0).mul(u.uRadialSpread)); // 400 = native ribbon length
  const rEr = vec3(cos(rAng), sin(rAng), 0.0); // radial dir, in local X–Y (the screen plane)
  const rEt = vec3(sin(rAng).negate(), cos(rAng), 0.0); // tangential
  const fanned = rEr
    .mul(rRho)
    .add(rEt.mul(twisted.z.sub(RIBBON_Z_CENTER)).mul(0.5))
    .add(vec3(0.0, 0.0, twisted.y));

  return { pos: mix(twisted, fanned, clamp(u.uRadialAmount, 0, 1)), twists };
}
