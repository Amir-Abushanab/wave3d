import "./style.css";
import { WaveRenderer } from "@wave3d/core/renderer";
import type { StudioConfig } from "@wave3d/core";
import { createThumbHost, prepThumbConfig, renderThumbFrame } from "@wave3d/core/studio";

interface Wave {
  title: string;
  author: string;
  config: StudioConfig;
}

// Where the studio lives. In the deployed build it is the site root ("/") and the gallery is
// "/gallery/"; in dev they are separate Vite servers, so point at the studio's dev port.
const STUDIO_BASE = import.meta.env.DEV ? "http://localhost:5173/" : "/";
const THUMB_W = 480;
const THUMB_H = 270;

// Every gallery/waves/*.json (repo root), inlined at build time.
const waves = Object.values(
  import.meta.glob<Wave>("../../../gallery/waves/*.json", { eager: true, import: "default" }),
).sort((a, b) => a.title.localeCompare(b.title));

// ---- "Open in studio": gzip + base64url the config into #w= (matches the studio's encoder) ----
function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function studioLink(config: StudioConfig): Promise<string> {
  const gz = await new Response(
    new Blob([JSON.stringify(config)]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  return STUDIO_BASE + "#w=" + bytesToB64url(new Uint8Array(gz));
}

// ---- one reused offscreen renderer, drained sequentially as cards scroll into view ----
const host = createThumbHost(THUMB_W, THUMB_H);
const queue: Array<{ config: StudioConfig; target: HTMLCanvasElement }> = [];
let renderer: WaveRenderer | null = null;
let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  for (let job = queue.shift(); job; job = queue.shift()) {
    try {
      const cfg = structuredClone(job.config);
      prepThumbConfig(cfg);
      if (!renderer) renderer = new WaveRenderer(host, cfg);
      else renderer.setConfig(cfg);
      const frame = renderThumbFrame(renderer, host);
      if (frame) {
        job.target.getContext("2d")?.drawImage(frame, 0, 0, job.target.width, job.target.height);
        job.target.classList.add("ready");
      }
    } catch (err) {
      console.warn("thumbnail failed:", err);
    }
    await new Promise((r) => setTimeout(r, 0)); // yield between renders; the renderer is shared
  }
  draining = false;
}

// ---- grid ----
function card(wave: Wave): HTMLElement {
  const el = document.createElement("article");
  el.className = "card";

  const canvas = document.createElement("canvas");
  canvas.className = "thumb";
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  // Render eagerly; the queue drains sequentially so it never blocks. (Lazy-on-scroll: later.)
  queue.push({ config: wave.config, target: canvas });

  const meta = document.createElement("div");
  meta.className = "meta";
  const title = document.createElement("h2");
  title.textContent = wave.title;
  const by = document.createElement("a");
  by.className = "by";
  by.textContent = "@" + wave.author;
  by.href = "https://github.com/" + wave.author;
  by.target = "_blank";
  by.rel = "noopener";
  meta.append(title, by);

  const open = document.createElement("a");
  open.className = "open";
  open.textContent = "Open in studio →";
  open.rel = "noopener";
  void studioLink(wave.config).then((href) => (open.href = href));

  el.append(canvas, meta, open);
  return el;
}

const app = document.getElementById("app")!;
app.innerHTML = `
  <header class="hero">
    <h1>🌊 Wave gallery</h1>
    <p>Community waves, each one a <code>StudioConfig</code>. <a href="${STUDIO_BASE}">Make your own →</a></p>
  </header>
  <main class="grid"></main>`;

const grid = app.querySelector(".grid")!;
if (waves.length === 0) {
  grid.innerHTML = `<p class="empty">No waves yet. Be the first: design one in the studio and hit Publish to gallery.</p>`;
} else {
  for (const wave of waves) grid.appendChild(card(wave));
  void drain();
}
