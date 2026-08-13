import * as THREE from "three";
import type { ParticlesConfig } from "../config/model";
import { particleFragmentShader, particleVertexShader } from "./shaders";

/**
 * The additive particle / dust field: a single {@link THREE.Points} whose every particle is placed
 * and animated ENTIRELY in the vertex shader from `uTime` + baked per-particle attributes, so the
 * field is deterministic — the same `(count, seed)` yields byte-identical buffers, and all motion is
 * a pure function of the scene time `t` (so timeOffset scrub / loopSeconds / paused reproduce).
 *
 * Ownership mirrors the lazy post passes on {@link WaveRenderer}: the renderer creates this when
 * `config.particles.count > 0` and disposes it when the block returns to absent/0, so "off" adds no
 * scene node and is byte-identical.
 *
 * Two emitter modes:
 *   0 — FIELD: ambient dust scattered across the frame (screen plane, via the camera basis in {@link frame}).
 *   1 — SHED: particles peeling off the emitter wave's DEFORMED edge (via the shared waveShape chunk).
 */
export interface ParticleFrame {
  /** Composition centre (the field centre), world space. */
  center: THREE.Vector3;
  /** Screen-right, world-space unit vector. */
  right: THREE.Vector3;
  /** Screen-up, world-space unit vector. */
  up: THREE.Vector3;
  /** Half the frame width / height, world units. */
  halfW: number;
  halfH: number;
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

/** Emitter-wave shape uniforms mirrored onto the particle material for the SHED emitter, so the dust
 *  rides the same deform as the ribbon. Names match the wave material's uniforms 1:1 (copied by value
 *  each refresh in configureShed). */
const SHED_SHAPE_UNIFORMS = [
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

/** Build the seeded per-particle attribute buffers. Pure function of `(count, seed, fieldWeight,
 *  shedWeight, shedBias)` — exported so a unit test can assert reproducibility without a GPU. */
export function buildParticleAttributes(
  count: number,
  seed: number,
  fieldWeight: number,
  shedWeight = 0,
  shedBias = 0,
): {
  position: Float32Array;
  aSeed: Float32Array;
  aRnd: Float32Array;
  aEmitter: Float32Array;
  aUv: Float32Array;
} {
  const rand = mulberry32(seed >>> 0 || 1);
  const position = new Float32Array(count * 3); // dummy — the vertex shader computes real positions
  const aSeed = new Float32Array(count);
  const aRnd = new Float32Array(count * 4);
  const aEmitter = new Float32Array(count);
  const aUv = new Float32Array(count * 2);
  // Route by weight: [0,field) → ambient field, the rest → shed. With no weights at all (total 0)
  // everything falls to the field — a bare `{ count }` block is dust.
  const total = fieldWeight + shedWeight;
  const fieldCount = total > 0 ? Math.round((count * fieldWeight) / total) : count;
  for (let i = 0; i < count; i++) {
    aSeed[i] = rand();
    aRnd[i * 4 + 0] = rand();
    aRnd[i * 4 + 1] = rand();
    aRnd[i * 4 + 2] = rand();
    aRnd[i * 4 + 3] = rand();
    aEmitter[i] = i < fieldCount ? 0 : 1;
  }
  // Shed uv in a SEPARATE pass so adding it doesn't shift the ring/field RNG sequence — the existing
  // ring/field layouts stay byte-identical. Ride a ribbon uv biased toward the OUTER half (the plume's
  // tips / edge, where the silk dissolves into glitter). `shedBias` skews the width draw toward one
  // flank so the spray can cluster off a single side (the reference's one-sided glitter) instead of
  // haloing the whole rim: `u^p` with p<1 (bias>0) crowds uv.x→1, p>1 (bias<0) crowds uv.x→0; p=1
  // (bias 0) leaves the draw untouched → byte-identical.
  const p = shedBias === 0 ? 1 : Math.exp(-shedBias * 2);
  for (let i = 0; i < count; i++) {
    const ux = rand();
    aUv[i * 2 + 0] = shedBias === 0 ? ux : Math.pow(ux, p);
    // Concentrate toward the tip (uv.y → 1, the plume's outer rim where silk meets black), with a
    // tail inward — rand()² biases most particles to the very edge so the shed reads against the void.
    const e = rand();
    aUv[i * 2 + 1] = 1.0 - e * e * 0.45;
  }
  return { position, aSeed, aRnd, aEmitter, aUv };
}

export class ParticleField {
  readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  /** Layout signature — only (count, seed, emitter mix) trigger an attribute rebuild; the rest are
   *  live uniforms. */
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
        uHalfW: { value: 1 },
        uHalfH: { value: 1 },
        uFieldDrift: { value: 0 },
        // Shed emitter (read only under SHED): the emitter wave's shape uniforms + world matrix,
        // mirrored from that wave in configureShed(). Always present JS-side; three uploads them only
        // when the compiled program declares them (the byte-identity precedent from the wave material).
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
        uShedDrift: { value: 0 },
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthTest: false, // always composite OVER the eclipse disc + waves...
      depthWrite: false, // ...and never occlude anything (additive glints)
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false; // positions are shader-computed; the base geometry is dummy
    this.points.renderOrder = 10; // after the waves (0..5) and the eclipse disc
  }

  /** Reconcile to `cfg`: rebuild the seeded buffers if the layout signature changed, then push the
   *  frame-independent uniforms. `loopSeconds` is scene-level (passed in). Called from refresh(). */
  sync(cfg: ParticlesConfig, loopSeconds: number): void {
    const count = Math.max(0, Math.floor(cfg.count));
    const fieldW = Math.max(0, cfg.field?.density ?? 0);
    const shedW = Math.max(0, cfg.shed?.rate ?? 0);
    const shedBias = cfg.shed?.bias ?? 0;
    const sig = `${count}|${cfg.seed}|${fieldW}|${shedW}|${shedBias}`;
    if (sig !== this.sig) {
      this.sig = sig;
      const { position, aSeed, aRnd, aEmitter, aUv } = buildParticleAttributes(
        count,
        cfg.seed,
        fieldW,
        shedW,
        shedBias,
      );
      this.geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
      this.geometry.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
      this.geometry.setAttribute("aRnd", new THREE.BufferAttribute(aRnd, 4));
      this.geometry.setAttribute("aEmitter", new THREE.BufferAttribute(aEmitter, 1));
      this.geometry.setAttribute("aUv", new THREE.BufferAttribute(aUv, 2));
      this.geometry.setDrawRange(0, count);
    }
    const u = this.material.uniforms;
    u.uLoopSeconds.value = loopSeconds;
    u.uLife.value = cfg.life ?? 6;
    u.uSize.value = cfg.size;
    u.uSizeJitter.value = cfg.sizeJitter ?? 0;
    u.uTwinkle.value = cfg.twinkle ?? 0;
    u.uFieldDrift.value = cfg.field?.drift ?? 0;
    setLinear(u.uColor.value as THREE.Vector3, cfg.color ?? DEFAULT_COLOR);
  }

  /** Push the per-frame frame basis (the camera can move, so this runs every frame). */
  frame(f: ParticleFrame, pixelRatio: number): void {
    const u = this.material.uniforms;
    (u.uCenter.value as THREE.Vector3).copy(f.center);
    (u.uRight.value as THREE.Vector3).copy(f.right);
    (u.uUp.value as THREE.Vector3).copy(f.up);
    u.uHalfW.value = f.halfW;
    u.uHalfH.value = f.halfH;
    u.uPixelRatio.value = pixelRatio;
  }

  /** Wire (or clear) the SHED emitter. `shape` null → shed off: clear the SHED define (lean
   *  recompile). Present → mirror the emitter wave's shape #defines + uniforms + world matrix so the
   *  dust rides the SAME deform as the ribbon. Called from refresh(); recompiles the point program
   *  only when the define set changes. */
  configureShed(
    shape: {
      defines: Record<string, string>;
      uniforms: Record<string, THREE.IUniform>;
      matrixWorld: THREE.Matrix4;
      speed: number;
      seed: number;
      drift: number;
      loopSeconds: number;
    } | null,
  ): void {
    const want = shape ? { SHED: "", ...shape.defines } : {};
    const cur = (this.material.defines ?? {}) as Record<string, string>;
    if (Object.keys(want).sort().join(",") !== Object.keys(cur).sort().join(",")) {
      this.material.defines = want;
      this.material.needsUpdate = true; // define set changed → recompile the point program
    }
    if (!shape) return;
    const u = this.material.uniforms;
    for (const name of SHED_SHAPE_UNIFORMS) {
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
    u.uShedDrift.value = shape.drift;
    u.uLoopSeconds.value = shape.loopSeconds;
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
