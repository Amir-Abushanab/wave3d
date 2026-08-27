/**
 * Assembles the post chain in the SAME order the WebGL `EffectComposer` runs it.
 *
 * That order is not arbitrary. `applyPost()` inserts bloom and then innerLight at index 1, so
 * innerLight ends up ahead of bloom; both therefore act on the raw, pre-tone-map scene. The
 * remaining effects are appended AFTER `OutputPass`, so they operate on display-space colour —
 * dithering a linear buffer would crush the steps in the shadows. Reproducing that means placing
 * `renderOutput()` ourselves partway down the chain instead of letting `RenderPipeline` apply it at
 * the end, which is what `outputColorTransform = false` is for.
 *
 *   scene → innerLight → +bloom → blur/grain → renderOutput → halftone → heatmap → CMYK → paper → dither
 *
 * Stages that sample an OFFSET coordinate need their input backed by a render target, since a
 * composed node is only defined at the current fragment. `convertToTexture()` materialises those.
 */
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { convertToTexture, renderOutput, screenCoordinate } from "three/tsl";
import { buildBasePost, type PostUniforms } from "./post";
import {
  innerLight,
  halftone,
  heatmap,
  halftoneCmyk,
  paperTexture,
  dither,
  fragCoord,
  type InnerLightUniforms,
  type HalftoneUniforms,
  type DitherUniforms,
} from "./postEffects";
import type { FloatUniform, Vec2Node, Vec4Node } from "./types";

/** Which effects this chain includes. Changing the set rebuilds the graph, as the WebGL path
 *  inserts and removes passes. */
export interface PostFlags {
  bloom: boolean;
  innerLight: boolean;
  halftone: boolean;
  heatmap: boolean;
  halftoneCmyk: boolean;
  paperTexture: boolean;
  dither: boolean;
}

export interface PostChainUniforms
  extends PostUniforms, InnerLightUniforms, HalftoneUniforms, DitherUniforms {
  uBloomStrength: FloatUniform;
  uBloomRadius: FloatUniform;
  uBloomThreshold: FloatUniform;
  uHeatmap: FloatUniform;
  uHalftoneCmyk: FloatUniform;
  uHalftoneCmykCell: FloatUniform;
  uPaper: FloatUniform;
  uPaperScale: FloatUniform;
}

/** A node that can be sampled at an arbitrary uv. */
type TextureStage = { sample: (at: Vec2Node) => Vec4Node };

const asStage = (node: unknown): TextureStage => {
  const tex = convertToTexture(node as never) as unknown as TextureStage;
  return tex;
};

export function buildPostChain(
  scenePass: unknown,
  u: PostChainUniforms,
  flags: PostFlags,
): Vec4Node {
  // gl_FragCoord's bottom-left origin, which every screen-space effect below was written against.
  const coord = fragCoord(screenCoordinate.xy as unknown as Vec2Node);

  // --- scene zone: acts on linear, pre-tone-map colour ---
  let stage: unknown = scenePass;

  if (flags.innerLight) {
    // Bind the input BEFORE reassigning `stage`. TSL evaluates an `Fn` body when the shader is
    // built, not when the function is called, so a closure reading `stage` lazily would resolve to
    // the innerLight node itself — a self-referential graph that recurses until the stack blows.
    const input = asStage(stage);
    stage = innerLight((at) => input.sample(at), u);
  }
  if (flags.bloom) {
    // BloomNode returns the bloom CONTRIBUTION, not the composite — UnrealBloomPass adds it to the
    // base image too, so the sum matches. The input is materialised because BloomNode reads it
    // through its own downsample chain.
    const src = convertToTexture(stage as never);
    stage = src.add(
      bloom(src, u.uBloomStrength as never, u.uBloomRadius as never, u.uBloomThreshold as never),
    );
  }

  // --- blur + grain (the always-on base pass) ---
  {
    const input = asStage(stage);
    stage = buildBasePost((at) => input.sample(at), u);
  }

  // --- OutputPass: tone mapping + sRGB. Everything after this sees display-space colour. ---
  stage = renderOutput(stage as never);

  // --- finish zone ---
  if (flags.halftone) {
    const input = asStage(stage);
    stage = halftone((at) => input.sample(at), u, coord);
  }
  if (flags.heatmap) stage = heatmap(stage as never, u.uHeatmap);
  if (flags.halftoneCmyk) {
    stage = halftoneCmyk(stage as never, u.uHalftoneCmyk, u.uHalftoneCmykCell, coord);
  }
  if (flags.paperTexture) {
    stage = paperTexture(stage as never, u.uPaper, u.uPaperScale, coord);
  }
  if (flags.dither) {
    const input = asStage(stage);
    stage = dither((at) => input.sample(at), u, coord);
  }

  return stage as Vec4Node;
}
