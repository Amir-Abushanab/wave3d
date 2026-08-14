import * as THREE from "three";
import type { ParticlesConfig } from "../config/model";
import { particleFragmentShader, particleVertexShader } from "./shaders";

/**
 * A WAVE's additive particle / dust field: a single {@link THREE.Points} whose every particle is placed
 * and animated ENTIRELY in the vertex shader from `uTime` + baked per-particle attributes, so the field
 * is deterministic — the same `(count, seed, edgeBias, bias)` yields byte-identical buffers, and all
 * motion is a pure function of the scene time `t` (so timeOffset scrub / loopSeconds / paused reproduce).
 *
 * One field belongs to ONE wave (created/disposed alongside it, like {@link WavePalette}). Every particle
 * spawns on that wave's DEFORMED surface / edge (via the shared waveShape chunk, riding the exact deform
 * the ribbon uses) and drifts outward from the wave centre. Byte-identical when off: absent
 * `wave.particles` ⇒ the renderer never creates a field.
 */
export interface ParticleFrame {
  /** The owning wave's world-space centre — drift radiates from here. */
  center: THREE.Vector3;
  /** Screen-right / screen-up unit vectors (world space) for screen-relative motion. */
  right: THREE.Vector3;
  up: THREE.Vector3;
}

/** Deterministic PRNG (mulberry32): a pure function of the seed, so a `(count, seed)` layout
 *  reproduces exactly. NEVER Math.random — that would desync timeOffset scrub / loop / paused. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// sRGB hex → linear RGB. Replicates WaveRenderer.hexToLinearVec3 locally to avoid a circular import
// (the renderer imports this module): three's ColorManagement linearizes on parse, so read .r/.g/.b
// directly — a second convertSRGBToLinear() would double-linearize.
const HEX_SCRATCH = new THREE.Color();
function setLinear(target: THREE.Vector3, hex: string): void {
  const c = HEX_SCRATCH.set(hex);
  target.set(c.r, c.g, c.b);
}

const DEFAULT_COLOR = "#ffcf8a"; // warm gold

/** The owning wave's shape uniforms mirrored onto the particle material so the dust rides the same
 *  deform as the ribbon. Names match the wave material's uniforms 1:1 (copied by value in configure). */
const SHAPE_UNIFORMS = [
  "uDispFreqX",
  "uDispFreqZ",
  "uDispAmount",
  "uDetailFreq",
  "uDetailAmount",
  "uTwFreqX",
  "uTwFreqY",
  "uTwFreqZ",
  "uTwPowX",
  "uTwPowY",
  "uTwPowZ",
  "uHelixTurns",
  "uHelixRadius",
  "uHelixRoll",
  "uHelixPhase",
  "uRadialAmount",
  "uRadialArc",
  "uRadialSpread",
  "uRadialRadius",
  "uRadialCenter",
] as const;

/** Build the seeded per-particle attribute buffers. Pure function of `(count, seed, edgeBias, bias)` —
 *  exported so a unit test can assert reproducibility without a GPU. */
export function buildParticleAttributes(
  count: number,
  seed: number,
  edgeBias = 1,
  bias = 0,
): {
  position: Float32Array;
  aSeed: Float32Array;
  aRnd: Float32Array;
  aUv: Float32Array;
} {
  const rand = mulberry32(seed >>> 0 || 1);
  const position = new Float32Array(count * 3); // dummy — the vertex shader computes real positions
  const aSeed = new Float32Array(count);
  const aRnd = new Float32Array(count * 4);
  const aUv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    aSeed[i] = rand();
    aRnd[i * 4 + 0] = rand();
    aRnd[i * 4 + 1] = rand();
    aRnd[i * 4 + 2] = rand();
    aRnd[i * 4 + 3] = rand();
  }
  // aUv in a SEPARATE pass so adding/changing it never shifts the aSeed/aRnd RNG sequence above. aUv.x
  // = the flank position across the ribbon width; `bias` skews it toward one side (`u^p`, p<1 crowds
  // →1, p>1 crowds →0; p=1 / bias 0 leaves it untouched). aUv.y = WHERE ALONG the ribbon the particle
  // spawns, interpolated by `edgeBias`: 0 → uniform across the whole SURFACE, 1 → crowded to the outer
  // rim/EDGE (`1 − rand²·0.45`, the silk-dissolving-into-glitter look).
  const pexp = bias === 0 ? 1 : Math.exp(-bias * 2);
  const eb = Math.min(Math.max(edgeBias, 0), 1);
  for (let i = 0; i < count; i++) {
    const ux = rand();
    aUv[i * 2 + 0] = bias === 0 ? ux : Math.pow(ux, pexp);
    const e = rand();
    const rim = 1.0 - e * e * 0.45; // outer-rim biased
    aUv[i * 2 + 1] = e + (rim - e) * eb; // mix(surface, edge) by edgeBias
  }
  return { position, aSeed, aRnd, aUv };
}

export class ParticleField {
  readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  /** Layout signature — only these rebuild the seeded buffers; the rest are live uniforms. */
  private sig = "";

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLoopSeconds: { value: 0 },
        uLife: { value: 6 },
        uSize: { value: 2 },
        uSizeJitter: { value: 0 },
        uTwinkle: { value: 0 },
        uPixelRatio: { value: 1 },
        uColor: { value: new THREE.Vector3(1, 0.81, 0.54) },
        uCenter: { value: new THREE.Vector3() },
        uRight: { value: new THREE.Vector3(1, 0, 0) },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uDrift: { value: 0 },
        // The owning wave's shape uniforms + world matrix, mirrored in configure() so the dust rides
        // the same deform as the ribbon. The nested HELIX/RADIAL uniforms are only declared (and
        // uploaded) when the matching #define is set — the byte-identity precedent from the wave material.
        uDispFreqX: { value: 0 },
        uDispFreqZ: { value: 0 },
        uDispAmount: { value: 0 },
        uDetailFreq: { value: 0 },
        uDetailAmount: { value: 0 },
        uTwFreqX: { value: 0 },
        uTwFreqY: { value: 0 },
        uTwFreqZ: { value: 0 },
        uTwPowX: { value: 0 },
        uTwPowY: { value: 0 },
        uTwPowZ: { value: 0 },
        uHelixTurns: { value: 0 },
        uHelixRadius: { value: 0 },
        uHelixRoll: { value: 0 },
        uHelixPhase: { value: 0 },
        uRadialAmount: { value: 0 },
        uRadialArc: { value: 0 },
        uRadialSpread: { value: 0 },
        uRadialRadius: { value: 0 },
        uRadialCenter: { value: 0 },
        uShedModel: { value: new THREE.Matrix4() },
        uShedSpeed: { value: 0 },
        uShedSeed: { value: 0 },
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthTest: false, // always composite OVER the waves...
      depthWrite: false, // ...and never occlude anything (additive glints)
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false; // positions are shader-computed; the base geometry is dummy
    this.points.renderOrder = 10; // after the waves (0..5)
  }

  /** Reconcile to `cfg`: rebuild the seeded buffers if the layout signature changed, then push the
   *  frame-independent uniforms. `loopSeconds` is scene-level (passed in). Called from refresh(). */
  sync(cfg: ParticlesConfig, loopSeconds: number): void {
    const count = Math.max(0, Math.floor(cfg.count));
    const edgeBias = cfg.edgeBias ?? 1;
    const bias = cfg.bias ?? 0;
    const sig = `${count}|${cfg.seed}|${edgeBias}|${bias}`;
    if (sig !== this.sig) {
      this.sig = sig;
      const { position, aSeed, aRnd, aUv } = buildParticleAttributes(
        count,
        cfg.seed,
        edgeBias,
        bias,
      );
      this.geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
      this.geometry.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
      this.geometry.setAttribute("aRnd", new THREE.BufferAttribute(aRnd, 4));
      this.geometry.setAttribute("aUv", new THREE.BufferAttribute(aUv, 2));
      this.geometry.setDrawRange(0, count);
    }
    const u = this.material.uniforms;
    u.uLoopSeconds.value = loopSeconds;
    u.uLife.value = cfg.life ?? 6;
    u.uSize.value = cfg.size;
    u.uSizeJitter.value = cfg.sizeJitter ?? 0;
    u.uTwinkle.value = cfg.twinkle ?? 0;
    u.uDrift.value = cfg.drift ?? 0;
    setLinear(u.uColor.value as THREE.Vector3, cfg.color ?? DEFAULT_COLOR);
  }

  /** Push the per-frame frame basis (the camera can move, so this runs every frame). */
  frame(f: ParticleFrame, pixelRatio: number): void {
    const u = this.material.uniforms;
    (u.uCenter.value as THREE.Vector3).copy(f.center);
    (u.uRight.value as THREE.Vector3).copy(f.right);
    (u.uUp.value as THREE.Vector3).copy(f.up);
    u.uPixelRatio.value = pixelRatio;
  }

  /** Bind the OWNING wave's shape: mirror its shape #defines + shape uniforms + world matrix so the
   *  dust rides the SAME deform as the ribbon. Recompiles the point program only when the define set
   *  changes. Called from refresh() each frame with the wave's live state. */
  configure(shape: {
    defines: Record<string, string>;
    uniforms: Record<string, THREE.IUniform>;
    matrixWorld: THREE.Matrix4;
    speed: number;
    seed: number;
  }): void {
    const want = shape.defines;
    const cur = (this.material.defines ?? {}) as Record<string, string>;
    if (Object.keys(want).sort().join(",") !== Object.keys(cur).sort().join(",")) {
      this.material.defines = { ...want };
      this.material.needsUpdate = true; // define set changed → recompile the point program
    }
    const u = this.material.uniforms;
    for (const name of SHAPE_UNIFORMS) {
      const src = shape.uniforms[name];
      if (!src || u[name] === undefined) continue;
      const dst = u[name].value;
      if (typeof src.value === "number") u[name].value = src.value;
      else if (dst && typeof (dst as { copy?: unknown }).copy === "function") {
        (dst as THREE.Vector3).copy(src.value as THREE.Vector3);
      }
    }
    (u.uShedModel.value as THREE.Matrix4).copy(shape.matrixWorld);
    u.uShedSpeed.value = shape.speed;
    u.uShedSeed.value = shape.seed;
  }

  /** Advance the field to scene time `t` (= the same `t` the waves get). */
  setTime(t: number): void {
    this.material.uniforms.uTime.value = t;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
