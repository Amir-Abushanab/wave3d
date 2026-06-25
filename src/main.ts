import "./style.css";
import { WaveRenderer } from "./wave/WaveRenderer";
import { createDefaultConfig, randomizeConfig, PRESETS } from "./wave/config";
import type { WaveConfig } from "./wave/config";
import { ControlPanel } from "./ui/panel";
import { exportConfigJSON, pickConfigFile, exportPNG, exportEmbed, VideoRecorder } from "./export/exporters";

const stage = document.getElementById("stage");
const panelEl = document.getElementById("panel");
if (!stage || !panelEl) throw new Error("Missing #stage or #panel element");

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

let config: WaveConfig = createDefaultConfig();
const renderer = new WaveRenderer(stage, config);
renderer.start();
// Studio only: mouse/trackpad orbit + zoom + pan (the embed stays a static view).
void renderer.enableOrbit();

const recorder = new VideoRecorder();

const presetOptions: Record<string, string> = { "—": "—" };
for (const name of Object.keys(PRESETS)) presetOptions[name] = name;

function applyConfig(next: WaveConfig): void {
  config = next;
  renderer.setConfig(config);
  panel.setConfig(config);
}

const panel = new ControlPanel(panelEl, renderer, config, {
  presetOptions,
  onPreset: (name) => {
    const make = PRESETS[name];
    if (make) applyConfig(make());
  },
  onRandomize: () => applyConfig(randomizeConfig(config)),
  onReset: () => applyConfig(createDefaultConfig()),
  onExportConfig: () => exportConfigJSON(config),
  onImportConfig: async () => {
    try {
      applyConfig(await pickConfigFile());
    } catch (err) {
      console.error("Import failed:", err);
    }
  },
  onExportPNG: () => {
    void exportPNG(renderer, config.transparentBackground);
  },
  onExportEmbed: () => exportEmbed(config),
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

// Shift the studio view right so the wave isn't hidden behind the control panel.
// (Desktop only — on mobile the panel is a full-width overlay, so we skip it.)
function applyViewInset(): void {
  if (!panelEl) return;
  const rect = panelEl.getBoundingClientRect();
  const inset = rect.right < window.innerWidth * 0.6 ? rect.right + 10 : 0;
  renderer.setViewInsetLeft(inset);
}
applyViewInset();

window.addEventListener("resize", () => {
  renderer.resize();
  applyViewInset();
});

// Exposed for debugging.
(window as unknown as { wave: unknown }).wave = {
  renderer,
  get config() {
    return config;
  },
};
