import type { WaveConfig } from "../wave/config";
import type { WaveRenderer } from "../wave/WaveRenderer";

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

export function exportConfigJSON(config: WaveConfig): void {
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
export async function encodeConfigToHash(config: WaveConfig): Promise<string> {
  const json = JSON.stringify(config);
  const gz = await new Response(
    new Blob([json]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  return bytesToB64url(new Uint8Array(gz));
}

/** Decode a config from a location hash. Tries the gzip token, then falls back to a plain
 *  base64-JSON token (the pre-compression format), then gives up (null). */
export async function decodeConfigFromHash(hash: string): Promise<WaveConfig | null> {
  const m = hash.match(/[#&]w=([^&]+)/);
  if (!m) return null;
  try {
    const text = await new Response(
      new Blob([b64urlToBytes(m[1])]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();
    return JSON.parse(text) as WaveConfig;
  } catch {
    /* not a gzip token — try the legacy plain base64-JSON format */
  }
  try {
    return JSON.parse(
      decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")))),
    ) as WaveConfig;
  } catch {
    return null;
  }
}

/** Write the config into the URL and copy the link to the clipboard. Returns ok. */
export async function copyShareLink(config: WaveConfig): Promise<boolean> {
  history.replaceState(null, "", "#w=" + (await encodeConfigToHash(config)));
  try {
    await navigator.clipboard.writeText(location.href);
    return true;
  } catch {
    return false; // clipboard blocked (no gesture / insecure context) — URL is still set
  }
}

export function pickConfigFile(): Promise<WaveConfig> {
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
              resolve(JSON.parse(String(reader.result)) as WaveConfig);
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

export async function exportPNG(renderer: WaveRenderer, transparent = false): Promise<void> {
  const blob = await renderer.capturePNG(transparent);
  downloadBlob(blob, "wave.png");
}

// ---- Embeddable component ----

/** A self-contained HTML page that renders this exact wave from config. */
export function generateEmbedHTML(config: WaveConfig): string {
  const json = JSON.stringify(config, null, 2);
  const bg = config.transparentBackground ? "transparent" : config.background;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Wave</title>
    <style>
      html, body { margin: 0; height: 100%; background: ${bg}; }
      #wave { position: fixed; inset: 0; }
    </style>
  </head>
  <body>
    <div id="wave"></div>
    <script type="module">
      // 1. In the wave-studio project run:  pnpm build:embed
      // 2. Put the generated dist-embed/wave-studio-embed.js next to this file.
      import { mountWave } from "./wave-studio-embed.js";
      const config = ${json};
      mountWave(document.getElementById("wave"), config);
    </script>
  </body>
</html>
`;
}

export function exportEmbed(config: WaveConfig): void {
  downloadText(generateEmbedHTML(config), "wave-embed.html", "text/html");
}

// ---- Video ----

export class VideoRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  start(renderer: WaveRenderer, fps = 60): void {
    if (this.recording) return;
    const stream = renderer.captureStream(fps);
    const mime =
      ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) =>
        MediaRecorder.isTypeSupported(m),
      ) ?? "video/webm";
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => {
      downloadBlob(new Blob(this.chunks, { type: "video/webm" }), "wave.webm");
      this.recorder = null;
    };
    this.recorder.start();
  }

  stop(): void {
    this.recorder?.stop();
  }
}
