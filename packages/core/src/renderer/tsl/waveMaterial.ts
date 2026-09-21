/**
 * The wave's `NodeMaterial` — the TSL port of `vertexShader` + `fragmentShader` / `lineFragmentShader`.
 *
 * The GLSL `#ifdef` variants become JS flags, so each material builds exactly the graph it needs
 * instead of relying on a define set and a program cache key.
 *
 * One deliberate difference from the GLSL: no output colour-space conversion. The material writes
 * LINEAR, exactly as the GLSL does; the conversion happens once at the end of the post chain,
 * matching `OutputPass` on the WebGL path.
 *
 * Premultiplied alpha, by contrast, has to be done HERE. `NodeMaterial.setupOutput()` does call
 * `setupPremultipliedAlpha()` — but on its own `basicOutput`, which it then discards the moment a
 * custom `outputNode` is set (`if (isCustomOutput) resultNode = this.outputNode`). So a material
 * that writes its own output gets the premultiplied BLEND FACTORS without the premultiply, and
 * every partly transparent pixel composites too bright. The GLSL does the same multiply under the
 * PREMULTIPLIED_ALPHA define Three injects for it; this is that line.
 */
import { NodeMaterial } from "three/webgpu";
import {
  Fn,
  varying,
  vec2,
  vec3,
  vec4,
  float,
  uv,
  positionLocal,
  positionWorld,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  modelWorldMatrix,
  screenUV,
  dFdx,
  dFdy,
  fwidth,
  abs as tabs,
  sin,
  cos,
  pow,
  max,
  clamp,
  mix,
  smoothstep,
  asin,
  cross,
  dot,
  exp,
  sqrt,
  normalize,
  radians,
  Loop,
  If,
  Break,
  select,
  Discard,
} from "three/tsl";
import { MAX_LIGHTS, MAX_NOISE_BANDS } from "../../config/model";
import { simplexNoise, grainHash } from "./noise";
import { waveShape, applyTwist, type WaveShapeFlags } from "./waveShape";
import { applyColorGrade, waveBaseColor, hueShift, parabola, mapLinear } from "./color";
import { pointerField } from "./pointerField";
import { dissolved } from "./dissolve";
import type { FloatNode, Vec2Node, Vec3Node } from "./types";
import type { WaveTslUniforms } from "./uniforms";

export interface WaveMaterialFlags extends WaveShapeFlags {
  theme: "solid" | "wireframe" | "glass";
  /** Pointer field: per-wave, config-only, so input never triggers a rebuild. */
  pointerFx: boolean;
  /** Click ripples, which nest inside the pointer field. */
  pointerRipples: boolean;
  depthTint: boolean;
  edgeFeather: boolean;
  rungs: boolean;
  /** Stripe hardening (wireframe only): compiled only when lineSharpness > 0, as in the GLSL. */
  lineSharp: boolean;
  /** The disintegration front: compiled only when the wave has one, as in the GLSL. */
  dissolve: boolean;
  /** Clear gaps (wireframe only): compiled only when lineGapOpacity < 1, as in the GLSL. */
  lineClearGaps: boolean;
  /** Lit / round strands (wireframe only): compiled only when lineLight > 0, as in the GLSL. */
  lineLight: boolean;
  /**
   * Premultiply the output, for the blend modes that ask for premultiplied factors ("squared" —
   * the default — and "multiply"). Mirrors `applyBlendMode`'s own rule; see the note at the top of
   * this file for why the node pipeline cannot do it for us.
   */
  premultiplied: boolean;
  /**
   * True when the active backend uses [0,1] clip Z (WebGPU) rather than [-1,1] (WebGL).
   *
   * `camera.coordinateSystem` changes what `projectionMatrix` produces — for an orthographic camera
   * the two differ by exactly `z_webgl = 2 * z_webgpu - 1`. The depth fade and depth tint consume
   * clip Z directly (`clamp(z * 6, 0, 1)`), so without this remap the wireframe theme and the tint
   * would silently render differently on each backend. WebGPURenderer can run either backend, so
   * this is read from the live renderer rather than assumed.
   */
  webgpuClipZ: boolean;
}

/** Linear + orbit time. Only the one selected by `loopMotion` is read, as in the GLSL. */
function timeNodes(u: WaveTslUniforms, flags: WaveShapeFlags): { t: FloatNode; loopOff: Vec2Node } {
  if (!flags.loopMotion) {
    return { t: u.uTime.mul(u.uSpeed).add(u.uSeed), loopOff: vec2(0, 0) };
  }
  // Seamless loop: sample the noise on a circle of radius loopR at angle loopTheta — exactly
  // periodic with period uLoopSeconds, and the tangential speed matches the linear drift.
  const loopTheta = u.uTime.mul(float(6.28318530718).div(u.uLoopSeconds)).add(u.uSeed).toVar();
  const loopR = u.uSpeed.mul(u.uLoopSeconds).mul(0.159154943092); // = uSpeed·uLoopSeconds / (2π)
  return { t: float(0), loopOff: vec2(cos(loopTheta), sin(loopTheta)).mul(loopR) };
}

/**
 * Striations: subtle high-frequency simplex grain ADDED to the colour — colour-matched (weaker
 * where blue is high), only near folds, and concentrated toward the ends. Blends rather than
 * reading as hard lines. Noise bands override the params inside rectangular uv regions.
 */
function surfaceStreaks(
  u: WaveTslUniforms,
  uvIn: Vec2Node,
  color: Vec3Node,
  crease: FloatNode,
): Vec3Node {
  const strength = float(u.uFiberStrength).toVar("streakStrength");
  const freq = float(u.uFiberCount).toVar("streakFreq");
  const colorAtten = float(0.9).toVar("streakAtten");
  const paraPow = float(3.0).toVar("streakPara");

  Loop({ start: 0, end: MAX_NOISE_BANDS, type: "int" }, ({ i }) => {
    If(float(i).greaterThanEqual(float(u.uNumNoiseBands)), () => {
      Break();
    });
    const b = u.uNoiseBandBounds.el(i).toVar();
    const prm = u.uNoiseBandParams.el(i).toVar();
    const feather = max(prm.x, 1.0e-4).toVar();
    const blend = smoothstep(b.x.sub(feather), b.x, uvIn.x)
      .mul(float(1).sub(smoothstep(b.y, b.y.add(feather), uvIn.x)))
      .mul(smoothstep(b.z.sub(feather), b.z, uvIn.y))
      .mul(float(1).sub(smoothstep(b.w, b.w.add(feather), uvIn.y)));
    strength.assign(mix(strength, prm.y, blend));
    freq.assign(mix(freq, prm.z, blend));
    colorAtten.assign(mix(colorAtten, prm.w, blend));
    paraPow.assign(mix(paraPow, u.uNoiseBandParaPow.el(i), blend));
  });

  // The high frequency runs along uv.x (the folded WIDTH), packing many thin stripes across the
  // cross-section while uv.y is barely scaled, so each stretches into a fine LENGTHWISE fiber.
  const p = float(1).sub(parabola(uvIn.x, paraPow));
  const n0 = simplexNoise(vec2(uvIn.x.mul(0.1), uvIn.y.mul(0.5))).toVar();
  const n1raw = simplexNoise(
    vec2(uvIn.x.mul(freq.add(freq.mul(0.5).mul(n0))), uvIn.y.mul(4.0).mul(n0)),
  );
  const n1 = mapLinear(n1raw, -1, 1, 0, 1);
  return color.add(
    n1
      .mul(strength)
      .mul(float(1).sub(color.b.mul(colorAtten)))
      .mul(crease)
      .mul(p),
  );
}

/** Build one wave's material for the given flags. */
export function buildWaveMaterial(u: WaveTslUniforms, flags: WaveMaterialFlags): NodeMaterial {
  const material = new NodeMaterial();
  // Glass draws OPAQUE with depth write on, exactly as the GLSL twin does: its see-through is
  // sampled from the backdrop rather than blended, which is what keeps overlapping sheets free of
  // any sorting. Leaving it transparent here made the two backends disagree on alpha across the
  // whole sheet — the parity case caught it as a 0.43 alpha bias.
  material.transparent = flags.theme !== "glass";
  material.depthTest = true;
  material.depthWrite = true;
  material.side = 2; // THREE.DoubleSide

  // ---- Vertex ----
  // The pointer falloff is computed in the vertex stage alongside the displacement and carried to
  // the fragment, matching the GLSL's `varying float vPointerFall`.
  let pointerFall: FloatNode | null = null;

  material.positionNode = Fn(() => {
    const { t, loopOff } = timeNodes(u, flags);
    const ws = waveShape(u, flags, positionLocal, uv(), t, loopOff);
    if (!flags.pointerFx) return ws.pos;

    // Displace along the wave's own (post-twist) up-axis, weighted by a screen-space falloff around
    // the smoothed cursor. Everything here is ADDITIVE, so the shared path above is untouched.
    // Shared clip transform, computed once and reused for the cursor metric and the ribbon tangent
    // (the compiler is not guaranteed to CSE the triple product).
    const mvp = cameraProjectionMatrix.mul(cameraViewMatrix).mul(modelWorldMatrix).toVar("mvp");
    const preClip = mvp.mul(vec4(ws.pos, 1.0)).toVar("preClip");
    const hit = pointerField(
      u,
      { loopMotion: flags.loopMotion, ripples: flags.pointerRipples },
      preClip.xy.div(max(preClip.w, 1.0e-6)),
      mvp,
      ws.twists,
      ws.pos,
      t,
      loopOff,
    );
    pointerFall = varying(hit.fall, "vPointerFall");
    // Rotations are linear, so displacing the post-twist axis equals displacing pre-twist Y.
    const dispAxis = applyTwist(
      applyTwist(applyTwist(vec3(0, 1, 0), ws.twists[0]), ws.twists[1]),
      ws.twists[2],
    );
    return ws.pos.add(dispAxis.mul(hit.disp));
  })();

  // Clip-space depth, normalised to the WebGL [-1,1] convention the GLSL was written against.
  const rawClip = varying(
    cameraProjectionMatrix
      .mul(cameraViewMatrix)
      .mul(modelWorldMatrix)
      .mul(vec4(material.positionNode as unknown as Vec3Node, 1.0)),
    "vClipPosition",
  );
  const clipZ: FloatNode = flags.webgpuClipZ ? rawClip.z.mul(2).sub(1) : rawClip.z;

  // ---- Fragment ----
  // This fragment's 0..1 screen position — read only by a screen-axis dissolve front. Taken from
  // the same clip vector the depth fade uses, so the two never disagree about where a fragment is.
  const ndc = rawClip.xy.div(max(rawClip.w, 1.0e-6)).mul(0.5).add(0.5);
  const fragment = (
    flags.theme === "wireframe"
      ? buildWireframeFragment(u, flags, clipZ, pointerFall, ndc)
      : flags.theme === "glass"
        ? buildGlassFragment(u, flags, ndc)
        : buildSolidFragment(u, flags, clipZ, pointerFall, ndc)
  ).toVar("fragOut");
  material.outputNode = flags.premultiplied
    ? vec4(fragment.rgb.mul(fragment.a), fragment.a)
    : fragment;

  return material;
}

/** The wireframe thin-line theme: colour carved into fine lengthwise strands, faded by depth. */
function buildWireframeFragment(
  u: WaveTslUniforms,
  flags: WaveMaterialFlags,
  clipZ: FloatNode,
  pointerFall: FloatNode | null,
  ndc: Vec2Node,
) {
  return Fn(() => {
    const vUv = uv();
    // The disintegration front: drop the chunks it has already eaten, before any shading work.
    if (flags.dissolve) Discard(dissolved(u, vUv, ndc));
    const color = applyColorGrade(u, waveBaseColor(u, vUv)).toVar("lineColor");
    if (pointerFall) {
      color.assign(hueShift(color, radians(u.uPointerHue).mul(pointerFall)));
      color.mulAssign(float(1).add(u.uPointerLighten.mul(pointerFall)));
    }

    // Carve into fine lengthwise strands; thickness from the screen-space uv derivative.
    const dy = dFdy(vUv).toVar();
    const lineThickness = u.uLineThickness
      .mul(pow(tabs(dy.x.mul(1232.0)), u.uLineDerivativePower)) // fixed reference width; see the GLSL
      .toVar("lineThickness");
    if (pointerFall) {
      // Strands taper to hairlines near the cursor.
      lineThickness.mulAssign(clamp(float(1).sub(u.uPointerThin.mul(pointerFall)), 0, 1));
    }
    // Each family's per-pixel rate and the duty cycle it averages to — see the GLSL for why a
    // sub-pixel period has to fall back to a tone rather than be point-sampled.
    const lineRate = u.uLineAmount.mul(fwidth(vUv.x)).toVar("lineRate");
    if (flags.lineLight) {
      // The line theme is otherwise UNLIT — a strand's colour comes from its uv alone, so it holds
      // one tone wherever the surface turns. This shades it with the same derivative normal and
      // lights the solid theme uses, and ROUNDS each strand so a highlight can run along one and not
      // its neighbour. See the LINE_LIGHT block in the GLSL for the full reasoning.
      const vWorldPos = positionWorld;
      const vViewDir = cameraPosition.sub(vWorldPos).toVar("lineViewDir");
      const n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos))).toVar("lineN");
      const vd = normalize(vViewDir).toVar("lineV");
      If(dot(n, vd).lessThan(0.0), () => {
        n.assign(n.negate());
      });
      {
        // World direction of increasing uv.x, by least squares from the screen derivatives — the
        // axis to tilt each strand about.
        const gu = vec2(dFdx(vUv.x), dFdy(vUv.x)).toVar("lineGu");
        const gg = dot(gu, gu).toVar("lineGg");
        If(gg.greaterThan(1.0e-12), () => {
          const across = dFdx(vWorldPos)
            .mul(gu.x)
            .add(dFdy(vWorldPos).mul(gu.y))
            .div(gg)
            .toVar("lineAcross");
          across.assign(normalize(across.sub(n.mul(dot(across, n)))));
          const sAcross = clamp(
            sin(vUv.x.mul(u.uLineAmount)).div(max(lineThickness, 1.0e-4)),
            -1,
            1,
          );
          n.assign(normalize(n.add(across.mul(sAcross).mul(1.2)))); // LINE_ROUND
          If(dot(n, vd).lessThan(0.0), () => {
            n.assign(n.negate());
          });
        });
      }
      const facing = tabs(dot(n, vd)).toVar("lineFacing");
      const lit = color.mul(mix(float(0.08), float(1), facing)).toVar("lineLit");
      Loop({ start: 0, end: MAX_LIGHTS, type: "int" }, ({ i }) => {
        If(float(i).greaterThanEqual(float(u.uNumLights)), () => {
          Break();
        });
        const l = normalize(u.uLightPos.el(i).sub(vWorldPos)).toVar();
        const lc = u.uLightColor.el(i).mul(u.uLightIntensity.el(i)).toVar();
        lit.addAssign(
          color
            .mul(max(dot(n, l), 0.0))
            .mul(lc)
            .mul(0.5),
        );
        lit.addAssign(
          lc.mul(pow(max(dot(n, normalize(l.add(vd))), 0.0), 48.0)).mul(1.5), // LINE_GLINT
        );
      });
      lit.mulAssign(clamp(u.uAmbient, 0, 1).add(0.55));
      color.assign(mix(color, lit, clamp(u.uLineLight, 0, 1)));
    }
    const a = smoothstep(lineThickness, 0.0, tabs(sin(vUv.x.mul(u.uLineAmount)))).toVar("lineA");
    // No duty-cycle fallback for the LENGTHWISE family — see the GLSL: its threshold is itself
    // derivative-built, so keying one on it makes cross-backend agreement worse.
    const rungRate = float(0).toVar("rungRate");
    const dutyRung = float(0).toVar("dutyRung");
    if (flags.rungs) {
      // The same carve at constant uv.y, so this family runs ACROSS the ribbon where the one above
      // runs along it — together they read as a ladder. Width comes from fwidth(), not the
      // lengthwise term's dFdy(vUv).x, which is the derivative of the wrong axis for this direction.
      rungRate.assign(u.uRungAmount.mul(fwidth(vUv.y)));
      const rungT = u.uRungThickness.mul(rungRate).toVar("rungT");
      a.assign(max(a, smoothstep(rungT, 0.0, tabs(sin(vUv.y.mul(u.uRungAmount))))));
      dutyRung.assign(asin(clamp(rungT.mul(0.5), 0, 1)).mul(0.63661977));
    }
    if (flags.lineSharp) {
      // Steepen the stripe about its own midpoint, which turns uLineThickness into a DUTY CYCLE and
      // this into the edge — see the LINE_SHARP block in the GLSL for why the soft ramp alone cannot
      // reach dense ink, why it is applied to the MERGED coverage, and why the floor is the analytic
      // stripe rate rather than fwidth() of that merged value.
      const aaRate = max(lineRate, rungRate).mul(0.5);
      a.assign(
        clamp(
          a
            .sub(0.5)
            .div(max(float(1).sub(u.uLineSharpness), aaRate.mul(1.4)))
            .add(0.5),
          0,
          1,
        ),
      );
    }
    // Sub-pixel rungs: fade to the tone those strands average to.
    a.assign(mix(a, max(a, dutyRung), smoothstep(1.2, 3.0, rungRate)));

    // Depth fade: the wave recedes into the background colour with depth.
    const depthFade = clamp(clipZ.mul(6.0), 0, 1).mul(u.uLineDepthFade);
    const cov = a.mul(float(1).sub(depthFade)).toVar("lineCov");
    // Soft ribbon ENDS, as the solid theme fades them — see the GLSL for why a wireframe needs it.
    const feather = flags.edgeFeather ? u.uEdgeFeather : float(0.1);
    cov.mulAssign(
      smoothstep(0.0, feather, vUv.y).mul(
        float(1).sub(smoothstep(float(1).sub(feather), 1.0, vUv.y)),
      ),
    );
    if (flags.lineClearGaps) {
      // CLEAR GAPS: the gaps carry the page colour only as far as uLineGapOpacity and are otherwise
      // transparent, so the strands composite over whatever is really behind them rather than over a
      // flat card of page colour. See the LINE_CLEAR_GAPS block in the GLSL.
      const gapA = float(1).sub(cov).mul(u.uLineGapOpacity).toVar("lineGapA");
      const outA = cov.add(gapA).toVar("lineOutA");
      // A fully clear gap must not reach the depth buffer, or it occludes the wave behind it.
      Discard(outA.lessThanEqual(0.002));
      const straight = color.mul(cov).add(u.uClearColor.mul(gapA)).div(outA).toVar("lineStraight");
      const outC = select(u.uSquared.greaterThan(0.5), straight.mul(straight), straight);
      return vec4(outC, u.uOpacity.mul(outA));
    }
    const faded = mix(u.uClearColor, color, cov).toVar("lineFaded");
    // Deep "squared" look — composited, not replace-blended (see applyBlendMode).
    const out = select(u.uSquared.greaterThan(0.5), faded.mul(faded), faded);
    return vec4(out, u.uOpacity);
  })();
}

/**
 * The glass theme's twin. Structurally the same as the GLSL: bend the backdrop along the surface
 * normal, absorb the wave's own palette over a thickness, then fresnel / rim / specular on top.
 *
 * Three TSL-specific departures, all forced:
 *  - There is no early `return`, so the normal pass is a SELECT at the end rather than a bail-out
 *    near the top. It costs the shading work on that pass; the pass only runs when a wave asks for
 *    caustics, so it is paid rarely.
 *  - The frost samples are unrolled in JavaScript. A Loop carrying a toVar accumulator inside
 *    another control block does not survive node generation — the accumulator gets hoisted out of
 *    scope — and building eleven taps as straight-line graph avoids the question entirely.
 *  - Screen position comes from the clip vector (the `ndc` the dissolve already uses), NOT from
 *    `screenUV`, which is top-down here while a clip-derived UV is y-up. Mixing the two is the
 *    classic way to send a sample the wrong way and get banding no one can explain.
 */
function buildGlassFragment(u: WaveTslUniforms, flags: WaveMaterialFlags, ndc: Vec2Node) {
  return Fn(() => {
    const vUv = uv();
    if (flags.dissolve) Discard(dissolved(u, vUv, ndc));
    const vWorldPos = positionWorld;

    const flatN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos))).toVar("glassFlatN");
    const N = flatN.toVar("glassN");
    If(u.uGlassRipple.greaterThan(0.001), () => {
      // Four travelling waves added to the normal as a gradient — see the GLSL for why trig rather
      // than scrolled noise, and why the temporal frequencies are integer multiples.
      const ph = u.uTime.mul(u.uGlassFlow);
      const k1 = vec3(1.0, 0.62, 0.31);
      const k2 = vec3(-0.54, 1.13, 0.47);
      const k3 = vec3(0.36, -0.82, 1.07);
      const k4 = vec3(-1.18, -0.33, 0.72);
      const g = k1
        .mul(cos(dot(vWorldPos, k1).mul(u.uGlassRippleScale).add(ph)))
        .add(
          k2
            .mul(cos(dot(vWorldPos, k2).mul(u.uGlassRippleScale).sub(ph.mul(2)).add(1.7)))
            .mul(0.65),
        )
        .add(
          k3
            .mul(cos(dot(vWorldPos, k3).mul(u.uGlassRippleScale).add(ph.mul(3)).add(3.9)))
            .mul(0.42),
        )
        .add(k4.mul(cos(dot(vWorldPos, k4).mul(u.uGlassRippleScale).sub(ph).add(2.6))).mul(0.55));
      N.assign(normalize(N.add(g.mul(u.uGlassRipple).mul(0.16))));
    });

    // ORTHOGRAPHIC view axis, not a per-fragment ray to the eye — column 2 of the view matrix.
    const V = normalize(u.uViewAxis).toVar("glassV");
    const ndv = clamp(tabs(dot(N, V)), 0.02, 1.0).toVar("glassNdv");
    const rim = pow(float(1).sub(tabs(dot(N, V))), max(u.uGlassRimPower, float(0.001))).toVar();

    const sUv = ndc.toVar("glassSUv");
    // The captures are sampled TOP-DOWN here while a clip-derived UV is y-up, so every texture
    // coordinate and every offset that rides one has its y flipped. These are not two flips that
    // cancel: getting it wrong does not mirror the image, it sends each sample to the wrong side of
    // the surface, which looked like the whole refraction had been rotated.
    const texUv = vec2(sUv.x, float(1).sub(sUv.y)).toVar("glassTexUv");
    const dir = N.xy.sub(flatN.xy).mul(2).add(N.xy).mul(-1).toVar("glassDir");
    If(u.uGlassFusion.greaterThan(0.001), () => {
      const g = vec2(9.0, 9.0).div(u.uResolution);
      const fieldAt = (p: Vec2Node): FloatNode => u.uLayers.sample(p).r;
      const grad = vec2(
        fieldAt(texUv.add(vec2(g.x, 0))).sub(fieldAt(texUv.sub(vec2(g.x, 0)))),
        // y runs the other way in the texture, so the difference is negated to stay a gradient in
        // the same space as the normal it is blended with.
        fieldAt(texUv.sub(vec2(0, g.y))).sub(fieldAt(texUv.add(vec2(0, g.y)))),
      ).toVar("glassGrad");
      If(dot(grad, grad).greaterThan(1.0e-8), () => {
        dir.assign(mix(dir, normalize(grad), clamp(u.uGlassFusion, 0, 1)));
      });
    });
    const offPx = dir
      .mul(mix(rim, float(1), u.uGlassRipple.mul(0.25)))
      .mul(u.uGlassStrength)
      .toVar("glassOffPx");
    const off = offPx.div(max(u.uResolution, vec2(1, 1))).toVar("glassOff");
    const texOff = vec2(off.x, off.y.negate()).toVar("glassTexOff");

    // Opaque capture: the sample IS the colour behind the glass, no alpha composite.
    const backdropAt = (p: Vec2Node): Vec3Node => u.uBackdrop.sample(p).rgb;

    const uvR = texUv.add(texOff.mul(float(1).add(u.uGlassChroma.mul(0.2)))).toVar("glassUvR");
    const uvG = texUv.add(texOff.mul(float(1).add(u.uGlassChroma.mul(0.1)))).toVar("glassUvG");
    const uvB = texUv.add(texOff).toVar("glassUvB");
    const col = vec3(backdropAt(uvR).r, backdropAt(uvG).g, backdropAt(uvB).b).toVar("glassCol");

    If(u.uGlassCaustic.greaterThan(0.001), () => {
      // Re-evaluate the offset from NEIGHBOURING normals: a dFdx-derived normal is constant across
      // each 2x2 quad, so differentiating it again yields exactly zero and the term does nothing.
      const st = vec2(3.0, 3.0).div(u.uResolution);
      const offsetAt = (p: Vec2Node): Vec2Node => {
        const texel = u.uGlassNormals.sample(p);
        const n = normalize(texel.xyz.mul(2).sub(1));
        const r = pow(float(1).sub(tabs(dot(n, V))), max(u.uGlassRimPower, float(0.001)));
        // Outside the glass the buffer is empty; an empty texel must contribute no offset.
        return select(texel.a.lessThan(0.5), vec2(0, 0), n.xy.mul(-1).mul(r).mul(u.uGlassStrength));
      };
      const dOdx = offsetAt(texUv.add(vec2(st.x, 0)))
        .sub(offsetAt(texUv.sub(vec2(st.x, 0))))
        .div(6.0);
      const dOdy = offsetAt(texUv.sub(vec2(0, st.y)))
        .sub(offsetAt(texUv.add(vec2(0, st.y))))
        .div(6.0);
      const detJ = float(1).add(dOdx.x).mul(float(1).add(dOdy.y)).sub(dOdy.x.mul(dOdx.y));
      const gain = clamp(float(1).div(max(tabs(detJ), float(0.12))), 0, 6);
      col.mulAssign(mix(float(1), gain, clamp(u.uGlassCaustic, 0, 1)));
    });

    If(u.uGlassFrost.greaterThan(0.001), () => {
      const radius = u.uGlassFrost.mul(u.uGlassFrost).mul(46.0);
      const r = radius.div(max(u.uResolution, vec2(1, 1)));
      const rot = grainHash(ndc.mul(u.uResolution)).mul(6.2831853);
      const tap = (base: Vec2Node, i: number, chan: "r" | "g" | "b"): FloatNode => {
        const t = (i + 0.5) / 11;
        const a = rot.add(i * 2.399963);
        const o = vec2(cos(a), sin(a)).mul(r).mul(Math.sqrt(t));
        return backdropAt(base.add(o))[chan];
      };
      const acc = (base: Vec2Node, chan: "r" | "g" | "b"): FloatNode => {
        let sum: FloatNode = tap(base, 0, chan);
        for (let i = 1; i < 11; i++) sum = sum.add(tap(base, i, chan));
        return sum.div(11);
      };
      col.assign(
        mix(col, vec3(acc(uvR, "r"), acc(uvG, "g"), acc(uvB, "b")), clamp(u.uGlassFrost, 0, 1)),
      );
    });

    // The material itself: the palette as transmitted light, absorbed over the sheet's thickness.
    const layers = max(u.uLayers.sample(texUv).r.mul(8), float(1)).toVar("glassLayers");
    const chord = float(2)
      .mul(u.uGlassPath)
      .mul(pow(ndv, 0.4))
      .mul(float(1).add(u.uGlassLayerGain.mul(layers.sub(1))))
      .toVar("glassChord");
    const lit = applyColorGrade(u, waveBaseColor(u, vUv)).toVar("glassLit");
    const hue = lit.div(max(max(lit.r, max(lit.g, lit.b)), float(0.001))).toVar("glassHue");
    const sigma = u.uGlassDensity.mul(float(1).sub(hue.mul(0.9)));
    const chordRGB = chord.mul(
      vec3(float(1).add(u.uGlassChroma.mul(0.12)), 1.0, float(1).sub(u.uGlassChroma.mul(0.12))),
    );
    col.mulAssign(mix(vec3(1, 1, 1), exp(sigma.mul(chordRGB).mul(-1)), clamp(u.uGlassTint, 0, 1)));

    // Thin film tints only what BOUNCES.
    const s2 = float(1)
      .sub(ndv.mul(ndv))
      .div(max(u.uGlassIor.mul(u.uGlassIor), float(1.0e-4)));
    const cosT = sqrt(max(float(1).sub(s2), float(0)));
    const phase = vec3(650.0, 550.0, 440.0);
    const film = mix(
      vec3(1, 1, 1),
      float(0.5).add(
        cos(
          float(6.2831853).mul(float(2).mul(u.uGlassIor).mul(u.uGlassFilmNm).mul(cosT)).div(phase),
        ).mul(0.5),
      ),
      clamp(u.uGlassIrid, 0, 1),
    ).toVar("glassFilm");

    const f0 = pow(u.uGlassIor.sub(1).div(u.uGlassIor.add(1)), float(2));
    const F = f0.add(
      float(1)
        .sub(f0)
        .mul(pow(float(1).sub(ndv), float(5))),
    );
    col.assign(
      mix(
        col,
        mix(u.uClearColor, vec3(1, 1, 1), 0.35).mul(film),
        F.mul(float(0.18).add(u.uGlassIrid.mul(0.4))),
      ),
    );

    // Rim, with a deliberately WIDE window — see the GLSL.
    col.assign(
      mix(
        col,
        film,
        float(1)
          .sub(ndv)
          .smoothstep(mix(float(0.62), float(0.42), u.uGlassIrid), float(1))
          .mul(u.uGlassRim),
      ),
    );
    col.mulAssign(float(1).sub(float(1).sub(ndv).smoothstep(0.62, 0.86).mul(0.1)));

    // Two keys, wide lobe: one overhead light never reaches horizontal normals.
    const KEY = normalize(vec3(-0.3, 0.86, 0.42));
    const KEY_FILL = normalize(vec3(0.42, 0.16, 0.89));
    const mirror = V.mul(-1)
      .sub(N.mul(dot(V.mul(-1), N).mul(2)))
      .mul(-1)
      .toVar("glassMirror");
    const lobe = pow(max(dot(mirror, KEY), float(0)), float(40))
      .add(pow(max(dot(mirror, KEY_FILL), float(0)), float(40)).mul(0.55))
      .toVar("glassLobe");
    const spec = lobe.add(rim.mul(0.25)).mul(u.uGlassSpec).toVar("glassSpec");
    col.addAssign(lobe.mul(u.uGlassSpec).mul(0.35).mul(film));

    const luma = dot(col, vec3(0.299, 0.587, 0.114)).toVar("glassLuma");
    const darkBlend = luma.smoothstep(0.25, 0.7);
    col.assign(max(mix(col.add(spec), col.mul(float(1).sub(spec)), darkBlend), vec3(0, 0, 0)));
    col.addAssign(float(0.5).sub(luma).mul(u.uGlassVibrancy));

    const alpha = u.uOpacity.toVar("glassAlpha");
    const shaded = vec4(clamp(col, 0, 1), clamp(alpha, 0, 1));
    // No early return in TSL: the normal pass is selected at the end.
    return select(u.uNormalPass.greaterThan(0.5), vec4(N.mul(0.5).add(0.5), 1.0), shaded);
  })();
}

/** The solid surface theme. */
function buildSolidFragment(
  u: WaveTslUniforms,
  flags: WaveMaterialFlags,
  clipZ: FloatNode,
  pointerFall: FloatNode | null,
  ndc: Vec2Node,
) {
  return Fn(() => {
    const vUv = uv();
    // The disintegration front: drop the chunks it has already eaten, before any shading work.
    if (flags.dissolve) Discard(dissolved(u, vUv, ndc));
    const vWorldPos = positionWorld;
    const vViewDir = cameraPosition.sub(vWorldPos).toVar("vViewDir");

    // crease: a foreshortening / fold detector from the screen-space uv derivative. It drives BOTH
    // the roundness shading and where the streaks appear — this is what gives the wave its
    // thickness without any normal-based lighting.
    const crease = float(0).toVar("crease");
    crease.assign(dFdy(vUv).y.mul(u.uResolution.y).mul(u.uCreaseLight));
    crease.assign(clamp(mapLinear(crease, -1, 1, 0, 1), 0, 1));
    crease.assign(pow(crease, u.uCreaseSharpness));
    crease.assign(clamp(smoothstep(0.0, u.uCreaseSoftness, crease), 0, 1));

    const col = waveBaseColor(u, vUv).toVar("col");
    col.assign(surfaceStreaks(u, vUv, col, crease));
    col.assign(applyColorGrade(u, col));

    if (pointerFall) {
      // Local hue rotation + brightness lift near the cursor (both fade out with the falloff).
      col.assign(hueShift(col, radians(u.uPointerHue).mul(pointerFall)));
      col.mulAssign(float(1).add(u.uPointerLighten.mul(pointerFall)));
    }

    // Iridescence: a thin-film hue that shifts with view angle — grazing parts of the ribbon shift
    // most, so the colour flows as the ribbon curves.
    If(u.uIridescence.greaterThan(0.001), () => {
      const iridN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
      const iridFacing = tabs(dot(iridN, normalize(vViewDir)));
      col.assign(hueShift(col, float(1).sub(iridFacing).mul(u.uIridescence).mul(Math.PI)));
    });

    // Sheen: lift the flat (low-crease) areas toward white. Pose-dependent, so kept gentle.
    col.addAssign(float(1).sub(crease).mul(0.25).mul(u.uSheen));

    // Pose-robust roundness: shade by the camera-facing ratio of the derivative surface normal so
    // the ribbon reads as a rounded solid from any angle.
    If(u.uRoundness.greaterThan(0.001), () => {
      const volN = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
      const facing = tabs(dot(volN, normalize(vViewDir))).toVar("facing");
      col.mulAssign(mix(float(1).sub(u.uRoundness.mul(0.6)), 1.0, facing));
      col.addAssign(smoothstep(0.65, 1.0, facing).mul(u.uRoundness).mul(0.18));
    });

    // Optional positionable lights — additive and gentle, on top of the base shading.
    If(u.uNumLights.greaterThan(0), () => {
      const n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos))).toVar("lightN");
      const vd = normalize(vViewDir).toVar("lightV");
      If(dot(n, vd).lessThan(0.0), () => {
        n.assign(n.negate());
      });
      Loop({ start: 0, end: MAX_LIGHTS, type: "int" }, ({ i }) => {
        If(float(i).greaterThanEqual(float(u.uNumLights)), () => {
          Break();
        });
        const l = normalize(u.uLightPos.el(i).sub(vWorldPos)).toVar();
        const lc = u.uLightColor.el(i).mul(u.uLightIntensity.el(i)).toVar();
        const diff = max(dot(n, l), 0.0);
        const spec = pow(max(dot(n, normalize(l.add(vd))), 0.0), 28.0);
        col.addAssign(col.mul(diff).mul(lc).mul(0.16).add(lc.mul(spec).mul(0.1)));
      });
    });

    col.mulAssign(clamp(u.uAmbient, 0, 1).add(0.55)); // overall level; default 0.45 => x1.0

    if (flags.depthTint) {
      // Fade far fragments toward a colour so a multi-wave stack gains atmospheric separation.
      col.assign(mix(col, u.uDepthTintColor, clamp(clipZ.mul(6.0), 0, 1).mul(u.uDepthTint)));
    }

    If(u.uTexture.greaterThan(0.001), () => {
      col.mulAssign(float(1).add(grainHash(vUv.mul(850.0)).sub(0.5).mul(u.uTexture).mul(0.25)));
    });

    // Soft ribbon ENDS (fades on vUv.y, the length) + optional viewport-edge fade.
    const ribEdge = flags.edgeFeather
      ? smoothstep(0.0, u.uEdgeFeather, vUv.y).mul(
          float(1).sub(smoothstep(float(1).sub(u.uEdgeFeather), 1.0, vUv.y)),
        )
      : smoothstep(0.0, 0.1, vUv.y).mul(float(1).sub(smoothstep(0.9, 1.0, vUv.y)));
    const alpha = u.uOpacity.mul(ribEdge).toVar("alpha");
    if (pointerFall) {
      alpha.mulAssign(clamp(float(1).sub(u.uPointerThin.mul(pointerFall)), 0, 1)); // local translucency
    }

    If(u.uEdgeFade.greaterThan(0.001), () => {
      const sc = screenUV;
      const vig = smoothstep(0.0, u.uEdgeFade, sc.x)
        .mul(float(1).sub(smoothstep(float(1).sub(u.uEdgeFade), 1.0, sc.x)))
        .mul(smoothstep(0.0, u.uEdgeFade, sc.y))
        .mul(float(1).sub(smoothstep(float(1).sub(u.uEdgeFade), 1.0, sc.y)));
      alpha.mulAssign(vig);
    });

    // Deep "squared" hero colour: square colour AND alpha so the soft ribbon edges keep the crisp
    // feather of the original squared-blend look, but composited (premultiplied) rather than
    // replace-blended, so they no longer punch holes.
    col.assign(clamp(col, vec3(0), vec3(1)));
    const squared = u.uSquared.greaterThan(0.5);
    return vec4(select(squared, col.mul(col), col), select(squared, alpha.mul(alpha), alpha));
  })();
}
