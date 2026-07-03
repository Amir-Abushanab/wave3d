import type { StudioConfig } from "../wave/config";
import type { WaveRenderer } from "../wave/WaveRenderer";
import { IMAGE_FORMATS, pickVideoMime } from "../output/formats";
import type { ExportSize, ImageFormat, RecordFormat, VideoFormat } from "../output/formats";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, mime = "text/plain"): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

// ---- Config (the "save state" format) ----

export function exportConfigJSON(config: StudioConfig): void {
  downloadText(JSON.stringify(config, null, 2), "wave.json", "application/json");
}

// ---- Shareable URL: the whole config gzipped into the location hash (#w=…) ----

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** gzip + base64url the config → a compact share token (~3-4× smaller than raw base64). */
export async function encodeConfigToHash(config: StudioConfig): Promise<string> {
  const json = JSON.stringify(config);
  const gz = await new Response(
    new Blob([json]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  return bytesToB64url(new Uint8Array(gz));
}

/** Decode a config from a location hash. Tries the gzip token, then falls back to a plain
 *  base64-JSON token (the pre-compression format), then gives up (null). */
export async function decodeConfigFromHash(hash: string): Promise<StudioConfig | null> {
  const m = hash.match(/[#&]w=([^&]+)/);
  if (!m) return null;
  try {
    const text = await new Response(
      new Blob([b64urlToBytes(m[1])]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();
    return JSON.parse(text) as StudioConfig;
  } catch {
    /* not a gzip token — try the legacy plain base64-JSON format */
  }
  try {
    return JSON.parse(
      decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")))),
    ) as StudioConfig;
  } catch {
    return null;
  }
}

/** Write the config into the URL and copy the link to the clipboard. Returns ok. */
export async function copyShareLink(config: StudioConfig): Promise<boolean> {
  history.replaceState(null, "", "#w=" + (await encodeConfigToHash(config)));
  try {
    await navigator.clipboard.writeText(location.href);
    return true;
  } catch {
    return false; // clipboard blocked (no gesture / insecure context) — URL is still set
  }
}

export function pickConfigFile(): Promise<StudioConfig> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        if (!file) {
          reject(new Error("No file selected"));
          return;
        }
        const reader = new FileReader();
        reader.addEventListener(
          "load",
          () => {
            try {
              resolve(JSON.parse(String(reader.result)) as StudioConfig);
            } catch (err) {
              reject(err instanceof Error ? err : new Error("Invalid JSON"));
            }
          },
          { once: true },
        );
        reader.addEventListener(
          "error",
          () => reject(reader.error ?? new Error("Could not read file")),
          { once: true },
        );
        reader.readAsText(file);
      },
      { once: true },
    );
    input.click();
  });
}

// ---- Image ----

export async function exportImage(
  renderer: WaveRenderer,
  size: ExportSize,
  format: ImageFormat,
  transparent = false,
  quality = 0.92,
): Promise<void> {
  const definition = IMAGE_FORMATS[format];
  const preserveTransparency = definition.supportsTransparency && transparent;
  const blob = await renderer.captureImage(
    definition.mime,
    preserveTransparency,
    definition.lossy ? quality : undefined,
  );
  downloadBlob(blob, `wave-${size.width}x${size.height}.${definition.extension}`);
}

// ---- Embeddable component ----

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/** A self-contained HTML page that renders this exact wave from config. */
export function generateEmbedHTML(
  config: StudioConfig,
  size: ExportSize,
  runtimeSource: string,
): string {
  const json = serializeForInlineScript(config);
  const runtime = serializeForInlineScript(runtimeSource);
  const bg = config.transparentBackground ? "transparent" : config.background;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Wave</title>
    <style>
      html, body { margin: 0; min-height: 100%; background: ${bg}; }
      body { display: grid; place-items: center; }
      #wave {
        width: min(100vw, calc(100vh * ${size.width} / ${size.height}), ${size.width}px);
        aspect-ratio: ${size.width} / ${size.height};
      }
    </style>
  </head>
  <body>
    <div id="wave"></div>
    <script type="module">
      const runtimeSource = ${runtime};
      const runtimeUrl = URL.createObjectURL(
        new Blob([runtimeSource], { type: "text/javascript" }),
      );
      const config = ${json};
      try {
        const { mountWave } = await import(runtimeUrl);
        mountWave(document.getElementById("wave"), config);
      } finally {
        URL.revokeObjectURL(runtimeUrl);
      }
    </script>
  </body>
</html>
`;
}

export async function exportEmbed(config: StudioConfig, size: ExportSize): Promise<void> {
  const runtimeUrl = new URL("./wave-studio-embed.js", document.baseURI);
  const response = await fetch(runtimeUrl);
  if (!response.ok) {
    throw new Error(`Could not load the embed runtime (${response.status})`);
  }
  const runtimeSource = await response.text();
  downloadText(
    generateEmbedHTML(config, size, runtimeSource),
    `wave-embed-${size.width}x${size.height}.html`,
    "text/html",
  );
}

// ---- Video ----

export class VideoRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  /** Record the canvas to a downloadable clip. `format` picks the container (WebM/MP4);
   *  an unsupported container falls back to WebM so recording always works. */
  start(renderer: WaveRenderer, format: VideoFormat = "webm", fps = 60): void {
    if (this.recording) return;
    const stream = renderer.captureStream(fps);
    const { mime, ext } = pickVideoMime(format);
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => {
      const type = ext === "mp4" ? "video/mp4" : "video/webm";
      downloadBlob(new Blob(this.chunks, { type }), `wave.${ext}`);
      this.recorder = null;
    };
    this.recorder.start();
  }

  stop(): void {
    this.recorder?.stop();
  }
}

// ---- GIF ----

// Unlike WebM/MP4 (native MediaRecorder), GIF needs us to grab frames on a timer, quantize
// each to 256 colours, and encode with gifenc. Frames are downscaled (long edge ≤ MAX_GIF_EDGE)
// and composited onto an opaque background so the output stays small and avoids GIF's harsh
// 1-bit transparency.
const GIF_FPS = 12;
const MAX_GIF_EDGE = 640;

export class GifRecorder {
  private encoder: ReturnType<typeof GIFEncoder> | null = null;
  private timer = 0;
  private readonly scratch = document.createElement("canvas");
  private readonly ctx = this.scratch.getContext("2d", {
    willReadFrequently: true,
  }) as CanvasRenderingContext2D;
  private background = "#ffffff";

  get recording(): boolean {
    return this.encoder !== null;
  }

  start(renderer: WaveRenderer, background = "#ffffff"): void {
    if (this.recording) return;
    const src = renderer.canvas;
    const scale = Math.min(1, MAX_GIF_EDGE / Math.max(src.width, src.height));
    this.scratch.width = Math.max(1, Math.round(src.width * scale));
    this.scratch.height = Math.max(1, Math.round(src.height * scale));
    this.background = background;
    this.encoder = GIFEncoder();
    const delay = Math.round(1000 / GIF_FPS);
    const grab = (): void => {
      const enc = this.encoder;
      if (!enc) return;
      const w = this.scratch.width;
      const h = this.scratch.height;
      this.ctx.fillStyle = this.background; // opaque bg → no 1-bit transparency fringe
      this.ctx.fillRect(0, 0, w, h);
      this.ctx.drawImage(src, 0, 0, w, h);
      const { data } = this.ctx.getImageData(0, 0, w, h);
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      enc.writeFrame(index, w, h, { palette, delay });
    };
    grab(); // first frame immediately, then on a fixed cadence
    this.timer = window.setInterval(grab, delay);
  }

  stop(): void {
    const enc = this.encoder;
    if (!enc) return;
    clearInterval(this.timer);
    this.timer = 0;
    this.encoder = null;
    enc.finish();
    downloadBlob(new Blob([enc.bytes()], { type: "image/gif" }), "wave.gif");
  }
}

/**
 * Unified recording facade: routes WebM/MP4 to the MediaRecorder-based VideoRecorder and GIF
 * to the frame-capture GifRecorder, so callers toggle one object regardless of format.
 */
export class Recorder {
  private readonly video = new VideoRecorder();
  private readonly gif = new GifRecorder();

  get recording(): boolean {
    return this.video.recording || this.gif.recording;
  }

  start(renderer: WaveRenderer, format: RecordFormat, gifBackground = "#ffffff"): void {
    if (format === "gif") this.gif.start(renderer, gifBackground);
    else this.video.start(renderer, format);
  }

  stop(): void {
    if (this.gif.recording) this.gif.stop();
    else this.video.stop();
  }
}
