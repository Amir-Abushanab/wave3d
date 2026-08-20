/**
 * Thumbnails for the per-wave "preset style" dust picker.
 *
 * A particle style is mostly colour + sprite shape + density, none of which a text list conveys —
 * "Embers" and "Sparks" read identically as words and nothing alike on screen. So each option gets
 * a small canvas: a seeded scatter of that style's own sprites, drawn additively on a dark ground
 * the way the renderer composites them.
 *
 * This is a LIKENESS, not the real thing: the GPU field spawns on a deformed wave surface and
 * animates from `uTime`, none of which belongs in a 44x20 swatch. It reproduces what actually
 * distinguishes the styles in the list — the two colours, the sprite shape, and roughly how dense
 * and how large the motes are.
 */
import type { ParticlesConfig } from "@wave3d/core";

/** Deterministic PRNG (mulberry32), so a given style always draws the identical swatch — the list
 *  is rebuilt on every open, and motes that jumped around would read as a rendering glitch. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 88; // 2x the 44x20 CSS swatch, so it stays crisp on hi-dpi
const H = 40;
const GROUND = "#0b0d14"; // the dark ground additive dust is designed against

/** Draw one mote in `shape` at (x, y). Sizes are already in canvas pixels. */
function drawMote(
  ctx: CanvasRenderingContext2D,
  shape: string,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  switch (shape) {
    case "ring": {
      ctx.lineWidth = Math.max(0.6, r * 0.34);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    case "star": {
      // Four tapered spikes — the same cross the fragment shader's `star` branch builds.
      ctx.lineWidth = Math.max(0.6, r * 0.3);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
      ctx.stroke();
      return;
    }
    case "streak": {
      // A comet: elongated along its travel, which in the swatch is simply horizontal.
      ctx.lineWidth = Math.max(0.7, r * 0.7);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - r * 1.6, y);
      ctx.lineTo(x + r * 1.6, y);
      ctx.stroke();
      return;
    }
    default: {
      // glitter / soft / sprite — a soft additive disc. "soft" is the more diffuse of the two, and
      // an uploaded sprite has no stand-in here, so it borrows the same dot.
      const spread = shape === "soft" ? 1.7 : 1.2;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * spread);
      g.addColorStop(0, color);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * spread, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** A small swatch previewing one dust style. Pure function of `cfg` — same style, same pixels. */
export function buildParticleStyleCanvas(cfg: ParticlesConfig): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, W, H);

  const shape = cfg.shape ?? "glitter";
  const colors = [cfg.color ?? "#ffcf8a", cfg.color2 ?? cfg.color ?? "#ffcf8a"];
  // Map the field's own count/size onto a swatch-sized scatter. Both are compressed hard: real
  // counts run to 20k and would just fill the box, so this preserves the ORDER (Fireflies sparse,
  // Glitter dense) rather than the absolute number.
  const dots = Math.round(Math.min(46, 8 + Math.sqrt(cfg.count) * 0.32));
  const base = Math.min(3.4, Math.max(0.9, cfg.size * 0.38));

  const rand = mulberry32((cfg.seed || 1) * 2654435761);
  ctx.globalCompositeOperation = "lighter"; // additive, like the field itself
  for (let i = 0; i < dots; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const jitter = 1 + (cfg.sizeJitter ?? 0) * (rand() - 0.5) * 2;
    const r = Math.max(0.5, base * jitter);
    drawMote(ctx, shape, x, y, r, colors[rand() < 0.5 ? 0 : 1]);
  }
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}
