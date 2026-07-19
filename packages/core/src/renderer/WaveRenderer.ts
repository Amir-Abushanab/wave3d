import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import {
  vertexShader,
  fragmentShader,
  lineFragmentShader,
  postVertexShader,
  postFragmentShader,
  ditherFragmentShader,
} from "./shaders";
import { WaveGeometry } from "./WaveGeometry";
import {
  InteractionController,
  interactionActive,
  anyPointerFxActive,
  wavePointerFxActive,
  waveRipplesActive,
  WAVE_APPLIERS,
  SCENE_APPLIERS,
  RIPPLE_SLOTS,
} from "./interaction";
import {
  buildPaletteTexture,
  configurePaletteTexture,
  paletteSignature,
  PALETTE_MAPS,
  paletteMapCanvas,
  canvasToTexture,
  loadPaletteImage,
  buildBackgroundGradientCanvas,
  buildBackgroundMeshCanvas,
  buildBackgroundImageCanvas,
  drawBackgroundMediaFrame,
} from "./palette";
import { buildHeroPaletteCanvas, buildHeroPaletteTexture } from "./heroPalette";
import {
  MAX_COLORS,
  MAX_LIGHTS,
  MAX_MESH_POINTS,
  MAX_NOISE_BANDS,
  ensureStudioConfig,
} from "../config/model";
import type { StudioConfig, WaveConfig, BlendMode } from "../config/model";

const BASE_SEGMENTS = 220; // base segment count along the ribbon; denser = smoother (scaled down per wave — see get segments)

/** Reference frame (world units) the orthographic camera fills at cameraZoom 1. The wave is
 *  framed by COVERING this FRAME_W × FRAME_H rectangle (centred on cameraTarget) into the canvas
 *  — scaled to fill both dimensions, cropping the aspect overflow — so a given cameraZoom /
 *  cameraTarget frames the wave the SAME at any canvas size or aspect (only the cropped margin
 *  differs). FRAME_H = FRAME_W / (16/9) makes the reference a 16:9 rectangle; for canvases wider
 *  than that the width binds, narrower ones zoom in to fill instead of
 *  showing empty bands. This is what makes a saved preset reproduce on anyone's screen. */
export const FRAME_W = 1333;
export const FRAME_H = 750;

export interface WaveRendererOptions {
  /** Honor prefers-reduced-motion by freezing animation. Default true. */
  respectReducedMotion?: boolean;
  /**
   * Skip the intro time-ramp (the ~1s ease-in of animation on load), rendering at full speed
   * immediately. The studio passes `import.meta.env.DEV` here so a fresh renderer on every HMR
   * hot-swap doesn't replay the ease-in (which reads as a "speed up" when you tab back). Default
   * false — production embeds keep the ease-in. Ignored while paused (a paused frame is always the
   * full frame). Default false.
   */
  skipIntroRamp?: boolean;
}

/**
 * Per-wave 2D palette texture (+ optional looping video). One instance per wave, so each
 * wave carries its own palette. Guarded by a signature so it only rebuilds when that wave's
 * palette actually changes (not every refresh).
 */
class WavePalette {
  texture?: THREE.Texture;
  private sig = "";
  private video?: HTMLVideoElement;
  private videoUrl = "";
  private failedUrl = "";

  constructor(
    private readonly makeVideo: (url: string) => HTMLVideoElement,
    private readonly onVideoReady: () => void,
  ) {}

  /** Rebuild this wave's palette texture from its config (video / custom image / stops /
   *  built-in map / hero LUT) and point the wave's palette uniforms at it. */
  apply(cfg: WaveConfig, uniforms: Record<string, THREE.IUniform>): void {
    const videoUrl = cfg.paletteVideoUrl;
    const url = cfg.paletteImageUrl;
    const source = cfg.paletteSource ?? "hero";
    let sig: string;
    let build: () => THREE.Texture;
    if (videoUrl) {
      this.ensureVideo(videoUrl);
      if (this.video?.readyState && this.video.readyState >= 2) {
        sig = "video|" + videoUrl;
        build = () => configurePaletteTexture(new THREE.VideoTexture(this.video!));
      } else {
        sig = "video-loading|" + videoUrl;
        build = () => buildHeroPaletteTexture();
      }
    } else if (url) {
      this.clearVideo();
      sig = "url|" + url;
      build = () => loadPaletteImage(url);
    } else if (source === "stops") {
      this.clearVideo();
      const opts = {
        stops: cfg.palette,
        edgeColor: cfg.paletteEdgeColor ?? "#8e9dff",
        edgeAmount: cfg.paletteEdgeAmount ?? 0.3,
      };
      sig = "stops|" + paletteSignature(opts);
      build = () => buildPaletteTexture(opts);
    } else if (PALETTE_MAPS[source]) {
      this.clearVideo();
      sig = "map|" + source;
      build = () => canvasToTexture(paletteMapCanvas(PALETTE_MAPS[source]));
    } else {
      this.clearVideo();
      sig = "hero";
      build = () => buildHeroPaletteTexture();
    }
    if (sig !== this.sig || !this.texture) {
      this.texture?.dispose();
      this.texture = build();
      this.sig = sig;
    }
    uniforms.uPalette.value = this.texture;
    uniforms.uUsePalette.value = cfg.usePaletteTexture === false ? 0 : 1;
    uniforms.uPaletteRaw.value = 1;
  }

  /** Play/pause this wave's palette video with the render loop. */
  syncPlayback(cfg: WaveConfig, running: boolean): void {
    const v = this.video;
    if (!v) return;
    const active =
      running &&
      cfg.gradientType !== "mesh" &&
      cfg.usePaletteTexture !== false &&
      !!cfg.paletteVideoUrl;
    if (active) void v.play().catch(() => {});
    else v.pause();
  }

  private ensureVideo(url: string): void {
    if (this.videoUrl === url || this.failedUrl === url) return;
    this.clearVideo();
    this.videoUrl = url;
    const video = this.makeVideo(url);
    video.addEventListener(
      "loadeddata",
      () => {
        this.video = video;
        this.failedUrl = "";
        this.sig = "";
        this.onVideoReady();
      },
      { once: true },
    );
    video.addEventListener(
      "error",
      () => {
        this.failedUrl = url;
        this.sig = "";
        this.onVideoReady();
      },
      { once: true },
    );
    this.video = video;
    video.load();
  }

  private clearVideo(): void {
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
    }
    this.video = undefined;
    this.videoUrl = "";
  }

  dispose(): void {
    this.texture?.dispose();
    this.texture = undefined;
    this.clearVideo();
    this.failedUrl = "";
  }
}

type Wave = {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  geometry: WaveGeometry;
  /** This wave's own 2D palette texture + optional video. */
  palette: WavePalette;
};

// Parse scratch: refresh() converts ~25 hex colours per wave per call (i.e. per slider input),
// so reuse one Color instead of allocating each time.
const HEX_SCRATCH = new THREE.Color();

/** Convert an sRGB hex string to a linear-space RGB vector (three's ColorManagement does the
 *  sRGB→linear conversion on parse). Exported for the studio subclass's live light-uniform push. */
export function hexToLinearVec3(hex: string, target: THREE.Vector3): THREE.Vector3 {
  // three's ColorManagement (on by default in r169) already converts the sRGB hex to
  // LINEAR when parsing the hex — its .r/.g/.b are linear. Calling
  // convertSRGBToLinear() again would double-linearize (crushing greens → everything
  // turns red), so we read the components directly.
  const c = HEX_SCRATCH.set(hex);
  return target.set(c.r, c.g, c.b);
}

/**
 * Renders a gradient "wave of light" from a {@link StudioConfig}. Framework-agnostic:
 * it needs only a DOM container and a config. The studio mutates the config in
 * place and calls `refresh()` / `rebuild()`.
 */
export class WaveRenderer {
  readonly renderer: THREE.WebGLRenderer;
  protected readonly scene = new THREE.Scene();
  protected readonly camera: THREE.OrthographicCamera;
  protected readonly group = new THREE.Group();
  private readonly composer: EffectComposer;
  private readonly postPass: ShaderPass;
  /** Optional bloom pass — created lazily when bloomStrength first goes >0, removed at 0. */
  private bloomPass?: UnrealBloomPass;
  private ditherPass?: ShaderPass;
  protected readonly container: HTMLElement;
  private readonly respectReducedMotion: boolean;
  private readonly skipIntroRamp: boolean;

  protected config: StudioConfig;
  protected waves: Wave[] = [];

  // 2D palette textures (+ any palette videos) live per-wave — see WavePalette on each Wave.
  private backgroundTexture?: THREE.Texture;
  private backgroundSig = "";
  private backgroundImage?: HTMLImageElement;
  private backgroundImageUrl = "";
  private failedBackgroundImageUrl = "";
  private backgroundVideo?: HTMLVideoElement;
  private backgroundVideoUrl = "";
  private failedBackgroundVideoUrl = "";
  private backgroundVideoCanvas?: HTMLCanvasElement;
  /** Authored default camera pose, for "Reset camera". */
  protected readonly homeCamPos = new THREE.Vector3();
  protected readonly homeCamTarget = new THREE.Vector3();

  // Reused scratch for per-frame clip-plane fitting (see updateClipPlanes) — hoisted so the
  // render loop allocates nothing.
  private readonly clipBox = new THREE.Box3();
  private readonly clipSphere = new THREE.Sphere();
  private readonly clipTmpA = new THREE.Vector3();
  private readonly clipTmpB = new THREE.Vector3();

  // ---- Interaction layer (optional; created only when config.interaction is active) ----
  /** Created by syncInteraction() when interaction turns on, disposed when it turns off. */
  protected interaction?: InteractionController;
  /** Extra ortho-zoom MULTIPLIER from a cameraZoom binding (1 = none); applied in applyZoom().
   *  Protected so the studio's writeCameraToConfig() can divide it back out (keep it out of config). */
  protected interactionZoom = 1;
  /** Extra time-offset DELTA from a timeOffset binding (0 = none); added in updateTime(). */
  private interactionTimeOffset = 0;
  /** Scene-binding out-params: appliers write into this, applyBindings() reads it back. */
  private readonly interactionSceneOut = { timeOffset: 0, zoom: 1 };

  private readonly timer = new THREE.Timer();
  private time = 0;
  private rafId = 0;
  protected running = false;
  private started = false;

  private visible = true;
  private pageVisible = true;
  private reducedMotion = false;
  /** Intro ramp: eases animation time 0→1 over ~1s on load (when config.introRamp). */
  private introTimeRamp = 0;

  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly motionQuery: MediaQueryList;

  protected capturing = false;
  /** Fixed backing-buffer dimensions used by the studio's visible export frame. Embeds leave
   *  this unset and continue to resize responsively with their container and device DPR. */
  private outputSize?: { width: number; height: number };

  constructor(container: HTMLElement, config: StudioConfig, options: WaveRendererOptions = {}) {
    this.container = container;
    this.config = ensureStudioConfig(config);
    this.respectReducedMotion = options.respectReducedMotion ?? true;
    this.skipIntroRamp = options.skipIntroRamp ?? false;

    this.renderer = new THREE.WebGLRenderer({
      // antialias smooths edges; preserveDrawingBuffer keeps the drawing buffer readable so we
      // can export PNG/WebM. Both cost a little performance, but this authoring tool needs them.
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    // Resilience: if the GPU drops the context (memory pressure, sleep/wake), don't
    // let the browser hard-crash the page — prevent the default and rebuild on restore.
    this.renderer.domElement.addEventListener("webglcontextlost", this.onContextLost, false);
    this.renderer.domElement.addEventListener(
      "webglcontextrestored",
      this.onContextRestored,
      false,
    );

    // Orthographic, framed in device pixels: resize() sets the frustum to the canvas size, and
    // the mesh is scaled up so the wave overflows the frame, leaving only the twist on screen.
    // The left/right/top/bottom bounds here are placeholders overwritten by the first resize();
    // near/far are placeholders too — updateClipPlanes() refits them to the scene every frame so
    // no camera angle ever clips the wave (a fixed slab does — see updateClipPlanes).
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10000);
    this.camera.position.set(
      config.cameraPosition.x,
      config.cameraPosition.y,
      config.cameraPosition.z,
    );
    this.camera.zoom = config.cameraZoom ?? 1;
    this.camera.lookAt(config.cameraTarget.x, config.cameraTarget.y, config.cameraTarget.z);
    this.camera.updateProjectionMatrix();
    // Remember the authored default pose so "Reset camera" returns to it (orbit mutates
    // config.cameraPosition, so we can't read it back from config later).
    this.homeCamPos.copy(this.camera.position);
    this.homeCamTarget.set(config.cameraTarget.x, config.cameraTarget.y, config.cameraTarget.z);
    this.scene.add(this.group);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.postPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uBlurAmount: { value: config.blur },
        uBlurSamples: { value: 6 },
        uGrainAmount: { value: config.grain },
        uTime: { value: 0 },
      },
      vertexShader: postVertexShader,
      fragmentShader: postFragmentShader,
    });
    this.composer.addPass(this.postPass);
    this.composer.addPass(new OutputPass());

    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = this.respectReducedMotion && this.motionQuery.matches;
    this.motionQuery.addEventListener("change", this.onMotionChange);
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        this.visible = entries[0]?.isIntersecting ?? true;
        this.updateRunning();
      },
      { rootMargin: "100px" },
    );
    this.intersectionObserver.observe(container);

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(container);

    this.applyBackground();
    this.buildWaves();
    this.resize();
  }

  private get segments(): number {
    // Scale detail down as waves multiply, so total geometry stays bounded.
    const q = this.config.quality / Math.sqrt(Math.max(1, this.config.waves.length));
    return THREE.MathUtils.clamp(Math.round(BASE_SEGMENTS * q), 24, 360);
  }

  private makeUniforms(): Record<string, THREE.IUniform> {
    const colors: THREE.Vector3[] = [];
    const colorPos: number[] = [];
    for (let i = 0; i < MAX_COLORS; i++) {
      colors.push(new THREE.Vector3(1, 1, 1));
      colorPos.push(MAX_COLORS > 1 ? i / (MAX_COLORS - 1) : 0);
    }
    const meshPointPos: THREE.Vector2[] = [];
    const meshPointColor: THREE.Vector3[] = [];
    const meshPointInfluence: number[] = [];
    for (let i = 0; i < MAX_MESH_POINTS; i++) {
      meshPointPos.push(new THREE.Vector2(0.5, 0.5));
      meshPointColor.push(new THREE.Vector3(1, 1, 1));
      meshPointInfluence.push(0.65);
    }
    const lightPos: THREE.Vector3[] = [];
    const lightColor: THREE.Vector3[] = [];
    const lightIntensity: number[] = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      lightPos.push(new THREE.Vector3());
      lightColor.push(new THREE.Vector3(1, 1, 1));
      lightIntensity.push(0);
    }
    const bandBounds: THREE.Vector4[] = [];
    const bandParams: THREE.Vector4[] = [];
    const bandParaPow: number[] = [];
    for (let i = 0; i < MAX_NOISE_BANDS; i++) {
      bandBounds.push(new THREE.Vector4());
      bandParams.push(new THREE.Vector4());
      bandParaPow.push(0);
    }
    // Click-ripple ring buffer (read only under POINTER_RIPPLES). Sized to RIPPLE_SLOTS.
    const rippleOrigin: THREE.Vector2[] = [];
    const rippleAge: number[] = [];
    const rippleAmp: number[] = [];
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
      rippleOrigin.push(new THREE.Vector2());
      rippleAge.push(0);
      rippleAmp.push(0);
    }
    return {
      // Deformation (vertex)
      uTime: { value: 0 },
      uSpeed: { value: 0.05 },
      uSeed: { value: 0 },
      uDispFreqX: { value: 0.003234 },
      uDispFreqZ: { value: 0.00799 },
      uDispAmount: { value: 6.051 },
      uDetailFreq: { value: 0.04 },
      uDetailAmount: { value: 0 }, // 2nd displacement octave (read only under DETAIL_OCTAVE)
      uTwFreqX: { value: -0.055 },
      uTwFreqY: { value: 0.077 },
      uTwFreqZ: { value: -0.518 },
      uTwPowX: { value: 3.95 },
      uTwPowY: { value: 5.85 },
      uTwPowZ: { value: 6.33 },
      uLoopSeconds: { value: 0 }, // seamless-loop period (read only under the LOOP_MOTION define)
      // Colour + light (fragment)
      uColors: { value: colors },
      uColorPos: { value: colorPos },
      uColorCount: { value: 2 },
      uGradType: { value: 0 },
      uGradAngle: { value: 0 },
      uGradShift: { value: 0.15 },
      uMeshPointPos: { value: meshPointPos },
      uMeshPointColor: { value: meshPointColor },
      uMeshPointInfluence: { value: meshPointInfluence },
      uMeshPointCount: { value: 0 },
      uMeshSoftness: { value: 0.62 },
      uPalette: { value: null },
      uUsePalette: { value: 1 },
      uPaletteRaw: { value: 1 },
      uPaletteScale: { value: new THREE.Vector2(1, 1) },
      uPaletteOffset: { value: new THREE.Vector2(0, 0) },
      uPaletteRotation: { value: 0 },
      uDebug: { value: 0 },
      uSheen: { value: 1 },
      uRoundness: { value: 0.35 },
      uIridescence: { value: 0 },
      uDepthTint: { value: 0 }, // solid-theme depth tint (read only under DEPTH_TINT)
      uDepthTintColor: { value: new THREE.Vector3() },
      uHueShift: { value: 0 },
      uContrast: { value: 1 },
      uSaturation: { value: 1 },
      uFiberCount: { value: 90 },
      uFiberStrength: { value: 0.25 },
      uTexture: { value: 0 },
      uCreaseLight: { value: 0.15 },
      uCreaseSharpness: { value: 2.0 },
      uCreaseSoftness: { value: 1.0 },
      uEdgeFade: { value: 0.06 },
      uEdgeFeather: { value: 0.1 }, // ribbon-edge softness (read only under EDGE_FEATHER)
      uOpacity: { value: 1 },
      uSquared: { value: 1 }, // "squared" deep-colour mode: square the colour in-shader (see applyBlendMode)
      uResolution: { value: new THREE.Vector2(1, 1) },
      uAmbient: { value: 0.45 },
      uNumLights: { value: 1 },
      uLightPos: { value: lightPos },
      uLightColor: { value: lightColor },
      uLightIntensity: { value: lightIntensity },
      uNumNoiseBands: { value: 0 },
      uNoiseBandBounds: { value: bandBounds },
      uNoiseBandParams: { value: bandParams },
      uNoiseBandParaPow: { value: bandParaPow },
      // Wireframe thin-line theme (used only by lineFragmentShader)
      uLineAmount: { value: 425 },
      uLineThickness: { value: 1 },
      uLineDerivativePower: { value: 0.95 },
      uMaxWidth: { value: 1232 },
      uClearColor: { value: new THREE.Vector3(1, 1, 1) },
      // Interaction / pointer field. ALWAYS present in JS (read only under POINTER_FX /
      // POINTER_RIPPLES); three uploads them only when the compiled program declares them, so their
      // presence never affects a non-interactive wave (byte-identity precedent: uDetailAmount).
      uPointer: { value: new THREE.Vector2(0, 0) }, // smoothed pointer NDC
      uPointerActive: { value: 0 }, // presence ramp × per-wave influence
      uPointerRadius: { value: 0.6 }, // falloff radius in NDC-y (config radius × 2)
      uPointerAspect: { value: 1 }, // drawing-buffer dw/dh
      uPointerAgitate: { value: 0 },
      uPointerPush: { value: 0 }, // signed membrane dome at the cursor (+ repel / − attract)
      uPointerWake: { value: 0 }, // drag-wake trough amplitude
      uPointerVel: { value: new THREE.Vector2(0, 0) }, // smoothed pointer velocity, NDC/s (wake dir)
      uPointerThin: { value: 0 },
      uPointerHue: { value: 0 },
      uPointerLighten: { value: 0 },
      uPointerRipple: { value: 0 }, // this wave's ripple amplitude (scales the shared envelope)
      uRippleOrigin: { value: rippleOrigin },
      uRippleAge: { value: rippleAge },
      uRippleAmp: { value: rippleAmp },
    };
  }

  /** Vertex-shader #defines for a wave: TWIST_MOTION (per-wave animated twist wobble) and
   *  LOOP_MOTION (scene-level seamless loop). Both select #ifdef-gated code paths; an empty
   *  object compiles the default (linear-time) program. */
  private waveDefines(sc: WaveConfig | undefined): Record<string, string> {
    const defines: Record<string, string> = {};
    if (sc?.twistMotion) defines.TWIST_MOTION = "";
    if ((this.config.loopSeconds ?? 0) > 0) defines.LOOP_MOTION = "";
    // A detailAmount binding on THIS wave also needs the octave compiled (else it no-ops on a wave
    // authored at 0). Only this wave's bindings matter now (bindings are per wave).
    const bindsDetail =
      sc?.interaction?.bindings?.some((b) => b.target === "detailAmount") ?? false;
    if ((sc?.detailAmount ?? 0) !== 0 || bindsDetail) defines.DETAIL_OCTAVE = "";
    if ((sc?.depthTint ?? 0) > 0) defines.DEPTH_TINT = "";
    if ((sc?.edgeFeather ?? 0.1) !== 0.1) defines.EDGE_FEATHER = "";
    // Pointer field (per wave, config-only, so input never triggers a recompile). Ripples nest inside.
    if (sc && wavePointerFxActive(this.config, sc)) {
      defines.POINTER_FX = "";
      if (waveRipplesActive(this.config, sc)) defines.POINTER_RIPPLES = "";
    }
    return defines;
  }

  private addWave(): void {
    const geo = new WaveGeometry(this.segments);
    // Initialise defines/fragment/blend from the wave this material will represent, so the
    // first refresh() doesn't force a needless program recompile. Falls back to the first wave.
    const sc = this.config.waves[this.waves.length] ?? this.config.waves[0];
    const material = new THREE.ShaderMaterial({
      uniforms: this.makeUniforms(),
      // TWIST_MOTION / LOOP_MOTION select variant vertex-shader paths. Toggled live in refresh().
      defines: this.waveDefines(sc),
      vertexShader,
      // solid theme = surfaceColor shader; wireframe theme = thin-line shader.
      // Swapped live in refresh() when the wave's theme changes.
      fragmentShader: sc?.theme === "wireframe" ? lineFragmentShader : fragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    // Blending (incl. the squaring blend) is set from the wave's blendMode — see applyBlendMode —
    // so it survives refresh() instead of being a dead constructor flag.
    this.applyBlendMode(material, sc?.blendMode ?? "squared");
    const mesh = new THREE.Mesh(geo.geometry, material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const palette = new WavePalette(
      (url) => this.createLoopingVideo(url),
      () => {
        this.updatePaletteTextures();
        this.syncVideoPlayback();
        if (!this.running) this.renderOnce();
      },
    );
    this.waves.push({ mesh, material, geometry: geo, palette });
  }

  /**
   * Apply config.blendMode to a material. "squared" (the default) is the hero blend:
   * CustomBlending with AddEquation, src = SrcColorFactor, dst = ZeroFactor, so the
   * framebuffer result is fragColor² — the squaring deepens the colours into the vivid
   * hero look (without it the wave reads pastel). "additive"/"normal"/"multiply" are
   * authoring overrides. Multiply uses Three's premultiplied-alpha path; the custom
   * fragment shaders premultiply their output when Three injects PREMULTIPLIED_ALPHA.
   * Returns true if material state changed (caller flags needsUpdate).
   */
  private applyBlendMode(material: THREE.ShaderMaterial, mode: BlendMode): boolean {
    // "squared" is the deep hero look. It used to be a framebuffer-squaring CustomBlending
    // (src·src, dst×0) — which REPLACES the destination rather than compositing over it, so any
    // semi-transparent pixel (soft ribbon edges, and the large near-edge-on regions at oblique
    // camera angles) wiped the framebuffer's colour AND alpha, punching dark / see-through holes
    // through the background and through other waves. On a transparent page you never saw it; on
    // an opaque background or with overlapping waves it's the "chunks vanish" artifact.
    //
    // Fix: do the colour-squaring in the shader (uSquared) and composite it with ordinary
    // premultiplied alpha (NormalBlending). Over an opaque body the result is identical (col²);
    // soft edges now blend into what's behind them instead of erasing it.
    const squared = mode === "squared";
    const blending =
      mode === "additive"
        ? THREE.AdditiveBlending
        : mode === "multiply"
          ? THREE.MultiplyBlending
          : THREE.NormalBlending; // "squared" (deep, via uSquared) and "normal" both composite
    // Premultiplied so the squared/multiply colour composites correctly (the shaders premultiply
    // their output under the PREMULTIPLIED_ALPHA define Three injects for this).
    const premultipliedAlpha = mode === "multiply" || squared;
    material.uniforms.uSquared.value = squared ? 1 : 0;
    if (material.blending === blending && material.premultipliedAlpha === premultipliedAlpha) {
      return false;
    }
    material.blending = blending;
    material.premultipliedAlpha = premultipliedAlpha;
    return true;
  }

  private disposeWaves(): void {
    for (const s of this.waves) {
      this.group.remove(s.mesh);
      s.material.dispose();
      s.geometry.dispose();
      s.palette.dispose();
    }
    this.waves = [];
  }

  /**
   * Reconcile the wave pool to `waveCount` WITHOUT tearing everything down:
   * keep existing waves (so the compiled shader program is never deleted and
   * re-compiled — that churn can crash some GPU drivers), add/remove only the
   * delta, and resize each geometry to the current quality.
   */
  private buildWaves(): void {
    const target = Math.max(1, this.config.waves.length);
    while (this.waves.length > target) {
      const s = this.waves.pop();
      if (!s) break;
      this.group.remove(s.mesh);
      s.material.dispose();
      s.geometry.dispose();
      s.palette.dispose();
    }
    while (this.waves.length < target) this.addWave();

    const segments = this.segments;
    this.waves.forEach((s, i) => {
      s.geometry.resize(segments);
      s.mesh.renderOrder = i;
    });
    this.refresh();
  }

  /** Re-read per-frame-independent values from the (mutated) config. */
  refresh(): void {
    this.applyBackground();
    this.applyPost();
    this.syncInteraction(); // create/dispose the interaction controller as config toggles it
    // Once an external driver (orbit / edit gizmo) owns the camera, don't fight it here; the shell
    // (no orbit) applies the saved camera position/target so it matches the authored view.
    if (!this.isCameraExternallyDriven()) {
      const p = this.config.cameraPosition;
      const tg = this.config.cameraTarget;
      this.camera.position.set(p.x, p.y, p.z);
      this.camera.lookAt(tg.x, tg.y, tg.z);
    }

    this.waves.forEach((wave, i) => {
      const sc = this.config.waves[i] ?? this.config.waves[this.config.waves.length - 1];
      const u = wave.material.uniforms;
      if (this.applyBlendMode(wave.material, sc.blendMode)) wave.material.needsUpdate = true;
      // Recompile the program when its #define set changes: TWIST_MOTION / DETAIL_OCTAVE / DEPTH_TINT
      // (per wave) and LOOP_MOTION (scene-level). Compare the whole set so any combination is handled.
      const wantDefines = this.waveDefines(sc);
      const curDefines = wave.material.defines ?? {};
      if (Object.keys(wantDefines).sort().join(",") !== Object.keys(curDefines).sort().join(",")) {
        wave.material.defines = wantDefines;
        wave.material.needsUpdate = true;
      }
      // Swap the fragment shader when this wave's theme changes: solid surfaceColor <->
      // wireframe thin-line. Three recompiles the program on needsUpdate.
      const wantFrag = sc.theme === "wireframe" ? lineFragmentShader : fragmentShader;
      if (wave.material.fragmentShader !== wantFrag) {
        wave.material.fragmentShader = wantFrag;
        wave.material.needsUpdate = true;
      }

      const stops = [...sc.palette].sort((a, b) => a.pos - b.pos);
      const colorCount = Math.max(1, Math.min(stops.length, MAX_COLORS));
      const colors = u.uColors.value as THREE.Vector3[];
      const colorPos = u.uColorPos.value as number[];
      for (let c = 0; c < MAX_COLORS; c++) {
        const stop = stops[Math.min(c, colorCount - 1)] ?? { color: "#ffffff", pos: 0 };
        hexToLinearVec3(stop.color, colors[c]);
        colorPos[c] = stop.pos;
      }
      u.uColorCount.value = colorCount;
      u.uGradType.value =
        sc.gradientType === "radial"
          ? 1
          : sc.gradientType === "conic"
            ? 2
            : sc.gradientType === "mesh"
              ? 3
              : 0;
      u.uGradAngle.value = ((sc.gradientAngle ?? 0) * Math.PI) / 180;
      u.uGradShift.value = sc.gradientShift ?? 0;
      const meshPoints = sc.meshGradientPoints.slice(0, MAX_MESH_POINTS);
      const meshPointPos = u.uMeshPointPos.value as THREE.Vector2[];
      const meshPointColor = u.uMeshPointColor.value as THREE.Vector3[];
      const meshPointInfluence = u.uMeshPointInfluence.value as number[];
      for (let pointIndex = 0; pointIndex < MAX_MESH_POINTS; pointIndex++) {
        const point = meshPoints[pointIndex] ?? meshPoints[meshPoints.length - 1];
        if (!point) continue;
        meshPointPos[pointIndex].set(point.x, point.y);
        hexToLinearVec3(point.color, meshPointColor[pointIndex]);
        meshPointInfluence[pointIndex] = point.influence;
      }
      u.uMeshPointCount.value = meshPoints.length;
      u.uMeshSoftness.value = sc.meshGradientSoftness;
      u.uPaletteScale.value.set(sc.paletteTextureScale?.x ?? 1, sc.paletteTextureScale?.y ?? 1);
      u.uPaletteOffset.value.set(sc.paletteTextureOffset?.x ?? 0, sc.paletteTextureOffset?.y ?? 0);
      u.uPaletteRotation.value = ((sc.paletteTextureRotation ?? 0) * Math.PI) / 180;
      u.uHueShift.value = sc.hueShift;
      u.uContrast.value = sc.colorContrast;
      u.uSaturation.value = sc.colorSaturation;
      // Wireframe thin-line theme params (used only by lineFragmentShader). uClearColor is the
      // between-line colour = the page background (scene), fed in linear space like the palette.
      u.uLineAmount.value = sc.lineAmount ?? 425;
      u.uLineThickness.value = sc.lineThickness ?? 1;
      u.uLineDerivativePower.value = sc.lineDerivativePower ?? 0.95;
      u.uMaxWidth.value = sc.maxWidth ?? 1232;
      hexToLinearVec3(this.config.background, u.uClearColor.value as THREE.Vector3);
      u.uFiberCount.value = sc.fiberCount;
      u.uFiberStrength.value = sc.fiberStrength;
      u.uTexture.value = sc.texture;
      u.uCreaseLight.value = sc.creaseLight;
      u.uCreaseSharpness.value = sc.creaseSharpness;
      u.uCreaseSoftness.value = sc.creaseSoftness;
      u.uSheen.value = sc.sheen ?? 1;
      u.uRoundness.value = sc.roundness ?? 0.35;
      u.uIridescence.value = sc.iridescence ?? 0;
      u.uDepthTint.value = sc.depthTint ?? 0;
      hexToLinearVec3(sc.depthTintColor ?? "#0a2540", u.uDepthTintColor.value as THREE.Vector3);
      u.uEdgeFade.value = sc.edgeFade;
      u.uEdgeFeather.value = sc.edgeFeather ?? 0.1;
      // Lights + ambient are scene-level (shared by every wave).
      const lights = this.config.lights ?? [];
      u.uAmbient.value = this.config.ambient ?? 0.45;
      u.uNumLights.value = Math.min(lights.length, MAX_LIGHTS);
      const lPos = u.uLightPos.value as THREE.Vector3[];
      const lCol = u.uLightColor.value as THREE.Vector3[];
      const lInt = u.uLightIntensity.value as number[];
      for (let li = 0; li < MAX_LIGHTS; li++) {
        const light = lights[li];
        if (light) {
          lPos[li].set(light.position.x, light.position.y, light.position.z);
          hexToLinearVec3(light.color, lCol[li]);
          lInt[li] = light.intensity;
        } else {
          lInt[li] = 0;
        }
      }
      // Noise bands (per-region fiber overrides) — per wave
      const bands = sc.noiseBands ?? [];
      u.uNumNoiseBands.value = Math.min(bands.length, MAX_NOISE_BANDS);
      const bBounds = u.uNoiseBandBounds.value as THREE.Vector4[];
      const bParams = u.uNoiseBandParams.value as THREE.Vector4[];
      const bPara = u.uNoiseBandParaPow.value as number[];
      for (let bi = 0; bi < MAX_NOISE_BANDS; bi++) {
        const band = bands[bi];
        if (band) {
          bBounds[bi].set(band.startX, band.endX, band.startY, band.endY);
          bParams[bi].set(band.feather, band.strength, band.frequency, band.colorAttenuation);
          bPara[bi] = band.parabolaPower;
        }
      }
      // Deformation (absolute per wave)
      u.uSpeed.value = sc.speed;
      u.uSeed.value = sc.seed;
      u.uLoopSeconds.value = this.config.loopSeconds ?? 0; // scene-level; shared by every wave
      u.uDispFreqX.value = sc.displaceFrequency.x;
      u.uDispFreqZ.value = sc.displaceFrequency.y;
      u.uDispAmount.value = sc.displaceAmount;
      u.uDetailFreq.value = sc.detailFrequency ?? 0.04;
      u.uDetailAmount.value = sc.detailAmount ?? 0;
      u.uTwFreqX.value = sc.twistFrequency.x;
      u.uTwFreqY.value = sc.twistFrequency.y;
      u.uTwFreqZ.value = sc.twistFrequency.z;
      u.uTwPowX.value = sc.twistPower.x;
      u.uTwPowY.value = sc.twistPower.y;
      u.uTwPowZ.value = sc.twistPower.z;
      // Mesh transform — each wave's ABSOLUTE scale / rotation / position, applied via
      // modelMatrix using THREE's Euler XYZ order so the on-screen orientation matches the
      // authored view.
      wave.mesh.scale.set(sc.scale.x, sc.scale.y, sc.scale.z);
      wave.mesh.rotation.set(
        THREE.MathUtils.degToRad(sc.rotation.x),
        THREE.MathUtils.degToRad(sc.rotation.y),
        THREE.MathUtils.degToRad(sc.rotation.z),
      );
      wave.mesh.position.set(sc.position.x, sc.position.y, sc.position.z);
      u.uOpacity.value = sc.opacity;
    });

    // Static pointer-field params. The falloff radius is SHARED (scene-level); the hover amplitudes
    // and ripple amplitude are PER WAVE. The dynamic pointer state (position/velocity/presence/ripple
    // envelopes) is pushed each frame in applyPointerField().
    const sharedRadius = (this.config.interaction?.radius ?? 0.3) * 2; // radius = fraction of viewport H
    this.waves.forEach((wave, i) => {
      const sc = this.config.waves[i] ?? this.config.waves[this.config.waves.length - 1];
      if (!wavePointerFxActive(this.config, sc)) return;
      const u = wave.material.uniforms;
      const h = sc.interaction?.hover;
      u.uPointerRadius.value = sharedRadius;
      u.uPointerAgitate.value = h?.agitate ?? 0;
      u.uPointerPush.value = h?.push ?? 0;
      u.uPointerWake.value = h?.wake ?? 0;
      u.uPointerThin.value = h?.thin ?? 0;
      u.uPointerHue.value = h?.hueShift ?? 0;
      u.uPointerLighten.value = h?.lighten ?? 0;
      u.uPointerRipple.value = sc.interaction?.press?.ripple ?? 0;
    });

    this.updatePaletteTextures();
    this.syncVideoPlayback();

    // Whole-wave mirror (world-space flip ≈ screen flip for the near-frontal camera).
    this.group.scale.set(this.config.mirrorH ? -1 : 1, this.config.mirrorV ? -1 : 1, 1);

    this.onAfterRefresh();
    if (!this.running) this.renderOnce();
  }

  /** Point every wave's palette sampler at its own WavePalette texture (each rebuilt only
   *  when that wave's palette actually changes — see WavePalette.apply). */
  private updatePaletteTextures(): void {
    this.waves.forEach((wave, i) => {
      const sc = this.config.waves[i] ?? this.config.waves[this.config.waves.length - 1];
      wave.palette.apply(sc, wave.material.uniforms);
    });
  }

  /** Dev: 0 = normal, 1 = visualise the crease value, 2 = visualise derivative normal. */
  setDebug(v: number): void {
    for (const s of this.waves) s.material.uniforms.uDebug.value = v;
    this.renderOnce();
  }

  /** Rebuild geometry + waves (call when waveCount or quality changes). */
  rebuild(): void {
    this.buildWaves();
  }

  private applyBackground(): void {
    if (this.config.transparentBackground) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
      return;
    }

    const matte = new THREE.Color(this.config.background);
    this.renderer.setClearColor(matte, 1);
    if (this.config.backgroundMode === "color") {
      this.applyColorBackground(matte);
      return;
    }
    // Live video is redrawn every frame, so cap its staging canvas near 1080p. Still images
    // and procedural maps retain the full 4K-capable background texture path.
    const { width, height } = this.backgroundCanvasSize(
      this.config.backgroundVideoUrl ? 2048 : 4096,
    );
    if (this.config.backgroundMode === "gradient") this.applyGradientBackground(width, height);
    else this.applyImageBackground(matte, width, height);
  }

  private applyColorBackground(matte: THREE.Color): void {
    this.clearBackgroundVideo();
    this.backgroundTexture?.dispose();
    this.backgroundTexture = undefined;
    this.backgroundSig = "";
    this.scene.background = matte;
  }

  private applyGradientBackground(width: number, height: number): void {
    this.clearBackgroundVideo();
    const gradType = this.config.backgroundGradientType;
    if (gradType === "mesh") {
      const pts = this.config.backgroundMeshPoints ?? [];
      const softness = this.config.backgroundMeshSoftness ?? 0.62;
      const ptSig = pts
        .map((p) => `${p.color}@${p.x.toFixed(3)},${p.y.toFixed(3)},${p.influence.toFixed(3)}`)
        .join(",");
      const sig = ["mesh", softness.toFixed(3), ptSig, width, height].join("|");
      if (sig !== this.backgroundSig || !this.backgroundTexture) {
        const canvas = buildBackgroundMeshCanvas(pts, softness, width, height);
        this.backgroundTexture?.dispose();
        this.backgroundTexture = canvasToTexture(canvas);
        this.backgroundSig = sig;
      }
      this.scene.background = this.backgroundTexture;
      return;
    }
    const source = this.config.backgroundGradientSource ?? "stops";
    const def = PALETTE_MAPS[source];
    const stops =
      source !== "stops" && def?.kind === "gradient" && def.stops
        ? def.stops
        : this.config.backgroundPalette;
    const stopSig = stops.map((stop) => `${stop.color}@${stop.pos.toFixed(3)}`).join(",");
    const sig = [
      "gradient",
      source,
      gradType,
      this.config.backgroundGradientAngle,
      stopSig,
      width,
      height,
    ].join("|");
    if (sig !== this.backgroundSig || !this.backgroundTexture) {
      const canvas = buildBackgroundGradientCanvas({
        stops,
        type: gradType,
        angle: this.config.backgroundGradientAngle,
        width,
        height,
      });
      this.backgroundTexture?.dispose();
      this.backgroundTexture = canvasToTexture(canvas);
      this.backgroundSig = sig;
    }
    this.scene.background = this.backgroundTexture;
  }

  /** Image mode: a live video, a user-loaded image, or a built-in map. `matte` shows while an
   *  async source is still loading. */
  private applyImageBackground(matte: THREE.Color, width: number, height: number): void {
    const fit = this.config.backgroundImageFit ?? "cover";
    const zoom = this.config.backgroundImageZoom ?? 1;
    const position = this.config.backgroundImagePosition ?? { x: 0, y: 0 };
    const videoUrl = this.config.backgroundVideoUrl;
    const customUrl = this.config.backgroundImageUrl;
    let source: CanvasImageSource;
    let sourceWidth: number;
    let sourceHeight: number;
    let sourceSig: string;
    if (videoUrl) {
      this.ensureBackgroundVideo(videoUrl);
      if (!this.backgroundVideo || this.backgroundVideo.readyState < 2) {
        this.scene.background = matte;
        return;
      }
      source = this.backgroundVideo;
      sourceWidth = this.backgroundVideo.videoWidth;
      sourceHeight = this.backgroundVideo.videoHeight;
      sourceSig = `video|${videoUrl}`;
    } else if (customUrl) {
      this.clearBackgroundVideo();
      if (
        !this.backgroundImage ||
        this.backgroundImageUrl !== customUrl ||
        !this.backgroundImage.complete
      ) {
        this.loadBackgroundImage(customUrl);
        this.scene.background = matte;
        return;
      }
      source = this.backgroundImage;
      sourceWidth = this.backgroundImage.naturalWidth;
      sourceHeight = this.backgroundImage.naturalHeight;
      sourceSig = `custom|${customUrl}`;
    } else {
      this.clearBackgroundVideo();
      const imageSource = this.config.backgroundImageSource ?? "vaporwave";
      const canvas =
        imageSource === "hero"
          ? buildHeroPaletteCanvas()
          : PALETTE_MAPS[imageSource]?.kind === "image"
            ? paletteMapCanvas(PALETTE_MAPS[imageSource], Math.max(width, height))
            : null;
      if (!canvas) {
        this.scene.background = matte;
        return;
      }
      source = canvas;
      sourceWidth = canvas.width;
      sourceHeight = canvas.height;
      sourceSig = `map|${imageSource}`;
    }

    const sig = [
      "image",
      sourceSig,
      fit,
      zoom,
      position.x,
      position.y,
      this.config.background,
      width,
      height,
    ].join("|");
    if (sig !== this.backgroundSig || !this.backgroundTexture) {
      const canvas = buildBackgroundImageCanvas(
        source,
        sourceWidth,
        sourceHeight,
        width,
        height,
        fit,
        this.config.background,
        zoom,
        position.x,
        position.y,
      );
      this.backgroundTexture?.dispose();
      this.backgroundTexture = canvasToTexture(canvas);
      this.backgroundSig = sig;
      this.backgroundVideoCanvas = videoUrl ? canvas : undefined;
    }
    this.scene.background = this.backgroundTexture;
  }

  private backgroundCanvasSize(maxRequestedEdge = 4096): { width: number; height: number } {
    const rawWidth = this.outputSize?.width ?? Math.max(1, this.container.clientWidth);
    const rawHeight = this.outputSize?.height ?? Math.max(1, this.container.clientHeight);
    const maxEdge = Math.min(maxRequestedEdge, this.renderer.capabilities.maxTextureSize);
    const scale = Math.min(1, maxEdge / Math.max(rawWidth, rawHeight));
    return {
      width: Math.max(1, Math.round(rawWidth * scale)),
      height: Math.max(1, Math.round(rawHeight * scale)),
    };
  }

  private loadBackgroundImage(url: string): void {
    if (this.backgroundImageUrl === url || this.failedBackgroundImageUrl === url) return;
    this.backgroundImageUrl = url;
    this.backgroundImage = undefined;
    const image = new Image();
    image.decoding = "async";
    if (!url.startsWith("data:") && !url.startsWith("blob:")) image.crossOrigin = "anonymous";
    image.addEventListener(
      "load",
      () => {
        if (this.config.backgroundImageUrl !== url) return;
        this.backgroundImage = image;
        this.failedBackgroundImageUrl = "";
        this.backgroundSig = "";
        this.applyBackground();
        if (!this.running) this.renderOnce();
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        if (this.config.backgroundImageUrl !== url) return;
        this.failedBackgroundImageUrl = url;
        this.backgroundSig = "";
        this.applyBackground();
        if (!this.running) this.renderOnce();
      },
      { once: true },
    );
    image.src = url;
  }

  private ensureBackgroundVideo(url: string): void {
    if (this.backgroundVideoUrl === url || this.failedBackgroundVideoUrl === url) return;
    this.clearBackgroundVideo();
    this.backgroundVideoUrl = url;
    const video = this.createLoopingVideo(url);
    video.addEventListener(
      "loadeddata",
      () => {
        if (this.config.backgroundVideoUrl !== url) return;
        this.backgroundVideo = video;
        this.failedBackgroundVideoUrl = "";
        this.backgroundSig = "";
        this.applyBackground();
        this.syncVideoPlayback();
        if (!this.running) this.renderOnce();
      },
      { once: true },
    );
    video.addEventListener(
      "error",
      () => {
        if (this.config.backgroundVideoUrl !== url) return;
        this.failedBackgroundVideoUrl = url;
        this.backgroundSig = "";
        this.applyBackground();
        if (!this.running) this.renderOnce();
      },
      { once: true },
    );
    this.backgroundVideo = video;
    video.load();
  }

  private clearBackgroundVideo(): void {
    if (this.backgroundVideo) {
      this.backgroundVideo.pause();
      this.backgroundVideo.removeAttribute("src");
      this.backgroundVideo.load();
    }
    this.backgroundVideo = undefined;
    this.backgroundVideoUrl = "";
    this.failedBackgroundVideoUrl = "";
    this.backgroundVideoCanvas = undefined;
  }

  private createLoopingVideo(url: string): HTMLVideoElement {
    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    if (!url.startsWith("data:") && !url.startsWith("blob:")) video.crossOrigin = "anonymous";
    video.src = url;
    return video;
  }

  private syncVideoPlayback(): void {
    const backgroundActive =
      this.running &&
      !this.config.transparentBackground &&
      this.config.backgroundMode === "image" &&
      !!this.config.backgroundVideoUrl;
    if (this.backgroundVideo) {
      if (backgroundActive) void this.backgroundVideo.play().catch(() => {});
      else this.backgroundVideo.pause();
    }
    // Palette videos are per wave.
    this.waves.forEach((wave, i) => {
      const sc = this.config.waves[i] ?? this.config.waves[this.config.waves.length - 1];
      wave.palette.syncPlayback(sc, this.running);
    });
  }

  private updateBackgroundVideoFrame(): void {
    const video = this.backgroundVideo;
    const canvas = this.backgroundVideoCanvas;
    if (!video || !canvas || video.readyState < 2 || !this.backgroundTexture) return;
    const position = this.config.backgroundImagePosition ?? { x: 0, y: 0 };
    drawBackgroundMediaFrame(
      canvas,
      video,
      video.videoWidth,
      video.videoHeight,
      this.config.backgroundImageFit ?? "cover",
      this.config.background,
      this.config.backgroundImageZoom ?? 1,
      position.x,
      position.y,
    );
    this.backgroundTexture.needsUpdate = true;
  }

  private applyPost(): void {
    const u = this.postPass.uniforms;
    u.uBlurAmount.value = this.config.blur;
    u.uGrainAmount.value = this.config.grain;
    u.uBlurSamples.value = Math.round(this.config.blurSamples ?? 6);
    this.applyBloom();
    this.applyDither();
  }

  /** Insert / tune / remove the bloom pass. strength 0 removes it from the composer entirely, so
   *  cost and pixels are identical to bloom-off; the pass (and its mip-chain render targets) is
   *  created lazily the first time bloom is enabled and disposed when turned back off. It sits
   *  right after the scene RenderPass so it blooms the wave before the grain/blur pass. */
  private applyBloom(): void {
    const strength = this.config.bloomStrength ?? 0;
    if (strength > 0) {
      if (!this.bloomPass) {
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        this.bloomPass = new UnrealBloomPass(
          size,
          strength,
          this.config.bloomRadius ?? 0.4,
          this.config.bloomThreshold ?? 0.85,
        );
        this.composer.insertPass(this.bloomPass, 1); // after RenderPass, before postPass/OutputPass
      }
      this.bloomPass.strength = strength;
      this.bloomPass.radius = this.config.bloomRadius ?? 0.4;
      this.bloomPass.threshold = this.config.bloomThreshold ?? 0.85;
    } else if (this.bloomPass) {
      this.composer.removePass(this.bloomPass);
      this.bloomPass.dispose();
      this.bloomPass = undefined;
    }
  }

  /** Insert / tune / remove the dithering pass — a self-contained "layered" post shader (an ordered
   *  Bayer dither, in the spirit of paper-design/shaders). Like bloom, dither 0 removes the pass
   *  entirely so cost and pixels match dither-off, and it's created lazily on first enable. It is
   *  appended AFTER OutputPass so it runs last and quantizes display-space colour (tone-mapped +
   *  sRGB) — dithering the linear composer buffer would crush the steps in the shadows. */
  private applyDither(): void {
    const strength = this.config.dither ?? 0;
    if (strength > 0) {
      if (!this.ditherPass) {
        this.ditherPass = new ShaderPass({
          uniforms: {
            tDiffuse: { value: null },
            uDitherStrength: { value: strength },
            uDitherScale: { value: this.config.ditherScale ?? 2 },
            uDitherSteps: { value: this.config.ditherSteps ?? 4 },
          },
          vertexShader: postVertexShader,
          fragmentShader: ditherFragmentShader,
        });
        this.composer.addPass(this.ditherPass); // last pass → renders the dithered image to screen
      }
      const u = this.ditherPass.uniforms;
      u.uDitherStrength.value = strength;
      u.uDitherScale.value = Math.max(1, this.config.ditherScale ?? 2);
      u.uDitherSteps.value = Math.max(2, Math.round(this.config.ditherSteps ?? 4));
    } else if (this.ditherPass) {
      this.composer.removePass(this.ditherPass);
      this.ditherPass.dispose();
      this.ditherPass = undefined;
    }
  }

  private onResize = (): void => {
    this.resize();
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault(); // tell the browser we'll recover → no "Aw, Snap" crash
    cancelAnimationFrame(this.rafId);
    this.running = false;
  };

  private onContextRestored = (): void => {
    this.disposeWaves(); // old GPU resources are invalid on a fresh context (per-wave palettes too)
    this.backgroundTexture?.dispose();
    this.backgroundTexture = undefined;
    this.backgroundSig = "";
    this.buildWaves();
    this.resize();
    this.updateRunning();
  };

  resize(): void {
    const w = this.outputSize?.width ?? Math.max(1, this.container.clientWidth);
    const h = this.outputSize?.height ?? Math.max(1, this.container.clientHeight);
    const dpr = this.outputSize ? 1 : Math.min(window.devicePixelRatio || 1, this.config.dprMax);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, !this.outputSize);
    if (this.outputSize) {
      // setSize(..., false) preserves the exact backing buffer without writing fixed CSS
      // pixel dimensions. Keep the canvas stretched to the visible aspect-ratio frame.
      this.renderer.domElement.style.width = "100%";
      this.renderer.domElement.style.height = "100%";
    }
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    const dw = w * dpr;
    const dh = h * dpr;
    (this.postPass.uniforms.uResolution.value as THREE.Vector2).set(dw, dh);
    for (const s of this.waves) {
      (s.material.uniforms.uResolution.value as THREE.Vector2).set(dw, dh);
    }
    // The responsive ortho framing: the frustum = the canvas in DEVICE pixels (1 world unit =
    // 1px at zoom 1). Combined with the ×10 mesh scale, the wave overflows the frame.
    this.camera.left = -dw / 2;
    this.camera.right = dw / 2;
    this.camera.top = dh / 2;
    this.camera.bottom = -dh / 2;
    this.applyZoom(); // responsive ortho zoom (maps FRAME_W world units onto the canvas)
    this.applyBackground();
    this.onAfterResize();
    if (!this.running) this.renderOnce();
  }

  /** Set an exact output buffer while CSS scales the canvas into the on-screen export frame. */
  setOutputSize(width: number, height: number): void {
    this.outputSize = {
      width: THREE.MathUtils.clamp(Math.round(width), 64, 8192),
      height: THREE.MathUtils.clamp(Math.round(height), 64, 8192),
    };
    this.resize();
  }

  start(): void {
    this.started = true;
    this.updateRunning();
  }

  stop(): void {
    this.started = false;
    this.updateRunning();
  }

  private onMotionChange = (e: MediaQueryListEvent): void => {
    this.reducedMotion = this.respectReducedMotion && e.matches;
    this.updateRunning();
  };

  private onVisibilityChange = (): void => {
    this.pageVisible = document.visibilityState === "visible";
    this.updateRunning();
  };

  private updateRunning(): void {
    const shouldAnimate =
      this.started &&
      this.visible &&
      this.pageVisible &&
      !this.config.paused &&
      !this.reducedMotion;

    if (shouldAnimate && !this.running) {
      this.running = true;
      // Reset the delta baseline (as Clock.start() + a discarded getDelta() used to) so the first
      // frame advances by ~one frame, not by the whole idle/pause gap that elapsed while stopped.
      this.timer.update();
      this.rafId = requestAnimationFrame(this.loop);
    } else if (!shouldAnimate && this.running) {
      this.running = false;
      cancelAnimationFrame(this.rafId);
    }
    // When not animating (paused / reduced-motion / static export) show the FULL frame, not a
    // frozen mid-ease, by forcing introTimeRamp = 1.
    if (!this.running) {
      this.introTimeRamp = 1;
      this.interaction?.settle(); // collapse pointer/input to rest before the one settled frame
      this.renderOnce();
    }
    this.syncVideoPlayback();
  }

  private loop = (): void => {
    if (!this.running) return;
    this.timer.update();
    const dt = this.timer.getDelta();
    this.time += dt;
    this.interaction?.update(dt); // advance smoothed input by the SAME delta (no time-model change)
    if (this.introTimeRamp < 1) this.introTimeRamp = Math.min(1, this.introTimeRamp + 0.016); // ~1s to full at 60fps
    this.renderOnce();
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Advance the per-frame time uniforms (geometry itself is static). Time model:
   *  time = elapsed·introTimeRamp + timeOffset — the ramp eases the animation in on load. */
  private updateTime(): void {
    // Skip the ease-in when asked: a fresh renderer (first load, or the studio's HMR hot-swap)
    // starts introTimeRamp at 0, and replaying the ramp on every save reads as a "speed up" when
    // you tab back. The studio passes skipIntroRamp in dev; prod builds + the embed keep the ease-in.
    const ramp = this.config.introRamp === false || this.skipIntroRamp ? 1 : this.introTimeRamp;
    const t = this.time * ramp + (this.config.timeOffset ?? 0) + this.interactionTimeOffset;
    // Indexed loop (no per-frame closure) — this runs every frame.
    for (let i = 0; i < this.waves.length; i++) {
      const u = this.waves[i].material.uniforms;
      u.uTime.value = t;
      // Palette drift: flow the colour along the ribbon independently of the geometry by drifting
      // uPaletteOffset over time. Only touch it when nonzero, so refresh()'s static base offset —
      // and every drift-off preset — is left byte-for-byte unchanged.
      const sc = this.config.waves[i] ?? this.config.waves[this.config.waves.length - 1];
      const dx = sc.paletteDriftX ?? 0;
      const dy = sc.paletteDriftY ?? 0;
      if (dx !== 0 || dy !== 0) {
        const base = sc.paletteTextureOffset;
        (u.uPaletteOffset.value as THREE.Vector2).set(base.x + dx * t, base.y + dy * t);
      }
    }
    this.postPass.uniforms.uTime.value = t;
  }

  /** Render exactly one frame at the current time. */
  renderOnce(): void {
    this.updateBackgroundVideoFrame();
    this.updateTime();
    this.applyInteraction(); // write pointer + binding uniforms (no-op when off / capturing)
    this.updateClipPlanes(); // keep near/far bracketing the scene so no camera angle clips the wave
    this.composer.render();
    // Editor overlays (gizmo/helpers + camera-rig minimap) draw on top of the composed frame —
    // the studio subclass plugs them in here; the base renders nothing extra.
    this.onAfterRenderFrame();
  }

  /** Create/dispose the interaction controller as config toggles interaction on/off. Called from
   *  refresh(); the compiled define set (POINTER_FX etc.) is handled separately by waveDefines(). */
  private syncInteraction(): void {
    const active = interactionActive(this.config);
    if (active && !this.interaction) {
      this.interaction = new InteractionController(this.container, () => this.config);
    } else if (!active && this.interaction) {
      this.interaction.dispose();
      this.interaction = undefined;
      this.interactionTimeOffset = 0;
      // Clear any live scroll→cameraZoom multiplier left in camera.zoom: with the controller gone
      // applyBindings won't run to reset it, so recompute the zoom here (no-op when already 1).
      if (this.interactionZoom !== 1) {
        this.interactionZoom = 1;
        this.applyZoom();
      }
    }
  }

  /** Per-frame interaction write: dynamic pointer-field uniforms + bindings. No-op without a
   *  controller. While capturing it writes the REST state instead (pointer field zeroed, every bound
   *  param at its authored base) — merely skipping the write would freeze whatever live hover/scroll
   *  state the previous frame left in the uniforms, so exports wouldn't be deterministic. */
  private applyInteraction(): void {
    if (!this.interaction) return;
    if (this.capturing) {
      this.applyInteractionRest();
      return;
    }
    if (anyPointerFxActive(this.config)) this.applyPointerField(this.interaction);
    this.applyBindings(this.interaction);
  }

  /** Write the capture-frame interaction state: exactly what this config renders with no input —
   *  pointer presence + ripple envelopes zeroed (vPointerFall gates every hover effect to 0) and each
   *  bound param at its authored base. Live controller state is left untouched, so the frame after
   *  the capture resumes mid-gesture; the trailing renderOnce() in captureImage restores the preview.
   *  interactionZoom is deliberately NOT reset — captureImage strips it from camera.zoom itself, and
   *  the post-capture restore depends on it being unchanged. */
  private applyInteractionRest(): void {
    for (let i = 0; i < this.waves.length; i++) {
      const sc = this.config.waves[i] ?? this.config.waves[this.config.waves.length - 1];
      if (!wavePointerFxActive(this.config, sc)) continue;
      const u = this.waves[i].material.uniforms;
      u.uPointerActive.value = 0;
      const rAmp = u.uRippleAmp.value as number[];
      for (let r = 0; r < RIPPLE_SLOTS; r++) rAmp[r] = 0;
    }
    // Scene bindings → authored base: blur/grain write straight to the post uniforms; the time
    // offset delta is simply 0 at base. (Live applyBindings recomputes all of these next frame.)
    const sceneBindings = this.config.interaction?.bindings;
    if (sceneBindings) {
      this.interactionSceneOut.timeOffset = this.config.timeOffset ?? 0;
      this.interactionSceneOut.zoom = this.config.cameraZoom ?? 1;
      const sceneArgs = { post: this.postPass.uniforms, out: this.interactionSceneOut };
      for (const b of sceneBindings) {
        const applier = SCENE_APPLIERS[b.target];
        applier.apply(applier.base(this.config), sceneArgs);
      }
    }
    if (this.interactionTimeOffset !== 0) {
      // renderOnce ran updateTime() BEFORE this, so uTime already carries the live offset for the
      // frame about to draw — zero it and re-run updateTime so the capture uses the authored time.
      this.interactionTimeOffset = 0;
      this.updateTime();
    }
    // Per-wave bindings → that wave's authored base.
    for (let i = 0; i < this.waves.length; i++) {
      const sc = this.config.waves[i];
      const bindings = sc?.interaction?.bindings;
      if (!sc || !bindings || bindings.length === 0) continue;
      const wave = this.waves[i];
      for (const b of bindings) {
        const applier = WAVE_APPLIERS[b.target];
        applier.apply(applier.base(sc), { u: wave.material.uniforms, mesh: wave.mesh });
      }
    }
  }

  /** Write the dynamic pointer-field uniforms to every wave that HAS a pointer field. Position /
   *  presence are PER WAVE (each trails the cursor at its own hover smoothing); ripple origins/ages
   *  are shared. Per-wave amplitudes were already pushed statically in refresh(). */
  private applyPointerField(ic: InteractionController): void {
    const dw = this.camera.right - this.camera.left;
    const dh = this.camera.top - this.camera.bottom;
    const aspect = dh !== 0 ? dw / dh : 1;
    const ripples = ic.sample().ripples;
    // Velocity-driven agitation: the configured `agitate` is the full-gesture strength; when the
    // cursor is still the drive drops to a low idle floor, so the churn tracks how you move instead
    // of buzzing at a constant rate the whole time the cursor is merely present.
    const AGITATE_IDLE = 0.2; // fraction of `agitate` still shown when the cursor holds still
    const AGITATE_GAIN = 0.85; // how much cursor speed adds back on top (capped at full strength)
    const agitateDrive = Math.min(1, AGITATE_IDLE + AGITATE_GAIN * ic.pointerFlux());
    const vel = ic.pointerVelocity();
    for (let i = 0; i < this.waves.length; i++) {
      const sc = this.config.waves[i] ?? this.config.waves[this.config.waves.length - 1];
      if (!wavePointerFxActive(this.config, sc)) continue;
      const u = this.waves[i].material.uniforms;
      u.uPointerAgitate.value = (sc.interaction?.hover?.agitate ?? 0) * agitateDrive;
      (u.uPointerVel.value as THREE.Vector2).copy(vel);
      const f = ic.fieldFor(i);
      if (f) {
        (u.uPointer.value as THREE.Vector2).copy(f.ndc);
        u.uPointerActive.value = f.presence;
      } else {
        u.uPointerActive.value = 0; // wave not advanced by update() yet → rest (no hover)
      }
      u.uPointerAspect.value = aspect;
      const rOrigin = u.uRippleOrigin.value as THREE.Vector2[];
      const rAge = u.uRippleAge.value as number[];
      const rAmp = u.uRippleAmp.value as number[];
      for (let r = 0; r < RIPPLE_SLOTS; r++) {
        rOrigin[r].copy(ripples[r].origin);
        rAge[r] = ripples[r].age;
        rAmp[r] = ripples[r].amp;
      }
    }
  }

  /** Evaluate bindings via the applier tables: value = mix(from ?? base, to, smoothedSource). Scene
   *  bindings drive scene params; each wave's bindings drive that wave's uniforms. */
  private applyBindings(ic: InteractionController): void {
    // Scene bindings → scene params. Seed out-params at base; appliers overwrite only what they drive,
    // so with no scene binding these stay at base → interactionTimeOffset 0 / interactionZoom 1.
    this.interactionSceneOut.timeOffset = this.config.timeOffset ?? 0;
    this.interactionSceneOut.zoom = this.config.cameraZoom ?? 1;
    const sceneArgs = { post: this.postPass.uniforms, out: this.interactionSceneOut };
    for (const b of this.config.interaction?.bindings ?? []) {
      const applier = SCENE_APPLIERS[b.target];
      const value = THREE.MathUtils.lerp(
        b.from ?? applier.base(this.config),
        b.to,
        ic.bindingValue(b),
      );
      applier.apply(value, sceneArgs);
    }
    // Per-wave bindings → that wave's uniforms / mesh.
    for (let i = 0; i < this.waves.length; i++) {
      const sc = this.config.waves[i];
      const bindings = sc?.interaction?.bindings;
      if (!sc || !bindings || bindings.length === 0) continue;
      const wave = this.waves[i];
      for (const b of bindings) {
        const applier = WAVE_APPLIERS[b.target];
        const value = THREE.MathUtils.lerp(b.from ?? applier.base(sc), b.to, ic.bindingValue(b));
        applier.apply(value, { u: wave.material.uniforms, mesh: wave.mesh });
      }
    }
    // interactionTimeOffset is the DELTA over config.timeOffset (updateTime adds both together).
    this.interactionTimeOffset =
      this.interactionSceneOut.timeOffset - (this.config.timeOffset ?? 0);
    // interactionZoom is a MULTIPLIER over config.cameraZoom (applyZoom multiplies both). This runs
    // even in the studio (where orbit owns the camera) so a scroll→cameraZoom reaction previews:
    // applyZoom only re-fires when the multiplier actually CHANGES (i.e. you scrub the scroll
    // preview), so it never fights an idle orbit; writeCameraToConfig divides it back out so it can't
    // bake into the saved/exported config, and captureImage strips it so posters use the authored zoom.
    const nextZoom = this.interactionSceneOut.zoom / (this.config.cameraZoom || 1);
    if (nextZoom !== this.interactionZoom) {
      this.interactionZoom = nextZoom;
      this.applyZoom();
    }
  }

  /** Feed a `custom:<name>` interaction input (developer API). No-op when interaction is off. */
  setInteractionInput(name: string, value: number): void {
    this.interaction?.setInput(name, value);
  }

  /** Re-evaluate play/pause after `config.paused` changes. */
  refreshPlayback(): void {
    this.updateRunning();
  }

  /** Jump the camera to the config's authored framing (cameraPosition / cameraTarget /
   *  cameraZoom). Called on whole-config swaps (preset / reset / randomize / import). The base
   *  applies the pose directly; the studio subclass overrides it to also drive the orbit target
   *  and sync the panel. Hook ⑤. */
  protected applyCameraFromConfig(): void {
    const p = this.config.cameraPosition;
    const tg = this.config.cameraTarget;
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(tg.x, tg.y, tg.z);
    this.applyZoom();
    if (!this.running) this.renderOnce();
  }

  // ---- Editor hook points (no-ops in the base; the studio subclass overrides them) ----

  /** Hook ①: true while orbit or an edit gizmo owns the camera, so refresh() won't reset it. */
  protected isCameraExternallyDriven(): boolean {
    return false;
  }

  /** Hook ②: called at the end of refresh(), before the trailing renderOnce(). */
  protected onAfterRefresh(): void {}

  /** Hook ③: called at the end of renderOnce(), after the composed frame is drawn. */
  protected onAfterRenderFrame(): void {}

  /** Hook ④: called at the end of resize(), before the trailing renderOnce(). */
  protected onAfterResize(): void {}

  /** Responsive ortho zoom: COVER the FRAME_W × FRAME_H reference frame onto the canvas so the
   *  wave frames the same at any size/aspect/dpr (only the cropped margin differs), times the
   *  user's cameraZoom. `max(...)` = cover (fill both axes, crop overflow); `min(...)` would be
   *  contain (fit with letterbox bands). Cover keeps the wave filling the frame on every screen. */
  protected applyZoom(): void {
    const dw = this.camera.right - this.camera.left; // device px (set in resize)
    const dh = this.camera.top - this.camera.bottom;
    // A cameraZoom binding multiplies in here. It stays 1 unless a binding drives it; when one does,
    // writeCameraToConfig divides it back out (so the studio's orbit-persisted config isn't polluted)
    // and captureImage strips it from camera.zoom (so exports use the authored framing).
    this.camera.zoom =
      Math.max(dw / FRAME_W, dh / FRAME_H) * (this.config.cameraZoom ?? 1) * this.interactionZoom;
    this.camera.updateProjectionMatrix();
  }

  /** Fit the orthographic near/far planes to the scene before every render, so no part of a wave
   *  is ever clipped as the camera orbits / dollies / pans (or when waves are added or scaled).
   *
   *  The camera is *constructed* with fixed 1..10000 planes that only suit the authored hero
   *  framing; once the view moves, the wave's depth extent along the view axis easily crosses
   *  them and the GPU hard-slices the geometry along a flat plane — chunks of the wave vanish.
   *
   *  The in-shader twist rotates each vertex about its LOCAL origin, so it can never move a vertex
   *  further from that origin than the base geometry already sits. A sphere at each mesh's origin
   *  (radius = base extent × the mesh's largest world scale, plus the Y displacement, ×1.2 slack)
   *  therefore safely contains the fully-deformed wave. We union those, then bracket the union
   *  along the view axis with a margin. Bracketing to the scene (rather than a fixed huge slab)
   *  keeps clip-space depth scene-normalised — so the wireframe theme's depth fade, which reads
   *  gl_Position.z, looks the same at any camera distance instead of washing out. Runs each frame;
   *  it's a handful of vector ops over 1–8 meshes with no allocation. */
  private updateClipPlanes(): void {
    this.clipBox.makeEmpty();
    for (let i = 0; i < this.waves.length; i++) {
      const wave = this.waves[i];
      const mesh = wave.mesh;
      mesh.updateWorldMatrix(true, false);
      const bs = mesh.geometry.boundingSphere;
      if (!bs) continue;
      // The twist pivot (the mesh's local origin) in world space = the safe sphere's centre.
      const center = this.clipTmpA.setFromMatrixPosition(mesh.matrixWorld);
      const disp = Math.abs(Number(wave.material.uniforms.uDispAmount.value) || 0);
      // Extra wave-local displacement THIS wave's pointer field can add (agitation + push/wake +
      // ripple — worst case they all stack at the cursor), so the deformed surface never crosses the
      // fitted near/far planes. 0 when off → byte-identical.
      const sc = this.config.waves[i] ?? this.config.waves[this.config.waves.length - 1];
      let pointerDisp = 0;
      if (wavePointerFxActive(this.config, sc)) {
        const h = sc.interaction?.hover;
        pointerDisp =
          (h?.agitate ?? 0) +
          Math.abs(h?.push ?? 0) +
          (h?.wake ?? 0) +
          (sc.interaction?.press?.ripple ?? 0);
      }
      const localRadius = bs.center.length() + bs.radius + disp + pointerDisp;
      const radius = localRadius * mesh.matrixWorld.getMaxScaleOnAxis() * 1.2;
      // Enclose this wave's sphere by adding its axis-aligned bounding cube corners.
      this.clipBox.expandByPoint(this.clipTmpB.copy(center).addScalar(radius));
      this.clipBox.expandByPoint(this.clipTmpB.copy(center).addScalar(-radius));
    }
    if (this.clipBox.isEmpty()) return;
    this.clipBox.getBoundingSphere(this.clipSphere);
    const viewDir = this.camera.getWorldDirection(this.clipTmpA); // normalised view axis
    const centerDepth = this.clipTmpB
      .copy(this.clipSphere.center)
      .sub(this.camera.position)
      .dot(viewDir);
    const radius = this.clipSphere.radius;
    const margin = radius * 0.25 + 10;
    // Orthographic: a negative near is legal — the slab may extend behind the camera origin.
    this.camera.near = centerDepth - radius - margin;
    this.camera.far = centerDepth + radius + margin;
    this.camera.updateProjectionMatrix();
  }

  /** A world-space position delta that drops a duplicated wave into open frame space beside the
   *  one it was copied from — screen-left and a touch down, sized to the visible frame — instead
   *  of hidden exactly on top of it or (for the hero, which fills the right of the frame) pushed
   *  off-frame. Camera-relative: it's "left on screen" no matter how the view is rotated/zoomed,
   *  because it's built from the camera's right/up axes and the frame's visible world size. */

  async captureImage(
    mime: string,
    transparent = true,
    quality?: number,
    time?: number,
  ): Promise<Blob> {
    const prevBg = this.config.transparentBackground;
    if (transparent !== prevBg) {
      this.config.transparentBackground = transparent;
      this.applyBackground();
    }
    // Deterministic frame: render at a fixed animation-time (with the ease-in ramp forced full) so
    // a captured poster is reproducible instead of whatever frame happened to be on screen — pass
    // time = 0 for the frame the wave opens on. Restored in `finally`. Undefined = the live frame.
    const fixTime = time !== undefined;
    const prevTime = this.time;
    const prevRamp = this.introTimeRamp;
    if (fixTime) {
      this.time = time;
      this.introTimeRamp = 1;
    }
    let blob: Blob | null = null;
    // Exports use the AUTHORED framing — strip any live scroll→cameraZoom multiplier from camera.zoom
    // for the capture render (config itself is never polluted, so code/embed exports are already
    // clean; this covers the pixel capture). The trailing renderOnce() restores the live preview.
    const prevZoom = this.camera.zoom;
    const strippingZoom = this.interactionZoom !== 1;
    try {
      this.capturing = true;
      if (strippingZoom) {
        this.camera.zoom = prevZoom / this.interactionZoom;
        this.camera.updateProjectionMatrix();
      }
      this.renderOnce();
      blob = await new Promise<Blob | null>((resolve) =>
        this.canvas.toBlob(resolve, mime, quality),
      );
    } finally {
      this.capturing = false;
      if (strippingZoom) {
        this.camera.zoom = prevZoom;
        this.camera.updateProjectionMatrix();
      }
      if (transparent !== prevBg) {
        this.config.transparentBackground = prevBg;
        this.applyBackground();
      }
      if (fixTime) {
        this.time = prevTime;
        this.introTimeRamp = prevRamp;
      }
      this.renderOnce();
    }
    if (!blob || blob.type !== mime) throw new Error(`Failed to capture ${mime}`);
    return blob;
  }

  captureStream(fps = 60): MediaStream {
    return this.canvas.captureStream(fps);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  getConfig(): StudioConfig {
    return this.config;
  }

  setConfig(config: StudioConfig): void {
    const next = ensureStudioConfig(config);
    const structural =
      next.waves.length !== this.waves.length || next.quality !== this.config.quality;
    this.config = next;
    if (structural) this.rebuild();
    else this.refresh();
    // A whole new config (preset/reset/randomize/import) carries its own authored framing —
    // apply it even in the studio, where refresh() leaves the camera to orbit. Without this,
    // selecting a preset updated the wave but kept the previous camera (wrong framing).
    this.applyCameraFromConfig();
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.running = false;
    this.interaction?.dispose();
    this.interaction = undefined;
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.motionQuery.removeEventListener("change", this.onMotionChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.clearBackgroundVideo();
    this.backgroundTexture?.dispose();
    for (const s of this.waves) {
      s.material.dispose();
      s.geometry.dispose();
      s.palette.dispose();
    }
    this.bloomPass?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
