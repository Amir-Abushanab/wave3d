import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
// Editor-only controls are lazy-loaded (see ensureGizmo) so the production embed
// — which never enters edit mode — doesn't pay for them.
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { TransformControls } from "three/addons/controls/TransformControls.js";
import { vertexShader, fragmentShader, lineFragmentShader, postVertexShader, postFragmentShader } from "./shaders";
import { WaveGeometry } from "./WaveGeometry";
import { buildPaletteTexture, paletteSignature, PALETTE_MAPS, paletteMapCanvas, canvasToTexture, loadPaletteImage } from "./palette";
import { buildHeroPaletteTexture } from "./heroPalette";
import { MAX_COLORS, MAX_LIGHTS, MAX_NOISE_BANDS, normalizePalette, ensureCamera } from "./config";
import type { WaveConfig } from "./config";

const BASE_SEGMENTS = 220; // base segment count along the ribbon; denser = smoother (scaled down per strand — see get segments)

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

type Strand = {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  wave: WaveGeometry;
};

function hexToLinearVec3(hex: string, target: THREE.Vector3): THREE.Vector3 {
  // three's ColorManagement (on by default in r169) already converts the sRGB hex to
  // LINEAR when constructing the Color — its .r/.g/.b are linear. Calling
  // convertSRGBToLinear() again would double-linearize (crushing greens → everything
  // turns red), so we read the components directly.
  const c = new THREE.Color(hex);
  return target.set(c.r, c.g, c.b);
}

/**
 * Renders a gradient "wave of light" from a {@link WaveConfig}. Framework-agnostic:
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

  private config: WaveConfig;
  private strands: Strand[] = [];

  /** Baked 2D palette texture (shared across strands) + its rebuild signature.
   *  Either the hero DataTexture LUT or a stops-generated CanvasTexture. */
  private paletteTexture?: THREE.Texture;
  private paletteSig = "";
  /** Set while the panel drives the camera, so orbit's 'change' doesn't re-refresh the
   *  panel mid-drag (the panel already knows the new value). */
  private suppressCameraChange = false;
  /** Authored default camera pose, for "Reset camera". */
  private readonly homeCamPos = new THREE.Vector3();
  private readonly homeCamTarget = new THREE.Vector3();

  // --- Camera-rig minimap (corner inset: the wave + a little camera/light marker) ---
  private cameraRigOn = false;
  private cameraRigCollapsed = false;
  private minimapCamera?: THREE.PerspectiveCamera;
  private cameraHelper?: THREE.CameraHelper;
  private camMarker?: THREE.Group;
  /** Gold markers in the minimap, one per config light (positions/colours tracked live). */
  private minimapLights: THREE.Mesh[] = [];
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
  private lightEditMode = false;
  private selectedLight = 0;
  private capturing = false;
  /** Set by the panel: fired after a gizmo drag/selection so sliders can refresh. */
  onLightsChanged?: (selected: number) => void;
  /** Set by the panel: fired after orbit moves the camera so sliders can refresh. */
  onCameraChanged?: () => void;

  constructor(container: HTMLElement, config: WaveConfig, options: WaveRendererOptions = {}) {
    this.container = container;
    normalizePalette(config);
    ensureCamera(config);
    this.config = config;
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
    this.renderer.domElement.addEventListener("webglcontextrestored", this.onContextRestored, false);

    // Orthographic, framed in device pixels: resize() sets the frustum to the canvas size, and
    // the mesh is scaled up so the wave overflows the frame, leaving only the twist on screen.
    // Bounds (-1,1,1,-1) here are placeholders overwritten by the first resize(); near/far = 1..10000.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10000);
    this.camera.position.set(config.cameraPosition.x, config.cameraPosition.y, config.cameraPosition.z);
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
    this.buildStrands();
    this.resize();
  }

  private get segments(): number {
    // Scale detail down as strands multiply, so total geometry stays bounded.
    const q = this.config.quality / Math.sqrt(Math.max(1, this.config.strandCount));
    return THREE.MathUtils.clamp(Math.round(BASE_SEGMENTS * q), 24, 360);
  }

  private makeUniforms(): Record<string, THREE.IUniform> {
    const colors: THREE.Vector3[] = [];
    const colorPos: number[] = [];
    for (let i = 0; i < MAX_COLORS; i++) {
      colors.push(new THREE.Vector3(1, 1, 1));
      colorPos.push(MAX_COLORS > 1 ? i / (MAX_COLORS - 1) : 0);
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
      uPalette: { value: null },
      uUsePalette: { value: 1 },
      uPaletteRaw: { value: 1 },
      uDebug: { value: 0 },
      uPdyLift: { value: 1 },
      uVolume: { value: 0.35 },
      uHueShift: { value: 0 },
      uLayerHue: { value: 0 },
      uContrast: { value: 1 },
      uSaturation: { value: 1 },
      uFiberCount: { value: 90 },
      uFiberThickness: { value: 0.25 },
      uTexture: { value: 0 },
      uGlowAmount: { value: 0.15 },
      uGlowPower: { value: 2.0 },
      uGlowRamp: { value: 1.0 },
      uEdgeFade: { value: 0.06 },
      uOpacity: { value: 1 },
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

  private addStrand(): void {
    const wave = new WaveGeometry(this.segments);
    const material = new THREE.ShaderMaterial({
      uniforms: this.makeUniforms(),
      // TWIST_MOTION selects the variant vertex shader (an animated twist-X wobble) over the
      // standard one. Toggled live in refresh().
      defines: this.config.twistMotion ? { TWIST_MOTION: "" } : {},
      vertexShader,
      // solid theme = surfaceColor shader; wireframe theme = thin-line shader.
      // Swapped live in refresh() when the theme changes.
      fragmentShader: this.config.theme === "wireframe" ? lineFragmentShader : fragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    // Blending (incl. the squaring blend) is set from config.blendMode — see applyBlendMode —
    // so it survives refresh() instead of being a dead constructor flag.
    this.applyBlendMode(material);
    const mesh = new THREE.Mesh(wave.geometry, material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.strands.push({ mesh, material, wave });
  }

  /**
   * Apply config.blendMode to a material. "squared" (the default) is the hero blend:
   * CustomBlending with AddEquation, src = SrcColorFactor, dst = ZeroFactor, so the
   * framebuffer result is fragColor² — the squaring deepens the colours into the vivid
   * hero look (without it the wave reads pastel). "additive"/"normal" are authoring
   * overrides. Returns true if material.blending changed (caller flags needsUpdate).
   */
  private applyBlendMode(material: THREE.ShaderMaterial): boolean {
    const blending =
      this.config.blendMode === "additive"
        ? THREE.AdditiveBlending
        : this.config.blendMode === "normal"
          ? THREE.NormalBlending
          : THREE.CustomBlending; // "squared" (default)
    if (material.blending === blending) return false;
    material.blending = blending;
    if (blending === THREE.CustomBlending) {
      material.blendEquation = THREE.AddEquation;
      material.blendSrc = THREE.SrcColorFactor;
      material.blendDst = THREE.ZeroFactor;
    }
    return true;
  }

  private disposeStrands(): void {
    for (const s of this.strands) {
      this.group.remove(s.mesh);
      s.material.dispose();
      s.wave.dispose();
    }
    this.strands = [];
  }

  /**
   * Reconcile the strand pool to `strandCount` WITHOUT tearing everything down:
   * keep existing strands (so the compiled shader program is never deleted and
   * re-compiled — that churn can crash some GPU drivers), add/remove only the
   * delta, and resize each geometry to the current quality.
   */
  private buildStrands(): void {
    const target = Math.max(1, this.config.strandCount);
    while (this.strands.length > target) {
      const s = this.strands.pop();
      if (!s) break;
      this.group.remove(s.mesh);
      s.material.dispose();
      s.wave.dispose();
    }
    while (this.strands.length < target) this.addStrand();

    const segments = this.segments;
    this.strands.forEach((s, i) => {
      s.wave.resize(segments);
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
    if (!this.orbit && !this.lightEditMode) {
      const p = this.config.cameraPosition;
      const tg = this.config.cameraTarget;
      this.camera.position.set(p.x, p.y, p.z);
      this.camera.lookAt(tg.x, tg.y, tg.z);
    }

    const stops = [...this.config.palette].sort((a, b) => a.pos - b.pos);
    const colorCount = Math.max(1, Math.min(stops.length, MAX_COLORS));

    this.strands.forEach((strand, i) => {
      const layer = this.config.layers[i] ?? this.config.layers[this.config.layers.length - 1];
      const u = strand.material.uniforms;
      if (this.applyBlendMode(strand.material)) strand.material.needsUpdate = true;
      // Switch between the standard and variant (animated-twist) vertex shaders by
      // adding/removing the TWIST_MOTION define and forcing a program recompile.
      const wantMotion = !!this.config.twistMotion;
      const hasMotion = "TWIST_MOTION" in (strand.material.defines ?? {});
      if (wantMotion !== hasMotion) {
        strand.material.defines = wantMotion ? { TWIST_MOTION: "" } : {};
        strand.material.needsUpdate = true;
      }
      // Swap the fragment shader when the theme changes: solid surfaceColor <-> wireframe
      // thin-line. Three recompiles the program on needsUpdate.
      const wantFrag = this.config.theme === "wireframe" ? lineFragmentShader : fragmentShader;
      if (strand.material.fragmentShader !== wantFrag) {
        strand.material.fragmentShader = wantFrag;
        strand.material.needsUpdate = true;
      }

      const colors = u.uColors.value as THREE.Vector3[];
      const colorPos = u.uColorPos.value as number[];
      for (let c = 0; c < MAX_COLORS; c++) {
        const stop = stops[Math.min(c, colorCount - 1)] ?? { color: "#ffffff", pos: 0 };
        hexToLinearVec3(stop.color, colors[c]);
        colorPos[c] = stop.pos;
      }
      u.uColorCount.value = colorCount;
      u.uGradType.value =
        this.config.gradientType === "radial" ? 1 : this.config.gradientType === "conic" ? 2 : 0;
      u.uGradAngle.value = ((this.config.gradientAngle ?? 0) * Math.PI) / 180;
      u.uGradShift.value = this.config.gradientShift ?? 0;
      u.uHueShift.value = this.config.hueShift;
      u.uContrast.value = this.config.colorContrast;
      u.uSaturation.value = this.config.colorSaturation;
      // Wireframe thin-line theme params (used only by lineFragmentShader). uClearColor is the
      // between-line colour = the page background, fed in linear space like the palette.
      u.uLineAmount.value = this.config.lineAmount ?? 425;
      u.uLineThickness.value = this.config.lineThickness ?? 1;
      u.uLineDerivativePower.value = this.config.lineDerivativePower ?? 0.95;
      u.uMaxWidth.value = this.config.maxWidth ?? 1232;
      hexToLinearVec3(this.config.background, u.uClearColor.value as THREE.Vector3);
      u.uFiberCount.value = this.config.fiberCount;
      u.uFiberThickness.value = this.config.fiberThickness;
      u.uTexture.value = this.config.texture;
      u.uGlowAmount.value = this.config.glowAmount;
      u.uGlowPower.value = this.config.glowPower;
      u.uGlowRamp.value = this.config.glowRamp;
      u.uPdyLift.value = this.config.pdyLift ?? 1;
      u.uVolume.value = this.config.volume ?? 0.35;
      u.uEdgeFade.value = this.config.edgeFade;
      // Lights
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
      // Noise bands (per-region fiber overrides)
      const bands = this.config.noiseBands ?? [];
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
      // Deformation
      u.uSpeed.value = this.config.speed * layer.speed;
      u.uSeed.value = layer.seed;
      u.uDispFreqX.value = this.config.displaceFrequency.x;
      u.uDispFreqZ.value = this.config.displaceFrequency.y;
      u.uDispAmount.value = this.config.displaceAmount;
      u.uTwFreqX.value = this.config.twistFrequency.x;
      u.uTwFreqY.value = this.config.twistFrequency.y;
      u.uTwFreqZ.value = this.config.twistFrequency.z;
      u.uTwPowX.value = this.config.twistPower.x;
      u.uTwPowY.value = this.config.twistPower.y;
      u.uTwPowZ.value = this.config.twistPower.z;
      // Mesh transform (scale / rotation / position) — applied via modelMatrix using THREE's
      // Euler XYZ order, so the on-screen orientation matches the authored hero view.
      strand.mesh.scale.set(this.config.scale.x, this.config.scale.y, this.config.scale.z);
      strand.mesh.rotation.set(
        THREE.MathUtils.degToRad(this.config.rotation.x),
        THREE.MathUtils.degToRad(this.config.rotation.y),
        THREE.MathUtils.degToRad(this.config.rotation.z + layer.twistOffset),
      );
      strand.mesh.position.set(
        this.config.position.x + layer.offset.x,
        this.config.position.y + layer.offset.y,
        this.config.position.z + layer.offset.z,
      );
      // Per-strand colour
      u.uLayerHue.value = layer.hueShift;
      u.uOpacity.value = layer.opacity;
    });

    this.updatePaletteTexture();

    // Whole-wave mirror (world-space flip ≈ screen flip for the near-frontal camera).
    this.group.scale.set(this.config.mirrorH ? -1 : 1, this.config.mirrorV ? -1 : 1, 1);

    if (this.lightEditMode) this.syncLightHelpers();
    if (!this.running) this.renderOnce();
  }

  /**
   * Rebuild the baked 2D palette texture when the stops / edge tint change, and point
   * every strand's sampler at it. Cheap (256×64 canvas), and guarded by a signature so
   * it only re-uploads when the palette actually changes — not on every refresh().
   */
  private updatePaletteTexture(): void {
    // The 2D palette texture can come from: a custom image (paletteImageUrl), the baked
    // hero LUT ("hero"), our editable stops ("stops"), or a built-in map name.
    const url = this.config.paletteImageUrl;
    const source = this.config.paletteSource ?? "hero";
    let sig: string;
    let build: () => THREE.Texture;
    if (url) {
      sig = "url|" + url;
      build = () => loadPaletteImage(url);
    } else if (source === "stops") {
      const opts = {
        stops: this.config.palette,
        edgeColor: this.config.paletteEdgeColor ?? "#8e9dff",
        edgeAmount: this.config.paletteEdgeAmount ?? 0.3,
      };
      sig = "stops|" + paletteSignature(opts);
      build = () => buildPaletteTexture(opts);
    } else if (PALETTE_MAPS[source]) {
      const def = PALETTE_MAPS[source];
      sig = "map|" + source;
      build = () => canvasToTexture(paletteMapCanvas(def));
    } else {
      sig = "hero";
      build = () => buildHeroPaletteTexture();
    }
    if (sig !== this.paletteSig || !this.paletteTexture) {
      this.paletteTexture?.dispose();
      this.paletteTexture = build();
      this.paletteSig = sig;
    }
    // Texture maps are 2D images sampled directly by (uv.x, uv.y).
    const use = this.config.usePaletteTexture === false ? 0 : 1;
    for (const s of this.strands) {
      s.material.uniforms.uPalette.value = this.paletteTexture;
      s.material.uniforms.uUsePalette.value = use;
      s.material.uniforms.uPaletteRaw.value = 1;
    }
  }

  /** Dev: 0 = normal, 1 = visualise pdy volume term, 2 = visualise derivative normal. */
  setDebug(v: number): void {
    for (const s of this.strands) s.material.uniforms.uDebug.value = v;
    this.renderOnce();
  }

  /** Rebuild geometry + strands (call when strandCount or quality changes). */
  rebuild(): void {
    this.buildStrands();
  }

  private applyBackground(): void {
    if (this.config.transparentBackground) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    } else {
      const c = new THREE.Color(this.config.background);
      this.scene.background = c;
      this.renderer.setClearColor(c, 1);
    }
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
    this.disposeStrands(); // old GPU resources are invalid on a fresh context
    this.paletteTexture?.dispose(); // force the palette texture to rebuild too
    this.paletteTexture = undefined;
    this.paletteSig = "";
    this.buildStrands();
    this.resize();
    this.updateRunning();
  };

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.config.dprMax);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, true);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    const dw = w * dpr;
    const dh = h * dpr;
    (this.postPass.uniforms.uResolution.value as THREE.Vector2).set(dw, dh);
    for (const s of this.strands) {
      (s.material.uniforms.uResolution.value as THREE.Vector2).set(dw, dh);
    }
    // The responsive ortho framing: the frustum = the canvas in DEVICE pixels (1 world unit =
    // 1px at zoom 1). Combined with the ×10 mesh scale, the wave overflows the frame.
    this.camera.left = -dw / 2;
    this.camera.right = dw / 2;
    this.camera.top = dh / 2;
    this.camera.bottom = -dh / 2;
    this.applyZoom(); // responsive ortho zoom (maps FRAME_W world units onto the canvas)
    this.applyViewOffset();
    if (this.cameraRigOn) this.positionMinimapBtn();
    if (!this.running) this.renderOnce();
  }

  /**
   * No-op kept for API compatibility (main.ts still calls it on resize). The studio used to
   * shift+scale the scene into the area right of the panel, but that made framing depend on
   * window/panel width and differ from the panel-less embed. Now the scene is always centred in
   * the full canvas (the panel just floats over its left edge), so a saved preset reproduces the
   * same view in the studio, the preview, and the exported embed.
   */
  setViewInsetLeft(_px: number): void {
    this.applyViewOffset();
    if (!this.running) this.renderOnce();
  }

  private applyViewOffset(): void {
    this.camera.clearViewOffset();
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
      this.started && this.visible && this.pageVisible && !this.config.paused && !this.reducedMotion;

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
    const ramp = this.config.introRamp === false ? 1 : this.introTimeRamp;
    const t = this.time * ramp + (this.config.timeOffset ?? 0);
    for (const strand of this.strands) {
      strand.material.uniforms.uTime.value = t;
    }
    this.postPass.uniforms.uTime.value = t;
  }

  /** Render exactly one frame at the current time. */
  renderOnce(): void {
    this.updateTime();
    this.composer.render();
    // Draw the light gizmo/helpers on top, crisp (not through the post pass), and
    // never into exports.
    if (this.lightEditMode && !this.capturing && this.overlay.children.length > 0) {
      for (const h of this.lightHelpers) {
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

  // ---------------- Light editing (draggable 3D gizmo) ----------------

  isLightEditMode(): boolean {
    return this.lightEditMode;
  }

  /** Toggle 3D light editing: show draggable handles + orbit; off restores hero view. */
  async setLightEditMode(on: boolean): Promise<void> {
    if (on === this.lightEditMode) return;
    this.lightEditMode = on;
    if (on) {
      await this.ensureGizmo();
      if (!this.lightEditMode) return; // toggled back off while controls loaded
      if (this.orbit) this.orbit.enabled = true;
      if (this.transform) this.transform.enabled = true;
      this.syncLightHelpers();
      this.frameEditCamera();
      this.selectLight(Math.min(this.selectedLight, Math.max(0, this.lightHelpers.length - 1)));
    } else {
      if (this.transform) this.transform.enabled = false;
      this.transform?.detach();
      if (this.orbit) this.orbit.enabled = this.mainOrbitOn; // keep main-view orbit on
      this.clearLightHelpers();
      this.restoreHeroCamera();
    }
    this.renderOnce();
  }

  /** Turn on mouse/trackpad orbit + zoom + pan + arrow-key orbit (studio only). */
  async enableOrbit(): Promise<void> {
    this.mainOrbitOn = true;
    this.renderer.domElement.style.cursor = "move"; // 4-way move arrows: left-drag pans the view
    window.addEventListener("keydown", this.onKeyDown);
    await this.ensureOrbit();
    if (this.orbit && !this.lightEditMode) this.orbit.enabled = true;
  }

  /** Arrow keys orbit the camera around the target (←/→ azimuth, ↑/↓ elevation). */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.mainOrbitOn || !this.orbit || this.lightEditMode) return;
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
    this.applyViewOffset();
    if (!this.running) this.renderOnce();
  }

  /** Dolly/aim the camera so the whole wave fills the viewport (keeps the view angle).
   *  Fits the geometry box's actual *projected* screen extent — tighter than a bounding
   *  sphere for a flat, diagonal ribbon. */
  fitToView(): void {
    const box = new THREE.Box3();
    for (const s of this.strands) {
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
    this.applyViewOffset();
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
    this.applyViewOffset();
    if (!this.running) this.renderOnce();
  }

  /** The current look-at target (orbit's if present, else from config). */
  private camTarget(): THREE.Vector3 {
    if (this.orbit) return this.orbit.target;
    const t = this.config.cameraTarget;
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** Read the camera as orbit values for the panel (angles in degrees). */
  getCameraOrbit(): { azimuth: number; elevation: number; distance: number; panX: number; panY: number } {
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
    this.applyViewOffset();
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
    this.applyViewOffset();
    if (!this.running) this.renderOnce();
  }

  /** Ortho zoom MULTIPLIER (replaces fov). 1 = the responsive base framing (the hero crop). */
  getFov(): number {
    return this.config.cameraZoom ?? 1;
  }

  setFov(zoom: number): void {
    this.config.cameraZoom = THREE.MathUtils.clamp(zoom, 0.1, 6);
    this.applyZoom();
    this.applyViewOffset();
    if (!this.running) this.renderOnce();
  }

  /** Jump the camera to the config's authored framing (cameraPosition / cameraTarget /
   *  cameraZoom). Unlike refresh()'s camera block — which is skipped while orbit owns the
   *  camera so it doesn't fight the user — this is for whole-config swaps (preset / reset /
   *  randomize / import), where the new config's framing SHOULD take over. It also moves the
   *  orbit target so subsequent orbiting pivots correctly, and syncs the panel proxy. */
  private applyCameraFromConfig(): void {
    if (this.lightEditMode) return; // light-edit owns the camera; don't fight it
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
    this.applyViewOffset();
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
    b.style.right = pad + "px";
    b.style.bottom = (this.cameraRigCollapsed ? pad : pad + size - 22) + "px";
    b.textContent = this.cameraRigCollapsed ? "▴ camera" : "▾ camera";
  }

  /** Build the minimap's fixed 3rd-person camera + the camera/light markers (once). */
  private ensureMinimap(): void {
    if (this.minimapCamera) return;
    this.minimapCamera = new THREE.PerspectiveCamera(42, 1, 1, 4000);
    this.minimapCamera.position.set(62, 46, 82);
    this.minimapCamera.lookAt(0, 0, 0);

    // Frustum of the MAIN camera (shows position + direction); hidden in the main view.
    this.cameraHelper = new THREE.CameraHelper(this.camera);
    this.cameraHelper.visible = false;
    this.scene.add(this.cameraHelper);

    // A little camera (body + lens) that follows the main camera.
    const marker = new THREE.Group();
    marker.add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 4.2), new THREE.MeshBasicMaterial({ color: 0x2a2f3d })));
    const lens = new THREE.Mesh(new THREE.ConeGeometry(1.3, 2.4, 18), new THREE.MeshBasicMaterial({ color: 0x6ea8fe }));
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

  /** Reconcile the minimap's light markers with config.lights (count, position, colour). */
  private syncMinimapLights(visible: boolean): void {
    const lights = this.config.lights ?? [];
    while (this.minimapLights.length < lights.length) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd24a }));
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

  /** Draw the camera-rig minimap into a corner viewport (called after the main render). */
  private renderMinimap(): void {
    if (!this.cameraRigOn || this.cameraRigCollapsed || !this.mainOrbitOn || this.capturing) return;
    if (!this.minimapCamera || !this.cameraHelper) return;
    // setViewport/setScissor take LOGICAL (CSS) pixels — three applies pixelRatio itself.
    const { x, y, size } = this.minimapRect();

    this.cameraHelper.update();
    this.cameraHelper.visible = true;
    if (this.camMarker) {
      this.camMarker.position.copy(this.camera.position);
      this.camMarker.quaternion.copy(this.camera.quaternion);
      this.camMarker.visible = true;
    }
    this.syncMinimapLights(true);

    const r = this.renderer;
    const prevColor = new THREE.Color();
    r.getClearColor(prevColor);
    const prevAlpha = r.getClearAlpha();
    r.autoClear = false;
    r.setRenderTarget(null); // draw to the screen — NOT a leftover composer buffer
    r.setScissorTest(true);
    r.setViewport(x, y, size, size);
    r.setScissor(x, y, size, size);
    r.setClearColor(0x12121a, 0.92);
    r.clear(true, true);
    r.render(this.scene, this.minimapCamera);
    r.setScissorTest(false);
    const full = this.renderer.getSize(new THREE.Vector2());
    r.setViewport(0, 0, full.x, full.y);
    r.setClearColor(prevColor, prevAlpha);
    r.autoClear = true;

    this.cameraHelper.visible = false;
    if (this.camMarker) this.camMarker.visible = false;
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
    this.orbit.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.orbit.target.set(this.config.cameraTarget.x, this.config.cameraTarget.y, this.config.cameraTarget.z);
    this.orbit.update();
    this.orbit.addEventListener("change", this.onControlsChange);
    // Cursor feedback by drag type: left-drag pans → 4-way move arrows; right-drag rotates →
    // grab/closed-hand. Idle stays on the move arrows (the primary drag pans). OrbitControls
    // doesn't expose the button, so we read it from pointerdown directly.
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      if (this.mainOrbitOn) el.style.cursor = e.button === 2 ? "grabbing" : "move";
    });
    window.addEventListener("pointerup", () => {
      if (this.mainOrbitOn) el.style.cursor = "move";
    });
  }

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
    this.transform.addEventListener("change", this.onControlsChange);
    const tc = this.transform as unknown as { getHelper?: () => THREE.Object3D };
    this.overlay.add(tc.getHelper ? tc.getHelper() : (this.transform as unknown as THREE.Object3D));

    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
  }

  private onControlsChange = (): void => {
    // Orbit/zoom/pan moved the camera → capture it so exports match the view.
    // (Not while light-editing — that orbit is a transient working view.)
    if (this.orbit && this.orbit.enabled && !this.lightEditMode) {
      this.writeCameraToConfig();
      if (!this.suppressCameraChange) this.onCameraChanged?.();
    }
    if (!this.running) this.renderOnce();
  };

  /** Persist the live camera (position/target/distance) into the config. */
  private writeCameraToConfig(): void {
    const r = (n: number): number => Math.round(n * 1000) / 1000;
    const p = this.camera.position;
    this.config.cameraPosition = { x: r(p.x), y: r(p.y), z: r(p.z) };
    // Capture the LIVE ortho zoom (mouse-scroll changes camera.zoom directly) back into
    // config.cameraZoom — the user multiplier — by inverting applyZoom's responsive COVER
    // factor. Without this, scroll-zoom changed the view but was never saved/exported, so a
    // framing tuned at a scrolled zoom didn't reproduce (its pan made sense only at that zoom).
    const cover = Math.max(
      (this.camera.right - this.camera.left) / FRAME_W,
      (this.camera.top - this.camera.bottom) / FRAME_H,
    );
    if (cover > 0) this.config.cameraZoom = r(this.camera.zoom / cover);
    if (this.orbit) {
      const t = this.orbit.target;
      this.config.cameraTarget = { x: r(t.x), y: r(t.y), z: r(t.z) };
      this.config.cameraDistance = r(p.distanceTo(this.orbit.target));
    }
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (!this.lightEditMode || !this.transform) return;
    if (this.transform.dragging || this.transform.axis) return; // interacting with the gizmo
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.lightHelpers, false)[0];
    if (hit) {
      const idx = this.lightHelpers.indexOf(hit.object as THREE.Mesh);
      if (idx >= 0) this.selectLight(idx);
    }
  };

  private selectLight(i: number): void {
    this.selectedLight = i;
    const h = this.lightHelpers[i];
    if (h && this.transform) this.transform.attach(h);
    else this.transform?.detach();
    this.onLightsChanged?.(i);
    if (!this.running) this.renderOnce();
  }

  /** Gizmo drag → write the moved handle back into the config + uniforms. */
  private onGizmoMoved = (): void => {
    const h = this.lightHelpers[this.selectedLight];
    const light = this.config.lights?.[this.selectedLight];
    if (!h || !light) return;
    light.position.x = Math.round(h.position.x * 100) / 100;
    light.position.y = Math.round(h.position.y * 100) / 100;
    light.position.z = Math.round(h.position.z * 100) / 100;
    this.pushLightUniforms();
    this.onLightsChanged?.(this.selectedLight);
  };

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

  /** Pull the camera back to a 3/4 angle that frames the wave + all lights. */
  private frameEditCamera(): void {
    const box = new THREE.Box3();
    // The baked + scaled wave spans ~±25 units; frame that plus any lights.
    box.expandByPoint(new THREE.Vector3(25, 25, 25));
    box.expandByPoint(new THREE.Vector3(-25, -25, -25));
    for (const l of this.config.lights ?? []) {
      box.expandByPoint(new THREE.Vector3(l.position.x, l.position.y, l.position.z));
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
    for (const strand of this.strands) {
      const u = strand.material.uniforms;
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

  async capturePNG(transparent = true): Promise<Blob> {
    const prev = this.config.transparentBackground;
    if (transparent !== prev) {
      this.config.transparentBackground = transparent;
      this.applyBackground();
    }
    this.capturing = true;
    this.camera.clearViewOffset(); // export the centered composition, not the studio-shifted view
    this.renderOnce();
    const blob = await new Promise<Blob | null>((resolve) => this.canvas.toBlob(resolve, "image/png"));
    this.capturing = false;
    if (transparent !== prev) {
      this.config.transparentBackground = prev;
      this.applyBackground();
    }
    this.applyViewOffset(); // restore the studio view
    this.renderOnce();
    if (!blob) throw new Error("Failed to capture PNG");
    return blob;
  }

  captureStream(fps = 60): MediaStream {
    return this.canvas.captureStream(fps);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  getConfig(): WaveConfig {
    return this.config;
  }

  setConfig(config: WaveConfig): void {
    normalizePalette(config);
    ensureCamera(config);
    const structural =
      config.strandCount !== this.strands.length || config.quality !== this.config.quality;
    this.config = config;
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
    this.transform?.detach();
    this.transform?.dispose();
    this.orbit?.dispose();
    this.paletteTexture?.dispose();
    this.minimapBtn?.remove();
    this.clearLightHelpers();
    for (const m of this.minimapLights) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    for (const s of this.strands) {
      s.material.dispose();
      s.wave.dispose();
    }
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
