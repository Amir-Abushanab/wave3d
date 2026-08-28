/**
 * The particle field on the TSL backend.
 *
 * Same public surface as {@link ParticleField} — `object`, `sync`, `frame`, `configure`, `dispose`
 * — and the same seeded buffers, so a field is byte-identical between backends before it ever
 * reaches a shader. Two things differ, both forced by WebGPU:
 *
 *   - The field is a `THREE.Sprite` with `count`, not a `THREE.Points`. WebGPU point primitives are
 *     fixed at one pixel, so `gl_PointSize` has no equivalent; three's PointsNodeMaterial honours a
 *     size only on a Sprite, drawing instanced quads.
 *   - There is no uniform MIRRORING. The GLSL field copies the owning wave's shape and pointer
 *     uniforms across to its own material every frame; here the graph reads the wave's registry
 *     directly, so the dust and the ribbon are literally driven by the same nodes.
 */
import * as THREE from "three";
import type { PointsNodeMaterial } from "three/webgpu";
import type { ParticlesConfig } from "../config/model";
import {
  buildParticleAttributes,
  loadSpriteTexture,
  setLinear,
  DEFAULT_COLOR,
  SHAPE_INDEX,
  type ParticleFrame,
} from "./particleField";
import { makeParticleUniforms, type ParticleTslUniforms } from "./tsl/particleUniforms";
import {
  buildParticleMaterial,
  type ParticleMaterialFlags,
  type ParticleAttributeArrays,
} from "./tsl/particleMaterial";
import type { WaveTslUniforms } from "./tsl/uniforms";

/** What the owning wave contributes: its uniform registry and the shape variant its graph uses. */
export interface ParticleHost {
  uniforms: WaveTslUniforms;
  flags: Omit<ParticleMaterialFlags, "sprite">;
}

export class ParticleFieldGPU {
  /** The scene object. A Sprite, not Points — see the class note. */
  readonly object = new THREE.Sprite();
  private readonly uniforms: ParticleTslUniforms = makeParticleUniforms();
  private material?: PointsNodeMaterial;
  /** Layout signature — only these rebuild the seeded buffers; the rest are live uniforms. */
  private sig = "";
  private attrs?: ParticleAttributeArrays;
  private count = 0;
  private sprite?: THREE.CanvasTexture;
  private spriteUrl = "";
  private spriteFailedUrl = "";
  private disposed = false;
  /** The variant the current material was built for; a change rebuilds the graph. */
  private variant = "";

  constructor(
    private readonly host: ParticleHost,
    private readonly onReady?: () => void,
  ) {
    this.object.frustumCulled = false; // positions are shader-computed; the quad is a dummy
    this.object.renderOrder = 10; // after the waves (0..5)
    this.object.count = 0;
    // The sprite's own transform must stay identity: the emitter computes WORLD positions, exactly
    // as the GLSL does, and PointsNodeMaterial feeds positionNode through modelViewMatrix.
    this.object.matrixAutoUpdate = false;
  }

  /** Reconcile to `cfg`, rebuilding the seeded buffers only when the layout signature changed. */
  sync(cfg: ParticlesConfig, loopSeconds: number): void {
    const count = Math.max(0, Math.floor(cfg.count));
    const edgeBias = cfg.edgeBias ?? 1;
    const bias = cfg.bias ?? 0;
    const sig = `${count}|${cfg.seed}|${edgeBias}|${bias}`;
    if (sig !== this.sig) {
      this.sig = sig;
      const { aSeed, aRnd, aUv } = buildParticleAttributes(count, cfg.seed, edgeBias, bias);
      this.attrs = { aSeed, aRnd, aUv };
      this.count = count;
      this.object.count = count;
      this.variant = ""; // the attribute nodes are baked into the graph, so it has to be rebuilt
    }

    const u = this.uniforms;
    u.uLoopSeconds.value = loopSeconds;
    u.uLife.value = cfg.life ?? 6;
    u.uPartSpeed.value = cfg.speed ?? 1;
    u.uSize.value = cfg.size;
    u.uSizeJitter.value = cfg.sizeJitter ?? 0;
    u.uTwinkle.value = cfg.twinkle ?? 0;
    u.uDrift.value = cfg.drift ?? 0;
    u.uRise.value = cfg.rise ?? 0;
    u.uSwirl.value = cfg.swirl ?? 0;
    u.uWander.value = cfg.wander ?? 0;
    u.uShape.value = SHAPE_INDEX[cfg.shape ?? "glitter"] ?? 0;
    u.uPartShove.value = cfg.pointerShove ?? 1;
    setLinear(u.uColor.value, cfg.color ?? DEFAULT_COLOR);
    setLinear(u.uColor2.value, cfg.color2 ?? cfg.color ?? DEFAULT_COLOR);
    this.syncSprite(cfg.shape === "sprite" ? (cfg.spriteUrl ?? "") : "");
    this.ensureMaterial();
  }

  /** Push the per-frame frame basis (the camera can move, so this runs every frame). */
  frame(f: ParticleFrame, _pixelRatio: number): void {
    // _pixelRatio is deliberately unused: three's PointsNodeMaterial multiplies sizeNode by the
    // device pixel ratio itself, so applying it here too would square the scaling.
    this.uniforms.uCenter.value.copy(f.center);
    this.uniforms.uRight.value.copy(f.right);
    this.uniforms.uUp.value.copy(f.up);
  }

  /** Bind the owning wave's world matrix and shed cadence. The shape and pointer uniforms need no
   *  mirroring on this backend — the graph reads the wave's registry directly. */
  configure(shape: {
    /** Present for signature parity with the GLSL field; unused here — see the class note. */
    defines?: Record<string, string>;
    /** Ditto: this backend reads the wave's registry directly rather than copying from it. */
    uniforms?: Record<string, { value: unknown }>;
    matrixWorld: THREE.Matrix4;
    speed: number;
    seed: number;
  }): void {
    this.uniforms.uShedModel.value.copy(shape.matrixWorld);
    this.uniforms.uShedSpeed.value = shape.speed;
    this.uniforms.uShedSeed.value = shape.seed;
    this.ensureMaterial();
  }

  /** Build (or rebuild) the node graph when the variant it was compiled for no longer applies. */
  private ensureMaterial(): void {
    if (!this.attrs || this.count === 0) return;
    const flags: ParticleMaterialFlags = { ...this.host.flags, sprite: !!this.sprite };
    const key = `${this.sig}|${JSON.stringify(flags)}`;
    if (key === this.variant) return;
    this.variant = key;
    this.material?.dispose();
    this.material = buildParticleMaterial(
      this.host.uniforms,
      this.uniforms,
      this.attrs,
      flags,
      this.sprite ?? null,
    );
    this.object.material = this.material as unknown as THREE.SpriteMaterial;
  }

  private syncSprite(url: string): void {
    if (url === this.spriteUrl) return;
    this.spriteUrl = url;
    if (this.sprite) {
      this.sprite.dispose();
      this.sprite = undefined;
      this.variant = ""; // the sampler disappears from the graph
    }
    if (!url || url === this.spriteFailedUrl) return;
    loadSpriteTexture(
      url,
      (tex) => {
        if (this.disposed || this.spriteUrl !== url) return;
        this.sprite = tex;
        this.variant = ""; // the sampler appears in the graph
        this.ensureMaterial();
        this.onReady?.(); // a paused / settled renderer would otherwise never draw it
      },
      () => {
        this.spriteFailedUrl = url;
      },
    );
  }

  setTime(t: number): void {
    this.uniforms.uTime.value = t;
  }

  dispose(): void {
    this.disposed = true;
    this.material?.dispose();
    this.sprite?.dispose();
    this.object.geometry.dispose();
  }
}
