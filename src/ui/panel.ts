import { Pane } from "tweakpane";
import {
  resizeLayers,
  createLight,
  createNoiseBand,
  normalizePalette,
  MAX_COLORS,
  MAX_LIGHTS,
  MAX_NOISE_BANDS,
  randomizeGradient,
  randomizeColor,
  randomizeSpine,
  randomizeTransform,
  randomizeTwist,
  randomizeSurface,
  randomizeLights,
  randomizeGlobal,
  randomizeStrands,
} from "../wave/config";
import type { WaveConfig } from "../wave/config";
import type { WaveRenderer } from "../wave/WaveRenderer";
import { GradientEditor } from "./GradientEditor";

export interface PanelHooks {
  presetOptions?: Record<string, string>;
  onPreset?: (name: string) => void;
  onRandomize?: () => void;
  onReset?: () => void;
  onExportConfig?: () => void;
  onImportConfig?: () => void;
  onExportPNG?: () => void;
  onExportEmbed?: () => void;
  onToggleRecord?: () => void;
}

/**
 * Tweakpane control panel. Bindings mutate the shared config in place and ask
 * the renderer to refresh; structural changes (strand count, quality) rebuild
 * geometry, and strand-count also rebuilds the panel.
 */
type FolderApi = ReturnType<Pane["addFolder"]>;

export class ControlPanel {
  private pane!: Pane;
  private gradientEditor?: GradientEditor;
  private readonly state = { recording: false };
  /** Remembered expanded/collapsed state of top-level folders, by title, so a
   *  panel rebuild (e.g. on strand-count change) doesn't reset them. */
  private foldState: Record<string, boolean> = {};
  private folders: Array<{ title: string; api: FolderApi }> = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly renderer: WaveRenderer,
    private config: WaveConfig,
    private readonly hooks: PanelHooks = {},
  ) {
    this.build();
  }

  setConfig(config: WaveConfig): void {
    this.config = config;
    setTimeout(() => this.rebuildPanel(), 0);
  }

  setRecording(on: boolean): void {
    this.state.recording = on;
    this.pane.refresh();
  }

  disposeEditor(): void {
    this.gradientEditor?.destroy();
    this.gradientEditor = undefined;
  }

  dispose(): void {
    this.disposeEditor();
    this.pane.dispose();
  }

  private rebuildStrands = (): void => {
    resizeLayers(this.config);
    this.renderer.rebuild();
    setTimeout(() => this.rebuildPanel(), 0);
  };

  private rebuildPanel(): void {
    // Remember which folders are open so the rebuild doesn't reset them.
    for (const f of this.folders) this.foldState[f.title] = f.api.expanded;
    this.disposeEditor();
    this.pane.dispose();
    this.build();
  }

  private build(): void {
    const cfg = this.config;
    // Backfill fields that may be absent in older saved states.
    if (!cfg.lights || cfg.lights.length === 0) cfg.lights = [createLight()];
    if (typeof cfg.ambient !== "number") cfg.ambient = 0.45;
    if (cfg.gradientType !== "radial" && cfg.gradientType !== "conic") cfg.gradientType = "linear";
    if (typeof cfg.gradientAngle !== "number") cfg.gradientAngle = 0;
    if (typeof cfg.gradientShift !== "number") cfg.gradientShift = 0.15;
    if (!cfg.noiseBands) cfg.noiseBands = [];
    if (typeof cfg.foldRadius !== "number") cfg.foldRadius = 0.8;
    if (typeof cfg.foldGap !== "number") cfg.foldGap = 0.6;
    if (typeof cfg.foldCenter !== "number") cfg.foldCenter = 0.55;
    normalizePalette(cfg);
    const pane = new Pane({ container: this.container, title: "Wave Studio" });
    this.pane = pane;
    // Keep sliders in sync while a light is dragged via its 3D gizmo, or while the
    // camera is moved via orbit/zoom/pan.
    this.renderer.onLightsChanged = () => pane.refresh();
    this.renderer.onCameraChanged = () => pane.refresh();

    const refresh = (): void => this.renderer.refresh();

    // Top-level folder that remembers its expanded state across rebuilds.
    type Folder = FolderApi;
    this.folders = [];
    const mkFolder = (title: string, expanded: boolean): Folder => {
      const api = pane.addFolder({ title, expanded: this.foldState[title] ?? expanded });
      this.folders.push({ title, api });
      return api;
    };

    // Tweakpane's combined point widgets (x/y/z in one row) are fiddly, so split
    // every Vec2/Vec3 into individual labelled 1-D sliders — one slider per axis.
    const vec = (
      folder: Folder,
      obj: object,
      label: string,
      opts: { min?: number; max?: number; step?: number },
      axisLabels: [string, string, string] = ["X", "Y", "Z"],
    ): void => {
      const rec = obj as Record<string, number>;
      (["x", "y", "z"] as const).forEach((k, i) => {
        if (!(k in rec)) return;
        folder.addBinding(rec, k, { label: `${label} ${axisLabels[i]}`, ...opts }).on("change", refresh);
      });
    };

    // A per-section "randomize" button: mutate only this section, then push to the
    // renderer + refresh the sliders. `after` handles non-binding widgets (gradient
    // editor) or camera reframing.
    const randomBtn = (folder: Folder, fn: (c: WaveConfig) => void, after?: () => void): void => {
      folder.addButton({ title: "🎲 randomize" }).on("click", () => {
        fn(cfg);
        refresh();
        pane.refresh();
        after?.();
      });
    };

    // ---- Actions ----
    const actions = mkFolder("Actions", true);
    const presetProxy = { preset: "—" };
    actions
      .addBinding(presetProxy, "preset", { label: "preset", options: this.hooks.presetOptions ?? { "—": "—" } })
      .on("change", (ev) => {
        if (ev.value !== "—") this.hooks.onPreset?.(String(ev.value));
      });
    actions.addButton({ title: "🎲 Randomize All" }).on("click", () => this.hooks.onRandomize?.());
    actions.addButton({ title: "🔄 Reset to default" }).on("click", () => this.hooks.onReset?.());
    actions.addButton({ title: "💾 Save state (.json)" }).on("click", () => this.hooks.onExportConfig?.());
    actions.addButton({ title: "📂 Load state (.json)" }).on("click", () => this.hooks.onImportConfig?.());
    actions.addButton({ title: "📷 Export PNG" }).on("click", () => this.hooks.onExportPNG?.());
    actions.addButton({ title: "🔗 Export embed (.html)" }).on("click", () => this.hooks.onExportEmbed?.());
    actions.addButton({ title: "🎬 Record / stop (.webm)" }).on("click", () => this.hooks.onToggleRecord?.());
    actions.addBinding(this.state, "recording", { readonly: true, label: "recording" });

    // ---- Global ----
    const g = mkFolder("Global", false);
    randomBtn(g, randomizeGlobal, () => this.renderer.resize());
    g.addBinding(cfg, "background", { view: "color", label: "background" }).on("change", refresh);
    g.addBinding(cfg, "transparentBackground", { label: "transparent" }).on("change", refresh);
    g.addBinding(cfg, "blendMode", { label: "blend", options: { Normal: "normal", Additive: "additive" } }).on("change", refresh);
    // Structural changes rebuild geometry/strands — only act on the FINAL value of a
    // drag (ev.last), never on every intermediate event, or the rapid rebuilds of the
    // heavy geometry can overwhelm the WebGL context.
    g.addBinding(cfg, "strandCount", { min: 1, max: 6, step: 1 }).on("change", (ev) => {
      if (ev.last) this.rebuildStrands();
    });
    g.addBinding(cfg, "quality", { min: 0.25, max: 2, step: 0.05 }).on("change", (ev) => {
      if (ev.last) this.renderer.rebuild();
    });
    g.addBinding(cfg, "dprMax", { min: 0.5, max: 2, step: 0.5 }).on("change", (ev) => {
      if (ev.last) this.renderer.resize();
    });
    g.addBinding(cfg, "speed", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
    g.addBinding(cfg, "paused").on("change", () => this.renderer.refreshPlayback());
    g.addBinding(cfg, "cameraDistance", { min: 1.5, max: 20, step: 0.05 }).on("change", () =>
      this.renderer.setCameraDistance(cfg.cameraDistance),
    );
    g.addButton({ title: "Reset view" }).on("click", () => this.renderer.resetView());

    // ---- Gradient (draggable stops: drag to reorder + set transition speed) ----
    const gradF = mkFolder("Gradient", true);
    randomBtn(gradF, randomizeGradient, () => this.gradientEditor?.refresh());
    const gradContent =
      (gradF.element.querySelector(".tp-fldv_c") as HTMLElement | null) ?? gradF.element;
    this.gradientEditor = new GradientEditor(gradContent, cfg, { onChange: refresh, max: MAX_COLORS });
    gradF
      .addBinding(cfg, "gradientType", {
        label: "type",
        options: { Linear: "linear", Radial: "radial", Conic: "conic" },
      })
      .on("change", refresh);
    gradF.addBinding(cfg, "gradientAngle", { label: "angle°", min: 0, max: 360, step: 1 }).on("change", refresh);
    gradF.addBinding(cfg, "gradientShift", { label: "2D warp", min: 0, max: 0.6, step: 0.01 }).on("change", refresh);

    // ---- Color & finish ----
    const col = mkFolder("Color & Finish", true);
    randomBtn(col, randomizeColor);
    col.addBinding(cfg, "hueShift", { min: 0, max: 360, step: 1 }).on("change", refresh);
    col.addBinding(cfg, "colorContrast", { min: 0, max: 2, step: 0.01 }).on("change", refresh);
    col.addBinding(cfg, "colorSaturation", { min: 0, max: 2, step: 0.01 }).on("change", refresh);
    col.addBinding(cfg, "fiberCount", { min: 1, max: 1200, step: 1, label: "streak freq" }).on("change", refresh);
    col.addBinding(cfg, "fiberThickness", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
    col.addBinding(cfg, "grain", { min: 0, max: 3, step: 0.01 }).on("change", refresh);
    col.addBinding(cfg, "texture", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
    col.addBinding(cfg, "blur", { min: 0, max: 0.3, step: 0.005 }).on("change", refresh);

    // ---- Noise Bands (Stripe's per-region fiber overrides; empty = uniform) ----
    const bandsF = mkFolder("Noise Bands", false);
    cfg.noiseBands.forEach((band, i) => {
      const sub = bandsF.addFolder({ title: `Band ${i + 1}`, expanded: true });
      sub.addBinding(band, "startX", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
      sub.addBinding(band, "endX", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
      sub.addBinding(band, "startY", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
      sub.addBinding(band, "endY", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
      sub.addBinding(band, "feather", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
      sub.addBinding(band, "strength", { min: 0, max: 2, step: 0.01 }).on("change", refresh);
      sub.addBinding(band, "frequency", { min: 1, max: 1200, step: 1 }).on("change", refresh);
      sub.addBinding(band, "colorAttenuation", { min: 0, max: 1, step: 0.01, label: "colorAtten" }).on("change", refresh);
      sub.addBinding(band, "parabolaPower", { min: 0, max: 5, step: 0.01, label: "parabola" }).on("change", refresh);
      sub.addButton({ title: "remove this band" }).on("click", () => {
        cfg.noiseBands.splice(i, 1);
        refresh();
        setTimeout(() => this.rebuildPanel(), 0);
      });
    });
    if (cfg.noiseBands.length < MAX_NOISE_BANDS) {
      bandsF.addButton({ title: "+ add band" }).on("click", () => {
        cfg.noiseBands.push(createNoiseBand());
        refresh();
        setTimeout(() => this.rebuildPanel(), 0);
      });
    }

    // ---- Spine (the sweep) ----
    const sp = mkFolder("Spine", false);
    randomBtn(sp, randomizeSpine);
    sp.addBinding(cfg, "spineLength", { min: 1, max: 16, step: 0.1, label: "length" }).on("change", refresh);
    sp.addBinding(cfg, "foldRadius", { min: 0, max: 3, step: 0.01, label: "fold radius" }).on("change", refresh);
    sp.addBinding(cfg, "foldGap", { min: 0.01, max: 3, step: 0.01, label: "fold gap" }).on("change", refresh);
    sp.addBinding(cfg, "foldCenter", { min: -1, max: 1, step: 0.01, label: "fold pos" }).on("change", refresh);
    vec(sp, cfg.displaceFrequency, "displace freq", { min: 0, max: 3, step: 0.05 }, ["X (len)", "Z (wid)", ""]);
    sp.addBinding(cfg, "displaceAmount", { min: 0, max: 2, step: 0.01 }).on("change", refresh);

    // ---- Transform ----
    const tr = mkFolder("Transform", false);
    randomBtn(tr, randomizeTransform);
    vec(tr, cfg.position, "position", { min: -5, max: 5, step: 0.05 });
    vec(tr, cfg.rotation, "rotation", { min: -180, max: 180, step: 1 });
    vec(tr, cfg.scale, "scale", { min: 0, max: 3, step: 0.05 });

    // ---- Twist (three axis-rotations: frequency × expStep(uv, power)) ----
    const tw = mkFolder("Twist", true);
    randomBtn(tw, randomizeTwist);
    vec(tw, cfg.twistFrequency, "twist freq", { min: -6.5, max: 6.5, step: 0.05 });
    vec(tw, cfg.twistPower, "twist power", { min: -4, max: 4, step: 0.05 });

    // ---- Wave & Light ----
    const r = mkFolder("Wave & Light", true);
    randomBtn(r, randomizeSurface);
    r.addBinding(cfg, "waveWidth", { min: 0.05, max: 4, step: 0.01, label: "width" }).on("change", refresh);
    r.addBinding(cfg, "widthTaper", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
    // glow* now drive the dFdy "pdy" term — volume/thickness + where streaks appear.
    r.addBinding(cfg, "glowAmount", { min: 0, max: 4, step: 0.01, label: "volume" }).on("change", refresh);
    r.addBinding(cfg, "glowPower", { min: 0.1, max: 4, step: 0.01 }).on("change", refresh);
    r.addBinding(cfg, "glowRamp", { min: 0.05, max: 2, step: 0.01 }).on("change", refresh);
    r.addBinding(cfg, "edgeFade", { min: 0, max: 0.5, step: 0.01 }).on("change", refresh);

    // ---- Lights (positionable; add/remove) ----
    const lightsF = mkFolder("Lights", true);
    randomBtn(lightsF, randomizeLights);
    lightsF.addBinding(cfg, "ambient", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
    const editProxy = { edit: this.renderer.isLightEditMode() };
    lightsF
      .addBinding(editProxy, "edit", { label: "drag in 3D" })
      .on("change", (ev) => this.renderer.setLightEditMode(Boolean(ev.value)));
    cfg.lights.forEach((light, i) => {
      const sub = lightsF.addFolder({ title: `Light ${i + 1}`, expanded: i === 0 });
      vec(sub, light.position, "pos", { min: -20, max: 20, step: 0.1 });
      sub.addBinding(light, "color", { view: "color", label: "color" }).on("change", refresh);
      sub.addBinding(light, "intensity", { min: 0, max: 4, step: 0.01 }).on("change", refresh);
      if (cfg.lights.length > 1) {
        sub.addButton({ title: "remove this light" }).on("click", () => {
          cfg.lights.splice(i, 1);
          refresh();
          setTimeout(() => this.rebuildPanel(), 0);
        });
      }
    });
    if (cfg.lights.length < MAX_LIGHTS) {
      lightsF.addButton({ title: "+ add light" }).on("click", () => {
        cfg.lights.push(createLight({ x: -5, y: 4, z: 6 }, 0.6));
        refresh();
        setTimeout(() => this.rebuildPanel(), 0);
      });
    }

    // ---- Per-strand ----
    if (cfg.layers.length > 1) {
      const strands = mkFolder("Strands", false);
      randomBtn(strands, randomizeStrands);
      cfg.layers.forEach((layer, i) => {
        const lf = strands.addFolder({ title: `Strand ${i + 1}`, expanded: false });
        lf.addBinding(layer, "opacity", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
        lf.addBinding(layer, "hueShift", { min: -180, max: 180, step: 1 }).on("change", refresh);
        lf.addBinding(layer, "widthMul", { min: 0, max: 2, step: 0.01 }).on("change", refresh);
        lf.addBinding(layer, "speed", { min: 0, max: 3, step: 0.01 }).on("change", refresh);
        lf.addBinding(layer, "seed", { min: 0, max: 20, step: 0.1 }).on("change", refresh);
        vec(lf, layer.offset, "offset", { min: -3, max: 3, step: 0.05 });
        lf.addBinding(layer, "twistOffset", { min: -180, max: 180, step: 1 }).on("change", refresh);
      });
    }
  }
}
