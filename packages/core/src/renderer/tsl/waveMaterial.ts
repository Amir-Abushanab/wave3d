/**
 * The wave's `NodeMaterial` — the TSL port of `vertexShader` + `fragmentShader` / `lineFragmentShader`.
 *
 * The GLSL `#ifdef` variants become JS flags, so each material builds exactly the graph it needs
 * instead of relying on a define set and a program cache key.
 *
 * Two deliberate differences from the GLSL, both because the node pipeline already does the work:
 *   - No `PREMULTIPLIED_ALPHA` block. `NodeMaterial.setupOutput()` calls `setupPremultipliedAlpha()`
 *     when `material.premultipliedAlpha` is set, so premultiplying here would double-apply it.
 *   - No output colour-space conversion. The material writes LINEAR, exactly as the GLSL does; the
 *     conversion happens once at the end of the post chain, matching `OutputPass` on the WebGL path.
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
  cross,
  dot,
  normalize,
  Loop,
  If,
  Break,
  select,
} from "three/tsl";
import { MAX_LIGHTS, MAX_NOISE_BANDS } from "../../config/model";
import { simplexNoise, grainHash } from "./noise";
import { waveShape, type WaveShapeFlags } from "./waveShape";
import { applyColorGrade, waveBaseColor, hueShift, parabola, mapLinear } from "./color";
import type { FloatNode, Vec2Node, Vec3Node } from "./types";
import type { WaveTslUniforms } from "./uniforms";

export interface WaveMaterialFlags extends WaveShapeFlags {
  theme: "solid" | "wireframe";
  depthTint: boolean;
  edgeFeather: boolean;
  rungs: boolean;
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
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = true;
  material.side = 2; // THREE.DoubleSide

  // ---- Vertex ----
  material.positionNode = Fn(() => {
    const { t, loopOff } = timeNodes(u, flags);
    return waveShape(u, flags, positionLocal, uv(), t, loopOff).pos;
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
  material.outputNode =
    flags.theme === "wireframe"
      ? buildWireframeFragment(u, flags, clipZ)
      : buildSolidFragment(u, flags, clipZ);

  return material;
}

/** The wireframe thin-line theme: colour carved into fine lengthwise strands, faded by depth. */
function buildWireframeFragment(u: WaveTslUniforms, flags: WaveMaterialFlags, clipZ: FloatNode) {
  return Fn(() => {
    const vUv = uv();
    const color = applyColorGrade(u, waveBaseColor(u, vUv)).toVar("lineColor");

    // Carve into fine lengthwise strands; thickness from the screen-space uv derivative.
    const dy = dFdy(vUv).toVar();
    const lineThickness = u.uLineThickness
      .mul(pow(tabs(dy.x.mul(u.uMaxWidth)), u.uLineDerivativePower))
      .toVar("lineThickness");
    const a = smoothstep(lineThickness, 0.0, tabs(sin(vUv.x.mul(u.uLineAmount)))).toVar("lineA");

    if (flags.rungs) {
      // The same carve at constant uv.y, so this family runs ACROSS the ribbon where the one above
      // runs along it — together they read as a ladder. Width comes from fwidth(), not the
      // lengthwise term's dFdy(vUv).x, which is the derivative of the wrong axis for this direction.
      const rung = tabs(sin(vUv.y.mul(u.uRungAmount)));
      a.assign(
        max(a, smoothstep(u.uRungThickness.mul(u.uRungAmount).mul(fwidth(vUv.y)), 0.0, rung)),
      );
    }

    // Depth fade: the wave recedes into the background colour with depth.
    const depthFade = clamp(clipZ.mul(6.0), 0, 1);
    const faded = mix(u.uClearColor, color, a.mul(float(1).sub(depthFade))).toVar("lineFaded");
    // Deep "squared" look — composited, not replace-blended (see applyBlendMode).
    const out = select(u.uSquared.greaterThan(0.5), faded.mul(faded), faded);
    return vec4(out, u.uOpacity);
  })();
}

/** The solid surface theme. */
function buildSolidFragment(u: WaveTslUniforms, flags: WaveMaterialFlags, clipZ: FloatNode) {
  return Fn(() => {
    const vUv = uv();
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
