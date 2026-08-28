/**
 * The pointer field in TSL — the port of `pointerFieldChunk` in `../shaders.ts`.
 *
 * Shared by the wave material and the particle emitter exactly as it is in the GLSL, so a wave's
 * dust reacts to the cursor through the SAME footprint, falloff and displacement its ribbon does
 * instead of staying pinned to the un-poked surface.
 *
 * `fall` is the screen falloff times presence, which both fragment themes consume; `disp` is the
 * signed displacement along the surface's own up-axis, which the CALLER applies — the wave in its
 * local space, the dust through the wave's world matrix.
 */
import {
  float,
  vec2,
  vec3,
  vec4,
  cos,
  exp,
  clamp,
  dot,
  length,
  smoothstep,
  Loop,
  If,
} from "three/tsl";
import { RIPPLE_SLOTS } from "../interaction";
import { simplexNoise } from "./noise";
import { applyTwist, type Twist } from "./waveShape";
import type { FloatNode, Vec2Node, Vec3Node, Mat4Node } from "./types";
import type { WaveTslUniforms } from "./uniforms";

const RIPPLE_WAVE_SPEED = 0.85; // NDC/s the ring crest travels outward
const RIPPLE_SIGMA = 0.14; // gaussian half-width of the travelling packet (NDC)
const RIPPLE_FREQ = 11.0; // oscillation within the packet (one crest + faint troughs)
const RIPPLE_MAX_R = 1.2; // reach where the crest has fully left the frame

export interface PointerHit {
  /** Screen falloff x presence. */
  fall: FloatNode;
  /** Signed displacement along the surface's own up-axis. */
  disp: FloatNode;
}

export interface PointerFieldOpts {
  loopMotion: boolean;
  ripples: boolean;
}

/**
 * Sample the field for ONE point.
 *
 * `ndc` is that point's screen position; `mvp` the clip transform of the space the twists and
 * `churnPos` live in (the owning wave's local space); `t` / `loopOff` the caller's linear / orbit
 * time — only the one selected by `loopMotion` is read.
 */
export function pointerField(
  u: WaveTslUniforms,
  opts: PointerFieldOpts,
  ndc: Vec2Node,
  mvp: Mat4Node,
  twists: [Twist, Twist, Twist],
  churnPos: Vec3Node,
  t: FloatNode,
  loopOff: Vec2Node,
): PointerHit {
  const aspect = vec2(u.uPointerAspect, 1.0);
  // Screen-space offset from the cursor (aspect-corrected → round in pixels). The DEFAULT metric.
  const dp = ndc.sub(u.uPointer).mul(aspect).toVar("pfDp");

  // Ribbon flow: stretch the metric along the strip's own LENGTH axis so the field reaches ALONG
  // the ribbon and stays tight across it. The length axis is local +X carried through the SAME
  // twists as the surface. The camera is orthographic (affine, w = 1), so the axis's screen image
  // is the linear map of the DIRECTION (w = 0): one mat*dir, no perspective divide.
  If(u.uShapeFlow.greaterThan(0.0), () => {
    const tangentLocal = applyTwist(
      applyTwist(applyTwist(vec3(1, 0, 0), twists[0]), twists[1]),
      twists[2],
    );
    const tang = mvp.mul(vec4(tangentLocal, 0.0)).xy.mul(aspect).toVar("pfTang");
    const tl = length(tang).toVar("pfTl");
    If(tl.greaterThan(1.0e-6), () => {
      tang.divAssign(tl);
      const nrm = vec2(tang.y.negate(), tang.x);
      // up to 3.5x reach along the length
      dp.assign(vec2(dot(dp, tang).div(u.uShapeFlow.mul(2.5).add(1.0)), dot(dp, nrm)));
    });
  });

  const fall = smoothstep(u.uPointerRadius, 0.0, length(dp)).mul(u.uPointerActive).toVar("pfFall");

  // Agitation: a fast churn octave near the cursor (additive — never rewrites the base noise time,
  // which would force restructuring the shared path). Loop-safe under both time variants.
  const churnArg = opts.loopMotion
    ? vec2(churnPos.x.mul(u.uDispFreqX).mul(3.0), churnPos.z.mul(u.uDispFreqZ).mul(3.0)).add(
        loopOff.mul(4.0),
      )
    : vec2(
        churnPos.x.mul(u.uDispFreqX).mul(3.0).add(t.mul(4.0)),
        churnPos.z.mul(u.uDispFreqZ).mul(3.0),
      );
  const disp = u.uPointerAgitate.mul(fall).mul(simplexNoise(churnArg)).toVar("pfDisp");

  // Membrane push/pull: a smooth dome that swells toward you (+ repel) or dents away (- attract).
  disp.addAssign(u.uPointerPush.mul(fall));

  // Drag-wake: pull the surface just BEHIND the moving cursor into a trailing trough. dp points
  // from cursor to vertex; "behind" is how far the vertex sits opposite the velocity, gated by
  // speed so it only forms while dragging and heals when the cursor stops.
  const velC = u.uPointerVel.mul(aspect).toVar("pfVel");
  const wakeSpeed = length(velC).toVar("pfSpeed");
  If(u.uPointerWake.notEqual(0.0).and(wakeSpeed.greaterThan(1.0e-4)), () => {
    const behind = clamp(dot(dp.negate(), velC).div(wakeSpeed.mul(u.uPointerRadius)), 0, 1);
    disp.subAssign(
      u.uPointerWake
        .mul(fall)
        .mul(behind)
        .mul(smoothstep(0.05, 0.6, wakeSpeed)),
    );
  });

  if (opts.ripples) {
    Loop({ start: 0, end: RIPPLE_SLOTS, type: "int" }, ({ i }) => {
      const amp = u.uRippleAmp.el(i).toVar("rAmp");
      If(amp.greaterThan(0.0), () => {
        const rd = length(ndc.sub(u.uRippleOrigin.el(i)).mul(aspect)).toVar("rD");
        // A wave PACKET whose crest travels outward: a gaussian window centred on the moving front
        // carrying a short oscillation, so the energy radiates instead of throbbing at the click
        // point. The shared envelope fades the packet over its lifetime; reach fades it as the
        // crest leaves frame.
        const front = u.uRippleAge.el(i).mul(RIPPLE_WAVE_SPEED).toVar("rFront");
        const band = rd.sub(front).toVar("rBand");
        const packet = exp(
          band
            .mul(band)
            .negate()
            .div(2.0 * RIPPLE_SIGMA * RIPPLE_SIGMA),
        ).mul(cos(band.mul(RIPPLE_FREQ)));
        const reach = float(1).sub(smoothstep(RIPPLE_MAX_R * 0.7, RIPPLE_MAX_R, front));
        disp.addAssign(u.uPointerRipple.mul(amp).mul(packet).mul(reach));
      });
    });
  }

  return { fall, disp };
}
