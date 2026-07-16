import * as THREE from "three";
import { clamp01 } from "../util/math";
import { createDefaultMeshPoints } from "../config/model";
import type {
  BackgroundImageFit,
  BasicGradientType,
  ColorStop,
  MeshGradientPoint,
} from "../config/model";

/**
 * Bakes the gradient stops into a 2D palette texture, sampled in the shader as
 * `texture2D(u_paletteTexture, vec2(uv.x, uv.y))`. The texture is a real image, so
 * colour can vary independently along BOTH axes:
 *   - X (uv.x, along the length): the gradient stops.
 *   - Y (uv.y, across the width): an "edge tint" blended toward both long edges
 */

const TEX_W = 256; // resolution along the gradient (length)
const TEX_H = 64; // resolution across the width

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
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

/** Sampling config shared by every palette-texture source (canvas, image, LUT, video):
 *  sRGB (the GPU linearizes on sample), linear filtering, clamped edges, no mipmaps. */
export function configurePaletteTexture<T extends THREE.Texture>(tex: T): T {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  return tex;
}

/** Wrap a canvas as a sampling-ready CanvasTexture. */
export function canvasToTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  return configurePaletteTexture(new THREE.CanvasTexture(canvas));
}

/** Build a ready-to-use CanvasTexture from gradient stops + edge tint. */
export function buildPaletteTexture(opts: PaletteTextureOptions): THREE.CanvasTexture {
  return canvasToTexture(buildPaletteCanvas(opts));
}

export interface BackgroundGradientOptions {
  stops: ColorStop[];
  type: BasicGradientType;
  angle: number;
  width: number;
  height: number;
}

/** Draw an export-ready linear, radial, or conic background gradient. */
export function buildBackgroundGradientCanvas(opts: BackgroundGradientOptions): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(opts.width));
  canvas.height = Math.max(1, Math.round(opts.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const { width, height } = canvas;
  const cx = width / 2;
  const cy = height / 2;
  const angle = (opts.angle * Math.PI) / 180;
  let gradient: CanvasGradient;
  if (opts.type === "radial") {
    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(cx, cy));
  } else if (opts.type === "conic") {
    gradient = ctx.createConicGradient(angle, cx, cy);
  } else {
    const radius = Math.abs(Math.sin(angle)) * cx + Math.abs(Math.cos(angle)) * cy;
    const dx = Math.sin(angle) * radius;
    const dy = -Math.cos(angle) * radius;
    gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  }

  const stops = [...opts.stops].sort((a, b) => a.pos - b.pos);
  if (stops.length === 0) gradient.addColorStop(0, "#ffffff");
  else for (const stop of stops) gradient.addColorStop(clamp01(stop.pos), stop.color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

/** Linear (0–1) → sRGB byte (0–255). */
function linearToSrgbByte(linear: number): number {
  const c = clamp01(linear);
  const srgb = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(clamp01(srgb) * 255);
}

/**
 * The single source of truth for mesh-gradient rendering — shared by the background
 * (buildBackgroundMeshCanvas) and the on-canvas MeshGradientEditor preview, and mirroring the
 * wave's meshGradient shader. An inverse-distance-weighted blend of coloured points, computed in
 * LINEAR RGB with y measured UP (point.y = 1 is the top). Returns an ImageData to putImageData
 * onto any 2D context.
 */
export function renderMeshGradient(
  points: MeshGradientPoint[],
  softness: number,
  width: number,
  height: number,
): ImageData {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const image = new ImageData(w, h);
  const data = image.data;
  const pts = points.length >= 2 ? points : createDefaultMeshPoints();
  const colors = pts.map((p) => new THREE.Color(p.color)); // .r/.g/.b are LINEAR
  const exponent = 4.8 + (1.35 - 4.8) * clamp01(softness);
  for (let py = 0; py < h; py++) {
    const y = 1 - py / Math.max(1, h - 1);
    for (let px = 0; px < w; px++) {
      const x = px / Math.max(1, w - 1);
      let r = 0;
      let g = 0;
      let b = 0;
      let weightSum = 0;
      for (let i = 0; i < pts.length; i++) {
        const influence = Math.max(pts[i].influence, 0.05);
        const distance = Math.hypot(x - pts[i].x, y - pts[i].y) / influence;
        const weight = 1 / (Math.pow(Math.max(distance, 0.012), exponent) + 0.002);
        r += colors[i].r * weight;
        g += colors[i].g * weight;
        b += colors[i].b * weight;
        weightSum += weight;
      }
      const iw = Math.max(weightSum, 0.0001);
      const off = (py * w + px) * 4;
      data[off] = linearToSrgbByte(r / iw);
      data[off + 1] = linearToSrgbByte(g / iw);
      data[off + 2] = linearToSrgbByte(b / iw);
      data[off + 3] = 255;
    }
  }
  return image;
}

/**
 * Draw a mesh-gradient background. Mesh gradients are low-frequency, so we render at a small
 * internal size (capped ~320 px) via renderMeshGradient and scale up smoothly.
 */
export function buildBackgroundMeshCanvas(
  points: MeshGradientPoint[],
  softness: number,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const scale = Math.min(1, 320 / Math.max(canvas.width, canvas.height));
  const lw = Math.max(2, Math.round(canvas.width * scale));
  const lh = Math.max(2, Math.round(canvas.height * scale));
  const buf = document.createElement("canvas");
  buf.width = lw;
  buf.height = lh;
  const bctx = buf.getContext("2d");
  if (!bctx) return canvas;
  bctx.putImageData(renderMeshGradient(points, softness, lw, lh), 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(buf, 0, 0, lw, lh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Fit a built-in canvas or uploaded image into a background-sized canvas. */
export function buildBackgroundImageCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  fit: BackgroundImageFit,
  matte: string,
  zoom = 1,
  positionX = 0,
  positionY = 0,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  drawBackgroundMediaFrame(
    canvas,
    source,
    sourceWidth,
    sourceHeight,
    fit,
    matte,
    zoom,
    positionX,
    positionY,
  );
  return canvas;
}

/** Draw one image or video frame into an existing fitted background canvas. */
export function drawBackgroundMediaFrame(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  fit: BackgroundImageFit,
  matte: string,
  zoom = 1,
  positionX = 0,
  positionY = 0,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = matte;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const safeZoom = Math.max(0.1, zoom);
  const baseWidth =
    fit === "stretch"
      ? canvas.width
      : sourceWidth *
        (fit === "contain"
          ? Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight)
          : Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight));
  const baseHeight =
    fit === "stretch"
      ? canvas.height
      : sourceHeight *
        (fit === "contain"
          ? Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight)
          : Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight));
  const drawWidth = baseWidth * safeZoom;
  const drawHeight = baseHeight * safeZoom;
  const offsetX = (positionX / 100) * canvas.width;
  const offsetY = (positionY / 100) * canvas.height;
  ctx.drawImage(
    source,
    (canvas.width - drawWidth) / 2 + offsetX,
    (canvas.height - drawHeight) / 2 + offsetY,
    drawWidth,
    drawHeight,
  );
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
  build?: (resolution?: number) => HTMLCanvasElement;
}

const mk = (pairs: Array<[string, number]>): ColorStop[] =>
  pairs.map(([color, pos]) => ({ color, pos }));

// ---- A genuine 2-D image map (procedural nebula): organic colour patches that vary in
// BOTH axes via domain-warped value noise — the kind of thing flat stops can't make. ----

function valueNoise2D(seed: number): (x: number, y: number) => number {
  const hash = (x: number, y: number): number => {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = smoothstep(x - xi);
    const v = smoothstep(y - yi);
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

const nebulaCache = new Map<number, HTMLCanvasElement>();
function buildNebulaCanvas(resolution = 220): HTMLCanvasElement {
  const N = Math.max(64, Math.min(1280, Math.round(resolution)));
  const cached = nebulaCache.get(N);
  if (cached) return cached;
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
    t = clamp01(t);
    for (let i = 1; i < COLORS.length; i++) {
      if (t <= COLORS[i][0]) {
        const [p0, c0] = COLORS[i - 1];
        const [p1, c1] = COLORS[i];
        const k = (t - p0) / (p1 - p0);
        return [
          c0[0] + (c1[0] - c0[0]) * k,
          c0[1] + (c1[1] - c0[1]) * k,
          c0[2] + (c1[2] - c0[2]) * k,
        ];
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
  nebulaCache.set(N, cv);
  return cv;
}

const imageMapCache = new Map<string, HTMLCanvasElement>();

function cachedImageMap(
  id: string,
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): HTMLCanvasElement {
  const cacheKey = `${id}|${width}x${height}`;
  const cached = imageMapCache.get(cacheKey);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) paint(ctx, width, height);
  imageMapCache.set(cacheKey, canvas);
  return canvas;
}

function buildVaporwaveCanvas(resolution = 240): HTMLCanvasElement {
  const width = Math.max(120, Math.min(2048, Math.round(resolution)));
  const height = Math.round((width * 2) / 3);
  return cachedImageMap("vaporwave", width, height, (ctx, canvasWidth, canvasHeight) => {
    const unit = canvasWidth / 240;
    const sky = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    sky.addColorStop(0, "#120638");
    sky.addColorStop(0.56, "#8e2de2");
    sky.addColorStop(1, "#ff2fa8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const sunY = canvasHeight * 0.48;
    const sunRadius = canvasHeight * 0.28;
    const sun = ctx.createLinearGradient(0, sunY - sunRadius, 0, sunY + sunRadius);
    sun.addColorStop(0, "#fff66d");
    sun.addColorStop(1, "#ff5cbe");
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(canvasWidth / 2, sunY, sunRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#3b126c";
    for (let y = sunY + 3 * unit; y < sunY + sunRadius; y += 9 * unit) {
      ctx.fillRect(canvasWidth / 2 - sunRadius, y, sunRadius * 2, 4 * unit);
    }

    const horizon = canvasHeight * 0.72;
    ctx.fillStyle = "#09051f";
    ctx.fillRect(0, horizon, canvasWidth, canvasHeight - horizon);
    ctx.strokeStyle = "#19e3ff";
    ctx.lineWidth = Math.max(1, unit);
    ctx.globalAlpha = 0.72;
    for (let x = -canvasWidth; x <= canvasWidth * 2; x += canvasWidth / 12) {
      ctx.beginPath();
      ctx.moveTo(canvasWidth / 2, horizon);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }
    for (let row = 0; row < 7; row++) {
      const t = row / 6;
      const y = horizon + (canvasHeight - horizon) * t * t;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

function buildKaleidoscopeCanvas(resolution = 220): HTMLCanvasElement {
  const size = Math.max(110, Math.min(2048, Math.round(resolution)));
  return cachedImageMap("kaleidoscope", size, size, (ctx, width, height) => {
    const unit = width / 220;
    const colors = ["#00e5ff", "#6c3bff", "#ff2ca8", "#ff7a00", "#ffe600", "#16f7a6"];
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.hypot(width, height);
    const slices = 24;
    for (let i = 0; i < slices; i++) {
      const a0 = (i / slices) * Math.PI * 2;
      const a1 = ((i + 1) / slices) * Math.PI * 2;
      ctx.fillStyle = colors[(i * 5) % colors.length];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius);
      ctx.lineTo(cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius);
      ctx.closePath();
      ctx.fill();
    }
    for (let ring = 1; ring <= 4; ring++) {
      ctx.strokeStyle = ring % 2 ? "rgba(255,255,255,.55)" : "rgba(8,5,35,.6)";
      ctx.lineWidth = 5 * unit;
      ctx.beginPath();
      ctx.arc(cx, cy, ring * 25 * unit, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/** Named palette maps. "gradient" kinds are stop presets; "image" kinds are true 2-D maps. */
export const PALETTE_MAPS: Record<string, PaletteMapDef> = {
  palestine: {
    label: "Palestine",
    kind: "gradient",
    stops: mk([
      ["#000000", 0],
      ["#f7f7f2", 0.34],
      ["#149954", 0.67],
      ["#e4312b", 1],
    ]),
    edgeColor: "#e4312b",
    edgeAmount: 0.22,
  },
  spain: {
    label: "Spain",
    kind: "gradient",
    stops: mk([
      ["#aa151b", 0], // crimson — top stripe
      ["#aa151b", 0.24], // hold the red band
      ["#f1bf00", 0.34], // into gold
      ["#f1bf00", 0.66], // hold the wide gold band (middle 50%)
      ["#aa151b", 0.76], // back to red
      ["#aa151b", 1], // crimson — bottom stripe
    ]),
    edgeColor: "#7a0f14", // deep oxblood edge tint (mirrors Palestine's red edge)
    edgeAmount: 0.22,
  },
  grandLine: {
    label: "Grand Line",
    kind: "gradient",
    stops: mk([
      ["#071b33", 0],
      ["#087ea4", 0.22],
      ["#45d4c5", 0.4],
      ["#f4d35e", 0.58],
      ["#f2b84b", 0.72],
      ["#d62828", 0.86],
      ["#18130f", 1],
    ]),
    edgeColor: "#061426",
    edgeAmount: 0.28,
  },
  vaporwave: { label: "Vaporwave Sunset", kind: "image", build: buildVaporwaveCanvas },
  kaleidoscope: { label: "Kaleidoscope", kind: "image", build: buildKaleidoscopeCanvas },
  nebula: { label: "Nebula (2D)", kind: "image", build: buildNebulaCanvas },
  sunset: {
    label: "Sunset",
    kind: "gradient",
    stops: mk([
      ["#3b1c6b", 0],
      ["#8b2fa0", 0.3],
      ["#e0457a", 0.56],
      ["#ff7a3d", 0.8],
      ["#ffd166", 1],
    ]),
    edgeColor: "#2a1a6b",
    edgeAmount: 0.3,
  },
  aurora: {
    label: "Aurora",
    kind: "gradient",
    stops: mk([
      ["#0b3d4f", 0],
      ["#1fb89e", 0.3],
      ["#5ee0a0", 0.52],
      ["#4d8ef0", 0.76],
      ["#9b5de5", 1],
    ]),
    edgeColor: "#0a2540",
    edgeAmount: 0.35,
  },
  ocean: {
    label: "Ocean",
    kind: "gradient",
    stops: mk([
      ["#0a1f4d", 0],
      ["#1f6fb8", 0.36],
      ["#2bd0d0", 0.66],
      ["#a8f0e2", 1],
    ]),
    edgeColor: "#061233",
    edgeAmount: 0.4,
  },
  ember: {
    label: "Ember",
    kind: "gradient",
    stops: mk([
      ["#2a0707", 0],
      ["#a81e1e", 0.34],
      ["#ff5a2e", 0.64],
      ["#ffd24a", 1],
    ]),
    edgeColor: "#150404",
    edgeAmount: 0.28,
  },
  iris: {
    label: "Iris",
    kind: "gradient",
    stops: mk([
      ["#2e1065", 0],
      ["#7c3aed", 0.34],
      ["#db2777", 0.64],
      ["#f5b8f0", 1],
    ]),
    edgeColor: "#1a0840",
    edgeAmount: 0.35,
  },
  mono: {
    label: "Mono",
    kind: "gradient",
    stops: mk([
      ["#16161e", 0],
      ["#6b7280", 0.4],
      ["#c2c8d2", 0.72],
      ["#f6f8fb", 1],
    ]),
    edgeColor: "#0a0a12",
    edgeAmount: 0.2,
  },
};

/** The canvas for a named map (its 2-D image, or its stops+edge gradient). */
export function paletteMapCanvas(def: PaletteMapDef, resolution?: number): HTMLCanvasElement {
  if (def.build) return def.build(resolution);
  return buildPaletteCanvas({
    stops: def.stops ?? [],
    edgeColor: def.edgeColor ?? "#8e9dff",
    edgeAmount: def.edgeAmount ?? 0,
  });
}

/** Load an arbitrary image (URL or object-URL) as a palette texture — "bring your own map". */
export function loadPaletteImage(url: string): THREE.Texture {
  return configurePaletteTexture(new THREE.TextureLoader().load(url));
}
