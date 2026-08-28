/**
 * The particle field's material in TSL — the port of `particleVertexShader` /
 * `particleFragmentShader` in `../shaders.ts`.
 *
 * The one structural change the backend forces: WebGPU point primitives are fixed at ONE pixel, so
 * a `THREE.Points` sized through `gl_PointSize` cannot work. three's own `PointsNodeMaterial`
 * documents that a size is honoured only when the material is attached to a `Sprite`, which draws
 * the field as instanced quads instead. That costs 4 vertices and 2 triangles per particle where
 * the point list needed 1 vertex, and it changes two things in the shader:
 *
 *   - `gl_PointSize` becomes `sizeNode`, which three multiplies by the device pixel ratio itself —
 *     so the GLSL's explicit `uPixelRatio` factor must NOT be repeated here or size is squared.
 *   - `gl_PointCoord` becomes `uv()`. Their Y axes are opposite (`gl_PointCoord` runs DOWN from the
 *     top-left), which the GLSL already had to flip for sprite artwork. Every procedural shape but
 *     "streak" is symmetric about Y, so getting this wrong would show up only on that one.
 *
 * Everything else — the deterministic life, the shed emitter riding the shared wave deform, and the
 * pointer weld/shove — is the same graph the ribbon uses, reading the OWNING WAVE's uniform
 * registry directly rather than mirroring values across two materials.
 */
import { PointsNodeMaterial } from "three/webgpu";
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  cos,
  sin,
  atan,
  pow,
  abs as tabs,
  exp,
  max,
  clamp,
  mix,
  fract,
  floor,
  length,
  dot,
  cross,
  normalize,
  smoothstep,
  uv,
  varying,
  instancedArray,
  instanceIndex,
  cameraProjectionMatrix,
  cameraViewMatrix,
  select,
  If,
  texture,
} from "three/tsl";
import type { Texture } from "three";
import { RIBBON_Z_CENTER } from "../WaveGeometry";
import { simplexNoise } from "./noise";
import { waveShape, applyTwist, type WaveShapeFlags } from "./waveShape";
import { pointerField } from "./pointerField";
import type { FloatNode, Vec2Node, Vec3Node } from "./types";
import type { WaveTslUniforms } from "./uniforms";
import type { ParticleTslUniforms } from "./particleUniforms";

const TAU = 6.28318530718;

export interface ParticleMaterialFlags extends WaveShapeFlags {
  pointerFx: boolean;
  pointerRipples: boolean;
  /** Bind user artwork instead of the procedural shapes. */
  sprite: boolean;
}

export interface ParticleAttributeArrays {
  aSeed: Float32Array;
  aRnd: Float32Array;
  aUv: Float32Array;
}

/** Alpha for the procedural shapes, indexed by `uShape` (0 glitter, 1 soft, 2 ring, 3 star, 4 streak). */
function shapeAlpha(shape: FloatNode, pc: Vec2Node, dir: Vec2Node): FloatNode {
  const d = length(pc).toVar("pcD");
  const glitter = smoothstep(0.5, 0.0, d);
  const soft = exp(d.mul(d).mul(-7.0)); // a diffuse gaussian blob (motes / pollen)
  const ring = smoothstep(0.09, 0.0, tabs(d.sub(0.34))); // a hollow band (bubbles)
  const ang = atan(pc.y, pc.x); // star: a 4-point sparkle
  const spike = pow(tabs(cos(ang.mul(2.0))), 6.0);
  const star = smoothstep(1.0, 0.0, d.div(spike.mul(0.5).add(0.14)));
  const along = dot(pc, dir); // streak: an elongated comet along the motion direction
  const perp = dot(pc, vec2(dir.y.negate(), dir.x));
  const streak = smoothstep(0.5, 0.0, length(vec2(along.mul(0.42), perp.mul(2.2))));
  // Rounded to an integer index in the GLSL (`int(uShape + 0.5)`); expressed as a select chain here.
  const s = floor(shape.add(0.5)).toVar("shapeIdx");
  return select(
    s.equal(1),
    soft,
    select(s.equal(2), ring, select(s.equal(3), star, select(s.equal(4), streak, glitter))),
  );
}

/**
 * Build one field's material.
 *
 * `wave` is the OWNING wave's uniform registry: the shed emitter and the pointer weld read it
 * directly, so the dust and the ribbon are driven by one set of nodes.
 */
export function buildParticleMaterial(
  wave: WaveTslUniforms,
  u: ParticleTslUniforms,
  attrs: ParticleAttributeArrays,
  flags: ParticleMaterialFlags,
  spriteTexture: Texture | null,
): PointsNodeMaterial {
  // instancedArray().element(instanceIndex), NOT instancedBufferAttribute.
  //
  // The latter is the accessor three's own PointsNodeMaterial docs reach for, but on a Sprite every
  // instance reads the same element and the whole field collapses onto one particle — silently,
  // with no warning. Measured on a 64-instance 4px grid: instancedBufferAttribute lit 37 pixels in
  // a 26x4 box; instancedArray lit exactly 1024 in a 94x94 box, which is 64 x 4x4 as intended.
  const aSeed = instancedArray(attrs.aSeed, "float").element(instanceIndex) as unknown as FloatNode;
  const aRnd = instancedArray(attrs.aRnd, "vec4").element(instanceIndex) as unknown as Vec3Node & {
    w: FloatNode;
    xyz: Vec3Node;
  };
  const aUv = instancedArray(attrs.aUv, "vec2").element(instanceIndex) as unknown as Vec2Node;

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.depthTest = false; // always composite OVER the waves...
  material.depthWrite = false; // ...and never occlude anything (additive glints)
  material.blending = 2; // THREE.AdditiveBlending
  material.sizeAttenuation = false; // orthographic: size is constant in device pixels

  // Deterministic life: age 0..1 from uTime + a per-particle seed. Advances once per loop period
  // when looping (so the field repeats seamlessly), else once per uLife seconds. Built OUTSIDE the
  // Fn bodies below, because `sizeNode` and the varyings are read by the material's own setup and
  // by the fragment graph — assigning them from inside an Fn would make them depend on which graph
  // three happens to build first.
  const cyc = max(1.0, floor(u.uPartSpeed.add(0.5)));
  const rate = select(
    u.uLoopSeconds.greaterThan(0.0),
    u.uTime.div(u.uLoopSeconds).mul(cyc),
    u.uTime.mul(u.uPartSpeed).div(max(u.uLife, 0.001)),
  );
  const age = fract(rate.add(aSeed));
  const fade = sin(age.mul(Math.PI)); // 0 at birth/death, 1 mid-life

  // Point size in LOGICAL pixels: three multiplies by the device pixel ratio itself, so the GLSL's
  // explicit uPixelRatio factor is deliberately absent here.
  const jitter = float(1).add(u.uSizeJitter.mul(aSeed.sub(0.5)).mul(2.0));
  material.sizeNode = max(u.uSize.mul(jitter).mul(fade), 0.0);

  // Linear / orbit time for the shed emitter. Only the one selected by loopMotion is read.
  const ts = flags.loopMotion ? float(0) : u.uTime.mul(u.uShedSpeed).add(u.uShedSeed);
  const loopTheta = u.uTime.mul(TAU).div(u.uLoopSeconds).add(u.uShedSeed);
  const loopR = u.uShedSpeed.mul(u.uLoopSeconds).mul(0.159154943092);
  const loopOff = flags.loopMotion ? vec2(cos(loopTheta), sin(loopTheta)).mul(loopR) : vec2(0, 0);

  // Spawn on the owning wave's DEFORMED surface at aUv, then peel outward as the particle ages.
  const emit = Fn(() => {
    // Approximate the base hairpin point for this uv (length from uv.y; width centre), then deform
    // it exactly as the wave does. Good enough for dust — the fan / displacement dominate.
    const base = vec3(aUv.y.sub(0.5).mul(400.0), 0.0, RIBBON_Z_CENTER);
    const ws = waveShape(wave, flags, base, aUv, ts, loopOff);
    const origin = u.uShedModel.mul(vec4(ws.pos, 1.0)).xyz.toVar("origin");
    const outward = normalize(origin.sub(u.uCenter).add(vec3(1e-4))).toVar("outward");

    const p = origin
      .add(outward.mul(age).mul(u.uDrift))
      .add(aRnd.xyz.sub(0.5).mul(age).mul(u.uDrift).mul(0.35))
      .toVar("p");

    // Motion styles, each 0 = off, all riding age so they stay loop-safe.
    p.addAssign(u.uUp.mul(age).mul(u.uRise)); // screen-vertical buoyancy

    // How far this mote travels from its birth patch over a WHOLE life. Only the pointer weld
    // reads it, so it is only computed when the pointer field is compiled in.
    const span = flags.pointerFx
      ? tabs(u.uDrift).mul(1.35).add(tabs(u.uRise)).add(u.uWander).toVar("span")
      : null;

    If(u.uSwirl.notEqual(0.0), () => {
      const nrm = cross(u.uRight, u.uUp);
      const rel = p.sub(u.uCenter).toVar("rel");
      if (span) span.addAssign(tabs(u.uSwirl).mul(TAU).mul(length(rel)));
      const rx = dot(rel, u.uRight);
      const ry = dot(rel, u.uUp);
      const rz = dot(rel, nrm);
      const a = age.mul(u.uSwirl).mul(TAU);
      const ca = cos(a);
      const sa = sin(a);
      p.assign(
        u.uCenter
          .add(u.uRight.mul(rx.mul(ca).sub(ry.mul(sa))))
          .add(u.uUp.mul(rx.mul(sa).add(ry.mul(ca))))
          .add(nrm.mul(rz)),
      );
    });

    If(u.uWander.notEqual(0.0), () => {
      const wan = vec2(
        simplexNoise(vec2(aSeed.mul(17.0), age.mul(3.0))),
        simplexNoise(vec2(age.mul(3.0), aSeed.mul(23.0))),
      );
      p.addAssign(u.uRight.mul(wan.x).add(u.uUp.mul(wan.y)).mul(u.uWander));
    });

    if (flags.pointerFx && span) {
      // WELD: the ribbon displaces its surface along its own post-twist up-axis, and a mote sitting
      // ON that surface has to take the same ride, or the cursor's dome lifts the silk out from
      // under its own glitter. Sampled at the SPAWN point, exactly as the ribbon's own displacement
      // is, so the two land in the same place — and so `outward` stays derived from the
      // UNDISPLACED origin, leaving the drift direction unbent by a poke.
      const pMvp = cameraProjectionMatrix.mul(cameraViewMatrix).mul(u.uShedModel).toVar("pMvp");
      const originClip = pMvp.mul(vec4(ws.pos, 1.0)).toVar("originClip");
      const localAxis = applyTwist(
        applyTwist(applyTwist(vec3(0, 1, 0), ws.twists[0]), ws.twists[1]),
        ws.twists[2],
      );
      const dispAxis = u.uShedModel.mul(vec4(localAxis, 0.0)).xyz.toVar("dispAxis");
      const opts = { loopMotion: flags.loopMotion, ripples: flags.pointerRipples };
      const weld = pointerField(
        wave,
        opts,
        originClip.xy.div(max(originClip.w, 1.0e-6)),
        pMvp,
        ws.twists,
        ws.pos,
        ts,
        loopOff,
      );
      // How attached to its birth patch this mote still is: 1 on the surface, 0 once it has
      // travelled a full life's worth away. Measured from DISTANCE rather than age, because dust
      // with no drift / rise / swirl / wander never leaves the surface at all — an age fade would
      // quietly stop that dust from following the ribbon halfway through its life.
      const attach = select(
        span.greaterThan(1.0e-4),
        float(1).sub(clamp(length(p.sub(origin)).div(span), 0, 1)),
        float(1),
      ).toVar("attach");
      p.addAssign(dispAxis.mul(weld.disp.mul(attach)));

      // SHOVE: the same field at the mote's OWN screen position, so the cursor also pushes dust
      // that has already left the surface and a click ripple blows through the cloud instead of
      // stopping dead at the ribbon.
      If(u.uPartShove.notEqual(0.0), () => {
        const pClip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p, 1.0)).toVar("pClip");
        const shove = pointerField(
          wave,
          opts,
          pClip.xy.div(max(pClip.w, 1.0e-6)),
          pMvp,
          ws.twists,
          ws.pos,
          ts,
          loopOff,
        );
        p.addAssign(dispAxis.mul(shove.disp.mul(float(1).sub(attach)).mul(u.uPartShove)));
      });
    }

    return p;
  });

  material.positionNode = emit();

  // Vertex-stage values the fragment needs. `outward` is recomputed here rather than threaded out
  // of the emitter: it is a pure function of the spawn point, so the graph is common-subexpression
  // eliminated back into one evaluation.
  //
  // Wrapped in an Fn because waveShape uses `.toVar()` / `.assign()`, which need a stack — calling
  // it at module level fails with "No stack defined for assign operation".
  const outwardDir = Fn(() => {
    const spawn = waveShape(
      wave,
      flags,
      vec3(aUv.y.sub(0.5).mul(400.0), 0.0, RIBBON_Z_CENTER),
      aUv,
      ts,
      loopOff,
    );
    const spawnWorld = u.uShedModel.mul(vec4(spawn.pos, 1.0)).xyz;
    return normalize(spawnWorld.sub(u.uCenter).add(vec3(1e-4)));
  })();

  const tw = sin(age.mul(9.0).add(aSeed).mul(TAU)).mul(0.5).add(0.5); // loop-safe flicker
  const vAlpha = varying(fade.mul(mix(float(1), tw, clamp(u.uTwinkle, 0, 1))), "vAlpha");
  const vColor = varying(mix(u.uColor, u.uColor2, aRnd.w), "vColor"); // two-tone dust
  const vDir = varying(
    normalize(vec2(dot(outwardDir, u.uRight), dot(outwardDir, u.uUp)).add(vec2(1e-4))),
    "vDir",
  );

  material.colorNode = Fn(() => {
    // gl_PointCoord's origin is the TOP-left with y running DOWN; the sprite quad's uv runs UP.
    const pointCoord = vec2(uv().x, float(1).sub(uv().y)).toVar("pointCoord");
    if (flags.sprite && spriteTexture) {
      const tex = texture(spriteTexture).sample(vec2(pointCoord.x, float(1).sub(pointCoord.y)));
      // Tinted by the dust colour so color / color2 keep working: white artwork takes the tint
      // exactly, coloured artwork multiplies it.
      return vec4(vColor.mul(tex.rgb), tex.a.mul(vAlpha));
    }
    const a = shapeAlpha(u.uShape, pointCoord.sub(0.5), vDir).mul(vAlpha);
    return vec4(vColor, a); // AdditiveBlending (src = SrcAlpha) -> adds vColor*a
  })();

  return material;
}
