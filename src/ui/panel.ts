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
  randomizeFinish,
  randomizeLights,
  randomizeGlobal,
  randomizeStrands,
} from "../wave/config";
import type { WaveConfig } from "../wave/config";
import type { WaveRenderer } from "../wave/WaveRenderer";
import { PALETTE_MAPS, buildPaletteCanvas, paletteMapCanvas } from "../wave/palette";
import { buildHeroPaletteCanvas } from "../wave/heroPalette";
import { GradientEditor } from "./GradientEditor";
import { PaletteDropdown } from "./PaletteDropdown";
import type { PaletteOption } from "./PaletteDropdown";
import { getPresetThumb } from "./presetThumbs";

export interface PanelHooks {
  presetOptions?: Record<string, string>;
  /** Name of the preset the app loads on startup, so the Global → preset dropdown shows it. */
  defaultPreset?: string;
  onPreset?: (name: string) => void;
  onRandomize?: () => void;
  onReset?: () => void;
  onExportConfig?: () => void;
  onImportConfig?: () => void;
  onExportPNG?: () => void;
  onExportEmbed?: () => void;
  onCopyLink?: () => Promise<boolean> | void;
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
  private paletteDropdown?: PaletteDropdown;
  private readonly state = { recording: false };
  /** Remembered expanded/collapsed state of top-level folders, by title, so a
   *  panel rebuild (e.g. on strand-count change) doesn't reset them. */
  private foldState: Record<string, boolean> = {};
  private folders: Array<{ title: string; api: FolderApi }> = [];
  private searchQuery = "";
  /** Name of the last-applied preset, shown in the Global → preset dropdown. Persists
   *  across panel rebuilds (every preset apply rebuilds the panel), and reverts to "—"
   *  when the user manually edits any control — so the label stays honest and the same
   *  preset can be re-selected. */
  private selectedPreset = "—";
  private presetDropdown?: PaletteDropdown;

  constructor(
    private readonly container: HTMLElement,
    private readonly renderer: WaveRenderer,
    private config: WaveConfig,
    private readonly hooks: PanelHooks = {},
  ) {
    if (hooks.defaultPreset) this.selectedPreset = hooks.defaultPreset;
    this.build();
  }

  setConfig(config: WaveConfig, presetName = "—"): void {
    this.config = config;
    this.selectedPreset = presetName;
    setTimeout(() => this.rebuildPanel(), 0);
  }

  /** Revert the preset label to "—" after a manual edit, so it doesn't claim a preset the
   *  config no longer matches (and so re-selecting that preset fires a change again). */
  private clearPresetIndicator(): void {
    if (this.selectedPreset === "—") return;
    this.selectedPreset = "—";
    this.presetDropdown?.refresh();
  }

  /** Redraw the preset picker's thumbnails once they've finished rendering offscreen. */
  refreshPresetThumbs(): void {
    this.presetDropdown?.refresh();
  }

  setRecording(on: boolean): void {
    this.state.recording = on;
    this.pane.refresh();
  }

  disposeEditor(): void {
    this.gradientEditor?.destroy();
    this.gradientEditor = undefined;
    this.paletteDropdown?.destroy();
    this.paletteDropdown = undefined;
    this.presetDropdown?.destroy();
    this.presetDropdown = undefined;
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
    // Backfill fields that may be absent in older saved states. Lights default to
    // EMPTY — only create the array if it's missing.
    if (!cfg.lights) cfg.lights = [];
    if (typeof cfg.ambient !== "number") cfg.ambient = 0.45;
    if (cfg.gradientType !== "radial" && cfg.gradientType !== "conic") cfg.gradientType = "linear";
    if (typeof cfg.gradientAngle !== "number") cfg.gradientAngle = 90;
    if (typeof cfg.gradientShift !== "number") cfg.gradientShift = 0.15;
    if (typeof cfg.usePaletteTexture !== "boolean") cfg.usePaletteTexture = true;
    if (typeof cfg.paletteSource !== "string") cfg.paletteSource = "hero";
    if (typeof cfg.paletteEdgeColor !== "string") cfg.paletteEdgeColor = "#8e9dff";
    if (typeof cfg.paletteEdgeAmount !== "number") cfg.paletteEdgeAmount = 0.3;
    if (typeof cfg.volume !== "number") cfg.volume = 0.55;
    if (typeof cfg.pdyLift !== "number") cfg.pdyLift = 0.5;
    if (typeof cfg.mirrorH !== "boolean") cfg.mirrorH = false;
    if (typeof cfg.mirrorV !== "boolean") cfg.mirrorV = false;
    if (typeof cfg.fov !== "number") cfg.fov = 44;
    if (typeof cfg.cameraZoom !== "number") cfg.cameraZoom = 1;
    if (typeof cfg.showCameraRig !== "boolean") cfg.showCameraRig = true;
    if (!cfg.noiseBands) cfg.noiseBands = [];
    normalizePalette(cfg);
    const pane = new Pane({ container: this.container, title: "Wave Studio" });
    this.pane = pane;

    // Search box to filter the many knobs by label/section name.
    this.container.querySelector(".wv-search")?.remove();
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "search controls…";
    search.className = "wv-search";
    search.value = this.searchQuery;
    search.style.cssText =
      "width:100%;box-sizing:border-box;margin:0 0 6px;padding:6px 9px;border-radius:5px;outline:none;" +
      "font:12px ui-sans-serif,system-ui,-apple-system,sans-serif;color:#d6d7db;" +
      "background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);";
    this.container.insertBefore(search, this.container.firstChild);
    search.addEventListener("input", () => {
      this.searchQuery = search.value;
      this.applyFilter();
    });
    // Keep sliders in sync while a light is dragged via its 3D gizmo, or while the
    // camera is moved via orbit/zoom/pan. Tweakpane's refresh() re-emits 'change' for
    // any value that changed, so we guard with `syncing`: without it, orbiting writes
    // cameraDistance → refresh re-fires the slider's change → setCameraDistance dollies
    // the camera → another orbit change → a feedback loop that makes the view jump.
    let syncing = false;
    // Camera proxy: orbit-style values shown in the Camera folder, kept in two-way sync with
    // the live camera. The camera is orthographic, so the framing knob is `zoom` (not
    // fov); `distance` stays internal (orbit positioning only — it doesn't change ortho size).
    const camP = { azimuth: 0, elevation: 0, distance: 5000, panX: 0, panY: 0, zoom: cfg.cameraZoom ?? 1 };
    const rc = (n: number): number => Math.round(n * 10) / 10;
    const syncCam = (): void => {
      const o = this.renderer.getCameraOrbit();
      camP.azimuth = rc(o.azimuth);
      camP.elevation = rc(o.elevation);
      camP.distance = o.distance;
      camP.panX = rc(o.panX);
      camP.panY = rc(o.panY);
      camP.zoom = Math.round(this.renderer.getFov() * 100) / 100;
    };
    syncCam();
    const syncPanel = (): void => {
      syncing = true;
      syncCam();
      pane.refresh();
      syncing = false;
    };
    this.renderer.onLightsChanged = syncPanel;
    this.renderer.onCameraChanged = syncPanel;

    const refresh = (): void => {
      this.clearPresetIndicator(); // a manual edit means the config no longer matches a preset
      this.renderer.refresh();
    };

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
    actions.addButton({ title: "🎲 Randomize All" }).on("click", () => this.hooks.onRandomize?.());
    actions.addButton({ title: "🔄 Reset to default" }).on("click", () => this.hooks.onReset?.());
    actions.addButton({ title: "💾 Save state (.json)" }).on("click", () => this.hooks.onExportConfig?.());
    actions.addButton({ title: "📂 Load state (.json)" }).on("click", () => this.hooks.onImportConfig?.());
    actions.addButton({ title: "📷 Export PNG" }).on("click", () => this.hooks.onExportPNG?.());
    actions.addButton({ title: "🔗 Export embed (.html)" }).on("click", () => this.hooks.onExportEmbed?.());
    const linkBtn = actions.addButton({ title: "🔗 Copy share link" });
    linkBtn.on("click", async () => {
      const ok = await this.hooks.onCopyLink?.();
      linkBtn.title = ok === false ? "✓ URL updated (copy it)" : "✓ Link copied!";
      setTimeout(() => (linkBtn.title = "🔗 Copy share link"), 1600);
    });
    actions.addButton({ title: "🎬 Record / stop (.webm)" }).on("click", () => this.hooks.onToggleRecord?.());
    actions.addBinding(this.state, "recording", { readonly: true, label: "recording" });

    // ---- Global ----
    const g = mkFolder("Global", true);
    // Presets are whole-scene ("global") configs (colour, transform, twist, displacement AND
    // the matched per-section camera) — so they live at the top of Global. Shown as a custom
    // dropdown with a wave-shape THUMBNAIL per preset (the configs mostly share the hero
    // palette, so only the shape distinguishes them). selectedId reflects the active preset;
    // a manual edit flips it to "—" (Custom). Thumbnails fill in async (see refreshPresetThumbs).
    const presetNames = Object.keys(this.hooks.presetOptions ?? {}).filter((n) => n !== "—");
    const gContent = (g.element.querySelector(".tp-fldv_c") as HTMLElement | null) ?? g.element;
    this.presetDropdown = new PaletteDropdown(gContent, {
      rootClass: "wv-pd-big",
      options: presetNames.map((n) => ({ id: n, label: n, group: "Presets" })),
      thumbFor: (id) => getPresetThumb(id),
      selectedId: () => (this.selectedPreset === "—" ? null : this.selectedPreset),
      customLabel: () => (this.selectedPreset === "—" ? "Custom (edited)" : null),
      onSelect: (id) => this.hooks.onPreset?.(id),
    });
    // Mount it at the very top of the Global folder (it appends to the end by default).
    gContent.insertBefore(this.presetDropdown.element, gContent.firstChild);
    randomBtn(g, randomizeGlobal, () => this.renderer.resize());
    g.addBinding(cfg, "background", { view: "color", label: "background" }).on("change", refresh);
    g.addBinding(cfg, "transparentBackground", { label: "transparent" }).on("change", refresh);
    g.addBinding(cfg, "blendMode", {
      label: "blend",
      options: { Squared: "squared", Normal: "normal", Additive: "additive" },
    }).on("change", refresh);
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
    // Noise phase — scrub the animation to pick a still frame.
    g.addBinding(cfg, "timeOffset", { min: 0, max: 60, step: 0.5, label: "noise phase" }).on("change", refresh);
    // Ease the animation in over ~1s on load.
    g.addBinding(cfg, "introRamp", { label: "intro ease-in" }).on("change", refresh);
    // ---- Camera (orbit-style controls; two-way synced with mouse drag/zoom/pan) ----
    const camF = mkFolder("Camera", true);
    const onOrbit = (): void => {
      if (!syncing) this.renderer.setCameraOrbit(camP.azimuth, camP.elevation, camP.distance);
    };
    const onPan = (): void => {
      if (!syncing) this.renderer.setCameraTarget(camP.panX, camP.panY);
    };
    camF.addBinding(camP, "azimuth", { min: -180, max: 180, step: 1, label: "azimuth°" }).on("change", onOrbit);
    camF.addBinding(camP, "elevation", { min: -89, max: 89, step: 1, label: "elevation°" }).on("change", onOrbit);
    // Orthographic framing: zoom (no fov/distance).
    camF.addBinding(camP, "zoom", { min: 0.1, max: 6, step: 0.05, label: "zoom" }).on("change", () => {
      if (!syncing) this.renderer.setFov(camP.zoom);
    });
    camF.addBinding(camP, "panX", { min: -2000, max: 2000, step: 10, label: "pan X" }).on("change", onPan);
    camF.addBinding(camP, "panY", { min: -2000, max: 2000, step: 10, label: "pan Y" }).on("change", onPan);
    camF.addButton({ title: "Fit to screen" }).on("click", () => this.renderer.fitToView());
    camF.addButton({ title: "Reset camera" }).on("click", () => this.renderer.resetView());
    camF.addBinding(cfg, "showCameraRig", { label: "rig minimap" }).on("change", () => {
      this.renderer.setCameraRig(cfg.showCameraRig);
    });
    this.renderer.setCameraRig(cfg.showCameraRig);

    // ---- Gradient (draggable stops: drag to reorder + set transition speed) ----
    const gradF = mkFolder("Gradient", true);
    randomBtn(gradF, randomizeGradient, () => this.gradientEditor?.refresh());
    const gradContent =
      (gradF.element.querySelector(".tp-fldv_c") as HTMLElement | null) ?? gradF.element;
    this.gradientEditor = new GradientEditor(gradContent, cfg, { onChange: refresh, max: MAX_COLORS });
    // gradientType/angle/warp drive the procedural (non-texture) gradient; the stops +
    // edge tint drive the "Custom stops" texture. Disable whichever don't apply to the
    // current palette source so it's clear what's editable.
    const bGradType = gradF
      .addBinding(cfg, "gradientType", { label: "type", options: { Linear: "linear", Radial: "radial", Conic: "conic" } })
      .on("change", refresh);
    const bGradAngle = gradF.addBinding(cfg, "gradientAngle", { label: "angle°", min: 0, max: 360, step: 1 }).on("change", refresh);
    const bGradShift = gradF.addBinding(cfg, "gradientShift", { label: "2D warp", min: 0, max: 0.6, step: 0.01 }).on("change", refresh);
    // 2D palette texture. Source = baked hero LUT, our editable
    // stops, a built-in map, or a custom image you load.
    const bUseTex = gradF.addBinding(cfg, "usePaletteTexture", { label: "palette 2D" }).on("change", () => {
      updatePaletteControls();
      refresh();
    });
    // Palette-source picker with an image preview of each source IN the dropdown
    // (Tweakpane lists can't render thumbnails). Grouped: 2-D image maps, then the
    // gradient-stop presets, then the editable "Custom stops".
    const thumbFor = (id: string): HTMLCanvasElement =>
      id === "hero"
        ? buildHeroPaletteCanvas()
        : id === "stops"
          ? buildPaletteCanvas({ stops: cfg.palette, edgeColor: cfg.paletteEdgeColor, edgeAmount: cfg.paletteEdgeAmount })
          : paletteMapCanvas(PALETTE_MAPS[id]);
    const ddOptions: PaletteOption[] = [{ id: "hero", label: "Hero", group: "Image maps" }];
    for (const [id, def] of Object.entries(PALETTE_MAPS)) if (def.kind === "image") ddOptions.push({ id, label: def.label, group: "Image maps" });
    for (const [id, def] of Object.entries(PALETTE_MAPS)) if (def.kind === "gradient") ddOptions.push({ id, label: def.label, group: "Gradient presets" });
    ddOptions.push({ id: "stops", label: "Custom stops", group: "Editable" });
    this.paletteDropdown = new PaletteDropdown(gradContent, {
      options: ddOptions,
      thumbFor,
      selectedId: () => (cfg.paletteImageUrl ? null : cfg.paletteSource),
      customLabel: () => (cfg.paletteImageUrl ? "Custom image" : null),
      onSelect: (id) => {
        cfg.paletteSource = id;
        cfg.paletteImageUrl = undefined; // a dropdown choice overrides any loaded image
        updatePaletteControls();
        refresh();
      },
    });
    // Move the picker directly under the "palette 2D" toggle (it mounts at the end).
    gradContent.insertBefore(this.paletteDropdown.element, bUseTex.element.nextSibling);
    gradF.addButton({ title: "📂 load palette image…" }).on("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        const f = input.files?.[0];
        if (f) {
          cfg.paletteImageUrl = URL.createObjectURL(f);
          updatePaletteControls();
          refresh();
        }
      };
      input.click();
    });
    // Edge tint applies to the "Custom stops" source (the cool periwinkle edges).
    const bEdgeColor = gradF.addBinding(cfg, "paletteEdgeColor", { view: "color", label: "edge tint" }).on("change", refresh);
    const bEdgeAmt = gradF.addBinding(cfg, "paletteEdgeAmount", { label: "edge amt", min: 0, max: 1, step: 0.01 }).on("change", refresh);

    const updatePaletteControls = (): void => {
      const tex = cfg.usePaletteTexture;
      const custom = !!cfg.paletteImageUrl;
      const isStops = cfg.paletteSource === "stops";
      const stopsActive = !custom && (!tex || isStops); // stops drive procedural grad or the "stops" texture
      const procActive = !tex; // type/angle/warp only affect the procedural gradient
      const edgeActive = tex && !custom && isStops; // edge tint only fills the "stops" texture
      this.gradientEditor?.setEnabled(stopsActive);
      bGradType.disabled = !procActive;
      bGradAngle.disabled = !procActive;
      bGradShift.disabled = !procActive;
      bEdgeColor.disabled = !edgeActive;
      bEdgeAmt.disabled = !edgeActive;
      this.paletteDropdown?.refresh(); // keep the trigger thumbnail/label current
    };
    updatePaletteControls();

    // ---- Color (hue / contrast / saturation grading) ----
    const col = mkFolder("Color", true);
    randomBtn(col, randomizeColor);
    // Hue is cyclic; allow negatives (most presets use small negative shifts) —
    // a min of 0 clipped them. Matches the per-strand hue range.
    col.addBinding(cfg, "hueShift", { min: -180, max: 180, step: 1 }).on("change", refresh);
    col.addBinding(cfg, "colorContrast", { min: 0, max: 2, step: 0.01 }).on("change", refresh);
    col.addBinding(cfg, "colorSaturation", { min: 0, max: 2, step: 0.01 }).on("change", refresh);

    // ---- Finish (surface texture + volume/glow, plus the render-mode theme) ----
    const fin = mkFolder("Finish", true);
    randomBtn(fin, randomizeFinish);
    // Lengthwise fiber streaks: density (streak freq) and width.
    fin.addBinding(cfg, "fiberCount", { min: 1, max: 1200, step: 1, label: "streak freq" }).on("change", refresh);
    fin.addBinding(cfg, "fiberThickness", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
    fin.addBinding(cfg, "grain", { min: 0, max: 3, step: 0.01 }).on("change", refresh);
    fin.addBinding(cfg, "texture", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
    fin.addBinding(cfg, "blur", { min: 0, max: 0.3, step: 0.005 }).on("change", refresh);
    fin.addBinding(cfg, "blurSamples", { min: 1, max: 16, step: 1, label: "blur samples" }).on("change", refresh);
    // Normal-based volume gives the rounded "thickness"; pdyLift is the derivative
    // white-lift; glow* drive the dFdy "pdy" term (where streaks appear + that lift).
    fin.addBinding(cfg, "volume", { min: 0, max: 1.2, step: 0.01, label: "thickness" }).on("change", refresh);
    fin.addBinding(cfg, "pdyLift", { min: 0, max: 2, step: 0.01, label: "pdy lift" }).on("change", refresh);
    fin.addBinding(cfg, "glowAmount", { min: 0, max: 6, step: 0.01, label: "glow" }).on("change", refresh);
    fin.addBinding(cfg, "glowPower", { min: 0.1, max: 4, step: 0.01 }).on("change", refresh);
    fin.addBinding(cfg, "glowRamp", { min: 0.05, max: 2, step: 0.01 }).on("change", refresh);
    fin.addBinding(cfg, "edgeFade", { min: 0, max: 0.5, step: 0.01 }).on("change", refresh);
    // Render mode: "solid" = surface shader; "wireframe" = the wave carved into fine
    // vertical lines on the background colour. The line* knobs shape those wireframe lines.
    fin.addBinding(cfg, "theme", { label: "theme", options: { solid: "solid", wireframe: "wireframe" } }).on("change", refresh);
    fin.addBinding(cfg, "lineAmount", { min: 1, max: 1200, step: 1, label: "line count" }).on("change", refresh);
    fin.addBinding(cfg, "lineThickness", { min: 0, max: 3, step: 0.01, label: "line thickness" }).on("change", refresh);
    fin.addBinding(cfg, "lineDerivativePower", { min: 0, max: 2, step: 0.01, label: "line falloff" }).on("change", refresh);
    fin.addBinding(cfg, "maxWidth", { min: 1, max: 3000, step: 1, label: "max width" }).on("change", refresh);

    // ---- Noise Bands (per-region fiber overrides; empty = uniform) ----
    const bandsF = mkFolder("Noise Bands", true);
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

    // ---- Displacement (noise pushes the baked folded() geometry along Y) ----
    const sp = mkFolder("Displacement", true);
    randomBtn(sp, randomizeSpine);
    vec(sp, cfg.displaceFrequency, "displace freq", { min: 0, max: 0.03, step: 0.0002 }, ["X (len)", "Z (wid)", ""]);
    sp.addBinding(cfg, "displaceAmount", { min: -12, max: 12, step: 0.05 }).on("change", refresh);

    // ---- Transform (position/rotation/scale of the folded mesh) ----
    const tr = mkFolder("Transform", true);
    randomBtn(tr, randomizeTransform);
    // The mesh is scaled ×10 and the ortho camera frames in pixels, so position/scale
    // live in the tens, not fractions — the ranges are sized accordingly.
    vec(tr, cfg.position, "position", { min: -600, max: 600, step: 1 }); // Wave 2b uses posX 525
    vec(tr, cfg.rotation, "rotation", { min: -180, max: 180, step: 0.1 });
    vec(tr, cfg.scale, "scale", { min: 0, max: 30, step: 0.1 });
    tr.addButton({ title: "↔ mirror horizontal" }).on("click", () => {
      cfg.mirrorH = !cfg.mirrorH;
      refresh();
    });
    tr.addButton({ title: "↕ mirror vertical" }).on("click", () => {
      cfg.mirrorV = !cfg.mirrorV;
      refresh();
    });

    // ---- Twist (three axis-rotations: frequency × expStep(uv, power)) ----
    const tw = mkFolder("Twist", true);
    randomBtn(tw, randomizeTwist);
    vec(tw, cfg.twistFrequency, "twist freq", { min: -2, max: 2, step: 0.002 });
    vec(tw, cfg.twistPower, "twist power", { min: 0, max: 8, step: 0.05 });
    // The animated-twist vertex variant: animate the X-twist with simplex
    // noise so the ribbon's twist breathes over time (used by the Wave 4 preset).
    tw.addBinding(cfg, "twistMotion", { label: "animate twist" }).on("change", refresh);

    // ---- Lights (positionable; add/remove) ----
    const lightsF = mkFolder("Lights", true);
    randomBtn(lightsF, randomizeLights);
    lightsF.addBinding(cfg, "ambient", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
    const editProxy = { edit: this.renderer.isLightEditMode() };
    lightsF
      .addBinding(editProxy, "edit", { label: "drag in 3D" })
      .on("change", async (ev) => {
        const on = Boolean(ev.value);
        // Nothing to drag without a light — add one (out where it's visible) so the
        // gizmo has a handle, then rebuild to reveal its controls.
        const added = on && cfg.lights.length === 0;
        if (added) {
          cfg.lights.push(createLight({ x: 800, y: 900, z: 1100 }, 1));
          refresh();
        }
        await this.renderer.setLightEditMode(on);
        if (added) this.rebuildPanel();
      });
    cfg.lights.forEach((light, i) => {
      const sub = lightsF.addFolder({ title: `Light ${i + 1}`, expanded: i === 0 });
      vec(sub, light.position, "pos", { min: -3000, max: 3000, step: 25 });
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
        cfg.lights.push(createLight({ x: -800, y: 600, z: 900 }, 0.7));
        refresh();
        setTimeout(() => this.rebuildPanel(), 0);
      });
    }

    // ---- Per-strand ----
    if (cfg.layers.length > 1) {
      const strands = mkFolder("Strands", true);
      randomBtn(strands, randomizeStrands);
      cfg.layers.forEach((layer, i) => {
        const lf = strands.addFolder({ title: `Strand ${i + 1}`, expanded: true });
        lf.addBinding(layer, "opacity", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
        lf.addBinding(layer, "hueShift", { min: -180, max: 180, step: 1 }).on("change", refresh);
        lf.addBinding(layer, "widthMul", { min: 0, max: 2, step: 0.01 }).on("change", refresh);
        lf.addBinding(layer, "speed", { min: 0, max: 3, step: 0.01 }).on("change", refresh);
        lf.addBinding(layer, "seed", { min: 0, max: 20, step: 0.1 }).on("change", refresh);
        vec(lf, layer.offset, "offset", { min: -3, max: 3, step: 0.05 });
        lf.addBinding(layer, "twistOffset", { min: -180, max: 180, step: 1 }).on("change", refresh);
      });
    }
    this.applyIcons();
    if (this.searchQuery) this.applyFilter();
  }

  /** Filter the panel by the search query: hide non-matching rows + empty folders. */
  private applyFilter(): void {
    const q = this.searchQuery.trim().toLowerCase();
    const rows = this.container.querySelectorAll<HTMLElement>(".tp-lblv, .tp-btnv");
    if (!q) {
      rows.forEach((r) => (r.style.display = ""));
      this.container.querySelectorAll<HTMLElement>(".tp-fldv").forEach((f) => (f.style.display = ""));
      for (const { title, api } of this.folders) api.expanded = this.foldState[title] ?? api.expanded;
      return;
    }
    rows.forEach((r) => {
      const label = (
        r.querySelector(".tp-lblv_l")?.textContent ||
        r.querySelector(".tp-btnv_t")?.textContent ||
        ""
      ).toLowerCase();
      r.style.display = label.includes(q) ? "" : "none";
    });
    for (const { title, api } of this.folders) {
      const el = api.element as HTMLElement;
      const hasVisible = [...el.querySelectorAll<HTMLElement>(".tp-lblv, .tp-btnv")].some((r) => r.style.display !== "none");
      const show = title.toLowerCase().includes(q) || hasVisible;
      el.style.display = show ? "" : "none";
      if (show && hasVisible) api.expanded = true;
    }
  }

  /** Swap leading emojis on buttons for clean monochrome inline SVG icons (post-build). */
  private applyIcons(): void {
    const sw = 1.5;
    const svg = (inner: string): string =>
      `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    const ICONS: Record<string, string> = {
      "🎲": svg('<path d="M1.6 4.6 8 1.2l6.4 3.4L8 8 1.6 4.6Z"/><path d="M1.6 4.6v6.8L8 14.8V8"/><path d="M14.4 4.6v6.8L8 14.8"/>'),
      "🔄": svg('<path d="M13.4 8a5.4 5.4 0 1 1-1.7-3.9"/><path d="M13.8 2.4v3.1h-3.1"/>'),
      "💾": svg('<path d="M8 1.9v7"/><path d="M5.2 6.2 8 9l2.8-2.8"/><path d="M2.6 12.6h10.8"/>'),
      "📂": svg('<path d="M1.9 4.3h4l1.4 1.8h6.8v6.6H1.9z"/>'),
      "📷": svg('<rect x="1.9" y="4.9" width="12.2" height="8.2" rx="1.2"/><circle cx="8" cy="9" r="2.2"/><path d="M5.7 4.9 6.7 3.1h2.6l1 1.8"/>'),
      "🔗": svg('<path d="M6.6 9.4 9.4 6.6"/><path d="M7.3 4.7 8.5 3.5a2.5 2.5 0 0 1 3.6 3.6L10.9 8.3"/><path d="M8.7 11.3 7.5 12.5a2.5 2.5 0 0 1-3.6-3.6L5.1 7.7"/>'),
      "🎬": svg('<circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none"/>'),
    };
    const STYLE_ID = "wv-icon-style";
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement("style");
      s.id = STYLE_ID;
      s.textContent = ".wv-ic{display:inline-flex;align-items:center;vertical-align:-2px;margin-right:6px;opacity:0.82}";
      document.head.appendChild(s);
    }
    this.container.querySelectorAll(".tp-btnv_t").forEach((el) => {
      const txt = el.textContent ?? "";
      for (const [emoji, icon] of Object.entries(ICONS)) {
        if (txt.startsWith(emoji)) {
          (el as HTMLElement).innerHTML = `<span class="wv-ic">${icon}</span>${txt.slice(emoji.length).trimStart()}`;
          break;
        }
      }
    });

    // Section (folder) header icons.
    const FOLDERS: Record<string, string> = {
      Actions: svg('<path d="M8.5 1.6 3 9h3.4L7 14.4 13 7H9.6z"/>'),
      Global: svg('<circle cx="8" cy="8" r="2.1"/><path d="M8 1.7v1.7M8 12.6v1.7M1.7 8h1.7M12.6 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"/>'),
      Camera: svg('<rect x="1.9" y="4.9" width="12.2" height="8.2" rx="1.2"/><circle cx="8" cy="9" r="2.2"/><path d="M5.7 4.9 6.7 3.1h2.6l1 1.8"/>'),
      Gradient: svg('<rect x="2.2" y="3.6" width="11.6" height="8.8" rx="1.4"/><path d="m2.6 12 5-5 3 2.4 2.8-3"/>'),
      Color: svg('<path d="M8 1.9C5.2 5 3.4 7 3.4 9.2a4.6 4.6 0 0 0 9.2 0C12.6 7 10.8 5 8 1.9Z"/>'),
      "Noise Bands": svg('<path d="M3 13V8M6.5 13V3.8M10 13V6.4M13.5 13V9.6"/>'),
      Displacement: svg('<path d="M1.8 8c2-4.2 4.2-4.2 6.2 0s4.2 4.2 6.2 0"/>'),
      Transform: svg('<path d="M8 2.4v11.2M2.4 8h11.2M6.3 4.3 8 2.4l1.7 1.9M6.3 11.7 8 13.6l1.7-1.9M4.3 6.3 2.4 8l1.9 1.7M11.7 6.3 13.6 8l-1.9 1.7"/>'),
      Twist: svg('<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13.2 2.6v3.1h-3.1"/>'),
      Finish: svg('<path d="m8 1.9 1.4 4.1 4.1 1-4.1 1L8 12.1 6.6 8l-4.1-1 4.1-1z"/>'),
      Lights: svg('<circle cx="8" cy="8" r="2.9"/><path d="M8 1.6v1.7M8 12.7v1.7M1.6 8h1.7M12.7 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"/>'),
      Strands: svg('<path d="M2 5h12M2 8h12M2 11h12"/>'),
    };
    this.container.querySelectorAll(".tp-fldv_t").forEach((el) => {
      const txt = (el.textContent ?? "").trim();
      const icon = FOLDERS[txt];
      if (icon && !el.querySelector(".wv-ic")) {
        (el as HTMLElement).innerHTML = `<span class="wv-ic">${icon}</span>${txt}`;
      }
    });
  }
}
