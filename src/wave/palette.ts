import * as THREE from "three";
import type { ColorStop } from "./config";

/**
 * Bakes the gradient stops into a 2D palette texture, sampled in the shader as
 * `texture2D(u_paletteTexture, vec2(uv.x, uv.y))`. The texture is a real image, so
 * colour can vary independently along BOTH axes:
 *   - X (uv.x, along the length): the gradient stops.
 *   - Y (uv.y, across the width): an "edge tint" blended toward both long edges
 */

const TEX_W = 256; // resolution along the gradient (length)
const TEX_H = 64; // resolution across the width

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** "#rrggbb" → "rgba(r,g,b,a)" for canvas fills with alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const c = new THREE.Color(hex); // parses many formats; .r/.g/.b are linear…
  // …but we want the original sRGB bytes for the canvas, so re-encode.
  const srgb = c.clone().convertLinearToSRGB();
  const r = Math.round(srgb.r * 255);
  const g = Math.round(srgb.g * 255);
  const b = Math.round(srgb.b * 255);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface PaletteTextureOptions {
  stops: ColorStop[];
  /** Cross-width edge tint colour (e.g. periwinkle). */
  edgeColor: string;
  /** 0 = flat 1-D gradient (no 2nd axis); higher = stronger cool edges. */
  edgeAmount: number;
}

/** Draw the palette into a 2D canvas. */
export function buildPaletteCanvas(opts: PaletteTextureOptions): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // X axis: the main gradient (stops sorted by position).
  const stops = [...opts.stops].sort((a, b) => a.pos - b.pos);
  const grad = ctx.createLinearGradient(0, 0, TEX_W, 0);
  if (stops.length === 0) {
    grad.addColorStop(0, "#ffffff");
  } else {
    for (const s of stops) grad.addColorStop(clamp01(s.pos), s.color);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // Y axis: blend the edge colour toward both long edges (V-shaped alpha), 0 in the
  // middle — a genuine second dimension of colour.
  const a = clamp01(opts.edgeAmount);
  if (a > 0.001) {
    const eg = ctx.createLinearGradient(0, 0, 0, TEX_H);
    eg.addColorStop(0, hexToRgba(opts.edgeColor, a));
    eg.addColorStop(0.5, hexToRgba(opts.edgeColor, 0));
    eg.addColorStop(1, hexToRgba(opts.edgeColor, a));
    ctx.fillStyle = eg;
    ctx.fillRect(0, 0, TEX_W, TEX_H);
  }

  return canvas;
}

/** A small string that changes whenever the texture would need rebuilding. */
export function paletteSignature(opts: PaletteTextureOptions): string {
  const s = opts.stops.map((x) => `${x.color}@${x.pos.toFixed(3)}`).join(",");
  return `${s}|${opts.edgeColor}|${opts.edgeAmount.toFixed(3)}`;
}

/** Wrap a canvas as a sampling-ready CanvasTexture (sRGB → GPU linearizes on sample). */
export function canvasToTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  return tex;
}

/** Build a ready-to-use CanvasTexture from gradient stops + edge tint. */
export function buildPaletteTexture(opts: PaletteTextureOptions): THREE.CanvasTexture {
  return canvasToTexture(buildPaletteCanvas(opts));
}

// ---- Built-in palette maps (pick via config.paletteSource) ----

export interface PaletteMapDef {
  label: string;
  /** "gradient" = a color-stop preset (1-D ramp + edge tint, reproducible with stops);
   *  "image" = a true 2-D texture (build()) that the stops can't reproduce. */
  kind: "gradient" | "image";
  stops?: ColorStop[];
  edgeColor?: string;
  edgeAmount?: number;
  build?: () => HTMLCanvasElement;
}

const mk = (pairs: Array<[string, number]>): ColorStop[] => pairs.map(([color, pos]) => ({ color, pos }));

// ---- A genuine 2-D image map (procedural nebula): organic colour patches that vary in
// BOTH axes via domain-warped value noise — the kind of thing flat stops can't make. ----

function valueNoise2D(seed: number): (x: number, y: number) => number {
  const hash = (x: number, y: number): number => {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const sm = (t: number): number => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = sm(x - xi);
    const v = sm(y - yi);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
}

function fbm(n: (x: number, y: number) => number, x: number, y: number, oct: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  let tot = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * n(x * f, y * f);
    tot += amp;
    f *= 2;
    amp *= 0.5;
  }
  return s / tot;
}

let nebulaCache: HTMLCanvasElement | null = null;
function buildNebulaCanvas(): HTMLCanvasElement {
  if (nebulaCache) return nebulaCache;
  const N = 220;
  const cv = document.createElement("canvas");
  cv.width = N;
  cv.height = N;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  const img = ctx.createImageData(N, N);
  const field = valueNoise2D(11);
  const warp = valueNoise2D(91);
  const bloomN = valueNoise2D(47);
  const COLORS: Array<[number, [number, number, number]]> = [
    [0.0, [34, 26, 92]], // deep indigo
    [0.24, [104, 48, 196]], // violet
    [0.46, [226, 70, 158]], // magenta
    [0.64, [255, 122, 92]], // coral
    [0.82, [255, 202, 110]], // gold
    [1.0, [70, 196, 188]], // teal
  ];
  const ramp = (t: number): [number, number, number] => {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < COLORS.length; i++) {
      if (t <= COLORS[i][0]) {
        const [p0, c0] = COLORS[i - 1];
        const [p1, c1] = COLORS[i];
        const k = (t - p0) / (p1 - p0);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return COLORS[COLORS.length - 1][1];
  };
  const S = 3.0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * S;
      const v = (y / N) * S;
      const wx = u + 0.7 * warp(u * 0.7 + 5, v * 0.7);
      const wy = v + 0.7 * warp(u * 0.7, v * 0.7 + 9);
      const f = fbm(field, wx, wy, 4);
      let [r, g, b] = ramp(f);
      const bloom = Math.max(0, fbm(bloomN, wx * 1.6 + 3, wy * 1.6, 3) - 0.55) * 1.7;
      r = r * (1 - bloom) + 70 * bloom;
      g = g * (1 - bloom) + 210 * bloom;
      b = b * (1 - bloom) + 200 * bloom;
      const i = (y * N + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  nebulaCache = cv;
  return cv;
}

/** Named palette maps. "gradient" kinds are stop presets; "image" kinds are true 2-D maps. */
export const PALETTE_MAPS: Record<string, PaletteMapDef> = {
  nebula: { label: "Nebula (2D)", kind: "image", build: buildNebulaCanvas },
  sunset: {
    label: "Sunset",
    kind: "gradient",
    stops: mk([["#3b1c6b", 0], ["#8b2fa0", 0.3], ["#e0457a", 0.56], ["#ff7a3d", 0.8], ["#ffd166", 1]]),
    edgeColor: "#2a1a6b",
    edgeAmount: 0.3,
  },
  aurora: {
    label: "Aurora",
    kind: "gradient",
    stops: mk([["#0b3d4f", 0], ["#1fb89e", 0.3], ["#5ee0a0", 0.52], ["#4d8ef0", 0.76], ["#9b5de5", 1]]),
    edgeColor: "#0a2540",
    edgeAmount: 0.35,
  },
  ocean: {
    label: "Ocean",
    kind: "gradient",
    stops: mk([["#0a1f4d", 0], ["#1f6fb8", 0.36], ["#2bd0d0", 0.66], ["#a8f0e2", 1]]),
    edgeColor: "#061233",
    edgeAmount: 0.4,
  },
  ember: {
    label: "Ember",
    kind: "gradient",
    stops: mk([["#2a0707", 0], ["#a81e1e", 0.34], ["#ff5a2e", 0.64], ["#ffd24a", 1]]),
    edgeColor: "#150404",
    edgeAmount: 0.28,
  },
  iris: {
    label: "Iris",
    kind: "gradient",
    stops: mk([["#2e1065", 0], ["#7c3aed", 0.34], ["#db2777", 0.64], ["#f5b8f0", 1]]),
    edgeColor: "#1a0840",
    edgeAmount: 0.35,
  },
  mono: {
    label: "Mono",
    kind: "gradient",
    stops: mk([["#16161e", 0], ["#6b7280", 0.4], ["#c2c8d2", 0.72], ["#f6f8fb", 1]]),
    edgeColor: "#0a0a12",
    edgeAmount: 0.2,
  },
};

/** The canvas for a named map (its 2-D image, or its stops+edge gradient). */
export function paletteMapCanvas(def: PaletteMapDef): HTMLCanvasElement {
  if (def.build) return def.build();
  return buildPaletteCanvas({ stops: def.stops ?? [], edgeColor: def.edgeColor ?? "#8e9dff", edgeAmount: def.edgeAmount ?? 0 });
}

/** Load an arbitrary image (URL or object-URL) as a palette texture — "bring your own map". */
export function loadPaletteImage(url: string): THREE.Texture {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  return tex;
}
