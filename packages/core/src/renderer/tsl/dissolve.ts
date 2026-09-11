/**
 * The disintegration front in TSL — the port of `dissolveChunk` in `../shaders.ts`.
 *
 * A band sweeps across the ribbon and everything behind it is eaten away chunk by chunk. Both wave
 * fragments discard on {@link dissolved}; the particle emitter reads {@link dissolveProgress} on the
 * same front, so the dust it sheds leaves exactly where the surface goes.
 *
 * Kept in one module (rather than inlined at each call site) for the same reason the GLSL keeps one
 * chunk: the ribbon and its dust MUST agree on where the front is, to the last decimal, or the
 * chunks and the motes drift apart.
 */
import { float, vec2, sin, dot, floor, fract, clamp, mix, select } from "three/tsl";
import { simplexNoise } from "./noise";
import type { FloatNode, Vec2Node } from "./types";
import type { WaveTslUniforms } from "./uniforms";

/**
 * The sweep coordinate, 0 where the front starts and 1 where it ends.
 *
 * Two families: the RIBBON's own axes (uv), so the front follows the sheet wherever the twist takes
 * it, and SCREEN space (ndc, 0..1 across the frame), so the front is a straight line on the canvas
 * and every wave in a stack crumbles against the same edge. The crumb pattern always stays in uv,
 * so the chunks belong to the surface either way.
 */
export function dissolveCoord(u: WaveTslUniforms, uv: Vec2Node, ndc: Vec2Node): FloatNode {
  const c = select(
    u.uDissolveAxis.lessThan(0.5),
    uv.y,
    select(
      u.uDissolveAxis.lessThan(1.5),
      uv.x,
      select(u.uDissolveAxis.lessThan(2.5), ndc.x, ndc.y),
    ),
  );
  return select(u.uDissolveReverse.greaterThan(0.5), float(1).sub(c), c);
}

/** How far the front has passed a point: 0 ahead of it (intact), 1 fully behind it (gone). */
export function dissolveProgress(u: WaveTslUniforms, coord: FloatNode): FloatNode {
  const band = u.uDissolveBand.max(1.0e-3);
  // amount 0 puts the band entirely BEFORE the ribbon and amount 1 entirely past it, so the two
  // ends of the range mean "whole" and "gone" whatever the band width.
  const front = u.uDissolveAmount.mul(float(1).add(band));
  return clamp(front.sub(coord).div(band), 0, 1);
}

/** Per-chunk hash: the same cell always returns the same value, so a chunk that has crumbled stays
 *  crumbled as the front advances (it never flickers back). */
function dissolveHash(cell: Vec2Node): FloatNode {
  return fract(sin(dot(floor(cell), vec2(127.1, 311.7))).mul(43758.5453));
}

/**
 * The erosion grain at a uv: 0 = the first thing to go, 1 = the last. Two octaves (coarse chunks
 * with finer grit inside them) blended between smooth simplex (organic tatters) and quantized cells
 * (hard blocky debris). Cells are square ON THE RIBBON — the sheet is 400 long by ~188 wide, so
 * uv.y is stretched by that ratio.
 */
function dissolveGrain(u: WaveTslUniforms, uv: Vec2Node): FloatNode {
  const cell = vec2(uv.x, uv.y.mul(2.13)).mul(u.uDissolveScale).toVar("disCell");
  const coarse = mix(simplexNoise(cell).mul(0.5).add(0.5), dissolveHash(cell), u.uDissolveBlocky);
  const fine = mix(
    simplexNoise(cell.mul(3.7)).mul(0.5).add(0.5),
    dissolveHash(cell.mul(3.7)),
    u.uDissolveBlocky,
  );
  return clamp(coarse.mul(0.72).add(fine.mul(0.28)), 0, 1);
}

/** True where the surface has been eaten away. `ndc` is the fragment's 0..1 screen position. */
export function dissolved(u: WaveTslUniforms, uv: Vec2Node, ndc: Vec2Node): FloatNode {
  return dissolveProgress(u, dissolveCoord(u, uv, ndc)).greaterThan(
    dissolveGrain(u, uv),
  ) as unknown as FloatNode;
}
