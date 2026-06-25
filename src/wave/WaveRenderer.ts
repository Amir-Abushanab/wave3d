import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
// Editor-only controls are lazy-loaded (see ensureGizmo) so the production embed
// — which never enters edit mode — doesn't pay for them.
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { TransformControls } from "three/addons/controls/TransformControls.js";
import { vertexShader, fragmentShader, postVertexShader, postFragmentShader } from "./shaders";
import { WaveGeometry } from "./WaveGeometry";
import { MAX_COLORS, MAX_LIGHTS, MAX_NOISE_BANDS, normalizePalette, ensureCamera } from "./config";
import type { WaveConfig } from "./config";

const BASE_SEGMENTS = 220;

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
  const c = new THREE.Color(hex);
  c.convertSRGBToLinear();
  return target.set(c.r, c.g, c.b);
}

/**
 * Renders a "wave of light" wave from a {@link WaveConfig}. Framework-agnostic:
 * it needs only a DOM container and a config. The studio mutates the config in
 * place and calls `refresh()` / `rebuild()`.
 */
export class WaveRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly group = new THREE.Group();
  private readonly composer: EffectComposer;
  private readonly postPass: ShaderPass;
  private readonly container: HTMLElement;
  private readonly respectReducedMotion: boolean;

  private config: WaveConfig;
  private strands: Strand[] = [];

  private readonly clock = new THREE.Clock();
  private time = 0;
  private rafId = 0;
  private running = false;
  private started = false;

  private visible = true;
  private pageVisible = true;
  private reducedMotion = false;

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

  /** Studio-only horizontal view inset (px) so the wave clears a left panel. */
  private panelInsetLeft = 0;

  constructor(container: HTMLElement, config: WaveConfig, options: WaveRendererOptions = {}) {
    this.container = container;
    normalizePalette(config);
    ensureCamera(config);
    this.config = config;
    this.respectReducedMotion = options.respectReducedMotion ?? true;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true, // for PNG / video capture
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    // Resilience: if the GPU drops the context (memory pressure, sleep/wake), don't
    // let the browser hard-crash the page — prevent the default and rebuild on restore.
    this.renderer.domElement.addEventListener("webglcontextlost", this.onContextLost, false);
    this.renderer.domElement.addEventListener("webglcontextrestored", this.onContextRestored, false);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(config.cameraPosition.x, config.cameraPosition.y, config.cameraPosition.z);
    this.camera.lookAt(config.cameraTarget.x, config.cameraTarget.y, config.cameraTarget.z);
    this.scene.add(this.group);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.postPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uBlurAmount: { value: config.blur },
        uBlurSamples: { value: 12 },
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
      uSpeed: { value: 0.3 },
      uSeed: { value: 0 },
      uLength: { value: 6 },
      uWidth: { value: 3 },
      uWidthTaper: { value: 0.35 },
      uFoldRadius: { value: 0.8 },
      uFoldGap: { value: 0.6 },
      uFoldCenter: { value: 0.55 },
      uDispFreqX: { value: 1.2 },
      uDispFreqZ: { value: 0.8 },
      uDispAmount: { value: 0.5 },
      uTwFreqX: { value: 1.0 },
      uTwFreqY: { value: 0.6 },
      uTwFreqZ: { value: 0.4 },
      uTwPowX: { value: 2.0 },
      uTwPowY: { value: 1.5 },
      uTwPowZ: { value: 2.5 },
      uScale: { value: new THREE.Vector3(1, 1, 1) },
      uRotation: { value: new THREE.Vector3(-14, 0, -20) },
      uPosition: { value: new THREE.Vector3(0, 0, 0) },
      // Colour + light (fragment)
      uColors: { value: colors },
      uColorPos: { value: colorPos },
      uColorCount: { value: 2 },
      uGradType: { value: 0 },
      uGradAngle: { value: 0 },
      uGradShift: { value: 0.15 },
      uHueShift: { value: 0 },
      uLayerHue: { value: 0 },
      uContrast: { value: 1 },
      uSaturation: { value: 1 },
      uFiberCount: { value: 90 },
      uFiberThickness: { value: 0.25 },
      uTexture: { value: 0 },
      uBezelPower: { value: 0.3 },
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
    };
  }

  private addStrand(): void {
    const wave = new WaveGeometry(this.segments);
    const material = new THREE.ShaderMaterial({
      uniforms: this.makeUniforms(),
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(wave.geometry, material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.strands.push({ mesh, material, wave });
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

    const blending = this.config.blendMode === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending;
    const stops = [...this.config.palette].sort((a, b) => a.pos - b.pos);
    const colorCount = Math.max(1, Math.min(stops.length, MAX_COLORS));

    this.strands.forEach((strand, i) => {
      const layer = this.config.layers[i] ?? this.config.layers[this.config.layers.length - 1];
      const u = strand.material.uniforms;
      if (strand.material.blending !== blending) {
        strand.material.blending = blending;
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
      u.uFiberCount.value = this.config.fiberCount;
      u.uFiberThickness.value = this.config.fiberThickness;
      u.uTexture.value = this.config.texture;
      u.uBezelPower.value = this.config.bezelPower;
      u.uGlowAmount.value = this.config.glowAmount;
      u.uGlowPower.value = this.config.glowPower;
      u.uGlowRamp.value = this.config.glowRamp;
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
      u.uLength.value = this.config.spineLength;
      u.uWidth.value = this.config.waveWidth * layer.widthMul;
      u.uWidthTaper.value = this.config.widthTaper;
      u.uFoldRadius.value = this.config.foldRadius;
      u.uFoldGap.value = this.config.foldGap;
      u.uFoldCenter.value = this.config.foldCenter;
      u.uDispFreqX.value = this.config.displaceFrequency.x;
      u.uDispFreqZ.value = this.config.displaceFrequency.y;
      u.uDispAmount.value = this.config.displaceAmount;
      u.uTwFreqX.value = this.config.twistFrequency.x;
      u.uTwFreqY.value = this.config.twistFrequency.y;
      u.uTwFreqZ.value = this.config.twistFrequency.z;
      u.uTwPowX.value = this.config.twistPower.x;
      u.uTwPowY.value = this.config.twistPower.y;
      u.uTwPowZ.value = this.config.twistPower.z;
      (u.uScale.value as THREE.Vector3).set(this.config.scale.x, this.config.scale.y, this.config.scale.z);
      (u.uRotation.value as THREE.Vector3).set(
        this.config.rotation.x,
        this.config.rotation.y,
        this.config.rotation.z + layer.twistOffset,
      );
      (u.uPosition.value as THREE.Vector3).set(
        this.config.position.x + layer.offset.x,
        this.config.position.y + layer.offset.y,
        this.config.position.z + layer.offset.z,
      );
      // Per-strand colour
      u.uLayerHue.value = layer.hueShift;
      u.uOpacity.value = layer.opacity;
    });

    if (this.lightEditMode) this.syncLightHelpers();
    if (!this.running) this.renderOnce();
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
    this.camera.aspect = w / h;
    this.applyViewOffset();
    if (!this.running) this.renderOnce();
  }

  /**
   * Studio-only: shift + scale the camera frustum so the centered scene appears
   * within the area to the RIGHT of a left-hand panel `px` wide (the config and
   * exports are untouched — see capturePNG, which clears this).
   */
  setViewInsetLeft(px: number): void {
    this.panelInsetLeft = Math.max(0, px);
    this.applyViewOffset();
    if (!this.running) this.renderOnce();
  }

  private applyViewOffset(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const inset = this.panelInsetLeft;
    if (inset > 8 && inset < w * 0.6) {
      // Zoom out by k so the full view fits the visible (w - inset) width, then
      // offset so the scene centre lands in the middle of that visible region.
      const k = w / (w - inset);
      this.camera.setViewOffset(k * w, k * h, (k * w) / 2 - (inset + w) / 2, ((k - 1) * h) / 2, w, h);
    } else {
      this.camera.clearViewOffset();
    }
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
    if (!this.running) this.renderOnce();
  }

  private loop = (): void => {
    if (!this.running) return;
    this.time += this.clock.getDelta();
    this.renderOnce();
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Advance the per-frame clock uniforms (geometry itself is static). */
  private updateTime(): void {
    for (const strand of this.strands) {
      strand.material.uniforms.uTime.value = this.time;
    }
    this.postPass.uniforms.uTime.value = this.time;
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
      this.renderer.render(this.overlay, this.camera);
      this.renderer.autoClear = true;
    }
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

  /** Turn on mouse/trackpad orbit + zoom + pan for the main view (studio only). */
  async enableOrbit(): Promise<void> {
    this.mainOrbitOn = true;
    await this.ensureOrbit();
    if (this.orbit && !this.lightEditMode) this.orbit.enabled = true;
  }

  /** Reset the camera to the straight-on hero framing at the configured distance. */
  resetView(): void {
    this.camera.position.set(0, 0, this.config.cameraDistance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    if (this.orbit) {
      this.orbit.target.set(0, 0, 0);
      this.orbit.update();
    }
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

  private async ensureOrbit(): Promise<void> {
    if (this.orbit) return;
    const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
    if (this.orbit) return; // a concurrent call already set it up
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = false;
    this.orbit.enabled = false; // enabled by enableOrbit() / light-edit
    this.orbit.screenSpacePanning = true;
    this.orbit.zoomToCursor = true;
    this.orbit.minDistance = 1.5;
    this.orbit.maxDistance = 40;
    this.orbit.target.set(this.config.cameraTarget.x, this.config.cameraTarget.y, this.config.cameraTarget.z);
    this.orbit.update();
    this.orbit.addEventListener("change", this.onControlsChange);
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
      this.onCameraChanged?.();
    }
    if (!this.running) this.renderOnce();
  };

  /** Persist the live camera (position/target/distance) into the config. */
  private writeCameraToConfig(): void {
    const r = (n: number): number => Math.round(n * 1000) / 1000;
    const p = this.camera.position;
    this.config.cameraPosition = { x: r(p.x), y: r(p.y), z: r(p.z) };
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
    box.expandByPoint(new THREE.Vector3(this.config.spineLength * 0.5, 0, 0));
    box.expandByPoint(new THREE.Vector3(-this.config.spineLength * 0.5, 0, 0));
    for (const l of this.config.lights ?? []) {
      box.expandByPoint(new THREE.Vector3(l.position.x, l.position.y, l.position.z));
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 2);
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.15;
    const dir = new THREE.Vector3(0.45, 0.35, 1).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(sphere.center);
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
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.running = false;
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.motionQuery.removeEventListener("change", this.onMotionChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.transform?.detach();
    this.transform?.dispose();
    this.orbit?.dispose();
    this.clearLightHelpers();
    for (const s of this.strands) {
      s.material.dispose();
      s.wave.dispose();
    }
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
