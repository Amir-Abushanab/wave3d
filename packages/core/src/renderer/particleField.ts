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
 * Two emitter modes for now (a third, shed-from-edge, arrives with the shared deform chunk):
 *   0 — RING: an annulus around the eclipse anchor (the reference's rim spray).
 *   1 — FIELD: ambient dust scattered across the frame.
 * Both are placed in the screen plane via the camera basis pushed each frame in {@link frame}.
 */
export interface ParticleFrame {
  /** Composition centre (the field centre), world space. */
  center: THREE.Vector3;
  /** Ring anchor (the eclipse centre, or the composition centre when no eclipse), world space. */
  eclipseCenter: THREE.Vector3;
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

/** Build the seeded per-particle attribute buffers. Pure function of `(count, seed, ringWeight,
 *  fieldWeight)` — exported so a unit test can assert reproducibility without a GPU. */
export function buildParticleAttributes(
  count: number,
  seed: number,
  ringWeight: number,
  fieldWeight: number,
): { position: Float32Array; aSeed: Float32Array; aRnd: Float32Array; aEmitter: Float32Array } {
  const rand = mulberry32(seed >>> 0 || 1);
  const position = new Float32Array(count * 3); // dummy — the vertex shader computes real positions
  const aSeed = new Float32Array(count);
  const aRnd = new Float32Array(count * 4);
  const aEmitter = new Float32Array(count);
  const total = ringWeight + fieldWeight;
  // Route the first `ringCount` particles to the ring, the rest to the ambient field. With no ring
  // weight at all (total 0) everything falls to the field — a bare `{ count }` block is dust.
  const ringCount = total > 0 ? Math.round((count * ringWeight) / total) : 0;
  for (let i = 0; i < count; i++) {
    aSeed[i] = rand();
    aRnd[i * 4 + 0] = rand();
    aRnd[i * 4 + 1] = rand();
    aRnd[i * 4 + 2] = rand();
    aRnd[i * 4 + 3] = rand();
    aEmitter[i] = i < ringCount ? 0 : 1;
  }
  return { position, aSeed, aRnd, aEmitter };
}

export class ParticleField {
  readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  /** Layout signature — only (count, seed, emitter mix) trigger an attribute rebuild; the rest are
   *  live uniforms. */
  private sig = "";
  private cfg?: ParticlesConfig;

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
        uEclipseCenter: { value: new THREE.Vector3() },
        uRight: { value: new THREE.Vector3(1, 0, 0) },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uHalfW: { value: 1 },
        uHalfH: { value: 1 },
        uRingRadius: { value: 0 },
        uRingWidth: { value: 0 },
        uRingSpin: { value: 0 },
        uFieldDrift: { value: 0 },
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
    this.cfg = cfg;
    const count = Math.max(0, Math.floor(cfg.count));
    const ringW = Math.max(0, cfg.ring?.density ?? 0);
    const fieldW = Math.max(0, cfg.field?.density ?? 0);
    const sig = `${count}|${cfg.seed}|${ringW}|${fieldW}`;
    if (sig !== this.sig) {
      this.sig = sig;
      const { position, aSeed, aRnd, aEmitter } = buildParticleAttributes(
        count,
        cfg.seed,
        ringW,
        fieldW,
      );
      this.geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
      this.geometry.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
      this.geometry.setAttribute("aRnd", new THREE.BufferAttribute(aRnd, 4));
      this.geometry.setAttribute("aEmitter", new THREE.BufferAttribute(aEmitter, 1));
      this.geometry.setDrawRange(0, count);
    }
    const u = this.material.uniforms;
    u.uLoopSeconds.value = loopSeconds;
    u.uLife.value = cfg.life ?? 6;
    u.uSize.value = cfg.size;
    u.uSizeJitter.value = cfg.sizeJitter ?? 0;
    u.uTwinkle.value = cfg.twinkle ?? 0;
    u.uRingSpin.value = cfg.ring?.spin ?? 0;
    u.uFieldDrift.value = cfg.field?.drift ?? 0;
    setLinear(u.uColor.value as THREE.Vector3, cfg.color ?? DEFAULT_COLOR);
  }

  /** Push the per-frame frame basis (the camera can move, so this runs every frame). The ring
   *  radius/width are authored as a fraction of the frame HEIGHT, converted to world units here. */
  frame(f: ParticleFrame, pixelRatio: number): void {
    const u = this.material.uniforms;
    (u.uCenter.value as THREE.Vector3).copy(f.center);
    (u.uEclipseCenter.value as THREE.Vector3).copy(f.eclipseCenter);
    (u.uRight.value as THREE.Vector3).copy(f.right);
    (u.uUp.value as THREE.Vector3).copy(f.up);
    u.uHalfW.value = f.halfW;
    u.uHalfH.value = f.halfH;
    u.uPixelRatio.value = pixelRatio;
    const frameH = f.halfH * 2;
    u.uRingRadius.value = (this.cfg?.ring?.radius ?? 0) * frameH;
    u.uRingWidth.value = (this.cfg?.ring?.width ?? 0) * frameH;
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
