import * as THREE from "three";
import type { ParticlesConfig } from "../config/model";
import { RIPPLE_SLOTS } from "./interactionGates";
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
export function setLinear(target: THREE.Vector3, hex: string): void {
  const c = HEX_SCRATCH.set(hex);
  target.set(c.r, c.g, c.b);
}

export const DEFAULT_COLOR = "#ffcf8a"; // warm gold

/**
 * Edge of the square canvas a {@link ParticlesConfig.spriteUrl} is rasterized into. SVG has no
 * intrinsic pixel size, so something has to choose one — this is it.
 *
 * 256² RGBA is ~256 KB (~350 KB with mipmaps), which is LESS than the per-particle attribute
 * buffers a 20k field already uploads (~800 KB): one texture serves every particle in the field, so
 * sprite artwork is not what makes a dust field expensive. 256 also covers the largest sprite the
 * hardware will draw — gl.ALIASED_POINT_SIZE_RANGE tops out around 511 px, and `size` clamps to 200
 * before the pixel-ratio multiply.
 */
const SPRITE_PX = 256;

/** Sprite-shape name → the int the fragment shader branches on (see particleFragmentShader). */
export const SHAPE_INDEX: Record<string, number> = {
  glitter: 0,
  soft: 1,
  ring: 2,
  star: 3,
  streak: 4,
};

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

/** The owning wave's POINTER-FIELD uniforms, mirrored the same way so the dust reads the exact
 *  cursor state the ribbon does (see pointerFieldChunk). Only uploaded under POINTER_FX — configure()
 *  copies them regardless, which is a handful of scalars. The ripple entries are ARRAYS: those are
 *  shared by reference (the wave owns them and applyPointerField mutates them in place), so a click
 *  costs no per-frame copy. Mirroring rather than a second CPU write also keeps capture determinism
 *  for free — applyInteractionRest zeroes the wave's uPointerActive / uRippleAmp, and the dust
 *  inherits that rest state on the same frame (updateSceneFx runs after applyInteraction). */
const POINTER_UNIFORMS = [
  "uPointer",
  "uPointerActive",
  "uPointerRadius",
  "uPointerAspect",
  "uPointerAgitate",
  "uPointerPush",
  "uPointerWake",
  "uPointerVel",
  "uShapeFlow",
  "uRippleOrigin",
  "uRippleAge",
  "uRippleAmp",
  "uPointerRipple",
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

/**
 * Rasterize `url` into a square {@link SPRITE_PX} texture.
 *
 * Deliberately the BACKGROUND-image pattern (load -> apply -> ask for a redraw) rather than a
 * fire-and-forget TextureLoader: a thumbnail or poster snapshotted while the texture was still in
 * flight would capture blank dust — the same class of bug that made image-driven preset thumbnails
 * render empty.
 *
 * Shared by both backends' particle fields, so the CORS rule, the letterboxing and the mipmap
 * settings have one home.
 */
export function loadSpriteTexture(
  url: string,
  onLoaded: (tex: THREE.CanvasTexture) => void,
  onFailed: () => void,
): void {
  const img = new Image();
  img.decoding = "async";
  // data:/blob: are same-origin already; anything else must be CORS-clean or the canvas taints
  // and readback (thumbnails, posters, captureImage) throws.
  if (!url.startsWith("data:") && !url.startsWith("blob:")) img.crossOrigin = "anonymous";
  img.addEventListener(
    "load",
    () => {
      const canvas = document.createElement("canvas");
      canvas.width = SPRITE_PX;
      canvas.height = SPRITE_PX;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // CONTAIN the artwork: a point sprite is always square, so non-square art has to be
      // letterboxed or it draws stretched. An SVG with no intrinsic size reports 0 in some
      // browsers — fall back to filling the square.
      const iw = img.naturalWidth || SPRITE_PX;
      const ih = img.naturalHeight || SPRITE_PX;
      const fit = Math.min(SPRITE_PX / iw, SPRITE_PX / ih);
      const w = iw * fit;
      const h = ih * fit;
      ctx.drawImage(img, (SPRITE_PX - w) / 2, (SPRITE_PX - h) / 2, w, h);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      // Mipmaps matter here in a way they do not for the palette: `sizeJitter` and the birth/death
      // fade draw the SAME texture at wildly different pixel sizes.
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      onLoaded(tex);
    },
    { once: true },
  );
  img.addEventListener("error", onFailed, { once: true });
  img.src = url;
}

export class ParticleField {
  readonly points: THREE.Points;
  /** The scene node, named the same on both backends (the TSL field is a Sprite, not Points). */
  get object(): THREE.Object3D {
    return this.points;
  }

  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  /** Layout signature — only these rebuild the seeded buffers; the rest are live uniforms. */
  private sig = "";
  /** Rasterized user artwork for shape "sprite", and the url it came from (so a repeat sync is a
   *  no-op). `spriteFailedUrl` latches a broken image so a bad url is not retried every frame. */
  private sprite?: THREE.CanvasTexture;
  private spriteUrl = "";
  private spriteFailedUrl = "";
  private disposed = false;
  /** Defines this field owns (currently just PARTICLE_SPRITE), merged over the wave's in configure().
   *  Set only once a texture is actually bound, so the sampler never compiles without one. */
  private ownDefines: Record<string, string> = {};
  /** Called when a sprite finishes rasterizing, so a paused/settled renderer redraws with it. */
  private readonly onReady?: () => void;

  constructor(onReady?: () => void) {
    this.onReady = onReady;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLoopSeconds: { value: 0 },
        uLife: { value: 6 },
        uPartSpeed: { value: 1 },
        uSize: { value: 2 },
        uSizeJitter: { value: 0 },
        uTwinkle: { value: 0 },
        uPixelRatio: { value: 1 },
        uColor: { value: new THREE.Vector3(1, 0.81, 0.54) },
        uColor2: { value: new THREE.Vector3(1, 0.81, 0.54) },
        uCenter: { value: new THREE.Vector3() },
        uRight: { value: new THREE.Vector3(1, 0, 0) },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uDrift: { value: 0 },
        uRise: { value: 0 },
        uSwirl: { value: 0 },
        uWander: { value: 0 },
        uShape: { value: 0 },
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
        // Pointer field, mirrored from the owning wave in configure() (read only under POINTER_FX).
        // The ripple arrays are sized to RIPPLE_SLOTS so the material is valid before the first
        // configure(); configure() then swaps in the wave's own arrays by reference.
        uPointer: { value: new THREE.Vector2() },
        uPointerActive: { value: 0 },
        uPointerRadius: { value: 0.6 },
        uPointerAspect: { value: 1 },
        uPointerAgitate: { value: 0 },
        uPointerPush: { value: 0 },
        uPointerWake: { value: 0 },
        uPointerVel: { value: new THREE.Vector2() },
        uShapeFlow: { value: 0 },
        uRippleOrigin: { value: Array.from({ length: RIPPLE_SLOTS }, () => new THREE.Vector2()) },
        uRippleAge: { value: Array.from({ length: RIPPLE_SLOTS }, () => 0) },
        uRippleAmp: { value: Array.from({ length: RIPPLE_SLOTS }, () => 0) },
        uPointerRipple: { value: 0 },
        uPartShove: { value: 1 },
        // User artwork (read only under PARTICLE_SPRITE, which is set only once this is non-null).
        uSprite: { value: null as THREE.Texture | null },
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
    this.syncSprite(cfg.shape === "sprite" ? (cfg.spriteUrl ?? "") : "");
    setLinear(u.uColor.value as THREE.Vector3, cfg.color ?? DEFAULT_COLOR);
    setLinear(u.uColor2.value as THREE.Vector3, cfg.color2 ?? cfg.color ?? DEFAULT_COLOR);
  }

  /** Push the per-frame frame basis (the camera can move, so this runs every frame). */
  frame(f: ParticleFrame, pixelRatio: number): void {
    const u = this.material.uniforms;
    (u.uCenter.value as THREE.Vector3).copy(f.center);
    (u.uRight.value as THREE.Vector3).copy(f.right);
    (u.uUp.value as THREE.Vector3).copy(f.up);
    u.uPixelRatio.value = pixelRatio;
  }

  /** Bind the OWNING wave's shape AND cursor state: mirror its #defines + shape uniforms + pointer
   *  uniforms + world matrix, so the dust rides the same deform as the ribbon and reacts to the same
   *  pointer field. Recompiles the point program only when the define set changes — which is why the
   *  defines must come from CONFIG only (shapeDefines), never from live input. Called from refresh()
   *  each frame with the wave's live state. */
  configure(shape: {
    defines: Record<string, string>;
    uniforms: Record<string, THREE.IUniform>;
    matrixWorld: THREE.Matrix4;
    speed: number;
    seed: number;
  }): void {
    const want = { ...shape.defines, ...this.ownDefines };
    const cur = (this.material.defines ?? {}) as Record<string, string>;
    if (Object.keys(want).sort().join(",") !== Object.keys(cur).sort().join(",")) {
      this.material.defines = { ...want };
      this.material.needsUpdate = true; // define set changed → recompile the point program
    }
    const u = this.material.uniforms;
    for (const name of SHAPE_UNIFORMS) this.mirror(shape.uniforms, name);
    for (const name of POINTER_UNIFORMS) this.mirror(shape.uniforms, name);
    (u.uShedModel.value as THREE.Matrix4).copy(shape.matrixWorld);
    u.uShedSpeed.value = shape.speed;
    u.uShedSeed.value = shape.seed;
  }

  /** Reconcile the sprite texture to `url` ("" = none). Cheap and idempotent: a repeat call with the
   *  same url does nothing, and a url that already failed is never retried. */
  private syncSprite(url: string): void {
    if (url === this.spriteUrl) return;
    this.spriteUrl = url;
    this.clearSprite();
    if (url && url !== this.spriteFailedUrl) this.loadSprite(url);
  }

  /** Drop the current sprite and fall back to the procedural shapes (which is what `uShape` still
   *  holds, so a field mid-load or with a broken image draws "glitter" rather than nothing). */
  private clearSprite(): void {
    if (!this.sprite) return;
    this.sprite.dispose();
    this.sprite = undefined;
    this.material.uniforms.uSprite.value = null;
    if (this.ownDefines.PARTICLE_SPRITE !== undefined) {
      this.ownDefines = {};
      this.material.needsUpdate = true; // configure() will also notice, but a paused field may not tick
    }
  }

  /**
   * Rasterize `url` into a square {@link SPRITE_PX} texture and bind it.
   *
   * Deliberately the BACKGROUND-image pattern (load → apply → ask for a redraw) rather than
   * loadPaletteImage's fire-and-forget TextureLoader: a thumbnail or poster snapshotted while the
   * texture was still in flight would capture blank dust — the same class of bug that made
   * image-driven preset thumbnails render empty.
   */
  private loadSprite(url: string): void {
    loadSpriteTexture(
      url,
      (tex) => {
        // The config may have moved on (or the field been disposed) while this was decoding.
        if (this.disposed || this.spriteUrl !== url) return;
        this.sprite = tex;
        this.material.uniforms.uSprite.value = tex;
        this.ownDefines = { PARTICLE_SPRITE: "" };
        this.material.needsUpdate = true; // sampler appears -> recompile the point program
        this.onReady?.(); // a paused / settled renderer would otherwise never draw it
      },
      () => {
        // Latch the failure so a broken url is not re-requested on every sync.
        this.spriteFailedUrl = url;
      },
    );
  }

  /** Copy one uniform across from the owning wave: numbers by value, vectors/matrices in place, and
   *  arrays (the ripple slots) by reference — the wave owns those and mutates them in place. */
  private mirror(src: Record<string, THREE.IUniform>, name: string): void {
    const from = src[name];
    const to = this.material.uniforms[name];
    if (!from || !to) return;
    const dst = to.value;
    if (typeof from.value === "number" || Array.isArray(from.value)) to.value = from.value;
    else if (dst && typeof (dst as { copy?: unknown }).copy === "function") {
      (dst as THREE.Vector3).copy(from.value as THREE.Vector3);
    }
  }

  /** Advance the field to scene time `t` (= the same `t` the waves get). */
  setTime(t: number): void {
    this.material.uniforms.uTime.value = t;
  }

  dispose(): void {
    this.disposed = true;
    this.sprite?.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
