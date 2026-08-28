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
import { WaveRendererGPU } from "../src/renderer/WaveRendererGPU";
import { PRESETS } from "../src/presets";
import { ensureStudioConfig, type StudioConfig } from "../src/config/model";
import { wavePointerFxActive } from "../src/renderer/interaction";

const galleryModules = import.meta.glob<{ default: { title?: string; config: unknown } }>(
  "../../../gallery/waves/*.json",
  { eager: true },
);

/**
 * Synthetic configs covering shipped features no preset happens to exercise.
 *
 * The pointer field is the important one: it is a whole shader path (agitation, membrane push,
 * drag wake, click ripples, plus the fragment's local hue / lighten / thinning) that no preset
 * turns on, so without this it would compile and never be compared against the GLSL.
 */
const withPointer =
  (ripple: number): (() => StudioConfig) =>
  () => {
    const c = PRESETS.Hero();
    c.waves[0].interaction = {
      hover: { agitate: 3, push: 2.5, wake: 1.5, thin: 0.35, hueShift: 40, lighten: 0.4 },
      ...(ripple > 0 ? { press: { ripple } } : {}),
    };
    return c;
  };

/**
 * One wave, one dust field, every motion term off unless the case turns it on.
 *
 * Particle Zoo stacks five waves with five different shapes and all four motion styles at once, so
 * a mismatch there says nothing about WHICH part is wrong. These isolate one variable each.
 */
const withParticles =
  ({
    bloom = false,
    waves = 1,
    ...over
  }: Record<string, unknown> & { bloom?: boolean; waves?: number }): (() => StudioConfig) =>
  () => {
    const c = PRESETS.Hero();
    // A DARK background, deliberately. Additive dust on white saturates and clips, so a field that
    // renders nothing at all still compares as a perfect match — which is exactly what happened,
    // and it hid a completely broken per-instance accessor behind nine passing cases.
    c.background = "#05070d";
    c.transparentBackground = false;
    while (c.waves.length < waves) c.waves.push(structuredClone(c.waves[0]));
    c.waves.length = waves;
    c.waves.forEach((w, i) => {
      w.seed = i * 3.7; // otherwise every copy is the same ribbon in the same place
    });
    // Bloom is off by default here: it smears any difference across the whole frame, which is
    // exactly what makes it useful as its own case rather than a constant.
    //
    // Destructured, NOT deleted off `over`. This factory is called once per backend, so mutating
    // the captured object made the second call see different settings from the first — i.e. it
    // compared bloom against no-bloom and blamed the difference on the port.
    // 0.12, not a larger value: at high strength the dust blows the whole frame out to a flat
    // white, and two identical blank images compare perfectly while testing nothing.
    c.bloomStrength = bloom ? 0.12 : 0;
    const particles = {
      count: 4000,
      seed: 7,
      size: 6,
      life: 6,
      speed: 1,
      color: "#ffcf8a",
      shape: "glitter",
      drift: 0,
      rise: 0,
      swirl: 0,
      wander: 0,
      sizeJitter: 0,
      twinkle: 0,
      ...over,
    } as StudioConfig["waves"][number]["particles"];
    for (const w of c.waves) w.particles = structuredClone(particles);
    return c;
  };

function syntheticConfigs(): Record<string, () => StudioConfig> {
  return {
    "synthetic:pointer-hover": withPointer(0),
    "synthetic:pointer-ripples": withPointer(2),
    // The emitter alone: no motion, no jitter, no twinkle. Anything wrong here is spawn or size.
    "synthetic:dust-static": withParticles({}),
    "synthetic:dust-drift": withParticles({ drift: 60 }),
    "synthetic:dust-swirl": withParticles({ swirl: 0.3, drift: 20 }),
    "synthetic:dust-wander": withParticles({ wander: 25, drift: 10 }),
    "synthetic:dust-jitter": withParticles({ sizeJitter: 0.8, twinkle: 0.7, drift: 20 }),
    // One per procedural shape, to pin the shape select and its uv orientation. "streak" is the
    // only one that is not symmetric about Y, so it is the one that catches a flipped point coord.
    "synthetic:dust-soft": withParticles({ shape: "soft" }),
    "synthetic:dust-ring": withParticles({ shape: "ring" }),
    "synthetic:dust-star": withParticles({ shape: "star" }),
    "synthetic:dust-streak": withParticles({ shape: "streak", drift: 60 }),
    // Dust feeding bloom. Additive glints are the brightest thing in any frame, so they sit right
    // on the bloom threshold — this is where a sub-quantisation difference gets amplified.
    "synthetic:dust-bloom": withParticles({ drift: 30, bloom: true }),
    // The same case with far less additive accumulation, so nothing exceeds 1.0. Values above 1
    // clamp identically on output, so an HDR difference is INVISIBLE until bloom reads it back —
    // which is why the bright and dim variants are both kept.
    // Particle Zoo's largest field, reproduced exactly: 16k motes at 3.6 px with almost no drift,
    // so they pile up on the ribbon. Dense overlap is where a small per-particle energy difference
    // compounds into a visible one — and it is invisible without bloom, because everything above
    // 1.0 clamps to the same white.
    "synthetic:dust-dense": withParticles({
      shape: "soft",
      count: 16000,
      size: 3.6,
      drift: 5.2,
      bloom: true,
    }),
    // Particle Zoo's SHAPE: five waves each shedding a dense field, all feeding bloom. The
    // per-wave precision floor accumulates across the stack and bloom then amplifies whatever is
    // left, so this is the case that says whether that preset's residual is structural.
    "synthetic:dust-stack": withParticles({
      shape: "soft",
      count: 12000,
      size: 3.6,
      drift: 5.2,
      bloom: true,
      waves: 5,
    }),
    "synthetic:dust-bloom-dim": withParticles({
      drift: 30,
      bloom: true,
      count: 300,
      size: 3,
      color: "#303030",
    }),
  };
}

/** Every config under test: the 17 shipped presets, the gallery entries, and the synthetics. */
function allConfigs(): Record<string, () => StudioConfig> {
  const out: Record<string, () => StudioConfig> = {};
  for (const [name, make] of Object.entries(PRESETS)) out[`preset:${name}`] = make;
  Object.assign(out, syntheticConfigs());
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
  /**
   * Zero every post-chain effect (blur, grain, bloom, dither, …), leaving just the wave material.
   * Diagnostic only: it splits "the shader is wrong" from "the post chain is wrong", which are very
   * different bugs that look identical in a whole-frame diff.
   */
  noPost?: boolean;
  /** Pin the pointer field to fixed values, so the interaction shader path can be compared. */
  pointer?: FixedPointer;
  /**
   * Arbitrary config overrides applied after `noPost`, so one effect can be isolated
   * (`{ grain: 0 }` leaves blur running, and vice versa).
   */
  overrides?: Record<string, number | string | boolean>;
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
  if (opts.noPost) {
    config.blur = 0;
    config.grain = 0;
    config.bloomStrength = 0; // NOT `bloom` — that key does not exist, and silently did nothing
    config.dither = 0;
    config.innerLight = 0;
    config.halftone = 0;
    config.heatmap = 0;
    config.paperTexture = 0;
    config.halftoneCmyk = 0;
  }
  for (const [k, v] of Object.entries(opts.overrides ?? {})) {
    // Dotted paths, so a nested field can be isolated too (`interaction.enabled=false`).
    const path = k.split(".");
    let target = config as unknown as Record<string, unknown>;
    for (const step of path.slice(0, -1)) {
      if (typeof target[step] !== "object" || target[step] === null) target[step] = {};
      target = target[step] as Record<string, unknown>;
    }
    target[path[path.length - 1]] = v;
  }

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;height:${height}px`;
  document.body.appendChild(host);

  let renderer: WaveRenderer | undefined;
  try {
    const Backend = opts.backend === "webgpu" ? WaveRendererGPU : WaveRenderer;
    renderer = new Backend(host, config, { respectReducedMotion: false, skipIntroRamp: true });
    await renderer.init(); // no-op on WebGL; starts the backend on WebGPU
    renderer.setOutputSize(width, height); // forces DPR 1 — parity must not depend on the display
    // Two captures: the first lets any theme/blend program compile, the second is the settled frame
    // (the studio's thumbnail path does the same for the same reason).
    //
    // The pointer has to be re-pinned before EACH capture: captureImage's trailing renderOnce()
    // runs outside the capture guard, so applyInteraction() gets to zero the pointer uniforms back
    // to "no input" in between. Pinning only once silently measured a field that was never on.
    if (opts.pointer) applyFixedPointer(renderer, opts.pointer);
    await renderer.captureImage("image/png", false, undefined, opts.time ?? 0);
    if (opts.pointer) applyFixedPointer(renderer, opts.pointer);
    const blob = await renderer.captureImage("image/png", false, undefined, opts.time ?? 0);
    return await blobToDataUrl(blob);
  } finally {
    renderer?.dispose();
    host.remove();
  }
}

/**
 * Pin the pointer uniforms to fixed values on every wave.
 *
 * The live controller derives these from real input, which is not reproducible — and `captureImage`
 * deliberately calls `applyInteractionRest()`, which ZEROES pointer presence so a captured frame is
 * always "this config with no input". Both would erase whatever is written here, so the controller
 * is detached first. The wave config keeps its `interaction` block, so `wavePointerFxActive()` is
 * still true and the pointer shader path is still compiled — only the per-frame writes stop.
 *
 * Both backends read the same registry keys, so this drives the real uniforms rather than
 * re-implementing the effect.
 */
function applyFixedPointer(renderer: WaveRenderer, p: FixedPointer): void {
  (renderer as unknown as { interaction?: unknown }).interaction = undefined;
  for (const wave of (
    renderer as unknown as {
      waves: { material: { uniforms: Record<string, { value: unknown }> } }[];
    }
  ).waves) {
    const u = wave.material.uniforms;
    (u.uPointer.value as { set: (x: number, y: number) => void }).set(p.x, p.y);
    u.uPointerActive.value = 1;
    u.uPointerRadius.value = p.radius;
    (u.uPointerVel.value as { set: (x: number, y: number) => void }).set(p.vx, p.vy);
    // The EFFECT amplitudes, not just the cursor position. applyInteraction() normally derives
    // these from the wave's hover config; pinning only the position leaves every amplitude at zero,
    // which renders identically to no pointer at all.
    u.uPointerAgitate.value = 3;
    u.uPointerPush.value = 2.5;
    u.uPointerWake.value = 1.5;
    u.uPointerThin.value = 0.35;
    u.uPointerHue.value = 40;
    u.uPointerLighten.value = 0.4;
    u.uShapeFlow.value = 0.5;
    u.uPointerRipple.value = p.ripple ? 2 : 0;
    if (p.ripple) {
      (u.uRippleOrigin.value as { set: (x: number, y: number) => void }[])[0].set(p.x, p.y);
      (u.uRippleAge.value as number[])[0] = 0.35;
      (u.uRippleAmp.value as number[])[0] = 1;
    }
  }
}

export interface FixedPointer {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  ripple?: boolean;
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
  /** Share of pixels sitting on a silhouette (see `edgeMask`), excluded from the `interior*` figures. */
  pctEdge: number;
  /** `pctOver8` over non-silhouette pixels only — the number that reflects shading fidelity. */
  interiorOver8: number;
  /** `pctOver24` over non-silhouette pixels only. */
  interiorOver24: number;
  /**
   * Mean SIGNED per-channel difference over interior pixels, as [r,g,b,a].
   *
   * Distinguishes the two failure shapes that look identical in an amplified diff: values near zero
   * mean the disagreement is symmetric — high-frequency noise landing on either side, which is
   * expected when a fiber texture is sampled at ~600x frequency and the two backends' interpolation
   * differs in the last bit. A consistent bias means something systematic is wrong instead.
   */
  interiorBias: [number, number, number, number];
  /** Amplified difference image, for eyeballing a failure. */
  diffPng: string;
}

/**
 * Mark pixels lying on a coverage boundary — anywhere the reference's alpha jumps between
 * neighbours.
 *
 * Two rasterisers disagree at a silhouette for reasons that have nothing to do with the shader:
 * which samples a triangle covers on a given edge is not specified to the last pixel. Those pixels
 * are reported separately so a real shading regression cannot hide behind them, and so an edge
 * difference cannot fail the gate on its own.
 */
function edgeMask(img: ImageData): Uint8Array {
  const { width: w, height: h, data } = img;
  const mask = new Uint8Array(w * h);
  // Gradient over RGB *and* alpha: a capture composited onto an opaque background has uniform
  // alpha, so the silhouette shows up only as a colour step.
  const stepBetween = (x0: number, y0: number, x1: number, y1: number) => {
    const i = (y0 * w + x0) * 4;
    const j = (y1 * w + x1) * 4;
    let m = 0;
    for (let k = 0; k < 4; k++) m = Math.max(m, Math.abs(data[i + k] - data[j + k]));
    return m;
  };
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (stepBetween(x, y, x + dx, y + dy) > 24) {
            edge = true;
            break;
          }
        }
      }
      if (edge) {
        // Dilate by one: a boundary pixel's immediate neighbours inherit the disagreement.
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) mask[(y + dy) * w + (x + dx)] = 1;
        }
      }
    }
  }
  return mask;
}

/** Compare two PNG data URLs. Amplifies the delta 8x into `diffPng` so small drifts stay visible. */
async function diff(aUrl: string, bUrl: string): Promise<DiffResult> {
  const [a, b] = await Promise.all([toImageData(aUrl), toImageData(bUrl)]);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const out = new ImageData(a.width, a.height);
  const mask = edgeMask(a);
  let sum = 0;
  let maxDelta = 0;
  let over8 = 0;
  let over24 = 0;
  let edgeCount = 0;
  let interiorOver8 = 0;
  let interiorOver24 = 0;
  const bias = [0, 0, 0, 0];
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
    if (mask[i >> 2]) {
      edgeCount++;
    } else {
      if (pixelMax > 8) interiorOver8++;
      if (pixelMax > 24) interiorOver24++;
      for (let k = 0; k < 4; k++) bias[k] += b.data[i + k] - a.data[i + k];
    }
    const amp = Math.min(255, pixelMax * 8);
    out.data[i] = amp;
    out.data[i + 1] = amp > 0 ? 255 - amp : 0;
    out.data[i + 2] = 0;
    out.data[i + 3] = 255;
  }
  const c = new OffscreenCanvas(a.width, a.height);
  c.getContext("2d")!.putImageData(out, 0, 0);
  const diffPng = await blobToDataUrl(await c.convertToBlob({ type: "image/png" }));
  const interior = Math.max(1, px - edgeCount);
  return {
    width: a.width,
    height: a.height,
    mae: sum / (px * 4),
    maxDelta,
    pctOver8: (over8 / px) * 100,
    pctOver24: (over24 / px) * 100,
    pctEdge: (edgeCount / px) * 100,
    interiorOver8: (interiorOver8 / interior) * 100,
    interiorOver24: (interiorOver24 / interior) * 100,
    interiorBias: bias.map((v) => v / interior) as [number, number, number, number],
    diffPng,
  };
}

declare global {
  interface Window {
    waveParity: {
      names: () => string[];
      features: () => string;
      inspect: (name: string) => string;
      render: typeof render;
      diff: typeof diff;
      ready: true;
    };
  }
}

window.waveParity = {
  names: () => Object.keys(CONFIGS),
  /** Diagnostic: what the resolved config says about background and post, for one config. */
  inspect: (name: string) => {
    const c = CONFIGS[name]();
    return JSON.stringify(
      {
        backgroundMode: c.backgroundMode,
        background: c.background,
        transparentBackground: c.transparentBackground,
        backgroundPalette: c.backgroundPalette?.length,
        bloomStrength: c.bloomStrength,
        innerLight: c.innerLight,
        blur: c.blur,
        grain: c.grain,
        waves: c.waves?.length,
        waveInteraction: JSON.stringify(c.waves?.[0]?.interaction ?? null),
        shapes: (c.waves ?? []).map(
          (w) =>
            `${w.theme ?? "solid"}/${w.blendMode ?? "squared"} radial=${w.radialAmount ?? 0} helix=${w.helixRadius ?? 0}/${w.helixRoll ?? 0} detail=${w.detailAmount ?? 0} twistMotion=${!!w.twistMotion} depthTint=${w.depthTint ?? 0} edgeFeather=${w.edgeFeather ?? 0.1}`,
        ),
        particles: (c.waves ?? []).map((w) =>
          w.particles
            ? `${w.particles.shape}/${w.particles.count}@${w.particles.size}px drift=${w.particles.drift}`
            : "-",
        ),
        pointerFxActive: c.waves?.[0] ? wavePointerFxActive(c, c.waves[0]) : null,
      },
      null,
      1,
    );
  },
  /** Diagnostic: per-config feature summary, for correlating parity failures against features. */
  features: () =>
    Object.entries(CONFIGS)
      .map(([name, make]) => {
        const c = make();
        const w = c.waves ?? [];
        return `${name.padEnd(34)} waves=${w.length} themes=${[...new Set(w.map((x) => x.theme ?? "solid"))].join("/")} blend=${[...new Set(w.map((x) => x.blendMode ?? "squared"))].join("/")} grad=${[...new Set(w.map((x) => x.gradientType ?? "linear"))].join("/")}`;
      })
      .join("\n"),
  render,
  diff,
  ready: true,
};
