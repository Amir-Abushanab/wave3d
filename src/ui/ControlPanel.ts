import { Pane } from "tweakpane";
import waveStudioLogoUrl from "../assets/favicon.png?inline";
import { injectStyleOnce } from "../util/dom";
import { roundTo } from "../util/math";
import {
  resizeWaves,
  createLight,
  DEFAULT_LIGHT_POSITION,
  createNoiseBand,
  ensureSceneDefaults,
  normalizeWave,
  MAX_COLORS,
  MAX_LIGHTS,
  MAX_MESH_POINTS,
  MAX_NOISE_BANDS,
  MAX_WAVES,
  randomizeGradient,
  randomizeColor,
  randomizeBackground,
  randomizeSpine,
  randomizeTransform,
  randomizeTwist,
  randomizeFinish,
  randomizeLights,
  randomizeGlobal,
  randomizeWave,
} from "../wave/config";
import type { StudioConfig, WaveConfig } from "../wave/config";
import type { WaveRenderer } from "../wave/WaveRenderer";
import { PALETTE_MAPS, buildPaletteCanvas, paletteMapCanvas } from "../wave/palette";
import { buildHeroPaletteCanvas } from "../wave/heroPalette";
import { GradientEditor } from "./GradientEditor";
import { MeshGradientEditor } from "./MeshGradientEditor";
import { PaletteDropdown } from "./PaletteDropdown";
import type { PaletteOption } from "./PaletteDropdown";
import { getPresetThumb } from "./presetThumbs";
import { applyControlHints, hideControlHint } from "./controlHints";
import {
  applyCustomExportDimension,
  applyExportPreset,
  canExportImageFormat,
  canRecordFormat,
  captureExportAspectRatio,
  CUSTOM_EXPORT_PRESET,
  EXPORT_PRESETS,
  IMAGE_FORMATS,
  exportGpuWarning,
} from "../output/formats";
import type { ExportSize, ImageFormat, RecordFormat } from "../output/formats";

function pickMediaDataUrl(onLoad: (url: string, kind: "image" | "video") => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,video/*";
  input.addEventListener(
    "change",
    () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.addEventListener(
        "load",
        () => {
          if (typeof reader.result === "string")
            onLoad(reader.result, file.type.startsWith("video/") ? "video" : "image");
        },
        { once: true },
      );
      reader.readAsDataURL(file);
    },
    { once: true },
  );
  input.click();
}

export interface PanelHooks {
  presetOptions?: Record<string, string>;
  /** Name of the preset the app loads on startup, so the Global → preset dropdown shows it. */
  defaultPreset?: string;
  onPreset?: (name: string) => void;
  onRandomize?: () => void;
  onReset?: () => void;
  onExportConfig?: () => void;
  onImportConfig?: () => void;
  onExportImage?: (format: ImageFormat, quality: number) => void;
  onExportEmbed?: () => void;
  onCopyLink?: () => Promise<boolean> | void;
  onToggleRecord?: (format: RecordFormat) => void;
  /** Fired after any change that mutates the document config, so the app can record undo/redo
   *  history. Called liberally (continuous during drags) — the History layer coalesces. */
  onEdit?: () => void;
  exportSize?: ExportSize;
  onExportSizeChange?: () => void;
  /** Fired with true/false as the pointer/focus enters/leaves the size controls, so the app can
   *  reveal the export-area readout for live feedback while you adjust the dimensions. */
  onSizeControlsActive?: (active: boolean) => void;
}

/**
 * Tweakpane control panel. Bindings mutate the shared config in place and ask
 * the renderer to refresh; structural changes (wave count, quality) rebuild
 * geometry, and wave-count also rebuilds the panel.
 */
type FolderApi = ReturnType<Pane["addFolder"]>;
type MkFolder = (title: string, expanded: boolean) => FolderApi;
type RandomBtn = (folder: FolderApi, fn: (c: StudioConfig) => void, after?: () => void) => void;
type VecRows = (
  folder: FolderApi,
  obj: object,
  label: string,
  opts: { min?: number; max?: number; step?: number },
  axisLabels?: [string, string, string],
) => void;

export class ControlPanel {
  private pane!: Pane;
  /** Per-wave colour editors (one set per wave's Color & Gradient sub-folder). */
  private waveGradientEditors: GradientEditor[] = [];
  private waveMeshEditors: MeshGradientEditor[] = [];
  private wavePaletteDropdowns: PaletteDropdown[] = [];
  private backgroundGradientEditor?: GradientEditor;
  private backgroundMeshEditor?: MeshGradientEditor;
  private backgroundGradientDropdown?: PaletteDropdown;
  private backgroundImageDropdown?: PaletteDropdown;
  private readonly state = {
    recording: false,
    recordFormat: "mp4" as RecordFormat, // MP4 is the most shareable; falls back to WebM if unsupported
    imageFormat: "webp" as ImageFormat, // WebP: small + supports transparency; falls back if unsupported
    imageQuality: 0.92,
  };
  /** Remembered expanded/collapsed state of top-level folders, by title, so a
   *  panel rebuild (e.g. on wave-count change) doesn't reset them. */
  private foldState: Record<string, boolean> = {};
  private folders: Array<{ title: string; api: FolderApi }> = [];
  /** Guards the camera two-way sync: refresh() re-emits 'change' for updated bindings, and
   *  without the guard orbiting writes camera state -> refresh re-fires the slider's change ->
   *  the camera moves again -> a feedback loop that makes the view jump. */
  private camSyncing = false;
  /** Orbit-style camera proxy shown in the Camera folder, two-way synced with the live camera.
   *  The camera is orthographic, so the framing knob is `zoom` (not fov); `distance` stays
   *  internal (orbit positioning only - it doesn't change ortho size). */
  private readonly camP = { azimuth: 0, elevation: 0, distance: 5000, panX: 0, panY: 0, zoom: 1 };
  private searchQuery = "";
  private syncingOutput = false;
  /** Name of the last-applied preset, shown in the Global → preset dropdown. Persists
   *  across panel rebuilds (every preset apply rebuilds the panel), and reverts to "—"
   *  when the user manually edits any control — so the label stays honest and the same
   *  preset can be re-selected. */
  private selectedPreset = "—";
  private presetDropdown?: PaletteDropdown;
  /** The Output → record button, so its label can flip Record ⇄ Stop while recording. */
  private recordBtn?: ReturnType<FolderApi["addButton"]>;

  constructor(
    private readonly container: HTMLElement,
    private readonly renderer: WaveRenderer,
    private config: StudioConfig,
    private readonly hooks: PanelHooks = {},
  ) {
    if (hooks.defaultPreset) this.selectedPreset = hooks.defaultPreset;
    this.build();
  }

  setConfig(config: StudioConfig, presetName = "—"): void {
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

  /** The current preset-dropdown label ("—" after a manual edit); used to tag history entries. */
  getPresetLabel(): string {
    return this.selectedPreset;
  }

  /** Redraw the preset picker's thumbnails once they've finished rendering offscreen. */
  refreshPresetThumbs(): void {
    this.presetDropdown?.refresh();
  }

  setRecording(on: boolean): void {
    this.state.recording = on;
    // The on-stage overlay (see RecordingOverlay) is the primary indicator; here we just
    // flip the button's label between Record and Stop and re-apply its inline icon.
    if (this.recordBtn) this.recordBtn.title = this.recordTitle();
    this.applyIcons();
  }

  /** Label for the record button: "⏹ Stop recording" while recording, else
   *  "🎬 Record (.<fmt>)" for the chosen container. */
  private recordTitle(): string {
    return this.state.recording ? "⏹ Stop recording" : `🎬 Record (.${this.state.recordFormat})`;
  }

  /** Wrap Tweakpane rows in a labelled, bordered box. `inline` rows share one flex line; any
   *  `stacked` rows (e.g. a conditional slider) go full-width beneath it. Used for the image
   *  and recording export groups. */
  private groupRows(caption: string, inline: HTMLElement[], stacked: HTMLElement[] = []): void {
    const anchor = inline[0] ?? stacked[0];
    if (!anchor) return;
    const box = document.createElement("div");
    box.className = "wv-ctl-group";
    const cap = document.createElement("div");
    cap.className = "wv-ctl-cap";
    cap.textContent = caption;
    anchor.parentElement?.insertBefore(box, anchor);
    box.appendChild(cap);
    if (inline.length > 0) {
      const line = document.createElement("div");
      line.className = "wv-ctl-row";
      for (const row of inline) line.appendChild(row);
      box.appendChild(line);
    }
    for (const row of stacked) box.appendChild(row);
  }

  refreshOutputSize(): void {
    this.syncingOutput = true;
    try {
      this.pane.refresh();
    } finally {
      this.syncingOutput = false;
    }
    this.updateOutputWarning();
  }

  private updateOutputWarning(): void {
    const outputSize = this.hooks.exportSize;
    const warning = this.container.querySelector<HTMLElement>(".wv-output-warning");
    if (!outputSize || !warning) return;
    const gpuWarning = exportGpuWarning(outputSize.width, outputSize.height);
    warning.hidden = !gpuWarning;
    warning.textContent = gpuWarning ? `⚠ ${gpuWarning.detail}` : "";
  }

  disposeEditor(): void {
    // Any open control-hint tooltip is anchored to DOM we're about to tear down.
    hideControlHint();
    for (const e of this.waveGradientEditors) e.destroy();
    this.waveGradientEditors = [];
    for (const e of this.waveMeshEditors) e.destroy();
    this.waveMeshEditors = [];
    for (const d of this.wavePaletteDropdowns) d.destroy();
    this.wavePaletteDropdowns = [];
    this.backgroundGradientEditor?.destroy();
    this.backgroundGradientEditor = undefined;
    this.backgroundMeshEditor?.destroy();
    this.backgroundMeshEditor = undefined;
    this.backgroundGradientDropdown?.destroy();
    this.backgroundGradientDropdown = undefined;
    this.backgroundImageDropdown?.destroy();
    this.backgroundImageDropdown = undefined;
    this.presetDropdown?.destroy();
    this.presetDropdown = undefined;
  }

  dispose(): void {
    this.disposeEditor();
    this.pane.dispose();
  }

  private rebuildWaves = (): void => {
    resizeWaves(this.config);
    this.renderer.rebuild();
    this.hooks.onEdit?.(); // add/remove wave is a structural edit — record it (skips `refresh`)
    setTimeout(() => this.rebuildPanel(), 0);
  };

  /** "Output" folder: export size/preset + GPU warning, image export, recording, embed export. */
  private buildOutputFolder(pane: Pane, mkFolder: MkFolder): void {
    const outputSize = this.hooks.exportSize;
    if (!outputSize) return;
    const output = mkFolder("Output", true);
    const warning = document.createElement("div");
    warning.className = "wv-output-warning";
    warning.setAttribute("role", "status");
    const formatOptions: Record<string, string> = { Custom: CUSTOM_EXPORT_PRESET };
    for (const [id, preset] of Object.entries(EXPORT_PRESETS)) {
      const gpuWarning = exportGpuWarning(preset.width, preset.height);
      const gpuLabel = gpuWarning ? ` · ⚠ ${gpuWarning.short}` : "";
      formatOptions[`${preset.label} · ${preset.width}×${preset.height}${gpuLabel}`] = id;
    }
    const sizeBinding = output
      .addBinding(outputSize, "preset", { label: "size", options: formatOptions })
      .on("change", (ev) => {
        if (this.syncingOutput) return;
        this.syncingOutput = true;
        try {
          applyExportPreset(outputSize, String(ev.value));
          pane.refresh();
        } finally {
          this.syncingOutput = false;
        }
        this.updateOutputWarning();
        this.hooks.onExportSizeChange?.();
      });
    const lockBinding = output
      .addBinding(outputSize, "lockAspectRatio", { label: "lock ratio" })
      .on("change", (ev) => {
        if (this.syncingOutput) return;
        outputSize.lockAspectRatio = Boolean(ev.value);
        if (outputSize.lockAspectRatio) captureExportAspectRatio(outputSize);
      });
    const setCustomSize = (dimension: "width" | "height", last: boolean): void => {
      if (this.syncingOutput) return;
      applyCustomExportDimension(outputSize, dimension, outputSize[dimension]);
      this.syncingOutput = true;
      try {
        pane.refresh();
      } finally {
        this.syncingOutput = false;
      }
      if (!last) return;
      this.updateOutputWarning();
      this.hooks.onExportSizeChange?.();
    };
    const widthBinding = output
      .addBinding(outputSize, "width", { min: 64, max: 8192, step: 1, label: "width px" })
      .on("change", (ev) => setCustomSize("width", ev.last));
    const heightBinding = output
      .addBinding(outputSize, "height", { min: 64, max: 8192, step: 1, label: "height px" })
      .on("change", (ev) => setCustomSize("height", ev.last));
    // Reveal the export-area readout while any size control is hovered or focused, so the size
    // shows live as you adjust it (a short leave-delay avoids flicker moving between the rows).
    let sizeHideTimer = 0;
    const activateSize = (): void => {
      window.clearTimeout(sizeHideTimer);
      this.hooks.onSizeControlsActive?.(true);
    };
    const deactivateSize = (): void => {
      window.clearTimeout(sizeHideTimer);
      sizeHideTimer = window.setTimeout(() => this.hooks.onSizeControlsActive?.(false), 120);
    };
    for (const bind of [sizeBinding, lockBinding, widthBinding, heightBinding]) {
      bind.element.addEventListener("pointerenter", activateSize);
      bind.element.addEventListener("pointerleave", deactivateSize);
      bind.element.addEventListener("focusin", activateSize);
      bind.element.addEventListener("focusout", deactivateSize);
    }
    const outputContent =
      (output.element.querySelector(".tp-fldv_c") as HTMLElement | null) ?? output.element;
    outputContent.appendChild(warning);
    this.updateOutputWarning();
    const imageOptions: Record<string, ImageFormat> = {};
    for (const [format, definition] of Object.entries(IMAGE_FORMATS) as Array<
      [ImageFormat, (typeof IMAGE_FORMATS)[ImageFormat]]
    >) {
      if (canExportImageFormat(format)) imageOptions[definition.label] = format;
    }
    // Fall back if the preferred default (WebP) can't be encoded here (e.g. older Safari).
    if (!Object.values(imageOptions).includes(this.state.imageFormat)) {
      this.state.imageFormat = Object.values(imageOptions)[0] ?? "png";
    }
    const imageFormatBinding = output.addBinding(this.state, "imageFormat", {
      label: "format",
      options: imageOptions,
    });
    const imageQualityBinding = output.addBinding(this.state, "imageQuality", {
      label: "quality",
      min: 0.1,
      max: 1,
      step: 0.01,
    });
    const exportImageBtn = output.addButton({ title: "📷 Export image (.png)" });
    const refreshImageControls = (): void => {
      const definition = IMAGE_FORMATS[this.state.imageFormat];
      imageQualityBinding.hidden = !definition.lossy;
      exportImageBtn.title = `📷 Export image (.${definition.extension})`;
      this.applyIcons();
    };
    imageFormatBinding.on("change", refreshImageControls);
    exportImageBtn.on("click", () =>
      this.hooks.onExportImage?.(this.state.imageFormat, this.state.imageQuality),
    );
    refreshImageControls();
    // Boxed like the recording group: format + Export on one line, the (lossy-only) quality
    // slider stacked beneath.
    this.groupRows(
      "IMAGE",
      [imageFormatBinding.element, exportImageBtn.element],
      [imageQualityBinding.element],
    );
    // Recording controls, boxed into one group. Format picker: WebM always; MP4 if the
    // browser can record it (Chromium/Safari — Firefox is WebM-only); GIF always (we encode
    // frames ourselves). The recorder falls back to WebM if a MediaRecorder container fails.
    const videoOptions: Record<string, string> = { WebM: "webm" };
    if (canRecordFormat("mp4")) videoOptions["MP4"] = "mp4";
    videoOptions["GIF"] = "gif";
    // Fall back to WebM if the preferred default (MP4) isn't recordable here (e.g. Firefox).
    if (!Object.values(videoOptions).includes(this.state.recordFormat)) {
      this.state.recordFormat = "webm";
    }
    const formatBinding = output
      .addBinding(this.state, "recordFormat", { label: "format", options: videoOptions })
      .on("change", () => {
        if (this.recordBtn && !this.state.recording) {
          this.recordBtn.title = this.recordTitle();
          this.applyIcons();
        }
      });
    this.recordBtn = output.addButton({ title: this.recordTitle() });
    this.recordBtn.on("click", () => this.hooks.onToggleRecord?.(this.state.recordFormat));
    this.groupRows("RECORD", [formatBinding.element, this.recordBtn.element]);
    // Standalone HTML page export goes last: image, then video, then embed.
    output
      .addButton({ title: "🔗 Export embed (.html)" })
      .on("click", () => this.hooks.onExportEmbed?.());
  }

  /** "Actions" folder: randomize/reset/save/load/share. */
  private buildActionsFolder(mkFolder: MkFolder): void {
    const actions = mkFolder("Actions", true);
    actions.addButton({ title: "🎲 Randomize All" }).on("click", () => this.hooks.onRandomize?.());
    actions.addButton({ title: "🔄 Reset to default" }).on("click", () => this.hooks.onReset?.());
    actions
      .addButton({ title: "💾 Save state (.json)" })
      .on("click", () => this.hooks.onExportConfig?.());
    actions
      .addButton({ title: "📂 Load state (.json)" })
      .on("click", () => this.hooks.onImportConfig?.());
    const linkBtn = actions.addButton({ title: "🔗 Copy share link" });
    linkBtn.on("click", async () => {
      const ok = await this.hooks.onCopyLink?.();
      linkBtn.title = ok === false ? "✓ URL updated (copy it)" : "✓ Link copied!";
      setTimeout(() => (linkBtn.title = "🔗 Copy share link"), 1600);
    });
  }

  /** "Global" folder: preset picker, quality/DPR, playback, post fx, mirror. */
  private buildGlobalFolder(
    mkFolder: MkFolder,
    randomBtn: RandomBtn,
    cfg: StudioConfig,
    refresh: () => void,
  ): void {
    const g = mkFolder("Global", true);
    // Presets are whole-scene ("global") configs (colour, transform, twist, displacement AND
    // the matched per-section camera). "randomize" leads the folder; the preset picker sits
    // right below it, under a clear "PRESET" caption. It's a custom dropdown with a wave-shape
    // THUMBNAIL per preset (the configs mostly share the hero palette, so only the shape
    // distinguishes them). selectedId reflects the active preset; a manual edit flips it to
    // "—" (Custom). Thumbnails fill in async (see refreshPresetThumbs).
    randomBtn(g, randomizeGlobal, () => this.renderer.resize());
    const gContent = (g.element.querySelector(".tp-fldv_c") as HTMLElement | null) ?? g.element;
    const randomizeEl = gContent.lastElementChild; // the randomize button just added
    const presetCap = document.createElement("div");
    presetCap.className = "wv-ctl-cap wv-picker-cap";
    presetCap.textContent = "PRESET";
    const presetNames = Object.keys(this.hooks.presetOptions ?? {}).filter((n) => n !== "—");
    this.presetDropdown = new PaletteDropdown(gContent, {
      rootClass: "wv-pd-big",
      options: presetNames.map((n) => ({ id: n, label: n, group: "Presets" })),
      thumbFor: (id) => getPresetThumb(id),
      selectedId: () => (this.selectedPreset === "—" ? null : this.selectedPreset),
      customLabel: () => (this.selectedPreset === "—" ? "Custom (edited)" : null),
      onSelect: (id) => this.hooks.onPreset?.(id),
    });
    // Structural changes rebuild geometry — only act on the FINAL value of a drag (ev.last),
    // never on every intermediate event, or the rapid rebuilds of the heavy geometry can
    // overwhelm the WebGL context. (waveCount lives in the Waves section below.)
    g.addBinding(cfg, "quality", { min: 0.25, max: 2, step: 0.05 }).on("change", (ev) => {
      if (ev.last) this.renderer.rebuild();
      this.hooks.onEdit?.(); // structural handler skips `refresh`, so record here
    });
    g.addBinding(cfg, "dprMax", { min: 0.5, max: 2, step: 0.5 }).on("change", (ev) => {
      if (ev.last) this.renderer.resize();
      this.hooks.onEdit?.();
    });
    g.addBinding(cfg, "paused").on("change", () => this.renderer.refreshPlayback());
    // Noise phase — scrub the animation to pick a still frame.
    g.addBinding(cfg, "timeOffset", { min: 0, max: 60, step: 0.5, label: "noise phase" }).on(
      "change",
      refresh,
    );
    // Seamless loop — 0 = off (linear drift). >0 maps the motion onto a circle in noise space so
    // it repeats exactly every N seconds; recording auto-stops after one loop (see onToggleRecord).
    // Crossing 0 recompiles the vertex program (LOOP_MOTION); it orbits rather than drifts, so the
    // motion character differs — that's the trade-off for a clean loop.
    g.addBinding(cfg, "loopSeconds", { min: 0, max: 30, step: 0.5, label: "loop (s, 0=off)" }).on(
      "change",
      refresh,
    );
    // Post-processing (one pass over the whole composite — scene-level, shared by all waves).
    g.addBinding(cfg, "grain", { min: 0, max: 3, step: 0.01 }).on("change", refresh);
    g.addBinding(cfg, "blur", { min: 0, max: 0.3, step: 0.005 }).on("change", refresh);
    g.addBinding(cfg, "blurSamples", { min: 1, max: 16, step: 1, label: "blur samples" }).on(
      "change",
      refresh,
    );
    // Bloom (UnrealBloomPass) — 0 disables the pass entirely (no cost/pixel change). radius &
    // threshold only bite once strength > 0. Great for the neon/wireframe/additive looks.
    g.addBinding(cfg, "bloomStrength", { min: 0, max: 3, step: 0.01, label: "bloom" }).on(
      "change",
      refresh,
    );
    g.addBinding(cfg, "bloomRadius", { min: 0, max: 1, step: 0.01, label: "bloom radius" }).on(
      "change",
      refresh,
    );
    g.addBinding(cfg, "bloomThreshold", {
      min: 0,
      max: 1,
      step: 0.01,
      label: "bloom threshold",
    }).on("change", refresh);
    // Whole-composition mirror (scene-level world-space flip).
    g.addButton({ title: "↔ mirror horizontal" }).on("click", () => {
      cfg.mirrorH = !cfg.mirrorH;
      refresh();
    });
    g.addButton({ title: "↕ mirror vertical" }).on("click", () => {
      cfg.mirrorV = !cfg.mirrorV;
      refresh();
    });
    // Tweakpane appends each blade after the previous one, which pushes trailing custom nodes to
    // the bottom of the folder — so re-seat the "PRESET" caption + picker right after the
    // randomize button now that the Global blades are all in place.
    const afterRandomize = randomizeEl?.nextElementSibling ?? null;
    gContent.insertBefore(presetCap, afterRandomize);
    gContent.insertBefore(this.presetDropdown.element, afterRandomize);
  }

  /** "Background" folder: solid colour, editable gradient, built-in map, or uploaded media. */
  private buildBackgroundFolder(
    pane: Pane,
    mkFolder: MkFolder,
    randomBtn: RandomBtn,
    cfg: StudioConfig,
    refresh: () => void,
  ): void {
    const bgF = mkFolder("Background", true);
    randomBtn(bgF, randomizeBackground, () => {
      this.backgroundGradientEditor?.refresh();
      this.backgroundMeshEditor?.refresh();
      updateBackgroundControls();
    });
    bgF.addBinding(cfg, "transparentBackground", { label: "transparent" }).on("change", refresh);
    bgF
      .addBinding(cfg, "backgroundMode", {
        label: "fill",
        options: { "Solid color": "color", Gradient: "gradient", "Image / video": "image" },
      })
      .on("change", () => {
        updateBackgroundControls();
        refresh();
      });
    const bBackgroundColor = bgF
      .addBinding(cfg, "background", { view: "color", label: "color / matte" })
      .on("change", refresh);
    const bBackgroundGradientType = bgF
      .addBinding(cfg, "backgroundGradientType", {
        label: "type",
        options: { Linear: "linear", Radial: "radial", Conic: "conic", Mesh: "mesh" },
      })
      .on("change", () => {
        updateBackgroundControls();
        refresh();
      });
    const bBackgroundGradientAngle = bgF
      .addBinding(cfg, "backgroundGradientAngle", {
        label: "angle°",
        min: 0,
        max: 360,
        step: 1,
      })
      .on("change", refresh);
    const bBackgroundMeshSoftness = bgF
      .addBinding(cfg, "backgroundMeshSoftness", {
        label: "mesh softness",
        min: 0,
        max: 1,
        step: 0.01,
      })
      .on("change", () => {
        this.backgroundMeshEditor?.refresh();
        refresh();
      });
    const bgContent =
      (bgF.element.querySelector(".tp-fldv_c") as HTMLElement | null) ?? bgF.element;

    const backgroundGradientOptions: PaletteOption[] = [];
    for (const [id, def] of Object.entries(PALETTE_MAPS))
      if (def.kind === "gradient")
        backgroundGradientOptions.push({ id, label: def.label, group: "Gradient presets" });
    backgroundGradientOptions.push({ id: "stops", label: "Custom stops", group: "Editable" });
    this.backgroundGradientDropdown = new PaletteDropdown(bgContent, {
      options: backgroundGradientOptions,
      thumbFor: (id) =>
        id === "stops"
          ? buildPaletteCanvas({
              stops: cfg.backgroundPalette,
              edgeColor: cfg.background,
              edgeAmount: 0,
            })
          : paletteMapCanvas(PALETTE_MAPS[id]),
      selectedId: () => cfg.backgroundGradientSource,
      customLabel: () => null,
      onSelect: (id) => {
        cfg.backgroundGradientSource = id;
        updateBackgroundControls();
        refresh();
      },
    });
    bgContent.insertBefore(
      this.backgroundGradientDropdown.element,
      bBackgroundGradientType.element,
    );
    this.backgroundGradientEditor = new GradientEditor(bgContent, () => cfg.backgroundPalette, {
      onChange: refresh,
      max: MAX_COLORS,
    });
    bgContent.insertBefore(this.backgroundGradientEditor.element, bBackgroundGradientType.element);
    this.backgroundMeshEditor = new MeshGradientEditor(
      bgContent,
      () => cfg.backgroundMeshPoints,
      () => cfg.backgroundMeshSoftness,
      { onChange: refresh, max: MAX_MESH_POINTS },
    );
    bgContent.insertBefore(this.backgroundMeshEditor.element, bBackgroundGradientType.element);

    const backgroundImageOptions: PaletteOption[] = [
      { id: "hero", label: "Hero", group: "Image maps" },
    ];
    for (const [id, def] of Object.entries(PALETTE_MAPS))
      if (def.kind === "image")
        backgroundImageOptions.push({ id, label: def.label, group: "Image maps" });
    this.backgroundImageDropdown = new PaletteDropdown(bgContent, {
      options: backgroundImageOptions,
      thumbFor: (id) =>
        id === "hero" ? buildHeroPaletteCanvas() : paletteMapCanvas(PALETTE_MAPS[id]),
      selectedId: () =>
        cfg.backgroundVideoUrl || cfg.backgroundImageUrl ? null : cfg.backgroundImageSource,
      customLabel: () =>
        cfg.backgroundVideoUrl ? "Custom video" : cfg.backgroundImageUrl ? "Custom image" : null,
      onSelect: (id) => {
        cfg.backgroundImageSource = id;
        cfg.backgroundImageUrl = undefined;
        cfg.backgroundVideoUrl = undefined;
        updateBackgroundControls();
        refresh();
      },
    });
    const bBackgroundFit = bgF
      .addBinding(cfg, "backgroundImageFit", {
        label: "fit",
        options: { Cover: "cover", Contain: "contain", Stretch: "stretch" },
      })
      .on("change", refresh);
    const bBackgroundZoom = bgF
      .addBinding(cfg, "backgroundImageZoom", {
        label: "zoom",
        min: 0.1,
        max: 8,
        step: 0.01,
      })
      .on("change", refresh);
    const bBackgroundPositionX = bgF
      .addBinding(cfg.backgroundImagePosition, "x", {
        label: "position X %",
        min: -100,
        max: 100,
        step: 1,
      })
      .on("change", refresh);
    const bBackgroundPositionY = bgF
      .addBinding(cfg.backgroundImagePosition, "y", {
        label: "position Y %",
        min: -100,
        max: 100,
        step: 1,
      })
      .on("change", refresh);
    const resetBackgroundFramingBtn = bgF
      .addButton({ title: "⟲ reset media framing" })
      .on("click", () => {
        cfg.backgroundImageFit = "cover";
        cfg.backgroundImageZoom = 1;
        cfg.backgroundImagePosition.x = 0;
        cfg.backgroundImagePosition.y = 0;
        pane.refresh();
        refresh();
      });
    const loadBackgroundImageBtn = bgF
      .addButton({ title: "📂 load background image / video…" })
      .on("click", () =>
        pickMediaDataUrl((url, kind) => {
          cfg.backgroundImageUrl = kind === "image" ? url : undefined;
          cfg.backgroundVideoUrl = kind === "video" ? url : undefined;
          updateBackgroundControls();
          refresh();
        }),
      );

    const updateBackgroundControls = (): void => {
      const gradient = cfg.backgroundMode === "gradient";
      const image = cfg.backgroundMode === "image";
      const mesh = gradient && cfg.backgroundGradientType === "mesh";
      bBackgroundColor.hidden = gradient;
      bBackgroundGradientType.hidden = !gradient;
      bBackgroundGradientAngle.hidden =
        !gradient || mesh || cfg.backgroundGradientType === "radial";
      bBackgroundMeshSoftness.hidden = !mesh;
      bBackgroundFit.hidden = !image;
      bBackgroundZoom.hidden = !image;
      bBackgroundPositionX.hidden = !image;
      bBackgroundPositionY.hidden = !image;
      resetBackgroundFramingBtn.hidden = !image;
      loadBackgroundImageBtn.hidden = !image;
      // Stops dropdown + editor drive linear/radial/conic; the mesh editor drives "mesh".
      if (this.backgroundGradientDropdown)
        this.backgroundGradientDropdown.element.hidden = !gradient || mesh;
      this.backgroundGradientEditor?.setVisible(gradient && !mesh);
      this.backgroundGradientEditor?.setEnabled(cfg.backgroundGradientSource === "stops");
      this.backgroundMeshEditor?.setVisible(mesh);
      if (this.backgroundImageDropdown) this.backgroundImageDropdown.element.hidden = !image;
      this.backgroundGradientDropdown?.refresh();
      this.backgroundImageDropdown?.refresh();
      this.backgroundMeshEditor?.refresh();
    };
    updateBackgroundControls();
  }

  /** "Camera" folder: orbit-style controls, two-way synced with mouse drag/zoom/pan. */
  private buildCameraFolder(mkFolder: MkFolder, cfg: StudioConfig): FolderApi {
    const camF = mkFolder("Camera", true);
    const camP = this.camP;
    // Lead the section with the rig-minimap toggle (studio aid: a corner inset showing the
    // camera + lights).
    camF.addBinding(cfg, "showCameraRig", { label: "rig minimap" }).on("change", () => {
      this.renderer.setCameraRig(cfg.showCameraRig);
    });
    this.renderer.setCameraRig(cfg.showCameraRig);
    const onOrbit = (): void => {
      if (!this.camSyncing)
        this.renderer.setCameraOrbit(camP.azimuth, camP.elevation, camP.distance);
    };
    const onPan = (): void => {
      if (!this.camSyncing) this.renderer.setCameraTarget(camP.panX, camP.panY);
    };
    camF
      .addBinding(camP, "azimuth", { min: -180, max: 180, step: 1, label: "azimuth°" })
      .on("change", onOrbit);
    camF
      .addBinding(camP, "elevation", { min: -89, max: 89, step: 1, label: "elevation°" })
      .on("change", onOrbit);
    // Orthographic framing: zoom (no fov/distance).
    camF
      .addBinding(camP, "zoom", { min: 0.1, max: 6, step: 0.05, label: "zoom" })
      .on("change", () => {
        if (!this.camSyncing) this.renderer.setZoom(camP.zoom);
      });
    camF
      .addBinding(camP, "panX", { min: -2000, max: 2000, step: 10, label: "pan X" })
      .on("change", onPan);
    camF
      .addBinding(camP, "panY", { min: -2000, max: 2000, step: 10, label: "pan Y" })
      .on("change", onPan);
    camF.addButton({ title: "Fit to screen" }).on("click", () => this.renderer.fitToView());
    camF.addButton({ title: "Reset camera" }).on("click", () => this.renderer.resetView());
    return camF;
  }

  /** "Lights" folder: ambient, drag-in-3D toggle, per-light controls, add/remove. */
  private buildLightsFolder(
    mkFolder: MkFolder,
    randomBtn: RandomBtn,
    vec: VecRows,
    cfg: StudioConfig,
    refresh: () => void,
  ): void {
    const lightsF = mkFolder("Lights", true);
    randomBtn(lightsF, randomizeLights);
    lightsF.addBinding(cfg, "ambient", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
    const editProxy = { edit: this.renderer.isLightEditMode() };
    lightsF
      .addBinding(editProxy, "edit", { label: "drag lights in 3D" })
      .on("change", async (ev) => {
        const on = Boolean(ev.value);
        // Nothing to drag without a light — add one (out where it's visible) so the
        // gizmo has a handle, then rebuild to reveal its controls.
        if (on && cfg.lights.length === 0) {
          cfg.lights.push(createLight({ ...DEFAULT_LIGHT_POSITION }, 1));
          refresh();
        }
        await this.renderer.setLightEditMode(on);
        // Rebuild so the added light's controls appear and the "drag waves in 3D" toggle clears
        // (the two modes are mutually exclusive).
        setTimeout(() => this.rebuildPanel(), 0);
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
  }

  private rebuildPanel(): void {
    // Remember which folders are open so the rebuild doesn't reset them.
    for (const f of this.folders) this.foldState[f.title] = f.api.expanded;
    // Disposing + recreating the pane resets #panel's scroll to the top, which yanks the view
    // away from the section being edited (e.g. a wave's 🎲, a drag-in-3D toggle, or any add/remove that
    // rebuilds). Capture the scroll offset and restore it — synchronously, then again next frame so
    // async editor/thumbnail layout (per-wave GradientEditor/PaletteDropdown) can't clobber it.
    const scrollTop = this.container.scrollTop;
    this.disposeEditor();
    this.pane.dispose();
    this.build();
    this.container.scrollTop = scrollTop;
    requestAnimationFrame(() => {
      this.container.scrollTop = scrollTop;
    });
  }

  private build(): void {
    const cfg = this.config;
    // The renderer already canonicalizes any config via ensureStudioConfig; run the scene + wave
    // normalizers here too (idempotent) so the panel is robust even if built before the renderer.
    ensureSceneDefaults(cfg);
    cfg.waves.forEach(normalizeWave);
    const pane = new Pane({ container: this.container, title: "Wave Studio" });
    this.pane = pane;

    // Wave Studio logo to the left of the collapsable's title. Tweakpane centres the root title,
    // so switch the title bar to a left-aligned flex row (the collapse marker stays absolute-right).
    const titleBar = this.container.querySelector<HTMLElement>(".tp-rotv_b");
    const titleText = titleBar?.querySelector<HTMLElement>(".tp-rotv_t");
    if (titleBar && titleText && !titleBar.querySelector(".wv-logo")) {
      titleBar.style.display = "flex";
      titleBar.style.alignItems = "center";
      titleBar.style.paddingLeft = "10px";
      titleText.style.flex = "1 1 auto";
      titleText.style.width = "auto";
      titleText.style.textAlign = "left";
      const logo = document.createElement("img");
      logo.className = "wv-logo";
      logo.src = waveStudioLogoUrl;
      logo.alt = "";
      logo.setAttribute("aria-hidden", "true");
      logo.style.cssText =
        "width:18px;height:18px;margin-right:8px;flex:0 0 auto;object-fit:contain;";
      titleBar.insertBefore(logo, titleText);
    }

    // Search box to filter the many knobs by label/section name. Created here but mounted at the
    // TOP of the pane content at the end of build() — so it sits under the "Wave Studio" title and
    // collapses with the pane. (Inserting it now would sink below the folders, since Tweakpane
    // appends each folder after any custom node already present.)
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "search controls…";
    search.className = "wv-search";
    search.value = this.searchQuery;
    search.style.cssText =
      "width:100%;box-sizing:border-box;margin:2px 0 8px;padding:6px 9px;border-radius:5px;outline:none;" +
      "font:12px ui-sans-serif,system-ui,-apple-system,sans-serif;color:#d6d7db;" +
      "background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);";
    search.addEventListener("input", () => {
      this.searchQuery = search.value;
      this.applyFilter();
    });
    const paneContent = this.container.querySelector(".tp-rotv_c") ?? this.container;
    // Keep sliders in sync while a light is dragged via its 3D gizmo, or while the camera is
    // moved via orbit/zoom/pan (guarded by this.camSyncing; see the field's doc).
    const camP = this.camP;
    camP.zoom = cfg.cameraZoom ?? 1;
    const syncCam = (): void => {
      const o = this.renderer.getCameraOrbit();
      camP.azimuth = roundTo(o.azimuth, 1);
      camP.elevation = roundTo(o.elevation, 1);
      camP.distance = o.distance;
      camP.panX = roundTo(o.panX, 1);
      camP.panY = roundTo(o.panY, 1);
      camP.zoom = roundTo(this.renderer.getZoom(), 2);
    };
    syncCam();
    const syncPanel = (): void => {
      this.camSyncing = true;
      syncCam();
      pane.refresh();
      this.camSyncing = false;
    };
    // Camera drags fire per pointermove, so they refresh only the Camera folder's bindings —
    // a full pane.refresh() walks every binding in the panel (hundreds at high wave counts).
    let camFolder: FolderApi | undefined;
    const syncCameraPanel = (): void => {
      this.camSyncing = true;
      syncCam();
      camFolder?.refresh();
      this.camSyncing = false;
    };
    // Light & wave gizmo drags are undoable edits, so they mark the history dirty; camera
    // orbit/zoom/pan is deliberately NOT undoable (view state), so onCameraChanged stays a plain
    // panel sync. (onEdit is coalesced, so firing continuously during a drag is fine.)
    this.renderer.onLightsChanged = () => {
      syncPanel();
      this.hooks.onEdit?.();
    };
    this.renderer.onCameraChanged = syncCameraPanel;
    // A wave gizmo drag mutates the dragged wave's position/rotation — refresh the panel so
    // that wave's Transform sliders track the drag live.
    this.renderer.onWaveChanged = () => {
      syncPanel();
      this.hooks.onEdit?.();
    };

    const refresh = (): void => {
      this.clearPresetIndicator(); // a manual edit means the config no longer matches a preset
      this.renderer.refresh();
      this.hooks.onEdit?.(); // record for undo/redo (coalesced into one entry per gesture)
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
        folder
          .addBinding(rec, k, { label: `${label} ${axisLabels[i]}`, ...opts })
          .on("change", refresh);
      });
    };

    // A per-section "randomize" button: mutate only this section, then push to the
    // renderer + refresh the sliders. `after` handles non-binding widgets (gradient
    // editor) or camera reframing.
    const randomBtn = (folder: Folder, fn: (c: StudioConfig) => void, after?: () => void): void => {
      folder.addButton({ title: "🎲 randomize" }).on("click", () => {
        fn(cfg);
        refresh();
        pane.refresh();
        after?.();
      });
    };

    this.buildOutputFolder(pane, mkFolder);
    this.buildActionsFolder(mkFolder);
    this.buildGlobalFolder(mkFolder, randomBtn, cfg, refresh);
    this.buildBackgroundFolder(pane, mkFolder, randomBtn, cfg, refresh);
    camFolder = this.buildCameraFolder(mkFolder, cfg);
    this.buildLightsFolder(mkFolder, randomBtn, vec, cfg, refresh);

    // ---- Waves ----
    // Each WaveConfig is a COMPLETE wave: its own colour/gradient, finish, displacement, twist,
    // transform and blend — no duplicated "global" controls. Adding a wave clones the last.
    // (The whole document is StudioConfig = scene + waves: WaveConfig[].)
    const buildWaveFolder = (parent: Folder, wave: WaveConfig, index: number): void => {
      const sf = parent.addFolder({ title: `Wave ${index + 1}`, expanded: true });
      // Per-section 🎲 that mutates only this wave's section, then rebuilds so the sliders
      // (some of which bind to replaced Vec objects) reflect the new values.
      const sectionRandom = (folder: Folder, fn: (s: WaveConfig) => void): void => {
        folder.addButton({ title: "🎲 randomize" }).on("click", () => {
          fn(wave);
          refresh();
          setTimeout(() => this.rebuildPanel(), 0);
        });
      };
      sf.addButton({ title: "🎲 randomize wave" }).on("click", () => {
        randomizeWave(wave);
        refresh();
        setTimeout(() => this.rebuildPanel(), 0);
      });
      if (cfg.waves.length > 1) {
        sf.addButton({ title: "✕ remove wave" }).on("click", () => {
          cfg.waves.splice(index, 1);
          cfg.waveCount = cfg.waves.length;
          this.rebuildWaves();
        });
      }

      // Compositing (how this wave stacks on the others).
      sf.addBinding(wave, "opacity", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
      sf.addBinding(wave, "blendMode", {
        label: "blend",
        options: {
          Squared: "squared",
          Normal: "normal",
          Additive: "additive",
          Multiply: "multiply",
        },
      }).on("change", refresh);
      sf.addBinding(wave, "speed", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
      sf.addBinding(wave, "seed", { min: 0, max: 20, step: 0.1 }).on("change", refresh);

      // --- Color & Gradient ---
      const gradF = sf.addFolder({ title: "Color & Gradient", expanded: true });
      const gradContent =
        (gradF.element.querySelector(".tp-fldv_c") as HTMLElement | null) ?? gradF.element;
      let swatchRaf = 0;
      const gradientEditor = new GradientEditor(gradContent, () => wave.palette, {
        onChange: () => {
          refresh();
          // Coalesce the trigger-swatch rebuild (a 256×64 CPU palette render) to one per
          // frame — stop drags fire onChange per pointermove.
          if (!swatchRaf) {
            swatchRaf = requestAnimationFrame(() => {
              swatchRaf = 0;
              paletteDropdown.refresh();
            });
          }
        },
        max: MAX_COLORS,
      });
      this.waveGradientEditors.push(gradientEditor);
      const meshEditor = new MeshGradientEditor(
        gradContent,
        () => wave.meshGradientPoints,
        () => wave.meshGradientSoftness,
        { onChange: refresh, max: MAX_MESH_POINTS },
      );
      this.waveMeshEditors.push(meshEditor);
      gradF
        .addBinding(wave, "gradientType", {
          label: "type",
          options: { Linear: "linear", Radial: "radial", Conic: "conic", Mesh: "mesh" },
        })
        .on("change", () => {
          updatePaletteControls();
          refresh();
        });
      const bGradAngle = gradF
        .addBinding(wave, "gradientAngle", { label: "angle°", min: 0, max: 360, step: 1 })
        .on("change", refresh);
      const bGradShift = gradF
        .addBinding(wave, "gradientShift", { label: "2D warp", min: 0, max: 0.6, step: 0.01 })
        .on("change", refresh);
      const bMeshSoftness = gradF
        .addBinding(wave, "meshGradientSoftness", {
          label: "mesh softness",
          min: 0,
          max: 1,
          step: 0.01,
        })
        .on("change", () => {
          meshEditor.refresh();
          refresh();
        });
      const bUseTex = gradF
        .addBinding(wave, "usePaletteTexture", { label: "palette 2D" })
        .on("change", () => {
          updatePaletteControls();
          refresh();
        });
      const thumbFor = (id: string): HTMLCanvasElement =>
        id === "hero"
          ? buildHeroPaletteCanvas()
          : id === "stops"
            ? buildPaletteCanvas({
                stops: wave.palette,
                edgeColor: wave.paletteEdgeColor,
                edgeAmount: wave.paletteEdgeAmount,
              })
            : paletteMapCanvas(PALETTE_MAPS[id]);
      const ddOptions: PaletteOption[] = [{ id: "hero", label: "Hero", group: "Image maps" }];
      for (const [id, def] of Object.entries(PALETTE_MAPS))
        if (def.kind === "image") ddOptions.push({ id, label: def.label, group: "Image maps" });
      for (const [id, def] of Object.entries(PALETTE_MAPS))
        if (def.kind === "gradient")
          ddOptions.push({ id, label: def.label, group: "Gradient presets" });
      ddOptions.push({ id: "stops", label: "Custom stops", group: "Editable" });
      const paletteDropdown = new PaletteDropdown(gradContent, {
        options: ddOptions,
        thumbFor,
        selectedId: () =>
          wave.paletteVideoUrl || wave.paletteImageUrl ? null : wave.paletteSource,
        customLabel: () =>
          wave.paletteVideoUrl ? "Custom video" : wave.paletteImageUrl ? "Custom image" : null,
        onSelect: (id) => {
          wave.paletteImageUrl = undefined;
          wave.paletteVideoUrl = undefined;
          const def = PALETTE_MAPS[id];
          if (def?.kind === "gradient" && def.stops?.length) {
            wave.palette = def.stops
              .slice(0, MAX_COLORS)
              .map((stop) => ({ color: stop.color, pos: stop.pos }));
            if (typeof def.edgeColor === "string") wave.paletteEdgeColor = def.edgeColor;
            if (typeof def.edgeAmount === "number") wave.paletteEdgeAmount = def.edgeAmount;
            wave.usePaletteTexture = true;
            wave.paletteSource = "stops";
          } else {
            wave.paletteSource = id;
          }
          updatePaletteControls();
          gradientEditor.refresh();
          this.pane.refresh();
          refresh();
        },
      });
      this.wavePaletteDropdowns.push(paletteDropdown);
      gradContent.insertBefore(paletteDropdown.element, gradContent.firstChild);
      const loadPaletteBtn = gradF
        .addButton({ title: "📂 load palette image / video…" })
        .on("click", () => {
          pickMediaDataUrl((url, kind) => {
            wave.paletteImageUrl = kind === "image" ? url : undefined;
            wave.paletteVideoUrl = kind === "video" ? url : undefined;
            wave.paletteTextureScale = { x: 1, y: 1 };
            wave.paletteTextureOffset = { x: 0, y: 0 };
            wave.paletteTextureRotation = 0;
            wave.usePaletteTexture = true;
            updatePaletteControls();
            refresh();
          });
        });
      const bPaletteScaleX = gradF
        .addBinding(wave.paletteTextureScale, "x", {
          label: "media scale X",
          min: 0.1,
          max: 8,
          step: 0.05,
        })
        .on("change", refresh);
      const bPaletteScaleY = gradF
        .addBinding(wave.paletteTextureScale, "y", {
          label: "media scale Y",
          min: 0.1,
          max: 8,
          step: 0.05,
        })
        .on("change", refresh);
      const bPaletteOffsetX = gradF
        .addBinding(wave.paletteTextureOffset, "x", {
          label: "media offset X",
          min: -4,
          max: 4,
          step: 0.01,
        })
        .on("change", refresh);
      const bPaletteOffsetY = gradF
        .addBinding(wave.paletteTextureOffset, "y", {
          label: "media offset Y",
          min: -4,
          max: 4,
          step: 0.01,
        })
        .on("change", refresh);
      const bPaletteRotation = gradF
        .addBinding(wave, "paletteTextureRotation", {
          label: "media rotation°",
          min: -180,
          max: 180,
          step: 1,
        })
        .on("change", refresh);
      // Palette drift — animate the colour along the ribbon (offset/sec), independent of the
      // geometry motion. Applies to any texture palette (hero LUT, maps, custom media).
      const bPaletteDriftX = gradF
        .addBinding(wave, "paletteDriftX", { label: "color drift X", min: -1, max: 1, step: 0.01 })
        .on("change", refresh);
      const bPaletteDriftY = gradF
        .addBinding(wave, "paletteDriftY", { label: "color drift Y", min: -1, max: 1, step: 0.01 })
        .on("change", refresh);
      const bEdgeColor = gradF
        .addBinding(wave, "paletteEdgeColor", { view: "color", label: "edge tint" })
        .on("change", () => {
          refresh();
          paletteDropdown.refresh();
        });
      const bEdgeAmt = gradF
        .addBinding(wave, "paletteEdgeAmount", { label: "edge amt", min: 0, max: 1, step: 0.01 })
        .on("change", () => {
          refresh();
          paletteDropdown.refresh();
        });
      gradF.addBinding(wave, "hueShift", { min: -180, max: 180, step: 1 }).on("change", refresh);
      gradF.addBinding(wave, "colorContrast", { min: 0, max: 2, step: 0.01 }).on("change", refresh);
      gradF
        .addBinding(wave, "colorSaturation", { min: 0, max: 2, step: 0.01 })
        .on("change", refresh);
      sectionRandom(gradF, (s) => {
        randomizeGradient(s);
        randomizeColor(s);
      });
      const updatePaletteControls = (): void => {
        const tex = wave.usePaletteTexture;
        const custom = !!(wave.paletteVideoUrl || wave.paletteImageUrl);
        const isStops = wave.paletteSource === "stops";
        const isMesh = wave.gradientType === "mesh";
        const stopsActive = !isMesh && !custom && (!tex || isStops);
        const procActive = !isMesh && !tex;
        const edgeActive = !isMesh && tex && !custom && isStops;
        gradientEditor.setEnabled(stopsActive);
        gradientEditor.setVisible(!isMesh);
        meshEditor.setVisible(isMesh);
        bGradAngle.disabled = !procActive;
        bGradShift.disabled = !procActive;
        bMeshSoftness.hidden = !isMesh;
        bUseTex.disabled = isMesh;
        paletteDropdown.element.hidden = isMesh;
        loadPaletteBtn.hidden = isMesh;
        bPaletteScaleX.hidden = isMesh || !custom;
        bPaletteScaleY.hidden = isMesh || !custom;
        bPaletteOffsetX.hidden = isMesh || !custom;
        bPaletteOffsetY.hidden = isMesh || !custom;
        bPaletteRotation.hidden = isMesh || !custom;
        // Drift applies to any texture palette (not mesh / procedural stops), not just custom media.
        bPaletteDriftX.hidden = isMesh || !tex;
        bPaletteDriftY.hidden = isMesh || !tex;
        bEdgeColor.disabled = !edgeActive;
        bEdgeAmt.disabled = !edgeActive;
        paletteDropdown.refresh();
      };
      updatePaletteControls();

      // --- Finish (surface material) ---
      const finF = sf.addFolder({ title: "Finish", expanded: true });
      finF
        .addBinding(wave, "theme", {
          label: "material",
          options: { solid: "solid", wireframe: "wireframe" },
        })
        .on("change", () => {
          updateMaterialControls();
          refresh();
        });
      const bFiberCount = finF
        .addBinding(wave, "fiberCount", { min: 1, max: 1200, step: 1, label: "streak freq" })
        .on("change", refresh);
      const bFiberStrength = finF
        .addBinding(wave, "fiberStrength", { min: 0, max: 1, step: 0.01, label: "streak strength" })
        .on("change", refresh);
      const bTexture = finF
        .addBinding(wave, "texture", { min: 0, max: 1, step: 0.01 })
        .on("change", refresh);
      const bRoundness = finF
        .addBinding(wave, "roundness", { min: 0, max: 1.2, step: 0.01, label: "roundness" })
        .on("change", refresh);
      const bSheen = finF
        .addBinding(wave, "sheen", { min: 0, max: 2, step: 0.01, label: "sheen" })
        .on("change", refresh);
      const bIridescence = finF
        .addBinding(wave, "iridescence", { min: 0, max: 1, step: 0.01, label: "iridescence" })
        .on("change", refresh);
      const bCreaseLight = finF
        .addBinding(wave, "creaseLight", { min: 0, max: 6, step: 0.01, label: "crease light" })
        .on("change", refresh);
      const bCreaseSharpness = finF
        .addBinding(wave, "creaseSharpness", {
          min: 0.1,
          max: 4,
          step: 0.01,
          label: "crease sharpness",
        })
        .on("change", refresh);
      const bCreaseSoftness = finF
        .addBinding(wave, "creaseSoftness", {
          min: 0.05,
          max: 2,
          step: 0.01,
          label: "crease softness",
        })
        .on("change", refresh);
      const bEdgeFade = finF
        .addBinding(wave, "edgeFade", { min: 0, max: 0.5, step: 0.01 })
        .on("change", refresh);
      const bLineAmount = finF
        .addBinding(wave, "lineAmount", { min: 1, max: 1200, step: 1, label: "line count" })
        .on("change", refresh);
      const bLineThickness = finF
        .addBinding(wave, "lineThickness", { min: 0, max: 3, step: 0.01, label: "line thickness" })
        .on("change", refresh);
      const bLineFalloff = finF
        .addBinding(wave, "lineDerivativePower", {
          min: 0,
          max: 2,
          step: 0.01,
          label: "line falloff",
        })
        .on("change", refresh);
      const bMaxWidth = finF
        .addBinding(wave, "maxWidth", { min: 1, max: 3000, step: 1, label: "max width" })
        .on("change", refresh);
      const solidOnly = [
        bFiberCount,
        bFiberStrength,
        bTexture,
        bRoundness,
        bSheen,
        bIridescence,
        bCreaseLight,
        bCreaseSharpness,
        bCreaseSoftness,
        bEdgeFade,
      ];
      const wireOnly = [bLineAmount, bLineThickness, bLineFalloff, bMaxWidth];
      const updateMaterialControls = (): void => {
        const wire = wave.theme === "wireframe";
        for (const b of solidOnly) b.hidden = wire;
        for (const b of wireOnly) b.hidden = !wire;
      };
      updateMaterialControls();
      sectionRandom(finF, randomizeFinish);

      // --- Noise Bands ---
      const bandsF = sf.addFolder({ title: "Noise Bands", expanded: true });
      wave.noiseBands.forEach((band, bi) => {
        const sub = bandsF.addFolder({ title: `Band ${bi + 1}`, expanded: true });
        sub.addBinding(band, "startX", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
        sub.addBinding(band, "endX", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
        sub.addBinding(band, "startY", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
        sub.addBinding(band, "endY", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
        sub.addBinding(band, "feather", { min: 0, max: 1, step: 0.01 }).on("change", refresh);
        sub.addBinding(band, "strength", { min: 0, max: 2, step: 0.01 }).on("change", refresh);
        sub.addBinding(band, "frequency", { min: 1, max: 1200, step: 1 }).on("change", refresh);
        sub
          .addBinding(band, "colorAttenuation", { min: 0, max: 1, step: 0.01, label: "colorAtten" })
          .on("change", refresh);
        sub
          .addBinding(band, "parabolaPower", { min: 0, max: 5, step: 0.01, label: "parabola" })
          .on("change", refresh);
        sub.addButton({ title: "remove this band" }).on("click", () => {
          wave.noiseBands.splice(bi, 1);
          refresh();
          setTimeout(() => this.rebuildPanel(), 0);
        });
      });
      if (wave.noiseBands.length < MAX_NOISE_BANDS) {
        bandsF.addButton({ title: "+ add band" }).on("click", () => {
          wave.noiseBands.push(createNoiseBand());
          refresh();
          setTimeout(() => this.rebuildPanel(), 0);
        });
      }

      // --- Displacement ---
      const dispF = sf.addFolder({ title: "Displacement", expanded: true });
      vec(dispF, wave.displaceFrequency, "displace freq", { min: 0, max: 0.03, step: 0.0002 }, [
        "X (len)",
        "Z (wid)",
        "",
      ]);
      dispF
        .addBinding(wave, "displaceAmount", { min: -12, max: 12, step: 0.05 })
        .on("change", refresh);
      sectionRandom(dispF, randomizeSpine);

      // --- Transform ---
      const trF = sf.addFolder({ title: "Transform", expanded: true });
      vec(trF, wave.position, "position", { min: -600, max: 600, step: 1 });
      vec(trF, wave.rotation, "rotation", { min: -180, max: 180, step: 0.1 });
      vec(trF, wave.scale, "scale", { min: 0, max: 30, step: 0.1 });
      sectionRandom(trF, randomizeTransform);

      // --- Twist ---
      const twF = sf.addFolder({ title: "Twist", expanded: true });
      vec(twF, wave.twistFrequency, "twist freq", { min: -2, max: 2, step: 0.002 });
      vec(twF, wave.twistPower, "twist power", { min: 0, max: 8, step: 0.05 });
      twF.addBinding(wave, "twistMotion", { label: "twist wobble" }).on("change", refresh);
      sectionRandom(twF, randomizeTwist);
      // Order the sub-sections: appearance (colour, finish) → shape (displacement, twist) → pose
      // (transform) → advanced (noise bands, last). DOM move so the blocks above stay grouped.
      const waveContent =
        (sf.element.querySelector(":scope > .tp-fldv_c") as HTMLElement | null) ?? sf.element;
      for (const f of [gradF, finF, dispF, twF, trF, bandsF]) waveContent.appendChild(f.element);
    };

    const wavesF = mkFolder("Waves", true);
    // Drag waves in 3D: a box handle per wave (click a handle to select which wave the
    // gizmo moves/rotates). Shared across all waves, so it lives at the section level.
    const waveDragProxy = { edit: this.renderer.isWaveEditMode() };
    wavesF
      .addBinding(waveDragProxy, "edit", { label: "drag waves in 3D" })
      .on("change", async (ev) => {
        await this.renderer.setWaveEditMode(Boolean(ev.value));
        setTimeout(() => this.rebuildPanel(), 0);
      });
    if (this.renderer.isWaveEditMode()) {
      const gizmoProxy = { mode: this.renderer.getGizmoMode() };
      wavesF
        .addBinding(gizmoProxy, "mode", {
          label: "gizmo",
          options: { move: "translate", rotate: "rotate" },
        })
        .on("change", (ev) => {
          this.renderer.setGizmoMode(ev.value as "translate" | "rotate");
        });
    }
    cfg.waves.forEach((wave, i) => buildWaveFolder(wavesF, wave, i));
    if (cfg.waves.length < MAX_WAVES) {
      wavesF.addButton({ title: "+ add wave (offset copy)" }).on("click", () => {
        const last = cfg.waves[cfg.waves.length - 1];
        const clone = structuredClone(last);
        // Exact copy of the last wave, dropped into open frame space (screen-left, camera-relative)
        // so it reads as a distinct second wave instead of sitting hidden on top of it or — for the
        // hero, which already fills the right of the frame — landing off-frame past it. A same-
        // colour copy needs to move a good fraction of the frame to be visible; a world-space nudge
        // toward the wrong side just looks like the first wave got a little thicker. resizeWaves()
        // (via rebuildWaves) clones with no offset; do it here so only a user-initiated add moves
        // (presets/imports keep their authored layout).
        const off = this.renderer.duplicateOffset();
        clone.position = {
          x: last.position.x + off.x,
          y: last.position.y + off.y,
          z: last.position.z,
        };
        cfg.waves.push(clone);
        cfg.waveCount = cfg.waves.length;
        this.rebuildWaves();
      });
    }
    // Reorder the top-level folders, independent of the build order above (which stays grouped by
    // concern). Short meta/setup folders stay near the top (output/canvas, quick actions, presets,
    // then background/camera) so they're always reachable; the tall Waves section sits below them,
    // above the rarely-used Lights. Done as a DOM move: appendChild re-appends in the given order.
    const topOrder = ["Output", "Actions", "Global", "Background", "Camera", "Waves", "Lights"];
    for (const title of topOrder) {
      const f = this.folders.find((x) => x.title === title);
      if (f) paneContent.appendChild(f.api.element);
    }
    // Seat the search at the top of the pane content now that all the folders are in place.
    paneContent.insertBefore(search, paneContent.firstChild);
    this.applyIcons();
    // Underline + hover-tooltip the cryptic labels (idempotent per row across rebuilds).
    applyControlHints(this.container);
    if (this.searchQuery) this.applyFilter();
  }

  /** Filter the panel by the search query: hide non-matching rows + empty folders. */
  private applyFilter(): void {
    const q = this.searchQuery.trim().toLowerCase();
    const rows = this.container.querySelectorAll<HTMLElement>(".tp-lblv, .tp-btnv");
    if (!q) {
      rows.forEach((r) => (r.style.display = ""));
      this.container
        .querySelectorAll<HTMLElement>(".tp-fldv")
        .forEach((f) => (f.style.display = ""));
      for (const { title, api } of this.folders)
        api.expanded = this.foldState[title] ?? api.expanded;
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
      const hasVisible = [...el.querySelectorAll<HTMLElement>(".tp-lblv, .tp-btnv")].some(
        (r) => r.style.display !== "none",
      );
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
      "🎲": svg(
        '<path d="M1.6 4.6 8 1.2l6.4 3.4L8 8 1.6 4.6Z"/><path d="M1.6 4.6v6.8L8 14.8V8"/><path d="M14.4 4.6v6.8L8 14.8"/>',
      ),
      "🔄": svg('<path d="M13.4 8a5.4 5.4 0 1 1-1.7-3.9"/><path d="M13.8 2.4v3.1h-3.1"/>'),
      "💾": svg('<path d="M8 1.9v7"/><path d="M5.2 6.2 8 9l2.8-2.8"/><path d="M2.6 12.6h10.8"/>'),
      "📂": svg('<path d="M1.9 4.3h4l1.4 1.8h6.8v6.6H1.9z"/>'),
      "📷": svg(
        '<rect x="1.9" y="4.9" width="12.2" height="8.2" rx="1.2"/><circle cx="8" cy="9" r="2.2"/><path d="M5.7 4.9 6.7 3.1h2.6l1 1.8"/>',
      ),
      "🔗": svg(
        '<path d="M6.6 9.4 9.4 6.6"/><path d="M7.3 4.7 8.5 3.5a2.5 2.5 0 0 1 3.6 3.6L10.9 8.3"/><path d="M8.7 11.3 7.5 12.5a2.5 2.5 0 0 1-3.6-3.6L5.1 7.7"/>',
      ),
      "🎬": svg(
        '<circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none"/>',
      ),
      "⏹": svg(
        '<rect x="3.5" y="3.5" width="9" height="9" rx="1.6" fill="currentColor" stroke="none"/>',
      ),
    };
    injectStyleOnce(
      "wv-icon-style",
      ".wv-ic{display:inline-flex;align-items:center;vertical-align:-2px;margin-right:6px;opacity:0.82}",
    );
    this.container.querySelectorAll(".tp-btnv_t").forEach((el) => {
      const txt = el.textContent ?? "";
      for (const [emoji, icon] of Object.entries(ICONS)) {
        if (txt.startsWith(emoji)) {
          (el as HTMLElement).innerHTML =
            `<span class="wv-ic">${icon}</span>${txt.slice(emoji.length).trimStart()}`;
          break;
        }
      }
    });

    // Section (folder) header icons.
    const FOLDERS: Record<string, string> = {
      Output: svg('<path d="M2 3.2h12v9.6H2z"/><path d="M5.2 12.8v1.5M10.8 12.8v1.5M4 14.3h8"/>'),
      Actions: svg('<path d="M8.5 1.6 3 9h3.4L7 14.4 13 7H9.6z"/>'),
      Global: svg(
        '<circle cx="8" cy="8" r="2.1"/><path d="M8 1.7v1.7M8 12.6v1.7M1.7 8h1.7M12.6 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"/>',
      ),
      Background: svg(
        '<rect x="2" y="2.8" width="12" height="10.4" rx="1.4"/><circle cx="10.8" cy="5.8" r="1.2"/><path d="m2.5 11 3.2-3.2 2.2 2 1.6-1.5 4 3.7"/>',
      ),
      Camera: svg(
        '<rect x="1.9" y="4.9" width="12.2" height="8.2" rx="1.2"/><circle cx="8" cy="9" r="2.2"/><path d="M5.7 4.9 6.7 3.1h2.6l1 1.8"/>',
      ),
      "Color & Gradient": svg(
        '<rect x="2.2" y="3.6" width="11.6" height="8.8" rx="1.4"/><path d="m2.6 12 5-5 3 2.4 2.8-3"/>',
      ),
      "Noise Bands": svg('<path d="M3 13V8M6.5 13V3.8M10 13V6.4M13.5 13V9.6"/>'),
      Displacement: svg('<path d="M1.8 8c2-4.2 4.2-4.2 6.2 0s4.2 4.2 6.2 0"/>'),
      Transform: svg(
        '<path d="M8 2.4v11.2M2.4 8h11.2M6.3 4.3 8 2.4l1.7 1.9M6.3 11.7 8 13.6l1.7-1.9M4.3 6.3 2.4 8l1.9 1.7M11.7 6.3 13.6 8l-1.9 1.7"/>',
      ),
      Twist: svg('<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13.2 2.6v3.1h-3.1"/>'),
      Finish: svg('<path d="m8 1.9 1.4 4.1 4.1 1-4.1 1L8 12.1 6.6 8l-4.1-1 4.1-1z"/>'),
      Lights: svg(
        '<circle cx="8" cy="8" r="2.9"/><path d="M8 1.6v1.7M8 12.7v1.7M1.6 8h1.7M12.7 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"/>',
      ),
      Waves: svg('<path d="M5.5 2c3 2 3 4 0 6s-3 4 0 6"/><path d="M10.5 2c-3 2-3 4 0 6s3 4 0 6"/>'),
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
