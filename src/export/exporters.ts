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

export function pickConfigFile(): Promise<WaveConfig> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error("No file selected"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result)) as WaveConfig);
        } catch (err) {
          reject(err instanceof Error ? err : new Error("Invalid JSON"));
        }
      };
      reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
      reader.readAsText(file);
    };
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
