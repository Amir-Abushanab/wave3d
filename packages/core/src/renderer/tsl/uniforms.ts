/**
 * The TSL mirror of `WaveRenderer.makeUniforms()`.
 *
 * Every entry keeps the SAME key and the same `.value` write semantics as the GLSL registry, so the
 * ~116 config-sync writes in `refresh()` (`u.uHueShift.value = …`, `u.uColors.value[i].set(…)`) work
 * against either backend without a second code path. That is the whole reason this port is tractable:
 * only the shader graph changes, not the config plumbing around it.
 *
 * Two shapes exist behind that uniform surface:
 *   - scalars and vectors ARE the TSL uniform node — it already exposes a live `.value`.
 *   - arrays are a `{ value, node }` wrapper, because `UniformArrayNode` keeps the source array on
 *     `.array` and uses `.value` for its own padded buffer. The node re-packs from `.array` on every
 *     render (`updateType = RENDER`), so mutating the shared elements in place propagates with no
 *     explicit invalidation — matching how the GLSL path already mutates its Vector3s.
 */
import { Vector2, Vector3, Vector4 } from "three";
import { uniform, uniformArray, texture } from "three/tsl";
import type { Texture } from "three";
import { MAX_COLORS, MAX_LIGHTS, MAX_MESH_POINTS, MAX_NOISE_BANDS } from "../../config/model";
import { RIPPLE_SLOTS } from "../interaction";

/** An array-valued uniform: `value` is the array the renderer mutates, `node` goes in the graph. */
interface ArrayUniform<T> {
  value: T[];
  readonly node: ReturnType<typeof uniformArray>;
}

const arr = <T>(value: T[], type: string): ArrayUniform<T> => ({
  value,
  node: uniformArray(value as never, type),
});

const fill = <T>(n: number, make: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => make(i));

/** Build one wave's uniform registry. Defaults mirror `makeUniforms()` exactly. */
export function makeTslUniforms(drawingBufferSize: Vector2) {
  return {
    // ---- Deformation (vertex) ----
    uTime: uniform(0),
    uSpeed: uniform(0.05),
    uSeed: uniform(0),
    uDispFreqX: uniform(0.003234),
    uDispFreqZ: uniform(0.00799),
    uDispAmount: uniform(6.051),
    uDetailFreq: uniform(0.04),
    uDetailAmount: uniform(0),
    uTwFreqX: uniform(-0.055),
    uTwFreqY: uniform(0.077),
    uTwFreqZ: uniform(-0.518),
    uTwPowX: uniform(3.95),
    uTwPowY: uniform(5.85),
    uTwPowZ: uniform(6.33),
    uLoopSeconds: uniform(0),

    // ---- Colour + light (fragment) ----
    uColors: arr(
      fill(MAX_COLORS, () => new Vector3(1, 1, 1)),
      "vec3",
    ),
    uColorPos: arr(
      fill(MAX_COLORS, (i) => (MAX_COLORS > 1 ? i / (MAX_COLORS - 1) : 0)),
      "float",
    ),
    uColorCount: uniform(2, "int"),
    uGradType: uniform(0, "int"),
    uGradAngle: uniform(0),
    uGradShift: uniform(0.15),
    uMeshPointPos: arr(
      fill(MAX_MESH_POINTS, () => new Vector2(0.5, 0.5)),
      "vec2",
    ),
    uMeshPointColor: arr(
      fill(MAX_MESH_POINTS, () => new Vector3(1, 1, 1)),
      "vec3",
    ),
    uMeshPointInfluence: arr(
      fill(MAX_MESH_POINTS, () => 0.65),
      "float",
    ),
    uMeshPointCount: uniform(0, "int"),
    uMeshSoftness: uniform(0.62),
    uPalette: texture(null as unknown as Texture),
    uUsePalette: uniform(1),
    uPaletteRaw: uniform(1),
    uPaletteScale: uniform(new Vector2(1, 1)),
    uPaletteOffset: uniform(new Vector2(0, 0)),
    uPaletteRotation: uniform(0),
    uDebug: uniform(0),
    uSheen: uniform(1),
    uRoundness: uniform(0.35),
    uIridescence: uniform(0),
    uDepthTint: uniform(0),
    uDepthTintColor: uniform(new Vector3()),
    uHueShift: uniform(0),
    uContrast: uniform(1),
    uSaturation: uniform(1),
    uFiberCount: uniform(90),
    uFiberStrength: uniform(0.25),
    uTexture: uniform(0),
    uCreaseLight: uniform(0.15),
    uCreaseSharpness: uniform(2.0),
    uCreaseSoftness: uniform(1.0),
    uEdgeFade: uniform(0.06),
    uEdgeFeather: uniform(0.1),
    uOpacity: uniform(1),
    uSquared: uniform(1),
    // Seeded from the CURRENT drawing buffer, not (1,1) — see the note in makeUniforms(): the
    // edgeFade vignette divides gl_FragCoord by this, so a stale (1,1) renders the wave invisible.
    uResolution: uniform(drawingBufferSize.clone()),
    uAmbient: uniform(0.45),
    uNumLights: uniform(1, "int"),
    uLightPos: arr(
      fill(MAX_LIGHTS, () => new Vector3()),
      "vec3",
    ),
    uLightColor: arr(
      fill(MAX_LIGHTS, () => new Vector3(1, 1, 1)),
      "vec3",
    ),
    uLightIntensity: arr(
      fill(MAX_LIGHTS, () => 0),
      "float",
    ),
    uNumNoiseBands: uniform(0, "int"),
    uNoiseBandBounds: arr(
      fill(MAX_NOISE_BANDS, () => new Vector4()),
      "vec4",
    ),
    uNoiseBandParams: arr(
      fill(MAX_NOISE_BANDS, () => new Vector4()),
      "vec4",
    ),
    uNoiseBandParaPow: arr(
      fill(MAX_NOISE_BANDS, () => 0),
      "float",
    ),

    // ---- Wireframe thin-line theme ----
    uLineAmount: uniform(425),
    uLineThickness: uniform(1),
    uLineDerivativePower: uniform(0.95),
    uMaxWidth: uniform(1232),
    uClearColor: uniform(new Vector3(1, 1, 1)),

    // ---- Helix / radial / rungs ----
    uHelixTurns: uniform(0),
    uHelixRadius: uniform(0),
    uHelixRoll: uniform(0),
    uHelixPhase: uniform(0),
    uRadialAmount: uniform(0),
    uRadialArc: uniform(160),
    uRadialSpread: uniform(1),
    uRadialRadius: uniform(40),
    uRadialCenter: uniform(0),
    uRungAmount: uniform(0),
    uRungThickness: uniform(1),

    // ---- Interaction / pointer field ----
    uPointer: uniform(new Vector2(0, 0)),
    uPointerActive: uniform(0),
    uPointerRadius: uniform(0.6),
    uPointerAspect: uniform(1),
    uPointerAgitate: uniform(0),
    uPointerPush: uniform(0),
    uPointerWake: uniform(0),
    uPointerVel: uniform(new Vector2(0, 0)),
    uShapeFlow: uniform(0),
    uPointerThin: uniform(0),
    uPointerHue: uniform(0),
    uPointerLighten: uniform(0),
    uPointerRipple: uniform(0),
    uRippleOrigin: arr(
      fill(RIPPLE_SLOTS, () => new Vector2()),
      "vec2",
    ),
    uRippleAge: arr(
      fill(RIPPLE_SLOTS, () => 0),
      "float",
    ),
    uRippleAmp: arr(
      fill(RIPPLE_SLOTS, () => 0),
      "float",
    ),
  };
}

export type WaveTslUniforms = ReturnType<typeof makeTslUniforms>;
