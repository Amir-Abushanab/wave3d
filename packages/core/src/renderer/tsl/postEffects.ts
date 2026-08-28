/**
 * The optional post effects, in TSL — ports of the layered passes in `../shaders.ts`.
 *
 * On the WebGL path each of these is a `ShaderPass` with its own render target, so it can sample
 * the previous stage at ANY coordinate (`texture2D(tDiffuse, someOtherUv)`). A node graph has no
 * such target by default: a composed node is an expression evaluated at the current fragment, and
 * cannot be sampled elsewhere. Every effect below that reads an offset coordinate — the light
 * march, the halftone cell centre, the dither block centre — therefore takes a TEXTURE node, and
 * the chain in `postChain.ts` materialises the preceding stage with `convertToTexture()`.
 *
 * Effects that only read the current fragment (heatmap, paper texture, CMYK halftone) take a plain
 * colour node and cost nothing extra.
 */
import {
  Fn,
  Loop,
  float,
  int,
  vec2,
  vec3,
  vec4,
  mat2,
  cos,
  sin,
  exp,
  max,
  mix,
  clamp,
  floor,
  fract,
  sqrt,
  dot,
  length,
  smoothstep,
  fwidth,
  uv,
  uniformArray,
  screenSize,
  transpose,
} from "three/tsl";
import type { FloatNode, FloatUniform, Vec2Node, Vec2Uniform, Vec3Node, Vec4Node } from "./types";

/** A stage that can be sampled at an arbitrary uv (i.e. backed by a render target). */
export type Sampler = (at: Vec2Node) => Vec4Node;

/** Rec.709 luminance, as the GLSL `luma`. */
const luma = (c: Vec3Node): FloatNode => dot(c, vec3(0.2126, 0.7152, 0.0722));

/**
 * The fragment coordinate in the GLSL convention (origin BOTTOM-left).
 *
 * `screenCoordinate` follows WebGPU's top-left origin and flips Y on WebGL to match, so every
 * effect keyed off `gl_FragCoord` has to flip back or its pattern lands mirrored. Screen-space
 * dot grids and dither matrices are extremely visible when they do.
 */
export function fragCoord(screenCoordinate: Vec2Node): Vec2Node {
  return vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y));
}

// ---- innerLight: radial light scattering (GPU Gems 3 style) ---------------------------------

const LIGHT_SAMPLES = 24;

export interface InnerLightUniforms {
  uInnerLight: FloatUniform;
  uInnerLightDensity: FloatUniform;
  uInnerLightDecay: FloatUniform;
  uInnerLightCenter: Vec2Uniform;
}

/**
 * March from each pixel toward the light point, accumulating the wave's own brightness weighted by
 * alpha (so only opaque pixels emit), then add the streaks back. Runs in the scene zone, so it
 * scatters the raw pre-tone-map wave the way bloom does.
 */
export function innerLight(sample: Sampler, u: InnerLightUniforms): Vec4Node {
  return Fn(() => {
    const vUv = uv();
    const src = sample(vUv).toVar("ilSrc");
    const delta = vUv
      .sub(u.uInnerLightCenter)
      .mul(u.uInnerLightDensity.div(LIGHT_SAMPLES))
      .toVar("ilDelta");
    const coord = vUv.toVar("ilCoord");
    const decay = float(1).toVar("ilDecay");
    const rays = vec3(0).toVar("ilRays");
    Loop({ start: 0, end: LIGHT_SAMPLES, type: "int" }, () => {
      coord.subAssign(delta);
      const s = sample(coord).toVar();
      rays.addAssign(s.rgb.mul(s.a).mul(decay)); // only opaque (wave) pixels emit light
      decay.mulAssign(u.uInnerLightDecay);
    });
    rays.divAssign(float(LIGHT_SAMPLES));
    const outc = src.rgb.add(rays.mul(u.uInnerLight));
    // Shafts stay visible over a transparent background.
    const outA = max(src.a, luma(rays).mul(u.uInnerLight));
    return vec4(outc, clamp(outA, 0, 1));
  })();
}

// ---- halftone: rotated dot screen -------------------------------------------------------------

export interface HalftoneUniforms {
  uHalftone: FloatUniform;
  uHalftoneCell: FloatUniform;
  uHalftoneAngle: FloatUniform;
}

const sigmoid = (x: FloatNode, k: number): FloatNode =>
  float(1).div(float(1).add(exp(x.sub(0.5).mul(-k))));

/** paper's classic dot: radius grows as the sampled cell darkens, soft edge via fwidth. */
const getCircle = (cellUv: Vec2Node, lum: FloatNode, baseR: number): FloatNode => {
  const r = mix(float(0.25 * baseR), 0.0, lum);
  const d = length(cellUv.sub(0.5)).toVar();
  const aa = fwidth(d);
  return float(1).sub(smoothstep(r.sub(aa), r.add(aa), d));
};

export function halftone(sample: Sampler, u: HalftoneUniforms, coord: Vec2Node): Vec4Node {
  return Fn(() => {
    const ca = cos(u.uHalftoneAngle);
    const sa = sin(u.uHalftoneAngle);
    const rot = mat2(ca, sa.negate(), sa, ca).toVar("htRot");
    const cell = max(u.uHalftoneCell, 2.0).toVar("htCell");
    const gridPx = rot.mul(coord).toVar("htGrid"); // rotate the screen into the dot grid
    const cellId = floor(gridPx.div(cell));
    const inCell = fract(gridPx.div(cell)); // position within the cell (0..1)
    const centrePx = transpose(rot).mul(cellId.add(0.5).mul(cell)); // cell centre, back in px
    const tex = sample(centrePx.div(max(screenSize, vec2(1)))).toVar("htTex");

    const c = vec3(sigmoid(tex.r, 2), sigmoid(tex.g, 2), sigmoid(tex.b, 2)); // paper default k=2
    const lum = mix(float(1), luma(c), tex.a).toVar("htLum");
    const d = getCircle(inCell, lum, 1.3); // baseR 1.3 ~ paper's original-colours default
    const dots = vec4(tex.rgb, tex.a.mul(d)); // wave-coloured dots, transparent between
    return mix(sample(uv()), dots, clamp(u.uHalftone, 0, 1));
  })();
}

// ---- heatmap: luminance to a thermal palette ---------------------------------------------------

const heat = (t: FloatNode): Vec3Node => {
  const s = clamp(t, 0, 1).toVar();
  const c = mix(vec3(0.0, 0.0, 0.4), vec3(0.0, 0.6, 1.0), smoothstep(0.0, 0.25, s)).toVar("heatC");
  c.assign(mix(c, vec3(0.0, 1.0, 0.4), smoothstep(0.25, 0.5, s)));
  c.assign(mix(c, vec3(1.0, 1.0, 0.0), smoothstep(0.5, 0.75, s)));
  c.assign(mix(c, vec3(1.0, 0.1, 0.0), smoothstep(0.75, 1.0, s)));
  return c;
};

export function heatmap(src: Vec4Node, uHeatmap: FloatUniform): Vec4Node {
  return Fn(() => {
    const s = src.toVar("hmSrc");
    const l = dot(s.rgb, vec3(0.299, 0.587, 0.114));
    return vec4(mix(s.rgb, heat(l), clamp(uHeatmap, 0, 1)), s.a);
  })();
}

// ---- paper texture: fibrous substrate shading --------------------------------------------------

const h21 = (p: Vec2Node): FloatNode => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

export function paperTexture(
  src: Vec4Node,
  uPaper: FloatUniform,
  uPaperScale: FloatUniform,
  coord: Vec2Node,
): Vec4Node {
  return Fn(() => {
    const s = src.toVar("ptSrc");
    const p = coord.div(max(uPaperScale, 0.5)).toVar("ptP");
    const fiber = h21(floor(p))
      .mul(0.5)
      .add(h21(floor(p.mul(vec2(0.3, 3.0)))).mul(0.5));
    const tex = mix(fiber, h21(coord), 0.3); // + fine speckle
    const shade = float(1).sub(tex.sub(0.5).mul(0.35));
    return vec4(s.rgb.mul(mix(float(1), shade, clamp(uPaper, 0, 1))), s.a);
  })();
}

// ---- CMYK halftone: four rotated dot screens ---------------------------------------------------

/** One rotated halftone dot screen for a channel value. */
const dotScreen = (
  coord: Vec2Node,
  value: FloatNode,
  angle: number,
  cell: FloatUniform,
): FloatNode => {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const r = mat2(ca, -sa, sa, ca).mul(coord);
  const c = fract(r.div(max(cell, 2.0)))
    .sub(0.5)
    .toVar();
  const radius = sqrt(clamp(value, 0, 1))
    .mul(0.5)
    .toVar();
  return smoothstep(radius, radius.sub(0.06), length(c));
};

export function halftoneCmyk(
  src: Vec4Node,
  uHalftoneCmyk: FloatUniform,
  uCell: FloatUniform,
  coord: Vec2Node,
): Vec4Node {
  return Fn(() => {
    const s = src.toVar("cmykSrc");
    const k = float(1)
      .sub(max(max(s.r, s.g), s.b))
      .toVar("cmykK"); // RGB -> CMYK
    const invK = max(float(1).sub(k), 1e-3).toVar();
    const cyan = float(1).sub(s.r).sub(k).div(invK);
    const mag = float(1).sub(s.g).sub(k).div(invK);
    const yel = float(1).sub(s.b).sub(k).div(invK);
    const dc = dotScreen(coord, cyan, 1.309, uCell); // 75 degrees
    const dm = dotScreen(coord, mag, 0.262, uCell); //  15
    const dy = dotScreen(coord, yel, 0.0, uCell); //     0
    const dk = dotScreen(coord, k, 0.785, uCell); //    45
    // Subtractive: cyan absorbs red, magenta green, yellow blue, black all.
    const outc = clamp(
      vec3(1)
        .sub(vec3(dc, 0, 0))
        .sub(vec3(0, dm, 0))
        .sub(vec3(0, 0, dy))
        .sub(vec3(dk)),
      vec3(0),
      vec3(1),
    );
    return vec4(mix(s.rgb, outc, clamp(uHalftoneCmyk, 0, 1)), s.a);
  })();
}

// ---- dither: ordered (Bayer) ------------------------------------------------------------------

export interface DitherUniforms {
  uDitherStrength: FloatUniform;
  uDitherScale: FloatUniform;
  uDitherSteps: FloatUniform;
}

/**
 * paper's default 8x8 ordered screen — the same 64 values the GLSL declares as a `const int[64]`.
 *
 * Kept as the literal table rather than a closed form. The recursive "magic square" identities that
 * look like they should reproduce it do not: three plausible bit-interleave formulations were
 * checked against these entries and disagreed on 48 to 56 of the 64, which would have shifted the
 * dither pattern in a way that is easy to mistake for a rendering difference. A uniform array of
 * 64 floats costs one buffer in the post stage, which has room to spare.
 */
const BAYER_8X8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

const bayerTable = /*@__PURE__*/ uniformArray(BAYER_8X8, "float");

/** `getBayerValue(uv, 8)` from the GLSL: index the 8x8 screen by the wrapped pixel coordinate. */
const bayer8 = (p: Vec2Node): FloatNode => {
  const cell = fract(p.div(8)).mul(8).toVar("bayerCell");
  const index = int(cell.y).mul(8).add(int(cell.x));
  return float(bayerTable.element(index as never) as never).div(64.0);
};

export function dither(sample: Sampler, u: DitherUniforms, coord: Vec2Node): Vec4Node {
  return Fn(() => {
    const pxSize = max(u.uDitherScale, 1.0).toVar("dPx");
    const pxSizeUV = coord.div(pxSize).toVar("dPxUv");
    const sampleUV = floor(coord.div(pxSize))
      .add(0.5)
      .mul(pxSize)
      .div(max(screenSize, vec2(1)));
    const image = sample(sampleUV).toVar("dImage");

    const lum = luma(image.rgb).toVar("dLum");
    const colorSteps = max(floor(u.uDitherSteps), 1.0).toVar("dSteps");

    const dithering = bayer8(pxSizeUV).sub(0.5);
    const brightness = clamp(lum.add(dithering.div(colorSteps)), 0, 1).toVar("dBright");
    brightness.assign(mix(float(0), brightness, image.a));
    const quantLum = floor(brightness.mul(colorSteps).add(0.5)).div(colorSteps).toVar("dQuant");

    // paper's "original colours" path: keep the source hue, quantize luminance.
    const color = image.rgb.div(max(lum, 0.001)).mul(quantLum);
    const quantAlpha = floor(image.a.mul(colorSteps).add(0.5)).div(colorSteps);
    const opacity = mix(quantLum, float(1), quantAlpha);

    return mix(image, vec4(color, opacity), clamp(u.uDitherStrength, 0, 1));
  })();
}
