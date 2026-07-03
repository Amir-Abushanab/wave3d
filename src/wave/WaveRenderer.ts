import * as THREE from "three";
import { roundTo } from "../util/math";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
// Editor-only controls are lazy-loaded (see ensureGizmo) so the production embed
// — which never enters edit mode — doesn't pay for them.
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  vertexShader,
  fragmentShader,
  lineFragmentShader,
  postVertexShader,
  postFragmentShader,
} from "./shaders";
import { WaveGeometry } from "./WaveGeometry";
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
  DEFAULT_LIGHT_POSITION,
  createLight,
  ensureStudioConfig,
} from "./config";
import type { StudioConfig, WaveConfig, BlendMode, LightConfig } from "./config";

const BASE_SEGMENTS = 220; // base segment count along the ribbon; denser = smoother (scaled down per wave — see get segments)

/** Reference frame (world units) the orthographic camera fills at cameraZoom 1. The wave is
 *  framed by COVERING this FRAME_W × FRAME_H rectangle (centred on cameraTarget) into the canvas
 *  — scaled to fill both dimensions, cropping the aspect overflow — so a given cameraZoom /
 *  cameraTarget frames the wave the SAME at any canvas size or aspect (only the cropped margin
 *  differs). FRAME_H = FRAME_W / (16/9) makes the reference a 16:9 rectangle; for canvases wider
 *  than that the width binds, narrower ones zoom in to fill instead of
 *  showing empty bands. This is what makes a saved preset reproduce on anyone's screen. */
const FRAME_W = 1333;
const FRAME_H = 750;

export interface WaveRendererOptions {
  /** Honor prefers-reduced-motion by freezing animation. Default true. */
  respectReducedMotion?: boolean;
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

// The minimap's fixed 3/4 vantage direction.
const MINIMAP_VANTAGE = new THREE.Vector3(0.85, 0.6, 1).normalize();

function hexToLinearVec3(hex: string, target: THREE.Vector3): THREE.Vector3 {
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
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly group = new THREE.Group();
  private readonly composer: EffectComposer;
  private readonly postPass: ShaderPass;
  private readonly container: HTMLElement;
  private readonly respectReducedMotion: boolean;

  private config: StudioConfig;
  private waves: Wave[] = [];

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
  /** Set while the panel drives the camera, so orbit's 'change' doesn't re-refresh the
   *  panel mid-drag (the panel already knows the new value). */
  private suppressCameraChange = false;
  /** Authored default camera pose, for "Reset camera". */
  private readonly homeCamPos = new THREE.Vector3();
  private readonly homeCamTarget = new THREE.Vector3();

  // Reused scratch for per-frame clip-plane fitting (see updateClipPlanes) — hoisted so the
  // render loop allocates nothing.
  private readonly clipBox = new THREE.Box3();
  private readonly clipSphere = new THREE.Sphere();
  private readonly clipTmpA = new THREE.Vector3();
  private readonly clipTmpB = new THREE.Vector3();

  // Same for the minimap, which renders every frame while the camera rig is open.
  private readonly miniBox = new THREE.Box3();
  private readonly miniSphere = new THREE.Sphere();
  private readonly miniTmpA = new THREE.Vector3();
  private readonly miniTmpB = new THREE.Vector3();
  private readonly miniPrevColor = new THREE.Color();
  private readonly miniSize = new THREE.Vector2();
  // Per-wave blend/transparent stash for the minimap's forced-opaque draw (index-parallel to waves).
  private readonly miniBlendPrev: THREE.Blending[] = [];
  private readonly miniTransPrev: boolean[] = [];

  // --- Camera-rig minimap (corner inset: the wave + a little camera/light marker) ---
  private cameraRigOn = false;
  private cameraRigCollapsed = false;
  private minimapCamera?: THREE.PerspectiveCamera;
  private camMarker?: THREE.Group;
  /** Gold markers in the minimap, one per rig light (positions/colours tracked live). */
  private minimapLights: THREE.Mesh[] = [];
  /** Shown in the rig when no light has been added yet, so the light is always visible there.
   *  Matches where "drag in 3D" creates the first light, so the marker doesn't jump when added. */
  private readonly defaultRigLight: LightConfig = createLight({ ...DEFAULT_LIGHT_POSITION }, 1);
  private minimapBtn?: HTMLButtonElement;

  private readonly clock = new THREE.Clock();
  private time = 0;
  private rafId = 0;
  private running = false;
  private started = false;

  private visible = true;
  private pageVisible = true;
  private reducedMotion = false;
  /** Intro ramp: eases animation time 0→1 over ~1s on load (when config.introRamp). */
  private introTimeRamp = 0;

  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly motionQuery: MediaQueryList;

  // --- Camera controls (orbit/zoom/pan) + light-editing gizmo ---
  private readonly overlay = new THREE.Scene();
  private readonly raycaster = new THREE.Raycaster();
  private orbit?: OrbitControls;
  private transform?: TransformControls;
  /** Whether the main view orbit/zoom/pan is on (studio); off for the embed. */
  private mainOrbitOn = false;
  private lightHelpers: THREE.Mesh[] = [];
  /** Which 3D-editing gizmo is active: none, dragging lights, or dragging the wave/waves. */
  private editMode: "none" | "light" | "wave" = "none";
  private selectedLight = 0;
  /** Wave/wave drag handles: index 0 = the whole-wave box (moves config.position); 1..N =
   *  per-wave spheres (move each layer's offset), shown only when there's >1 wave. */
  private waveHelpers: THREE.Mesh[] = [];
  private selectedWave = 0;
  /** Gizmo operation: "translate" moves the handle, "rotate" spins the whole wave. */
  private gizmoMode: "translate" | "rotate" = "translate";
  /** Active free screen-plane drag of a handle (grab anywhere on the marker, camera locked). */
  private dragState?: { helper: THREE.Mesh; offset: THREE.Vector3 };
  private readonly dragPlane = new THREE.Plane();
  /** Active left-drag camera pan in edit mode (the press missed every handle → move the view). */
  private panState?: { lastNdc: THREE.Vector2 };
  /** Camera snapshot taken when entering a 3D-edit mode and restored verbatim on exit, so the
   *  view returns exactly where it was (position + ortho zoom + up) rather than snapping to the
   *  authored hero framing. */
  private returnCamera: {
    pos: THREE.Vector3;
    target: THREE.Vector3;
    zoom: number;
    up: THREE.Vector3;
  } | null = null;
  private capturing = false;
  /** Fixed backing-buffer dimensions used by the studio's visible export frame. Embeds leave
   *  this unset and continue to resize responsively with their container and device DPR. */
  private outputSize?: { width: number; height: number };
  /** Set by the panel: fired after a gizmo drag/selection so sliders can refresh. */
  onLightsChanged?: (selected: number) => void;
  /** Set by the panel: fired after orbit moves the camera so sliders can refresh. */
  onCameraChanged?: () => void;
  /** Set by the panel: fired after a wave/wave gizmo drag/selection so the position and
   *  per-wave offset sliders can refresh. */
  onWaveChanged?: () => void;

  constructor(container: HTMLElement, config: StudioConfig, options: WaveRendererOptions = {}) {
    this.container = container;
    this.config = ensureStudioConfig(config);
    this.respectReducedMotion = options.respectReducedMotion ?? true;

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
    return {
      // Deformation (vertex)
      uTime: { value: 0 },
      uSpeed: { value: 0.05 },
      uSeed: { value: 0 },
      uDispFreqX: { value: 0.003234 },
      uDispFreqZ: { value: 0.00799 },
      uDispAmount: { value: 6.051 },
      uTwFreqX: { value: -0.055 },
      uTwFreqY: { value: 0.077 },
      uTwFreqZ: { value: -0.518 },
      uTwPowX: { value: 3.95 },
      uTwPowY: { value: 5.85 },
      uTwPowZ: { value: 6.33 },
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
      uHueShift: { value: 0 },
      uLayerHue: { value: 0 },
      uContrast: { value: 1 },
      uSaturation: { value: 1 },
      uFiberCount: { value: 90 },
      uFiberStrength: { value: 0.25 },
      uTexture: { value: 0 },
      uCreaseLight: { value: 0.15 },
      uCreaseSharpness: { value: 2.0 },
      uCreaseSoftness: { value: 1.0 },
      uEdgeFade: { value: 0.06 },
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
    };
  }

  private addWave(): void {
    const geo = new WaveGeometry(this.segments);
    // Initialise defines/fragment/blend from the wave this material will represent, so the
    // first refresh() doesn't force a needless program recompile. Falls back to the first wave.
    const sc = this.config.waves[this.waves.length] ?? this.config.waves[0];
    const material = new THREE.ShaderMaterial({
      uniforms: this.makeUniforms(),
      // TWIST_MOTION selects the variant vertex shader (an animated twist-X wobble) over the
      // standard one. Toggled live in refresh() per wave.
      defines: sc?.twistMotion ? { TWIST_MOTION: "" } : {},
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
    // Once orbit owns the camera (studio), don't fight it here; the embed (no orbit)
    // applies the saved camera position/target so it matches the authored view.
    if (!this.orbit && !this.editing) {
      const p = this.config.cameraPosition;
      const tg = this.config.cameraTarget;
      this.camera.position.set(p.x, p.y, p.z);
      this.camera.lookAt(tg.x, tg.y, tg.z);
    }

    this.waves.forEach((wave, i) => {
      const sc = this.config.waves[i] ?? this.config.waves[this.config.waves.length - 1];
      const u = wave.material.uniforms;
      if (this.applyBlendMode(wave.material, sc.blendMode)) wave.material.needsUpdate = true;
      // Switch between the standard and variant (animated-twist) vertex shaders by
      // adding/removing the TWIST_MOTION define and forcing a program recompile.
      const wantMotion = !!sc.twistMotion;
      const hasMotion = "TWIST_MOTION" in (wave.material.defines ?? {});
      if (wantMotion !== hasMotion) {
        wave.material.defines = wantMotion ? { TWIST_MOTION: "" } : {};
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
      // Per-wave hue is absolute, so drive uHueShift and zero the legacy per-layer delta.
      u.uHueShift.value = sc.hueShift;
      u.uLayerHue.value = 0;
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
      u.uEdgeFade.value = sc.edgeFade;
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
      u.uDispFreqX.value = sc.displaceFrequency.x;
      u.uDispFreqZ.value = sc.displaceFrequency.y;
      u.uDispAmount.value = sc.displaceAmount;
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

    this.updatePaletteTextures();
    this.syncVideoPlayback();

    // Whole-wave mirror (world-space flip ≈ screen flip for the near-frontal camera).
    this.group.scale.set(this.config.mirrorH ? -1 : 1, this.config.mirrorV ? -1 : 1, 1);

    if (this.editMode === "light") this.syncLightHelpers();
    else if (this.editMode === "wave") this.syncWaveHelpers();
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
      this.clearBackgroundVideo();
      this.backgroundTexture?.dispose();
      this.backgroundTexture = undefined;
      this.backgroundSig = "";
      this.scene.background = matte;
      return;
    }

    // Live video is redrawn every frame, so cap its staging canvas near 1080p. Still images
    // and procedural maps retain the full 4K-capable background texture path.
    const { width, height } = this.backgroundCanvasSize(
      this.config.backgroundVideoUrl ? 2048 : 4096,
    );
    if (this.config.backgroundMode === "gradient") {
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
      return;
    }

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
    if (this.cameraRigOn) this.positionMinimapBtn();
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
      this.clock.start();
      this.clock.getDelta();
      this.rafId = requestAnimationFrame(this.loop);
    } else if (!shouldAnimate && this.running) {
      this.running = false;
      cancelAnimationFrame(this.rafId);
    }
    // When not animating (paused / reduced-motion / static export) show the FULL frame, not a
    // frozen mid-ease, by forcing introTimeRamp = 1.
    if (!this.running) {
      this.introTimeRamp = 1;
      this.renderOnce();
    }
    this.syncVideoPlayback();
  }

  private loop = (): void => {
    if (!this.running) return;
    this.time += this.clock.getDelta();
    if (this.introTimeRamp < 1) this.introTimeRamp = Math.min(1, this.introTimeRamp + 0.016); // ~1s to full at 60fps
    this.renderOnce();
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Advance the per-frame clock uniforms (geometry itself is static). Time model:
   *  time = elapsed·introTimeRamp + timeOffset — the ramp eases the animation in on load. */
  private updateTime(): void {
    // Skip the ease-in in dev: a fresh renderer (first load, or main.ts's HMR hot-swap) starts
    // introTimeRamp at 0, and replaying the ramp on every save reads as a "speed up" when you tab
    // back. Prod builds + the embed (import.meta.env.DEV === false) keep the ease-in.
    const ramp = this.config.introRamp === false || import.meta.env.DEV ? 1 : this.introTimeRamp;
    const t = this.time * ramp + (this.config.timeOffset ?? 0);
    for (const wave of this.waves) {
      wave.material.uniforms.uTime.value = t;
    }
    this.postPass.uniforms.uTime.value = t;
  }

  /** Render exactly one frame at the current time. */
  renderOnce(): void {
    this.updateBackgroundVideoFrame();
    this.updateTime();
    this.updateClipPlanes(); // keep near/far bracketing the scene so no camera angle clips the wave
    this.composer.render();
    // Draw the light gizmo/helpers on top, crisp (not through the post pass), and
    // never into exports.
    if (this.editing && !this.capturing && this.overlay.children.length > 0) {
      const helpers = this.editMode === "wave" ? this.waveHelpers : this.lightHelpers;
      for (const h of helpers) {
        h.scale.setScalar(Math.max(0.1, this.camera.position.distanceTo(h.position) * 0.09));
      }
      this.renderer.autoClear = false;
      this.renderer.setRenderTarget(null); // draw to the screen, not a leftover composer buffer
      this.renderer.render(this.overlay, this.camera);
      this.renderer.autoClear = true;
    }
    this.renderMinimap();
  }

  /** Re-evaluate play/pause after `config.paused` changes. */
  refreshPlayback(): void {
    this.updateRunning();
  }

  // ---------------- 3D editing (draggable gizmo: lights or wave/waves) ----------------

  /** True while any drag-in-3D gizmo owns the camera (light or wave). */
  private get editing(): boolean {
    return this.editMode !== "none";
  }

  isLightEditMode(): boolean {
    return this.editMode === "light";
  }

  isWaveEditMode(): boolean {
    return this.editMode === "wave";
  }

  /** Toggle 3D light editing: show draggable light handles; off restores the prior view. */
  async setLightEditMode(on: boolean): Promise<void> {
    await this.setEditMode(on ? "light" : "none");
  }

  /** Toggle 3D wave/wave editing: drag the whole wave (and each wave when there's >1). */
  async setWaveEditMode(on: boolean): Promise<void> {
    await this.setEditMode(on ? "wave" : "none");
  }

  /** Enter/leave/switch a 3D-edit mode. Modes are mutually exclusive — turning one on turns
   *  the other off. The camera is snapshotted on the first entry and restored on the final exit
   *  (so light↔wave switches keep the same return view). */
  private async setEditMode(mode: "none" | "light" | "wave"): Promise<void> {
    if (mode === this.editMode) return;
    const prev = this.editMode;
    // Tear down the previous mode's handles + gizmo.
    if (prev !== "none") {
      if (this.transform) this.transform.enabled = false;
      this.transform?.detach();
      if (prev === "light") this.clearLightHelpers();
      else this.clearWaveHelpers();
    }
    this.editMode = mode;
    // Leaving LIGHT mode undoes its transient 3/4 framing (back to the pre-edit camera). Wave
    // editing never moves the camera, so there's nothing to restore when leaving it.
    if (prev === "light") this.restoreReturnCamera();
    if (mode === "none") {
      if (this.orbit) this.orbit.enabled = this.mainOrbitOn; // keep main-view orbit on
      this.setOrbitForEdit(false); // restore left-drag camera pan
      this.dragState = undefined;
      this.renderOnce();
      return;
    }
    await this.ensureGizmo();
    if (this.editMode !== mode) return; // toggled away while controls lazy-loaded
    if (this.orbit) this.orbit.enabled = true;
    this.setOrbitForEdit(true); // left-drag on a handle moves it; on empty space it pans
    this.gizmoMode = "translate"; // each mode entry starts in move mode (rotate is wave-only)
    this.transform?.setMode("translate");
    if (this.transform) this.transform.enabled = true;
    if (mode === "light") {
      // Light editing reframes to a 3/4 working angle, so snapshot the current view first and
      // restore it on exit (the framing is transient, not part of the authored composition).
      this.captureReturnCamera();
      this.syncLightHelpers();
      this.frameEditCamera();
      this.selectLight(Math.min(this.selectedLight, Math.max(0, this.lightHelpers.length - 1)));
    } else {
      // Wave editing leaves the camera exactly where it is — no reframing, no zoom — so the view
      // stays put on enter AND exit; you pan/rotate/zoom normally to reach a handle and drag it.
      this.syncWaveHelpers();
      this.selectWaveHandle(Math.min(this.selectedWave, Math.max(0, this.waveHelpers.length - 1)));
    }
    this.renderOnce();
  }

  /** In edit mode, take PAN off OrbitControls' left button so left-drag is free to grab handles;
   *  onPointerDown/Move pan the camera manually when a left-press misses every handle (so panning
   *  never fights the object drag). Right-drag still rotates the camera; scroll/middle zooms. */
  private setOrbitForEdit(editing: boolean): void {
    if (!this.orbit) return;
    this.orbit.mouseButtons = editing
      ? { MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  }

  /** Switch the wave-edit gizmo between moving handles and rotating the whole wave. Rotate
   *  targets the whole-wave box (config.rotation), so selecting it makes the intent obvious. */
  setGizmoMode(mode: "translate" | "rotate"): void {
    this.gizmoMode = mode;
    this.transform?.setMode(mode);
    if (mode === "rotate" && this.editMode === "wave") {
      const waveIdx = this.waveHelpers.findIndex((h) => h.userData.kind === "wave");
      if (waveIdx >= 0) this.selectWaveHandle(waveIdx);
    }
    if (!this.running) this.renderOnce();
  }

  getGizmoMode(): "translate" | "rotate" {
    return this.gizmoMode;
  }

  /** Snapshot the live camera so leaving edit mode returns exactly here (incl. ortho zoom). */
  private captureReturnCamera(): void {
    this.returnCamera = {
      pos: this.camera.position.clone(),
      target: this.orbit
        ? this.orbit.target.clone()
        : this.camera.getWorldDirection(new THREE.Vector3()).add(this.camera.position),
      zoom: this.camera.zoom,
      up: this.camera.up.clone(),
    };
  }

  /** Restore the snapshot from captureReturnCamera (falls back to the authored hero camera). */
  private restoreReturnCamera(): void {
    const s = this.returnCamera;
    this.returnCamera = null;
    if (!s) {
      this.restoreHeroCamera();
      return;
    }
    this.camera.position.copy(s.pos);
    this.camera.up.copy(s.up);
    this.camera.zoom = s.zoom;
    this.camera.updateProjectionMatrix();
    if (this.orbit) {
      this.orbit.target.copy(s.target);
      this.orbit.update(); // fires onControlsChange → writes the restored view back to config
    } else {
      this.camera.lookAt(s.target);
    }
  }

  /** Turn on mouse/trackpad orbit + zoom + pan + arrow-key orbit (studio only). */
  async enableOrbit(): Promise<void> {
    this.mainOrbitOn = true;
    this.renderer.domElement.style.cursor = "move"; // 4-way move arrows: left-drag pans the view
    window.addEventListener("keydown", this.onKeyDown);
    await this.ensureOrbit();
    if (this.orbit && !this.editing) this.orbit.enabled = true;
  }

  /** Arrow keys orbit the camera around the target (←/→ azimuth, ↑/↓ elevation). */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.mainOrbitOn || !this.orbit || this.editing) return;
    const t = e.target instanceof HTMLElement ? e.target : null;
    if (t && (t.closest("#panel") || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return; // let the panel keep arrows
    const step = e.shiftKey ? 0.015 : 0.05;
    let az = 0;
    let pol = 0;
    if (e.key === "ArrowLeft") az = -step;
    else if (e.key === "ArrowRight") az = step;
    else if (e.key === "ArrowUp") pol = -step;
    else if (e.key === "ArrowDown") pol = step;
    else return;
    e.preventDefault();
    const offset = this.camera.position.clone().sub(this.orbit.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta += az;
    sph.phi = THREE.MathUtils.clamp(sph.phi + pol, 0.05, Math.PI - 0.05);
    offset.setFromSpherical(sph);
    this.camera.position.copy(this.orbit.target).add(offset);
    this.orbit.update(); // fires 'change' → writes camera to config + renders
  };

  /** Reset the camera to the straight-on hero framing at the configured distance. */
  resetView(): void {
    this.camera.position.copy(this.homeCamPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.homeCamTarget);
    if (this.orbit) {
      this.orbit.target.copy(this.homeCamTarget);
      this.orbit.update();
    }
    this.writeCameraToConfig();
    this.onCameraChanged?.();
    if (!this.running) this.renderOnce();
  }

  /** Dolly/aim the camera so the whole wave fills the viewport (keeps the view angle).
   *  Fits the geometry box's actual *projected* screen extent — tighter than a bounding
   *  sphere for a flat, diagonal ribbon. */
  fitToView(): void {
    const box = new THREE.Box3();
    for (const s of this.waves) {
      s.mesh.updateWorldMatrix(true, false);
      if (!s.mesh.geometry.boundingBox) s.mesh.geometry.computeBoundingBox();
      const bb = s.mesh.geometry.boundingBox;
      if (bb) box.union(bb.clone().applyMatrix4(s.mesh.matrixWorld));
    }
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());

    // Aim at the centre, then measure how much of the viewport the box spans (in NDC).
    if (this.orbit) this.orbit.target.copy(center);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld(true);
    const c = box.min,
      m = box.max;
    let frac = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? m.x : c.x, i & 2 ? m.y : c.y, i & 4 ? m.z : c.z).project(this.camera);
      frac = Math.max(frac, Math.abs(v.x), Math.abs(v.y)); // |ndc| 0→1 = half-viewport
    }
    // Overfill slightly (>1): the folded geometry's bounding box has empty diagonal
    // corners, so filling past the box edges lets the actual ribbon fill the frame.
    // Ortho: framing is the zoom, not the distance.
    const target = 1.18;
    this.config.cameraZoom = ((this.config.cameraZoom ?? 1) * target) / Math.max(0.001, frac);
    this.applyZoom();
    if (this.orbit) this.orbit.update();
    this.writeCameraToConfig();
    this.onCameraChanged?.();
    if (!this.running) this.renderOnce();
  }

  /** Dolly the camera to a distance from the orbit target (or set z when no orbit). */
  setCameraDistance(d: number): void {
    if (this.orbit) {
      const dir = this.camera.position.clone().sub(this.orbit.target);
      const len = dir.length() || 1;
      this.camera.position.copy(this.orbit.target).addScaledVector(dir.multiplyScalar(1 / len), d);
      this.orbit.update();
    } else {
      this.camera.position.z = d;
    }
    this.writeCameraToConfig();
    if (!this.running) this.renderOnce();
  }

  /** The current look-at target (orbit's if present, else from config). */
  private camTarget(): THREE.Vector3 {
    if (this.orbit) return this.orbit.target;
    const t = this.config.cameraTarget;
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** Read the camera as orbit values for the panel (angles in degrees). */
  getCameraOrbit(): {
    azimuth: number;
    elevation: number;
    distance: number;
    panX: number;
    panY: number;
  } {
    const t = this.camTarget();
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(t));
    return {
      azimuth: THREE.MathUtils.radToDeg(sph.theta),
      elevation: 90 - THREE.MathUtils.radToDeg(sph.phi),
      distance: sph.radius,
      panX: t.x,
      panY: t.y,
    };
  }

  /** Place the camera at azimuth/elevation (degrees) + distance around the target. */
  setCameraOrbit(azimuthDeg: number, elevationDeg: number, distance: number): void {
    const target = this.camTarget();
    const sph = new THREE.Spherical(
      Math.max(0.01, distance),
      THREE.MathUtils.degToRad(90 - elevationDeg),
      THREE.MathUtils.degToRad(azimuthDeg),
    );
    sph.makeSafe();
    this.suppressCameraChange = true;
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    if (this.orbit) this.orbit.update();
    this.suppressCameraChange = false;
    this.writeCameraToConfig();
    if (!this.running) this.renderOnce();
  }

  /** Roll the camera around its view axis (degrees) — tilts the composition without
   *  moving the camera. Applied after positioning; reset by any orbit interaction. */
  rollView(deg: number): void {
    this.camera.rotateZ(THREE.MathUtils.degToRad(deg));
    this.camera.updateMatrixWorld();
    if (!this.running) this.renderOnce();
  }

  /** Pan: move the look-at target (and camera with it) to (x, y) in world units. */
  setCameraTarget(x: number, y: number): void {
    const target = this.camTarget();
    const delta = new THREE.Vector3(x - target.x, y - target.y, 0);
    this.suppressCameraChange = true;
    this.camera.position.add(delta);
    if (this.orbit) this.orbit.target.add(delta);
    else this.config.cameraTarget = { x, y, z: target.z };
    this.camera.lookAt(this.camTarget());
    if (this.orbit) this.orbit.update();
    this.suppressCameraChange = false;
    this.writeCameraToConfig();
    if (!this.running) this.renderOnce();
  }

  /** Ortho zoom MULTIPLIER (the camera has no real fov). 1 = the responsive base framing (the hero crop). */
  getZoom(): number {
    return this.config.cameraZoom ?? 1;
  }

  setZoom(zoom: number): void {
    this.config.cameraZoom = THREE.MathUtils.clamp(zoom, 0.1, 6);
    this.applyZoom();
    if (!this.running) this.renderOnce();
  }

  /** Jump the camera to the config's authored framing (cameraPosition / cameraTarget /
   *  cameraZoom). Unlike refresh()'s camera block — which is skipped while orbit owns the
   *  camera so it doesn't fight the user — this is for whole-config swaps (preset / reset /
   *  randomize / import), where the new config's framing SHOULD take over. It also moves the
   *  orbit target so subsequent orbiting pivots correctly, and syncs the panel proxy. */
  private applyCameraFromConfig(): void {
    if (this.editing) return; // a 3D-edit gizmo owns the camera; don't fight it
    const p = this.config.cameraPosition;
    const tg = this.config.cameraTarget;
    this.suppressCameraChange = true;
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(tg.x, tg.y, tg.z);
    if (this.orbit) {
      this.orbit.target.set(tg.x, tg.y, tg.z);
      this.orbit.update();
    }
    this.applyZoom();
    this.suppressCameraChange = false;
    this.onCameraChanged?.(); // keep the panel's camera sliders in sync
    if (!this.running) this.renderOnce();
  }

  /** Responsive ortho zoom: COVER the FRAME_W × FRAME_H reference frame onto the canvas so the
   *  wave frames the same at any size/aspect/dpr (only the cropped margin differs), times the
   *  user's cameraZoom. `max(...)` = cover (fill both axes, crop overflow); `min(...)` would be
   *  contain (fit with letterbox bands). Cover keeps the wave filling the frame on every screen. */
  private applyZoom(): void {
    const dw = this.camera.right - this.camera.left; // device px (set in resize)
    const dh = this.camera.top - this.camera.bottom;
    this.camera.zoom = Math.max(dw / FRAME_W, dh / FRAME_H) * (this.config.cameraZoom ?? 1);
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
    for (const wave of this.waves) {
      const mesh = wave.mesh;
      mesh.updateWorldMatrix(true, false);
      const bs = mesh.geometry.boundingSphere;
      if (!bs) continue;
      // The twist pivot (the mesh's local origin) in world space = the safe sphere's centre.
      const center = this.clipTmpA.setFromMatrixPosition(mesh.matrixWorld);
      const disp = Math.abs(Number(wave.material.uniforms.uDispAmount.value) || 0);
      const localRadius = bs.center.length() + bs.radius + disp;
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
  duplicateOffset(): { x: number; y: number; z: number } {
    this.camera.updateMatrixWorld();
    const worldW = (this.camera.right - this.camera.left) / this.camera.zoom; // visible world span
    const worldH = (this.camera.top - this.camera.bottom) / this.camera.zoom;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    // Screen-left ~40% + screen-down ~15% of the frame: enough to clearly separate the copy, small
    // enough that a few successive adds cascade diagonally and stay on-screen before running off.
    const off = right.multiplyScalar(-0.4 * worldW).add(up.multiplyScalar(-0.15 * worldH));
    return { x: off.x, y: off.y, z: 0 };
  }

  /** Toggle the corner camera-rig minimap (studio aid; off in the embed). */
  setCameraRig(on: boolean): void {
    this.cameraRigOn = on;
    if (on) this.ensureMinimap();
    if (this.minimapBtn) this.minimapBtn.style.display = on ? "" : "none";
    if (on) this.positionMinimapBtn();
    if (!this.running) this.renderOnce();
  }

  /** Corner rectangle (logical px) for the minimap viewport. */
  private minimapRect(): { x: number; y: number; size: number; pad: number } {
    const sz = this.renderer.getSize(new THREE.Vector2());
    const size = Math.round(Math.min(sz.x, sz.y) * 0.27);
    const pad = Math.round(size * 0.06);
    return { x: sz.x - size - pad, y: pad, size, pad };
  }

  /** Place the collapse button at the minimap's top-right (or bottom corner when collapsed). */
  private positionMinimapBtn(): void {
    const b = this.minimapBtn;
    if (!b) return;
    const { size, pad } = this.minimapRect();
    // minimapRect() is in renderer BUFFER px (= the export size); the canvas is CSS-scaled to
    // fill the container, so convert to on-screen px or the button detaches from the minimap.
    const canvas = this.renderer.domElement;
    const buf = this.renderer.getSize(new THREE.Vector2());
    const sx = buf.x > 0 ? canvas.clientWidth / buf.x : 1;
    const sy = buf.y > 0 ? canvas.clientHeight / buf.y : 1;
    b.style.right = pad * sx + "px";
    b.style.bottom = (this.cameraRigCollapsed ? pad * sy : (pad + size) * sy - 22) + "px";
    b.textContent = this.cameraRigCollapsed ? "▴ camera" : "▾ camera";
  }

  /** Build the minimap's fixed 3rd-person camera + the camera/light markers (once). */
  private ensureMinimap(): void {
    if (this.minimapCamera) return;
    // Pose/near/far are recomputed every frame by frameMinimap() to fit the current scene
    // (the wave sits in a ×10 ortho world, so a fixed vantage can't frame it).
    this.minimapCamera = new THREE.PerspectiveCamera(42, 1, 1, 10000);

    // A little camera (body + lens) marking where the main camera views the wave from.
    const marker = new THREE.Group();
    marker.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 2.4, 4.2),
        new THREE.MeshBasicMaterial({ color: 0x2a2f3d }),
      ),
    );
    const lens = new THREE.Mesh(
      new THREE.ConeGeometry(1.3, 2.4, 18),
      new THREE.MeshBasicMaterial({ color: 0x6ea8fe }),
    );
    lens.rotation.x = -Math.PI / 2; // cone points -Z (the camera's forward)
    lens.position.z = -2.7;
    marker.add(lens);
    marker.visible = false;
    this.scene.add(marker);
    this.camMarker = marker;

    // Collapse/expand toggle overlaid on the minimap corner.
    const btn = document.createElement("button");
    btn.style.cssText =
      "position:absolute;z-index:30;padding:2px 8px;border-radius:5px;cursor:pointer;" +
      "font:11px ui-sans-serif,system-ui,-apple-system,sans-serif;color:#cdd0d6;" +
      "background:rgba(18,18,26,0.85);border:1px solid rgba(255,255,255,0.16);";
    btn.addEventListener("click", () => {
      this.cameraRigCollapsed = !this.cameraRigCollapsed;
      this.positionMinimapBtn();
      this.renderOnce();
    });
    this.container.appendChild(btn);
    this.minimapBtn = btn;
    this.positionMinimapBtn();
  }

  /** The lights the rig should show: the configured lights, or a single default-position
   *  marker when none has been added yet — so the light is always visible in the rig. */
  private rigLights(): LightConfig[] {
    const lights = this.config.lights ?? [];
    return lights.length ? lights : [this.defaultRigLight];
  }

  /** Reconcile the minimap's light markers with the rig lights (count, position, colour). */
  private syncMinimapLights(visible: boolean): void {
    const lights = this.rigLights();
    while (this.minimapLights.length < lights.length) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffd24a }),
      );
      m.visible = false;
      this.scene.add(m);
      this.minimapLights.push(m);
    }
    while (this.minimapLights.length > lights.length) {
      const m = this.minimapLights.pop();
      if (!m) break;
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    lights.forEach((l, i) => {
      const m = this.minimapLights[i];
      m.position.set(l.position.x, l.position.y, l.position.z);
      (m.material as THREE.MeshBasicMaterial).color.set(l.color); // track the light's colour
      m.visible = visible;
    });
  }

  /** Fit the minimap's 3rd-person camera to the wave (+ lights) and size/place the camera
   *  proxy, so the rig reads at any scene scale. The main camera is orthographic — its literal
   *  distance is arbitrary — so the proxy sits a fixed multiple of the scene radius back along
   *  the true view direction rather than at the far-away ortho position. */
  private frameMinimap(): void {
    const cam = this.minimapCamera;
    const marker = this.camMarker;
    if (!cam || !marker) return;
    const box = this.miniBox.setFromObject(this.group);
    if (box.isEmpty()) return; // geometry not built yet
    for (const l of this.rigLights()) {
      box.expandByPoint(this.miniTmpA.set(l.position.x, l.position.y, l.position.z));
    }
    const subject = box.getBoundingSphere(this.miniSphere);
    const radius = Math.max(subject.radius, 1);

    // Point the little camera at the wave from its real view direction, kept a sane distance
    // away (using the ortho camera's actual z would push it thousands of units off and dwarf
    // the wave).
    const viewDir = this.camera.getWorldDirection(this.miniTmpA); // points toward the wave
    const markerPos = this.miniTmpB.copy(subject.center).addScaledVector(viewDir, -radius * 1.5);
    marker.position.copy(markerPos);
    marker.quaternion.copy(this.camera.quaternion);
    marker.scale.setScalar(radius * 0.05);
    for (const m of this.minimapLights) m.scale.setScalar(radius * 0.045);

    // Frame the whole rig (wave + proxy) from a fixed 3/4 vantage. (`rig` reuses the sphere
    // behind `subject`, which has no readers past this point.)
    box.expandByPoint(markerPos);
    const rig = box.getBoundingSphere(this.miniSphere);
    const frameR = Math.max(rig.radius, 1);
    cam.position.copy(rig.center).addScaledVector(MINIMAP_VANTAGE, frameR * 2.9);
    cam.near = Math.max(1, frameR * 0.02);
    cam.far = frameR * 10;
    cam.up.set(0, 1, 0);
    cam.lookAt(rig.center);
    cam.updateProjectionMatrix();
  }

  /** Draw the camera-rig minimap into a corner viewport (called after the main render). */
  private renderMinimap(): void {
    if (!this.cameraRigOn || this.cameraRigCollapsed || !this.mainOrbitOn || this.capturing) return;
    if (!this.minimapCamera || !this.camMarker) return;
    // setViewport/setScissor take LOGICAL (CSS) pixels — three applies pixelRatio itself.
    const { x, y, size } = this.minimapRect();

    this.camMarker.visible = true;
    this.syncMinimapLights(true);
    this.frameMinimap();

    const r = this.renderer;
    const prevColor = this.miniPrevColor;
    r.getClearColor(prevColor);
    const prevAlpha = r.getClearAlpha();
    r.autoClear = false;
    r.setRenderTarget(null); // draw to the screen — NOT a leftover composer buffer
    r.setScissorTest(true);
    r.setViewport(x, y, size, size);
    r.setScissor(x, y, size, size);
    r.setClearColor(0x12121a, 0.92);
    r.clear(true, true);
    // scene.background (the wave's page colour / image / gradient) fills ANY camera's view, so
    // hide it while drawing the minimap — otherwise it covers the 3rd-person wave.
    const prevBg = this.scene.background;
    this.scene.background = null;
    // The wave's own blend mode (additive for the neon / Spider-Man presets) makes it vanish on
    // the dark minimap backdrop; force opaque normal blending just for this draw so the shape
    // always reads. The main render already happened, so we restore immediately after.
    for (let i = 0; i < this.waves.length; i++) {
      const m = this.waves[i].material;
      this.miniBlendPrev[i] = m.blending;
      this.miniTransPrev[i] = m.transparent;
      m.blending = THREE.NormalBlending;
      m.transparent = false;
    }
    r.render(this.scene, this.minimapCamera);
    for (let i = 0; i < this.waves.length; i++) {
      const m = this.waves[i].material;
      m.blending = this.miniBlendPrev[i];
      m.transparent = this.miniTransPrev[i];
    }
    this.scene.background = prevBg;
    r.setScissorTest(false);
    const full = this.renderer.getSize(this.miniSize);
    r.setViewport(0, 0, full.x, full.y);
    r.setClearColor(prevColor, prevAlpha);
    r.autoClear = true;

    this.camMarker.visible = false;
    for (const m of this.minimapLights) m.visible = false;
  }

  private async ensureOrbit(): Promise<void> {
    if (this.orbit) return;
    const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
    if (this.orbit) return; // a concurrent call already set it up
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = false;
    this.orbit.enabled = false; // enabled by enableOrbit() / light-edit
    this.orbit.screenSpacePanning = true;
    this.orbit.zoomToCursor = true;
    this.orbit.minDistance = 12;
    this.orbit.maxDistance = 600;
    // Left drag PANS (moves the view around); right drag ROTATES — swapped from the
    // OrbitControls default so the primary drag moves the scene rather than orbiting it.
    this.orbit.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.orbit.target.set(
      this.config.cameraTarget.x,
      this.config.cameraTarget.y,
      this.config.cameraTarget.z,
    );
    this.orbit.update();
    this.orbit.addEventListener("change", this.onControlsChange);
    // Cursor feedback by drag type: left-drag pans → 4-way move arrows; right-drag rotates →
    // grab/closed-hand. Idle stays on the move arrows (the primary drag pans). OrbitControls
    // doesn't expose the button, so we read it from pointerdown directly.
    this.renderer.domElement.addEventListener("pointerdown", this.onCursorDown);
    window.addEventListener("pointerup", this.onCursorUp);
  }

  private onCursorDown = (e: PointerEvent): void => {
    if (this.mainOrbitOn) {
      this.renderer.domElement.style.cursor = e.button === 2 ? "grabbing" : "move";
    }
  };

  private onCursorUp = (): void => {
    if (this.mainOrbitOn) this.renderer.domElement.style.cursor = "move";
  };

  private async ensureGizmo(): Promise<void> {
    await this.ensureOrbit();
    if (this.transform) return;
    const { TransformControls } = await import("three/addons/controls/TransformControls.js");
    if (this.transform) return; // a concurrent call already set it up
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode("translate");
    this.transform.addEventListener("dragging-changed", (e) => {
      if (this.orbit) this.orbit.enabled = !(e as unknown as { value: boolean }).value;
    });
    this.transform.addEventListener("objectChange", this.onGizmoMoved);
    // (onGizmoMoved routes to the light- or wave-drag handler based on the active mode.)
    this.transform.addEventListener("change", this.onControlsChange);
    const tc = this.transform as unknown as { getHelper?: () => THREE.Object3D };
    this.overlay.add(tc.getHelper ? tc.getHelper() : (this.transform as unknown as THREE.Object3D));

    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.onPointerUp);
  }

  private onControlsChange = (): void => {
    // Orbit/zoom/pan moved the camera → capture it so exports match the view. Wave editing keeps
    // the live view (persist it); light editing uses a transient 3/4 working view (don't persist).
    if (
      this.orbit &&
      this.orbit.enabled &&
      this.editMode !== "light" &&
      !this.suppressCameraChange
    ) {
      this.writeCameraToConfig();
      this.onCameraChanged?.();
    }
    if (!this.running) this.renderOnce();
  };

  /** Persist the live camera (position/target/distance) into the config. */
  private writeCameraToConfig(): void {
    const p = this.camera.position;
    this.config.cameraPosition = {
      x: roundTo(p.x, 3),
      y: roundTo(p.y, 3),
      z: roundTo(p.z, 3),
    };
    // Capture the LIVE ortho zoom (mouse-scroll changes camera.zoom directly) back into
    // config.cameraZoom — the user multiplier — by inverting applyZoom's responsive COVER
    // factor. Without this, scroll-zoom changed the view but was never saved/exported, so a
    // framing tuned at a scrolled zoom didn't reproduce (its pan made sense only at that zoom).
    const cover = Math.max(
      (this.camera.right - this.camera.left) / FRAME_W,
      (this.camera.top - this.camera.bottom) / FRAME_H,
    );
    if (cover > 0) this.config.cameraZoom = roundTo(this.camera.zoom / cover, 3);
    if (this.orbit) {
      const t = this.orbit.target;
      this.config.cameraTarget = {
        x: roundTo(t.x, 3),
        y: roundTo(t.y, 3),
        z: roundTo(t.z, 3),
      };
      this.config.cameraDistance = roundTo(p.distanceTo(this.orbit.target), 3);
    }
  }

  /** Pointer position in normalized device coords (-1..1), from a canvas-relative event. */
  private pointerNdc(ev: PointerEvent): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (!this.editing || !this.transform) return;
    if (ev.button !== 0) return; // only left-drag moves objects; right-drag rotates the camera
    if (this.transform.dragging || this.transform.axis) return; // on a gizmo handle → let it move
    this.raycaster.setFromCamera(this.pointerNdc(ev), this.camera);
    const helpers = this.editMode === "wave" ? this.waveHelpers : this.lightHelpers;
    const hit = this.raycaster.intersectObjects(helpers, false)[0];
    if (!hit) {
      // Missed every handle → pan the view (the tool's normal left-drag). OrbitControls' LEFT is
      // unmapped in edit mode, so onPointerMove pans manually without fighting the object drag.
      if (this.orbit) {
        this.panState = { lastNdc: this.pointerNdc(ev) };
        this.renderer.domElement.setPointerCapture?.(ev.pointerId);
      }
      return;
    }
    const idx = helpers.indexOf(hit.object as THREE.Mesh);
    if (idx < 0) return;
    if (this.editMode === "wave") this.selectWaveHandle(idx);
    else this.selectLight(idx);
    // Free screen-plane drag: the WHOLE marker is grabbable (not just the thin gizmo arrows) and
    // the camera stays locked. Rotate mode uses the gizmo's rings instead, so skip it there.
    if (this.gizmoMode !== "translate") return;
    const helper = helpers[idx];
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, helper.position);
    const grab = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, grab)) return;
    this.dragState = { helper, offset: helper.position.clone().sub(grab) };
    if (this.orbit) this.orbit.enabled = false; // lock the camera for the whole drag
    this.renderer.domElement.setPointerCapture?.(ev.pointerId);
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (this.panState) {
      // Ortho pan: unproject the pointer delta into world units (auto-handles zoom/aspect/dpr),
      // then shift camera + orbit target together so the grabbed point tracks the cursor.
      const ndc = this.pointerNdc(ev);
      const before = new THREE.Vector3(this.panState.lastNdc.x, this.panState.lastNdc.y, 0);
      const after = new THREE.Vector3(ndc.x, ndc.y, 0);
      const delta = before.unproject(this.camera).sub(after.unproject(this.camera)); // opposite the cursor
      this.camera.position.add(delta);
      this.panState.lastNdc = ndc;
      if (this.orbit) {
        this.orbit.target.add(delta);
        this.orbit.update(); // fires 'change' → persists the new framing + renders
      } else {
        this.camera.updateProjectionMatrix();
        if (!this.running) this.renderOnce();
      }
      return;
    }
    if (!this.dragState) return;
    this.raycaster.setFromCamera(this.pointerNdc(ev), this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, p)) return;
    this.dragState.helper.position.copy(p.add(this.dragState.offset));
    this.onGizmoMoved(); // write the new position into config + uniforms
    if (!this.running) this.renderOnce();
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (this.panState) {
      this.panState = undefined;
      this.renderer.domElement.releasePointerCapture?.(ev.pointerId);
      return;
    }
    if (!this.dragState) return;
    this.dragState = undefined;
    if (this.orbit) this.orbit.enabled = true; // still editing → keep right-drag camera rotate
    this.renderer.domElement.releasePointerCapture?.(ev.pointerId);
  };

  private selectLight(i: number): void {
    this.selectedLight = i;
    const h = this.lightHelpers[i];
    if (h && this.transform) this.transform.attach(h);
    else this.transform?.detach();
    this.onLightsChanged?.(i);
    if (!this.running) this.renderOnce();
  }

  private selectWaveHandle(i: number): void {
    this.selectedWave = i;
    const h = this.waveHelpers[i];
    if (h && this.transform) this.transform.attach(h);
    else this.transform?.detach();
    this.onWaveChanged?.();
    if (!this.running) this.renderOnce();
  }

  /** Gizmo drag → route to the active mode's writer. */
  private onGizmoMoved = (): void => {
    if (this.editMode === "wave") this.onWaveGizmoMoved();
    else this.onLightGizmoMoved();
  };

  /** Light gizmo drag → write the moved handle back into the config + uniforms. */
  private onLightGizmoMoved(): void {
    const h = this.lightHelpers[this.selectedLight];
    const light = this.config.lights?.[this.selectedLight];
    if (!h || !light) return;
    light.position.x = roundTo(h.position.x, 2);
    light.position.y = roundTo(h.position.y, 2);
    light.position.z = roundTo(h.position.z, 2);
    this.pushLightUniforms();
    this.onLightsChanged?.(this.selectedLight);
  }

  /** Wave gizmo drag → the whole-wave box writes config.position (and the wave handles
   *  follow it); a per-wave sphere writes that layer's offset (relative to config.position). */
  private onWaveGizmoMoved(): void {
    const h = this.waveHelpers[this.selectedWave];
    if (!h) return;
    const wave = this.config.waves[h.userData.index as number];
    if (!wave) return;
    // Mutate the wave's vectors IN PLACE (don't reassign a new object): the panel's Transform
    // sliders hold a reference to these objects, so replacing them would leave the sliders
    // reading the stale old object even though the wave moved.
    if (this.gizmoMode === "rotate") {
      wave.rotation.x = roundTo(THREE.MathUtils.radToDeg(h.rotation.x), 2);
      wave.rotation.y = roundTo(THREE.MathUtils.radToDeg(h.rotation.y), 2);
      wave.rotation.z = roundTo(THREE.MathUtils.radToDeg(h.rotation.z), 2);
    } else {
      wave.position.x = roundTo(h.position.x, 2);
      wave.position.y = roundTo(h.position.y, 2);
      wave.position.z = roundTo(h.position.z, 2);
    }
    this.pushWaveTransforms();
    this.onWaveChanged?.();
  }

  /** Reconcile the helper spheres with config.lights (count, position, colour). */
  private syncLightHelpers(): void {
    const lights = this.config.lights ?? [];
    while (this.lightHelpers.length < lights.length) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
      );
      mesh.renderOrder = 999;
      this.overlay.add(mesh);
      this.lightHelpers.push(mesh);
    }
    while (this.lightHelpers.length > lights.length) {
      const mesh = this.lightHelpers.pop();
      if (!mesh) break;
      this.overlay.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    lights.forEach((l, i) => {
      const h = this.lightHelpers[i];
      h.position.set(l.position.x, l.position.y, l.position.z);
      (h.material as THREE.MeshBasicMaterial).color.set(l.color);
    });
    if (this.selectedLight >= this.lightHelpers.length) {
      this.selectedLight = Math.max(0, this.lightHelpers.length - 1);
    }
    const sel = this.lightHelpers[this.selectedLight];
    if (sel && this.transform && this.transform.object !== sel) this.transform.attach(sel);
    if (!sel) this.transform?.detach();
  }

  private clearLightHelpers(): void {
    for (const mesh of this.lightHelpers) {
      this.overlay.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.lightHelpers = [];
  }

  /** Reconcile the wave drag handles with config: one box handle per wave, sitting at that
   *  wave's absolute position (and oriented to its rotation so the rotate gizmo starts there). */
  private syncWaveHelpers(): void {
    if (this.transform?.dragging) return; // don't yank a handle out from under an active drag
    const waves = this.config.waves ?? [];
    const wantTotal = waves.length;
    if (this.waveHelpers.length !== wantTotal) {
      this.clearWaveHelpers();
      for (let i = 0; i < wantTotal; i++) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 0.55, 0.55),
          new THREE.MeshBasicMaterial({ color: 0x39d0ff, depthTest: false, transparent: true }),
        );
        box.renderOrder = 999;
        box.userData = { kind: "wave", index: i };
        this.overlay.add(box);
        this.waveHelpers.push(box);
      }
    }
    for (const h of this.waveHelpers) {
      const sc = waves[h.userData.index as number];
      if (!sc) continue;
      h.position.set(sc.position.x, sc.position.y, sc.position.z);
      h.rotation.set(
        THREE.MathUtils.degToRad(sc.rotation.x),
        THREE.MathUtils.degToRad(sc.rotation.y),
        THREE.MathUtils.degToRad(sc.rotation.z),
      );
    }
    if (this.selectedWave >= this.waveHelpers.length) this.selectedWave = 0;
    const sel = this.waveHelpers[this.selectedWave];
    if (sel && this.transform && this.transform.object !== sel) this.transform.attach(sel);
    if (!sel) this.transform?.detach();
  }

  private clearWaveHelpers(): void {
    for (const mesh of this.waveHelpers) {
      this.overlay.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.waveHelpers = [];
  }

  /** Reposition just the wave MESHES from each wave's absolute transform — the transform
   *  subset of refresh(), used live during a wave gizmo drag so the ribbon follows without a
   *  full uniform re-push or a helper resync. */
  private pushWaveTransforms(): void {
    this.waves.forEach((wave, i) => {
      const sc = this.config.waves[i] ?? this.config.waves[this.config.waves.length - 1];
      wave.mesh.scale.set(sc.scale.x, sc.scale.y, sc.scale.z);
      wave.mesh.rotation.set(
        THREE.MathUtils.degToRad(sc.rotation.x),
        THREE.MathUtils.degToRad(sc.rotation.y),
        THREE.MathUtils.degToRad(sc.rotation.z),
      );
      wave.mesh.position.set(sc.position.x, sc.position.y, sc.position.z);
    });
    if (!this.running) this.renderOnce();
  }

  /** Pull the camera back to a 3/4 angle that frames the edit target: the origin wave + all
   *  lights (light mode), or a region around config.position + the handles (wave mode). */
  private frameEditCamera(): void {
    const box = new THREE.Box3();
    if (this.editMode === "wave") {
      // The wave can sit far from the origin (some presets push position to the hundreds), so
      // frame around it — a ~200-unit margin shows a good chunk of the ×10-scaled ribbon.
      const target = this.config.waves[this.selectedWave] ?? this.config.waves[0];
      const c = new THREE.Vector3(target.position.x, target.position.y, target.position.z);
      box.expandByPoint(c.clone().addScalar(200));
      box.expandByPoint(c.clone().addScalar(-200));
      for (const h of this.waveHelpers) box.expandByPoint(h.position);
    } else {
      // The baked + scaled wave spans ~±25 units; frame that plus any lights.
      box.expandByPoint(new THREE.Vector3(25, 25, 25));
      box.expandByPoint(new THREE.Vector3(-25, -25, -25));
      for (const l of this.config.lights ?? []) {
        box.expandByPoint(new THREE.Vector3(l.position.x, l.position.y, l.position.z));
      }
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 2);
    const dir = new THREE.Vector3(0.45, 0.35, 1).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(dir, radius * 3 + 200);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(sphere.center);
    // Ortho: frame by zoom (frustum is in px), not distance.
    this.camera.zoom = (this.camera.right - this.camera.left) / Math.max(1, radius * 2.6);
    this.camera.updateProjectionMatrix();
    if (this.orbit) {
      this.orbit.target.copy(sphere.center);
      this.orbit.update();
    }
  }

  /** Restore the authored camera (from config) — used when leaving light-edit. */
  private restoreHeroCamera(): void {
    const p = this.config.cameraPosition;
    const t = this.config.cameraTarget;
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(t.x, t.y, t.z);
    if (this.orbit) {
      this.orbit.target.set(t.x, t.y, t.z);
      this.orbit.update();
    }
  }

  /** Push only the light uniforms (used live during a gizmo drag). */
  private pushLightUniforms(): void {
    const lights = this.config.lights ?? [];
    for (const wave of this.waves) {
      const u = wave.material.uniforms;
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
    }
    if (!this.running) this.renderOnce();
  }

  async captureImage(mime: string, transparent = true, quality?: number): Promise<Blob> {
    const prev = this.config.transparentBackground;
    if (transparent !== prev) {
      this.config.transparentBackground = transparent;
      this.applyBackground();
    }
    let blob: Blob | null = null;
    try {
      this.capturing = true;
      this.renderOnce();
      blob = await new Promise<Blob | null>((resolve) =>
        this.canvas.toBlob(resolve, mime, quality),
      );
    } finally {
      this.capturing = false;
      if (transparent !== prev) {
        this.config.transparentBackground = prev;
        this.applyBackground();
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
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.motionQuery.removeEventListener("change", this.onMotionChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("keydown", this.onKeyDown);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("pointerdown", this.onCursorDown);
    window.removeEventListener("pointerup", this.onCursorUp);
    this.transform?.detach();
    this.transform?.dispose();
    this.orbit?.dispose();
    this.clearBackgroundVideo();
    this.backgroundTexture?.dispose();
    this.minimapBtn?.remove();
    this.clearLightHelpers();
    this.clearWaveHelpers();
    for (const m of this.minimapLights) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    for (const s of this.waves) {
      s.material.dispose();
      s.geometry.dispose();
      s.palette.dispose();
    }
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
