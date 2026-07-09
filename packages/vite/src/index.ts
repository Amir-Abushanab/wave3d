import type { Plugin, ViteDevServer } from "vite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, normalize, sep } from "node:path";

export interface Wave3DPosterOptions {
  /** Directory posters are written to, relative to the Vite root. Default `"public"`. */
  outDir?: string;
  /** Image MIME type captured. Default `"image/webp"`. */
  type?: string;
  /** Encoder quality 0–1 for lossy types. Default `0.92`. */
  quality?: number;
  /** Fixed animation-time to capture, for a reproducible frame. Default `0` — the frame the wave
   *  opens on. Set `null` to capture whatever frame is live (non-deterministic). */
  posterTime?: number | null;
}

const VIRTUAL_ID = "virtual:wave3d-poster-capture";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const ENDPOINT = "/__wave3d_poster";
const RECAPTURE_EVENT = "wave3d:recapture";

/**
 * Dev-only Vite plugin (Mode B): captures a wave3d poster from the browser already rendering it and
 * writes it to disk — no headless browser, no Playwright. Each `<wave-3d data-wave3d-poster-out="…">`
 * is snapshotted on `wave3d-ready` and re-snapshotted on every HMR round, so the committed poster
 * stays in sync as you edit the config. React / `mountWave` opt in via `registerPoster` from
 * `@wave3d/vite/client`. Captures are deterministic (fixed frame) and written only when the bytes
 * actually change. `vite build` does nothing here — it just references the committed file.
 */
export function wave3dPoster(options: Wave3DPosterOptions = {}): Plugin {
  const { outDir = "public", type = "image/webp", quality = 0.92, posterTime = 0 } = options;
  let outAbs = resolve(process.cwd(), outDir);

  return {
    name: "wave3d-poster",
    apply: "serve", // dev only; production build references the committed poster

    configResolved(config) {
      outAbs = resolve(config.root, outDir);
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },

    load(id) {
      if (id === RESOLVED_ID)
        return clientScript(ENDPOINT, RECAPTURE_EVENT, type, quality, posterTime);
    },

    transformIndexHtml() {
      return [
        { tag: "script", attrs: { type: "module", src: `/@id/${VIRTUAL_ID}` }, injectTo: "head" },
      ];
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "POST" || !req.url || !req.url.startsWith(ENDPOINT)) return next();
        const out = new URL(req.url, "http://localhost").searchParams.get("out") ?? "";
        const dest = safeJoin(outAbs, out);
        if (!dest) {
          res.statusCode = 400;
          res.end("wave3d-poster: unsafe output path");
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk as Buffer));
        req.on("end", () => {
          try {
            const body = Buffer.concat(chunks);
            // Exactly-once: skip identical bytes. Deterministic captures of an unchanged wave
            // produce identical files, so redundant recaptures (or an unrelated edit) are no-ops.
            if (existsSync(dest) && readFileSync(dest).equals(body)) {
              res.statusCode = 204;
              res.end();
              return;
            }
            mkdirSync(dirname(dest), { recursive: true });
            // Stop watching before writing, so our own write can't retrigger a reload/recapture
            // loop (the poster lives under a watched dir like public/).
            server.watcher.unwatch(dest);
            writeFileSync(dest, body);
            server.config.logger.info(`  wave3d-poster → ${out} (${body.length} B)`);
            res.statusCode = 204;
            res.end();
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    },

    handleHotUpdate({ file, server }) {
      // Ignore our own poster writes; a real source edit asks the client to re-capture (which is a
      // no-op unless the rendered frame actually changed — see the dedup above).
      if (file === outAbs || file.startsWith(outAbs + sep)) return;
      server.ws.send({ type: "custom", event: RECAPTURE_EVENT });
    },
  };
}

export default wave3dPoster;

/** Resolve `rel` under `baseAbs`, or null if it would escape (path traversal). */
function safeJoin(baseAbs: string, rel: string): string | null {
  if (!rel) return null;
  const dest = resolve(baseAbs, normalize(rel));
  if (dest !== baseAbs && !dest.startsWith(baseAbs + sep)) return null;
  return dest;
}

/**
 * The injected client module. Snapshots each opted-in wave and POSTs the blob back to disk:
 *  - `<wave-3d data-wave3d-poster-out="…">` elements are auto-discovered (handle is on the node);
 *  - React / mountWave register a handle or renderer via `window.__wave3dPoster` (see ./client).
 * Captures use a fixed frame and poll until the frame settles, so a config change (which re-renders /
 * rebuilds geometry asynchronously) yields exactly one write of the final frame.
 */
function clientScript(
  endpoint: string,
  event: string,
  type: string,
  quality: number,
  posterTime: number | null,
): string {
  const opts = JSON.stringify({ type, quality, time: posterTime ?? undefined });
  return `
const OUT_ATTR = "data-wave3d-poster-out";
const ENDPOINT = ${JSON.stringify(endpoint)};
const OPTS = ${opts};
const wired = new WeakSet();
const registry = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snapshotOf(t) {
  if (t && typeof t.snapshot === "function") return t.snapshot(OPTS);            // WaveHandle
  if (t && typeof t.captureImage === "function")                                 // WaveRenderer
    return t.captureImage(OPTS.type, true, OPTS.quality, OPTS.time);
  return Promise.resolve(null);
}

async function hashOf(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return String.fromCharCode.apply(null, new Uint8Array(digest));
}

async function post(out, blob) {
  await fetch(ENDPOINT + "?out=" + encodeURIComponent(out), {
    method: "POST", headers: { "content-type": blob.type }, body: blob,
  }).catch(() => {});
  console.info("[wave3d-poster] captured " + out + " (" + blob.size + " B)");
}

// Capture until the frame settles. A config change re-renders (and can rebuild geometry) async, and
// a handle may still be upgrading, so poll — POSTing only when the frame actually changes — until two
// consecutive snapshots match, or an ~8s budget runs out. The server writes only on a real byte
// change, so this converges to a single write of the settled frame (and none for a no-op edit).
async function captureStable(getTarget, out) {
  const deadline = performance.now() + 8000;
  let last = null;
  let stable = 0;
  while (performance.now() < deadline && stable < 2) {
    let blob = null;
    try { blob = await snapshotOf(getTarget()); } catch {}
    if (blob) {
      const h = await hashOf(blob);
      if (h === last) stable++;
      else { stable = 0; last = h; await post(out, blob); }
    } else stable = 0; // not running yet
    if (stable < 2) await sleep(400);
  }
}

const domEls = () => document.querySelectorAll("wave-3d[" + OUT_ATTR + "]");

function wireDom() {
  domEls().forEach((el) => {
    if (wired.has(el)) return;
    wired.add(el);
    const out = el.getAttribute(OUT_ATTR);
    const go = () => captureStable(() => el.handle, out);
    el.addEventListener("wave3d-ready", go);
    if (el.handle && el.handle.state === "running") go();
  });
}

function recaptureAll() {
  wireDom();
  domEls().forEach((el) => captureStable(() => el.handle, el.getAttribute(OUT_ATTR)));
  registry.forEach((r) => captureStable(() => r.target, r.out));
}

window.__wave3dPoster = {
  register(target, out) {
    registry.push({ target, out });
    captureStable(() => target, out); // polls until the handle is running, then until it settles
  },
};
(window.__wave3dPosterQueue || []).forEach((a) => window.__wave3dPoster.register(a[0], a[1]));
window.__wave3dPosterQueue = null;

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireDom);
else wireDom();

let recaptureTimer = 0;
if (import.meta.hot) {
  import.meta.hot.on(${JSON.stringify(event)}, () => {
    clearTimeout(recaptureTimer); // debounce the HMR burst, then re-capture until the frame settles
    recaptureTimer = setTimeout(recaptureAll, 250);
  });
}
`;
}
