import "./style.css";
import { WaveRenderer } from "@wave3d/core/renderer";
import { randomizeConfig, ensureStudioConfig, PRESETS } from "@wave3d/core";
import type { StudioConfig } from "@wave3d/core";
import { ControlPanel } from "./ui/ControlPanel";
import { OutputResizeHandle } from "./ui/OutputResizeHandle";
import { RecordingOverlay } from "./ui/RecordingOverlay";
import { HistoryControls } from "./ui/HistoryControls";
import { HistoryThumbnailer } from "./ui/historyThumbs";
import { showToast, dismissToast } from "./ui/Toast";
import { History } from "./history";
import { generatePresetThumbnails } from "./ui/presetThumbs";
import {
  exportConfigJSON,
  pickConfigFile,
  exportImage,
  exportEmbed,
  Recorder,
  decodeConfigFromHash,
  copyShareLink,
} from "./export/exporters";
import { aspectRatioLabel, DEFAULT_EXPORT_SIZE, exportGpuWarning } from "./output/formats";

const stage = document.getElementById("stage");
const panelEl = document.getElementById("panel");
const captureSizeEl = document.getElementById("capture-size");
const workspace = document.getElementById("workspace");
const resizeHandleEls = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".output-resize-handle"),
);
if (!stage || !panelEl || !captureSizeEl || !workspace || resizeHandleEls.length !== 4) {
  throw new Error("Missing studio workspace elements");
}

// Surface uncaught errors visibly so problems in the wild can be reported.
function showError(title: string, detail: string): void {
  let el = document.getElementById("err-overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "err-overlay";
    el.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;max-height:40vh;overflow:auto;z-index:99;" +
      "background:rgba(120,12,12,0.94);color:#fff;font:11px/1.45 ui-monospace,monospace;" +
      "padding:8px 12px;white-space:pre-wrap;border-top:2px solid #ff5a5a";
    el.addEventListener("dblclick", () => el?.remove());
    document.body.appendChild(el);
  }
  el.textContent = `⚠ ${title}  (double-click to dismiss)\n${detail}`;
}
// True only on the very first module execution. In dev, the import.meta.hot block at the bottom
// re-runs this module in place on each edit; firstBoot-guarded setup (global error handlers, the
// camera hint) then runs once rather than stacking on every save. hot.data persists across HMR
// updates by design; in production import.meta.hot is undefined, so firstBoot is always true.
const firstBoot = !import.meta.hot?.data.booted;
if (import.meta.hot) import.meta.hot.data.booted = true;

if (firstBoot) {
  window.addEventListener("error", (e) =>
    showError(e.message, (e.error as Error)?.stack || `${e.filename}:${e.lineno}`),
  );
  window.addEventListener("unhandledrejection", (e) =>
    showError("Unhandled promise rejection", (e.reason as Error)?.stack || String(e.reason)),
  );
}

// Keep the export frame clean: the dimensions bar (#capture-size) and the four resize handles stay
// hidden, and flash in for a moment only when the export dimensions actually change (a corner drag,
// a size preset, or a width/height edit). The handles additionally show while hovering the frame —
// see the #stage:hover / #stage.controls-flash rules in the CSS. (The camera-controls hint moved out
// to the history cluster, out of the way at bottom-left — see historyControls.addHelpButton below.)
let exportInfoW = -1;
let exportInfoH = -1;
let exportInfoTimer = 0;
function flashExportInfo(width: number, height: number): void {
  if (width === exportInfoW && height === exportInfoH) return; // ignore no-op re-renders (window resize)
  exportInfoW = width;
  exportInfoH = height;
  stage!.classList.add("controls-flash");
  clearTimeout(exportInfoTimer);
  exportInfoTimer = window.setTimeout(() => stage!.classList.remove("controls-flash"), 1800);
}

// The app's default wave (what loads on startup and on "Reset to default").
const DEFAULT_PRESET = "Stripe Hero";
const makeDefault = (): StudioConfig => PRESETS[DEFAULT_PRESET]();

// A shared link (#w=…) overrides the default on load — applied async (gzip decode) below.
const hasSharedLink = /[#&]w=/.test(location.hash);
let config: StudioConfig = makeDefault();
const renderer = new WaveRenderer(stage, config, { skipIntroRamp: import.meta.env.DEV });
const exportSize = { ...DEFAULT_EXPORT_SIZE };

function updateExportPresentation(refitPreview: boolean): void {
  const width = Math.round(exportSize.width);
  const height = Math.round(exportSize.height);
  exportSize.width = width;
  exportSize.height = height;
  if (refitPreview) {
    stage!.style.removeProperty("inline-size");
    stage!.style.removeProperty("block-size");
  }
  stage!.style.setProperty("--capture-aspect", String(width / height));
  const gpuWarning = exportGpuWarning(width, height);
  captureSizeEl!.textContent =
    `EXPORT AREA · ${width} × ${height} px · ${aspectRatioLabel(width, height)}` +
    " · IMAGE / VIDEO / EMBED" +
    (gpuWarning ? ` · ⚠ ${gpuWarning.short.toUpperCase()}` : "");
  flashExportInfo(width, height); // briefly reveal the bar + resize handles when the size changes
}

function applyExportSize(): void {
  updateExportPresentation(true);
  const { width, height } = exportSize;
  renderer.setOutputSize(width, height);
}

applyExportSize();
renderer.start();
// Studio only: mouse/trackpad orbit + zoom + pan (the embed stays a static view).
void renderer.enableOrbit();

const recorder = new Recorder();
const recordingOverlay = new RecordingOverlay(stage);
/** Auto-stop timer for seamless-loop capture (records exactly one period). */
let loopRecordTimer = 0;
function stopRecording(): void {
  clearTimeout(loopRecordTimer);
  loopRecordTimer = 0;
  recorder.stop();
  recordingOverlay.stop();
  panel.setRecording(false);
}

const presetOptions: Record<string, string> = { "—": "—" };
for (const name of Object.keys(PRESETS)) presetOptions[name] = name;

// ---- Undo / redo history ----
// Each committed edit snapshots the whole StudioConfig; restoring reuses applyConfig below.
// `applying` suppresses edit-capture while WE swap the config (preset/reset/undo/redo) — notably
// renderer.setConfig fires onCameraChanged synchronously, which would otherwise look like an edit.
const applying = { on: false };
const history = new History({
  getLive: () => config,
  getLabel: () => panel.getPresetLabel(),
  onChange: () => historyControls.update(history.getState()),
});
const onEdit = (): void => {
  dismissToast(); // a fresh edit supersedes a pending "undo clear"
  if (!applying.on) history.markDirty();
};

function applyConfig(next: StudioConfig, presetName = "—", record = true, label?: string): void {
  dismissToast(); // preset / reset / randomize / import / undo / redo supersedes a pending "undo clear"
  // Normalize once, up front, so this module, the renderer, and the panel all share the same
  // canonical config object.
  if (record) history.flush(); // commit any pending manual edit as its own step first
  applying.on = true;
  config = ensureStudioConfig(next);
  renderer.setConfig(config);
  panel.setConfig(config, presetName); // presetName labels the Global → preset dropdown
  applying.on = false;
  if (record) history.commit(config, presetName, label);
}

const panel = new ControlPanel(panelEl, renderer, config, {
  presetOptions,
  // Shared-link load isn't a named preset → "—"; otherwise show the default's name.
  defaultPreset: hasSharedLink ? "—" : DEFAULT_PRESET,
  onEdit,
  onPreset: (name) => {
    const make = PRESETS[name];
    if (make) applyConfig(make(), name, true, name);
  },
  onRandomize: () => applyConfig(randomizeConfig(config), "—", true, "Randomize All"),
  onReset: () => applyConfig(makeDefault(), DEFAULT_PRESET, true, "Reset"),
  onCopyLink: () => copyShareLink(config),
  onExportConfig: () => exportConfigJSON(config),
  onImportConfig: async () => {
    try {
      applyConfig(await pickConfigFile(), "—", true, "Imported");
    } catch (err) {
      console.error("Import failed:", err);
    }
  },
  exportSize,
  onExportSizeChange: applyExportSize,
  onSizeControlsActive: (active) => stage!.classList.toggle("size-adjusting", active),
  onExportImage: (format, quality) => {
    void exportImage(renderer, exportSize, format, config.transparentBackground, quality);
  },
  onExportEmbed: () => {
    void exportEmbed(config, exportSize);
  },
  onToggleRecord: (format) => {
    if (recorder.recording) {
      stopRecording();
    } else {
      // GIF is composited onto an opaque background (no 1-bit transparency); use the wave's
      // own background, or white when it's transparent.
      const gifBg = config.transparentBackground ? "#ffffff" : config.background;
      recorder.start(renderer, format, gifBg);
      recordingOverlay.start();
      panel.setRecording(true);
      // Seamless-loop capture: the motion repeats every config.loopSeconds, so recording exactly
      // one period yields a clip that loops cleanly. Auto-stop after it — the user can still stop
      // early. (No loop set → record until stopped, as before.)
      clearTimeout(loopRecordTimer);
      const loopSec = config.loopSeconds ?? 0;
      if (loopSec > 0) {
        loopRecordTimer = window.setTimeout(stopRecording, loopSec * 1000);
      }
    }
  },
});

const outputResizer = new OutputResizeHandle(workspace, stage, resizeHandleEls, exportSize, {
  onDragStart: () => captureSizeEl.setAttribute("aria-live", "off"),
  onPreviewChange: () => updateExportPresentation(false),
  onCommit: (refitPreview) => {
    updateExportPresentation(refitPreview);
    captureSizeEl.setAttribute("aria-live", "polite");
    renderer.setOutputSize(exportSize.width, exportSize.height);
    panel.refreshOutputSize();
  },
});
const onWindowResize = (): void => outputResizer.fitPreview();
window.addEventListener("resize", onWindowResize);

// Undo/redo: floating controls (bottom-left) + keyboard shortcuts. Restores go through applyConfig
// with record=false so they don't re-enter history.
function doUndo(): void {
  history.flush();
  const r = history.undo();
  if (r) applyConfig(r.config, r.presetName, false);
}
function doRedo(): void {
  history.flush();
  const r = history.redo();
  if (r) applyConfig(r.config, r.presetName, false);
}
function doJump(id: number): void {
  history.flush();
  const r = history.jumpToId(id);
  if (r) applyConfig(r.config, r.presetName, false);
}
const historyThumbnailer = new HistoryThumbnailer((id) => history.getConfigById(id));
const historyControls = new HistoryControls(workspace, {
  onUndo: doUndo,
  onRedo: doRedo,
  onJump: doJump,
  // Wipe the timeline back to a single baseline — the current wave stays, undo/redo resets — but
  // offer a few seconds to take it back via an Undo toast (any later edit invalidates it).
  onClear: () => {
    history.clear(config, panel.getPresetLabel());
    showToast({
      message: "History cleared",
      actionLabel: "Undo",
      onAction: () => history.undoClear(),
    });
  },
  thumb: historyThumbnailer,
});
// Park the camera-controls hint here (bottom-left, out of the way) as a "?" whose hover/focus
// reveals it — rather than floating it over the export frame.
historyControls.addHelpButton("drag to move · scroll to zoom · right-drag or arrow keys to rotate");
// Seed the baseline now that the panel + controls exist (a shared link re-seeds it below).
history.reset(config, hasSharedLink ? "—" : DEFAULT_PRESET);

const onHistoryKey = (e: KeyboardEvent): void => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k !== "z" && k !== "y") return;
  const t = e.target as HTMLElement | null;
  // While typing in a field, let the browser's native text-undo win.
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  e.preventDefault();
  if (k === "y" || e.shiftKey) doRedo();
  else doUndo();
};
// End-of-gesture commit: flush a pending edit when a pointer drag releases → one entry per gesture.
// CAPTURE phase because the gradient/mesh editors stopPropagation() on pointerup; queueMicrotask
// defers past the editor's own handler so we snapshot its final value.
const onHistoryPointerUp = (): void => {
  if (history.isDirty()) queueMicrotask(() => history.flush());
};
window.addEventListener("keydown", onHistoryKey, true);
window.addEventListener("pointerup", onHistoryPointerUp, true);
window.addEventListener("pointercancel", onHistoryPointerUp, true);

// Apply a shared link (#w=…) once decoded (gzip). The default shows for the frame or two
// the decode takes; then the shared wave swaps in (dropdown stays "—" = custom).
if (hasSharedLink) {
  void decodeConfigFromHash(location.hash).then((shared) => {
    if (shared) {
      applyConfig(shared, "—", false);
      history.reset(config, "—", "Shared link"); // the shared wave becomes the clean baseline
    }
  });
}

// Render each preset's thumbnail offscreen (once the main view has painted), then refresh the
// preset picker to show them. Deferred so it never competes with the initial render.
setTimeout(() => void generatePresetThumbnails(PRESETS, () => panel.refreshPresetThumbs()), 600);

// Exposed for debugging — dev only, so it's stripped from the production build.
if (import.meta.env.DEV) {
  (window as unknown as { wave: unknown }).wave = {
    renderer,
    history,
    thumbnailer: historyThumbnailer,
    get config() {
      return config;
    },
  };
}

// Dev-only HMR. Nothing in the module graph opts into HMR, so Vite would otherwise full-reload on
// every edit — the flash + reset that made saves feel heavy. Self-accepting re-runs this entry in
// place instead; dispose() tears the old app down first so a reload can't stack a second render
// loop (which would literally speed the animation up), duplicate the canvas/panel, or double up
// the corner-drag handlers. import.meta.hot is undefined in production, so this is tree-shaken out.
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    window.removeEventListener("resize", onWindowResize);
    window.removeEventListener("keydown", onHistoryKey, true);
    window.removeEventListener("pointerup", onHistoryPointerUp, true);
    window.removeEventListener("pointercancel", onHistoryPointerUp, true);
    if (recorder.recording) recorder.stop();
    recordingOverlay.stop();
    outputResizer.dispose();
    historyControls.dispose();
    historyThumbnailer.dispose();
    history.dispose();
    panel.dispose();
    renderer.dispose();
  });
}
