import "./style.css";
import { WaveRenderer } from "./wave/WaveRenderer";
import { randomizeConfig, PRESETS } from "./wave/config";
import type { WaveConfig } from "./wave/config";
import { ControlPanel } from "./ui/ControlPanel";
import { generatePresetThumbnails } from "./ui/presetThumbs";
import {
  exportConfigJSON,
  pickConfigFile,
  exportPNG,
  exportEmbed,
  VideoRecorder,
  decodeConfigFromHash,
  copyShareLink,
} from "./export/exporters";
import { aspectRatioLabel, DEFAULT_EXPORT_SIZE } from "./output/formats";

const stage = document.getElementById("stage");
const panelEl = document.getElementById("panel");
const captureSizeEl = document.getElementById("capture-size");
if (!stage || !panelEl || !captureSizeEl) {
  throw new Error("Missing #stage, #panel, or #capture-size element");
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
window.addEventListener("error", (e) =>
  showError(e.message, (e.error as Error)?.stack || `${e.filename}:${e.lineno}`),
);
window.addEventListener("unhandledrejection", (e) =>
  showError("Unhandled promise rejection", (e.reason as Error)?.stack || String(e.reason)),
);

// The app's default wave (what loads on startup and on "Reset to default").
const DEFAULT_PRESET = "Stripe Wave 2";
const makeDefault = (): WaveConfig => PRESETS[DEFAULT_PRESET]();

// A shared link (#w=…) overrides the default on load — applied async (gzip decode) below.
const hasSharedLink = /[#&]w=/.test(location.hash);
let config: WaveConfig = makeDefault();
const renderer = new WaveRenderer(stage, config);
const exportSize = { ...DEFAULT_EXPORT_SIZE };

function applyExportSize(): void {
  const width = Math.round(exportSize.width);
  const height = Math.round(exportSize.height);
  exportSize.width = width;
  exportSize.height = height;
  stage!.style.setProperty("--capture-aspect", String(width / height));
  captureSizeEl!.textContent =
    `EXPORT AREA · ${width} × ${height} px · ${aspectRatioLabel(width, height)}` +
    " · PNG / VIDEO / EMBED";
  renderer.setOutputSize(width, height);
}

applyExportSize();
renderer.start();
// Studio only: mouse/trackpad orbit + zoom + pan (the embed stays a static view).
void renderer.enableOrbit();

const recorder = new VideoRecorder();

const presetOptions: Record<string, string> = { "—": "—" };
for (const name of Object.keys(PRESETS)) presetOptions[name] = name;

function applyConfig(next: WaveConfig, presetName = "—"): void {
  config = next;
  renderer.setConfig(config);
  panel.setConfig(config, presetName); // presetName labels the Global → preset dropdown
}

const panel = new ControlPanel(panelEl, renderer, config, {
  presetOptions,
  // Shared-link load isn't a named preset → "—"; otherwise show the default's name.
  defaultPreset: hasSharedLink ? "—" : DEFAULT_PRESET,
  onPreset: (name) => {
    const make = PRESETS[name];
    if (make) applyConfig(make(), name);
  },
  onRandomize: () => applyConfig(randomizeConfig(config)),
  onReset: () => applyConfig(makeDefault(), DEFAULT_PRESET),
  onCopyLink: () => copyShareLink(config),
  onExportConfig: () => exportConfigJSON(config),
  onImportConfig: async () => {
    try {
      applyConfig(await pickConfigFile());
    } catch (err) {
      console.error("Import failed:", err);
    }
  },
  exportSize,
  onExportSizeChange: applyExportSize,
  onExportPNG: () => {
    void exportPNG(renderer, exportSize, config.transparentBackground);
  },
  onExportEmbed: () => exportEmbed(config, exportSize),
  onToggleRecord: () => {
    if (recorder.recording) {
      recorder.stop();
      panel.setRecording(false);
    } else {
      recorder.start(renderer);
      panel.setRecording(true);
    }
  },
});

// Apply a shared link (#w=…) once decoded (gzip). The default shows for the frame or two
// the decode takes; then the shared wave swaps in (dropdown stays "—" = custom).
if (hasSharedLink) {
  void decodeConfigFromHash(location.hash).then((shared) => {
    if (shared) applyConfig(shared, "—");
  });
}

// Render each preset's thumbnail offscreen (once the main view has painted), then refresh the
// preset picker to show them. Deferred so it never competes with the initial render.
setTimeout(() => void generatePresetThumbnails(PRESETS, () => panel.refreshPresetThumbs()), 600);

// Camera-controls hint: shows briefly, fades on first interaction or after a few seconds.
{
  const hint = document.createElement("div");
  hint.textContent = "drag to move · scroll to zoom · right-drag or arrow keys to rotate";
  hint.style.cssText =
    "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:20;" +
    "padding:7px 14px;border-radius:999px;white-space:nowrap;pointer-events:none;" +
    "font:12px/1 ui-sans-serif,system-ui,-apple-system,sans-serif;color:#dfe1e6;" +
    "background:rgba(18,18,26,0.72);border:1px solid rgba(255,255,255,0.12);" +
    "backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);" +
    "opacity:0;transition:opacity 0.6s ease;";
  document.body.appendChild(hint);
  requestAnimationFrame(() => {
    hint.style.opacity = "1";
  });

  let gone = false;
  function dismiss(): void {
    if (gone) return;
    gone = true;
    hint.style.opacity = "0";
    setTimeout(() => hint.remove(), 700);
    window.removeEventListener("pointerdown", onPointer, true);
    window.removeEventListener("wheel", dismiss, true);
    window.removeEventListener("keydown", onKey, true);
  }
  function onPointer(e: PointerEvent): void {
    const t = e.target;
    if (t instanceof HTMLElement && t.closest("#panel")) return; // panel clicks don't count
    dismiss();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key.startsWith("Arrow")) dismiss();
  }
  window.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("wheel", dismiss, true);
  window.addEventListener("keydown", onKey, true);
  setTimeout(dismiss, 5000);
}

// Exposed for debugging.
(window as unknown as { wave: unknown }).wave = {
  renderer,
  get config() {
    return config;
  },
};
