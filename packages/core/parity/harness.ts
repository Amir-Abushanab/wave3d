/**
 * Preset-parity harness page. Renders every shipped preset + gallery config at a FIXED size,
 * DPR and animation time, then compares two renders pixel-by-pixel. Driven by `run.mjs`
 * (Playwright) — everything here runs in the page so the GPU, driver and browser are identical
 * across the two backends being compared, leaving the backend as the only variable.
 *
 * Cross-backend renders are NOT bit-identical by construction (WebGPU's default output buffer is
 * HalfFloat, MSAA resolve differs, and the noise ULPs diverge), so parity is measured perceptually
 * — see `diff()` — rather than by the SHA-256 digests used for same-backend refactor checks.
 */
import { WaveRenderer } from "../src/renderer/WaveRenderer";
import { PRESETS } from "../src/presets";
import { ensureStudioConfig, type StudioConfig } from "../src/config/model";

const galleryModules = import.meta.glob<{ default: { title?: string; config: unknown } }>(
  "../../../gallery/waves/*.json",
  { eager: true },
);

/** Every config under test: the 17 shipped presets + the gallery entries. */
function allConfigs(): Record<string, () => StudioConfig> {
  const out: Record<string, () => StudioConfig> = {};
  for (const [name, make] of Object.entries(PRESETS)) out[`preset:${name}`] = make;
  for (const [path, mod] of Object.entries(galleryModules)) {
    const slug = path
      .split("/")
      .pop()!
      .replace(/\.json$/, "");
    out[`gallery:${slug}`] = () =>
      ensureStudioConfig(structuredClone(mod.default.config) as StudioConfig);
  }
  return out;
}

const CONFIGS = allConfigs();

export interface RenderOpts {
  backend?: "webgl" | "webgpu";
  width?: number;
  height?: number;
  /** Fixed animation time, seconds. captureImage() forces the intro ramp full at this time. */
  time?: number;
}

/**
 * Render one config to a PNG data URL. The renderer is built, captured and torn down per call so
 * no state (palette textures, particle fields, composer targets) leaks between configs — the same
 * isolation the studio's thumbnail renderer needs, for the same reason.
 */
async function render(name: string, opts: RenderOpts = {}): Promise<string> {
  const make = CONFIGS[name];
  if (!make) throw new Error(`unknown config: ${name}`);
  const width = opts.width ?? 480;
  const height = opts.height ?? 320;

  const config = make();
  // Determinism: never animate, and pin the noise phase. captureImage(time) then fixes uTime and
  // forces introTimeRamp to 1, so the frame is a pure function of the config.
  config.paused = true;
  config.timeOffset = 0;

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px`;
  document.body.appendChild(host);

  let renderer: WaveRenderer | undefined;
  try {
    renderer = new WaveRenderer(host, config, { respectReducedMotion: false, skipIntroRamp: true });
    if (typeof (renderer as { init?: () => Promise<void> }).init === "function") {
      await (renderer as unknown as { init: () => Promise<void> }).init(); // WebGPU backend only
    }
    renderer.setOutputSize(width, height); // forces DPR 1 — parity must not depend on the display
    // Two captures: the first lets any theme/blend program compile, the second is the settled frame
    // (the studio's thumbnail path does the same for the same reason).
    await renderer.captureImage("image/png", false, undefined, opts.time ?? 0);
    const blob = await renderer.captureImage("image/png", false, undefined, opts.time ?? 0);
    return await blobToDataUrl(blob);
  } finally {
    renderer?.dispose();
    host.remove();
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a full-size PNG.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function toImageData(dataUrl: string): Promise<ImageData> {
  // createImageBitmap, not `new Image()` + decode(): image decoding is tied to rendering, which is
  // throttled to a standstill in a backgrounded/automated tab — decode() there never resolves.
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}

export interface DiffResult {
  width: number;
  height: number;
  /** Mean absolute per-channel difference, 0-255. */
  mae: number;
  /** Largest single-channel difference, 0-255. */
  maxDelta: number;
  /** Share of pixels whose max channel delta exceeds 8/255. */
  pctOver8: number;
  /** Share of pixels whose max channel delta exceeds 24/255 — visible-to-the-eye disagreement. */
  pctOver24: number;
  /** Amplified difference image, for eyeballing a failure. */
  diffPng: string;
}

/** Compare two PNG data URLs. Amplifies the delta 8x into `diffPng` so small drifts stay visible. */
async function diff(aUrl: string, bUrl: string): Promise<DiffResult> {
  const [a, b] = await Promise.all([toImageData(aUrl), toImageData(bUrl)]);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const out = new ImageData(a.width, a.height);
  let sum = 0;
  let maxDelta = 0;
  let over8 = 0;
  let over24 = 0;
  const px = a.width * a.height;
  for (let i = 0; i < a.data.length; i += 4) {
    let pixelMax = 0;
    for (let k = 0; k < 4; k++) {
      const d = Math.abs(a.data[i + k] - b.data[i + k]);
      sum += d;
      if (d > pixelMax) pixelMax = d;
    }
    if (pixelMax > maxDelta) maxDelta = pixelMax;
    if (pixelMax > 8) over8++;
    if (pixelMax > 24) over24++;
    const amp = Math.min(255, pixelMax * 8);
    out.data[i] = amp;
    out.data[i + 1] = amp > 0 ? 255 - amp : 0;
    out.data[i + 2] = 0;
    out.data[i + 3] = 255;
  }
  const c = new OffscreenCanvas(a.width, a.height);
  c.getContext("2d")!.putImageData(out, 0, 0);
  const diffPng = await blobToDataUrl(await c.convertToBlob({ type: "image/png" }));
  return {
    width: a.width,
    height: a.height,
    mae: sum / (px * 4),
    maxDelta,
    pctOver8: (over8 / px) * 100,
    pctOver24: (over24 / px) * 100,
    diffPng,
  };
}

declare global {
  interface Window {
    waveParity: {
      names: () => string[];
      render: typeof render;
      diff: typeof diff;
      ready: true;
    };
  }
}

window.waveParity = { names: () => Object.keys(CONFIGS), render, diff, ready: true };
