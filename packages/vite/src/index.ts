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
 * `@wave3d/vite/client`. Captures are deterministic (fixed frame) and re-written only when the
 * config actually changes. `vite build` does nothing here — it just references the committed file.
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
        const params = new URL(req.url, "http://localhost").searchParams;
        const dup = params.get("dup");
        if (dup) {
          // A wave clashed with another on this filename — surface it in the Vite terminal.
          server.config.logger.warn(
            `  wave3d-poster: two waves target "${dup}" — give each a unique data-wave3d-poster-out ` +
              `(or registerPoster filename); the duplicate is ignored.`,
          );
          res.statusCode = 204;
          res.end();
          return;
        }
        const out = params.get("out") ?? "";
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
            // Secondary guard: the client already skips a recapture when the config is unchanged,
            // but on the first capture of a session it has no record yet — so skip identical bytes
            // here too (a deterministic frame matching the committed poster is a no-op).
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
 * A recapture is skipped when the target's config is unchanged since the last one written (keyed on a
 * config hash, not the pixels), so GPU-nondeterministic presets don't churn the file.
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
const lastHash = new Map(); // out → the config hash we last captured
const owners = new Map(); // out → the element/target that owns writing it
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// First wave to claim an output filename owns it. A second wave targeting the same file is almost
// always a mistake — they'd overwrite each other every recapture — so report it (the dev server
// logs to the Vite terminal) and ignore it, leaving the file stable under its first owner.
function claim(out, who) {
  const owner = owners.get(out);
  if (owner === undefined) {
    owners.set(out, who);
    return true;
  }
  if (owner === who) return true;
  // report the clash to the dev server so it logs in the Vite terminal (see the "dup" middleware)
  fetch(ENDPOINT + "?dup=" + encodeURIComponent(out), { method: "POST" }).catch(() => {});
  return false;
}

function configOf(t) {
  if (!t) return null;
  if (typeof t.getConfig === "function") return t.getConfig();                     // WaveRenderer
  if (t.renderer && typeof t.renderer.getConfig === "function")                    // WaveHandle
    return t.renderer.getConfig();
  return null;
}

function snapshotOf(t) {
  if (t && typeof t.snapshot === "function") return t.snapshot(OPTS);              // WaveHandle
  if (t && typeof t.captureImage === "function")                                   // WaveRenderer
    return t.captureImage(OPTS.type, true, OPTS.quality, OPTS.time);
  return Promise.resolve(null);
}

async function sha256(str) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return String.fromCharCode.apply(null, new Uint8Array(digest));
}

// Capture a target's poster only when its CONFIG changes. Keying on the config (not the rendered
// bytes) means GPU-nondeterministic presets — which draw different pixels every frame — don't churn
// the file on every recapture. Waits for the wave to run, lets an HMR config change settle into the
// render, then snapshots. (In-memory per dev session; a committed sidecar could persist it + fold in
// the engine version so a core upgrade that changes rendering also regenerates.)
async function capture(getTarget, out) {
  await sleep(300); // let an HMR config update apply + the render settle before reading it
  const deadline = performance.now() + 8000;
  let config = configOf(getTarget());
  while (config === null && performance.now() < deadline) {
    await sleep(300);
    config = configOf(getTarget());
  }
  if (config === null) return; // never became ready
  const hash = await sha256(JSON.stringify(config));
  if (hash === lastHash.get(out)) return; // config unchanged → nothing to write
  const blob = await snapshotOf(getTarget());
  if (!blob) return;
  lastHash.set(out, hash);
  await fetch(ENDPOINT + "?out=" + encodeURIComponent(out), {
    method: "POST", headers: { "content-type": blob.type }, body: blob,
  }).catch(() => {});
  console.info("[wave3d-poster] captured " + out + " (" + blob.size + " B)");
}

const domEls = () => document.querySelectorAll("wave-3d[" + OUT_ATTR + "]");

function wireDom() {
  domEls().forEach((el) => {
    if (wired.has(el)) return;
    wired.add(el); // mark processed even if it's a rejected duplicate, so we warn only once
    const out = el.getAttribute(OUT_ATTR);
    if (!claim(out, el)) return; // duplicate filename — left to the first owner
    const go = () => capture(() => el.handle, out);
    el.addEventListener("wave3d-ready", go);
    if (el.handle && el.handle.state === "running") go();
  });
}

function recaptureAll() {
  wireDom();
  domEls().forEach((el) => {
    const out = el.getAttribute(OUT_ATTR);
    if (owners.get(out) === el) capture(() => el.handle, out); // owner only — skip duplicates
  });
  registry.forEach((r) => capture(() => r.target, r.out));
}

window.__wave3dPoster = {
  register(target, out) {
    if (!claim(out, target)) return; // duplicate filename — left to the first owner
    registry.push({ target, out });
    capture(() => target, out); // waits for the handle to run, captures on its first config
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
