/**
 * The WebGPU / TSL backend.
 *
 * Subclasses {@link WaveRenderer} and overrides only the four things that are actually
 * backend-specific — the three renderer, the wave material, how a shader variant is re-selected,
 * and the post chain. Everything else (config sync, camera, background, resize, interaction,
 * capture, particles) is shared, because both backends expose the same `uniforms` surface.
 *
 * `WebGPURenderer` falls back to a WebGL2 backend on its own when WebGPU is unavailable, so this
 * class is not "the WebGPU-only path" — it is the TSL path, which runs on either backend. What it
 * must not do is get imported from the package entry: `three/webgpu` pulls the whole node system
 * (~200 KB gzipped), so this module is only ever reached through a dynamic import.
 */
import * as THREE from "three";
import { WebGPURenderer, RenderPipeline, WebGPUCoordinateSystem } from "three/webgpu";
import { pass, texture, screenUV } from "three/tsl";
import type { WaveConfig } from "../config/model";
import { WaveRenderer, type WaveMaterial } from "./WaveRenderer";
import { makeTslUniforms, type WaveTslUniforms } from "./tsl/uniforms";
import { buildWaveMaterial, type WaveMaterialFlags } from "./tsl/waveMaterial";
import { buildPostChain, type PostChainUniforms, type PostFlags } from "./tsl/postChain";
import { floatUniform, vec2Uniform } from "./tsl/types";

/** The flag set that decides a wave's node graph — the TSL twin of `waveDefines()`. */
function variantKey(f: WaveMaterialFlags): string {
  return [
    f.theme,
    f.loopMotion && "loop",
    f.detailOctave && "detail",
    f.helix && "helix",
    f.twistMotion && "twist",
    f.radial && "radial",
    f.depthTint && "depthTint",
    f.edgeFeather && "edgeFeather",
    f.rungs && "rungs",
    f.webgpuClipZ && "gpuz",
  ]
    .filter(Boolean)
    .join(",");
}

type TslMaterial = WaveMaterial & { userData: { variant: string; tsl: WaveTslUniforms } };

export class WaveRendererGPU extends WaveRenderer {
  declare readonly renderer: THREE.WebGLRenderer & WebGPURenderer;
  private post?: RenderPipeline;
  /**
   * Lazily built, NOT a field initialiser. Subclass field initialisers run only after `super()`
   * returns, and the base constructor already renders (buildWaves → resize → renderOnce), so a
   * field here would still be `undefined` at first draw.
   */
  private postUniformsCache?: PostChainUniforms;
  /** The effect set the current chain was built for; a change rebuilds it, as the WebGL path
   *  inserts and removes passes. */
  private postFlagsKey = "";

  protected override createRenderer(): THREE.WebGLRenderer {
    // Called from the BASE constructor, which is the only hook that runs early enough to stop the
    // first render: `ready` cannot be cleared from this subclass's constructor body or a field
    // initialiser, since both run after super() has already drawn a frame.
    this.ready = false;
    // No preserveDrawingBuffer: WebGPU has no such option and does not need one — the canvas is
    // configured COPY_SRC, so toBlob()/toDataURL() readback works, which is what captureImage,
    // the poster capture and the studio thumbnails rely on.
    return new WebGPURenderer({
      // antialias: false to MATCH the WebGL path, not because MSAA is unwanted. Everything there
      // renders through EffectComposer, whose render target is created without `samples` — so the
      // WebGL canvas's `antialias: true` never applies and that path is effectively unaliased.
      // Enabling MSAA here would make WebGPU quietly render smoother edges than WebGL, which is a
      // visual change disguised as a port. It is a real upgrade to opt into later, deliberately.
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
    }) as unknown as THREE.WebGLRenderer;
  }

  private get postUniforms() {
    this.postUniformsCache ??= {
      uBlurAmount: floatUniform(0),
      uBlurSamples: floatUniform(6),
      uGrainAmount: floatUniform(0),
      uBloomStrength: floatUniform(0),
      uBloomRadius: floatUniform(0.4),
      uBloomThreshold: floatUniform(0.85),
      uInnerLight: floatUniform(0),
      uInnerLightDensity: floatUniform(0.5),
      uInnerLightDecay: floatUniform(0.95),
      uInnerLightCenter: vec2Uniform(0.5, 0.15),
      uHalftone: floatUniform(0),
      uHalftoneCell: floatUniform(6),
      uHalftoneAngle: floatUniform(0.4),
      uHeatmap: floatUniform(0),
      uHalftoneCmyk: floatUniform(0),
      uHalftoneCmykCell: floatUniform(6),
      uPaper: floatUniform(0),
      uPaperScale: floatUniform(2),
      uDitherStrength: floatUniform(0),
      uDitherScale: floatUniform(2),
      uDitherSteps: floatUniform(4),
    };
    return this.postUniformsCache;
  }

  /** Start the WebGPU backend, then draw the first frame. Safe to call more than once. */
  override async init(): Promise<void> {
    if (this.ready) return;
    await (this.renderer as unknown as WebGPURenderer).init();
    this.ready = true;
    // The constructor's buildWaves()/resize() ran against a not-yet-drawable backend, so their
    // trailing renderOnce() was skipped. Catch up now that the backend is live.
    this.resize();
    this.refresh();
  }

  /**
   * True when the live backend uses [0,1] clip Z rather than [-1,1]. Read from the renderer rather
   * than assumed, because WebGPURenderer silently falls back to a WebGL2 backend — in which case
   * the clip convention is the WebGL one and the depth fade must NOT be remapped.
   */
  private get webgpuClipZ(): boolean {
    const cs = (this.renderer as unknown as { coordinateSystem: number }).coordinateSystem;
    return cs === (WebGPUCoordinateSystem as number);
  }

  private flagsFor(sc: WaveConfig | undefined): WaveMaterialFlags {
    const bindsDetail =
      sc?.interaction?.bindings?.some((b) => b.target === "detailAmount") ?? false;
    const bindsHelix =
      sc?.interaction?.bindings?.some((b) => b.target.startsWith("helix")) ?? false;
    return {
      theme: sc?.theme === "wireframe" ? "wireframe" : "solid",
      loopMotion: (this.config.loopSeconds ?? 0) > 0,
      detailOctave: (sc?.detailAmount ?? 0) !== 0 || bindsDetail,
      helix: (sc?.helixRadius ?? 0) !== 0 || (sc?.helixRoll ?? 0) !== 0 || bindsHelix,
      twistMotion: !!sc?.twistMotion,
      radial: (sc?.radialAmount ?? 0) !== 0,
      depthTint: (sc?.depthTint ?? 0) > 0,
      edgeFeather: (sc?.edgeFeather ?? 0.1) !== 0.1,
      rungs: sc?.theme === "wireframe" && (sc.rungAmount ?? 0) > 0,
      webgpuClipZ: this.webgpuClipZ,
    };
  }

  protected override createWaveMaterial(sc: WaveConfig | undefined): WaveMaterial {
    const u = makeTslUniforms(this.renderer.getDrawingBufferSize(new THREE.Vector2()));
    const flags = this.flagsFor(sc);
    const material = buildWaveMaterial(u, flags) as unknown as TslMaterial;
    // The shared config-sync path reaches uniforms through `material.uniforms`; the node registry
    // is that same surface, so refresh() needs no backend branch.
    material.uniforms = u as unknown as WaveMaterial["uniforms"];
    material.userData = { variant: variantKey(flags), tsl: u };
    return material;
  }

  /**
   * A TSL variant is a different GRAPH, not a different define set, so a variant change rebuilds
   * the material and re-points the mesh at it. The uniform registry is carried over untouched, so
   * no config state is lost and no value has to be re-synced.
   */
  protected override applyWaveVariant(
    wave: { mesh: THREE.Mesh; material: WaveMaterial },
    sc: WaveConfig,
  ): boolean {
    const current = wave.material as TslMaterial;
    const flags = this.flagsFor(sc);
    const key = variantKey(flags);
    if (current.userData.variant === key) return false;

    const rebuilt = buildWaveMaterial(current.userData.tsl, flags) as unknown as TslMaterial;
    rebuilt.uniforms = current.uniforms;
    rebuilt.userData = { variant: key, tsl: current.userData.tsl };
    rebuilt.blending = current.blending;
    rebuilt.premultipliedAlpha = current.premultipliedAlpha;
    wave.mesh.material = rebuilt;
    wave.material = rebuilt;
    current.dispose();
    return false; // the mesh already points at a fresh material; nothing to recompile in place
  }

  // ---- Post chain --------------------------------------------------------------------------

  /** Which effects the config currently asks for — the node twin of applyPost()'s pass juggling. */
  private postFlags(): PostFlags {
    const c = this.config;
    return {
      bloom: (c.bloomStrength ?? 0) > 0,
      innerLight: (c.innerLight ?? 0) > 0,
      halftone: (c.halftone ?? 0) > 0,
      heatmap: (c.heatmap ?? 0) > 0,
      halftoneCmyk: (c.halftoneCmyk ?? 0) > 0,
      paperTexture: (c.paperTexture ?? 0) > 0,
      dither: (c.dither ?? 0) > 0,
    };
  }

  /** Push the config into the post uniforms. Mirrors applyPost() / the per-effect apply* methods. */
  private syncPostUniforms(): void {
    const c = this.config;
    const u = this.postUniforms;
    u.uBlurAmount.value = c.blur;
    u.uGrainAmount.value = c.grain;
    u.uBlurSamples.value = Math.round(c.blurSamples ?? 6);
    u.uBloomStrength.value = c.bloomStrength ?? 0;
    u.uBloomRadius.value = c.bloomRadius ?? 0.4;
    u.uBloomThreshold.value = c.bloomThreshold ?? 0.85;
    u.uInnerLight.value = c.innerLight ?? 0;
    u.uInnerLightDensity.value = c.innerLightDensity ?? 0.5;
    u.uInnerLightDecay.value = c.innerLightDecay ?? 0.95;
    u.uInnerLightCenter.value.set(c.innerLightX ?? 0.5, c.innerLightY ?? 0.15);
    u.uHalftone.value = c.halftone ?? 0;
    u.uHalftoneCell.value = Math.max(2, c.halftoneCell ?? 6);
    u.uHalftoneAngle.value = c.halftoneAngle ?? 0.4;
    u.uHeatmap.value = c.heatmap ?? 0;
    u.uHalftoneCmyk.value = c.halftoneCmyk ?? 0;
    u.uHalftoneCmykCell.value = Math.max(2, c.halftoneCmykCell ?? 6);
    u.uPaper.value = c.paperTexture ?? 0;
    u.uPaperScale.value = Math.max(0.5, c.paperTextureScale ?? 2);
    u.uDitherStrength.value = c.dither ?? 0;
    u.uDitherScale.value = Math.max(1, c.ditherScale ?? 2);
    u.uDitherSteps.value = Math.max(2, Math.round(c.ditherSteps ?? 4));
  }

  private ensurePost(): RenderPipeline {
    const flags = this.postFlags();
    const key = JSON.stringify(flags);
    if (this.post && key !== this.postFlagsKey) this.disposePost();
    if (!this.post) {
      this.postFlagsKey = key;
      this.post = new RenderPipeline(this.renderer as unknown as WebGPURenderer);
      // The chain places renderOutput() itself, so the finish-zone effects see display-space
      // colour exactly as they do after OutputPass on the WebGL path.
      this.post.outputColorTransform = false;
      this.post.outputNode = buildPostChain(
        pass(this.scene, this.camera),
        this.postUniforms,
        flags,
      ) as never;
    }
    return this.post;
  }

  protected override renderComposed(): void {
    // Fold each wave's array-valued uniforms into its shared packed buffer. The config sync writes
    // the logical arrays (`u.uColors.value[i].set(...)`) exactly as on the WebGL path; this is the
    // one extra step that layout needs. Cheap — ~52 vec4s per wave.
    for (const wave of this.waves) {
      (wave.material as TslMaterial).userData.tsl.packed.sync();
    }
    this.syncPostUniforms();
    this.ensurePost().render();
  }

  protected override resizePost(w: number, h: number, dpr: number): void {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
  }

  protected override disposePost(): void {
    this.post?.dispose();
    this.post = undefined;
  }

  /**
   * Not yet: the particle field is a `THREE.Points` whose size comes from `gl_PointSize`, and
   * WebGPU point primitives are fixed at one pixel — three's own PointsNodeMaterial documents that
   * a size can only be honoured when the material is attached to a `Sprite`. Rebuilding the field
   * as instanced sprites is its own piece of work; until then a dust-bearing preset renders its
   * ribbon correctly and simply omits the dust, rather than failing to compile.
   */
  protected override supportsParticles(): boolean {
    return false;
  }

  /**
   * WebGPU exposes no `capabilities` object; the equivalent limit lives on the adapter's device.
   * Falls back to 8192, the value every WebGPU implementation is required to support, for the
   * window before `init()` resolves — the base class calls this while sizing the background.
   */
  protected override maxTextureSize(): number {
    const device = (this.renderer as unknown as { backend?: { device?: GPUDevice } }).backend
      ?.device;
    return device?.limits?.maxTextureDimension2D ?? 8192;
  }

  /**
   * Rebuild the post chain when the background changes.
   *
   * A `pass()` node captures the scene's background at the point its render context is first built.
   * Because the chain is created lazily on the first draw — when `scene.background` is still null —
   * a background set afterwards would never appear, rendering every non-transparent preset on a
   * transparent canvas. Background changes are user-driven, not per-frame, so rebuilding here is
   * cheap; rebuilding every frame (which also works) is not.
   */
  protected override onBackgroundChanged(): void {
    // The node renderer does NOT support a plain Texture background. Background.update() handles
    // exactly three cases — null, `isColor`, and `isNode` — and anything else hits
    // "Renderer: Unsupported background configuration." So the gradient / image / video backgrounds,
    // which the WebGL renderer takes as `scene.background = texture`, have to be re-expressed as a
    // node. `getBackgroundNode(scene) || scene.background` means backgroundNode wins where set, so
    // `scene.background` can be left alone for the WebGL path's benefit.
    const bg = this.scene.background as THREE.Texture | THREE.Color | null;
    const isTexture = !!bg && (bg as THREE.Texture).isTexture === true;
    this.scene.backgroundNode = isTexture
      ? (texture(bg as THREE.Texture).sample(screenUV) as never)
      : null;
    this.disposePost();
  }
}
