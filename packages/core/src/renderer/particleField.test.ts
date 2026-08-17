/**
 * The particle field must be DETERMINISTIC: there is no pixel-snapshot harness, so this is the guard
 * that the seeded layout reproduces (which is what lets timeOffset scrub / loopSeconds / paused give
 * the same frame every time). We test the pure attribute builder, not the GPU.
 */
import { describe, expect, it } from "vitest";
import { buildParticleAttributes } from "./particleField";

/** Mean of one interleaved component of an attribute array. */
function mean(a: Float32Array, stride: number, offset: number): number {
  let s = 0;
  const n = a.length / stride;
  for (let i = 0; i < n; i++) s += a[i * stride + offset];
  return s / n;
}

describe("particle attributes are deterministic", () => {
  it("same (count, seed, edgeBias, bias) → byte-identical buffers", () => {
    const a = buildParticleAttributes(500, 7, 0.5, 0.3);
    const b = buildParticleAttributes(500, 7, 0.5, 0.3);
    expect(Array.from(a.aSeed)).toEqual(Array.from(b.aSeed));
    expect(Array.from(a.aRnd)).toEqual(Array.from(b.aRnd));
    expect(Array.from(a.aUv)).toEqual(Array.from(b.aUv));
  });

  it("different seeds diverge", () => {
    const a = buildParticleAttributes(500, 7);
    const b = buildParticleAttributes(500, 8);
    expect(Array.from(a.aSeed)).not.toEqual(Array.from(b.aSeed));
  });

  it("edgeBias / bias only touch aUv — the aSeed/aRnd draw is unchanged (separate-pass invariant)", () => {
    const base = buildParticleAttributes(400, 5, 1, 0);
    const other = buildParticleAttributes(400, 5, 0, 0.7);
    expect(Array.from(other.aSeed)).toEqual(Array.from(base.aSeed));
    expect(Array.from(other.aRnd)).toEqual(Array.from(base.aRnd));
    expect(Array.from(other.aUv)).not.toEqual(Array.from(base.aUv));
  });

  it("edgeBias moves the spawn from the whole surface (0) toward the outer rim (1)", () => {
    const surface = buildParticleAttributes(4000, 7, 0, 0); // aUv.y ~ uniform, mean ~0.5
    const edge = buildParticleAttributes(4000, 7, 1, 0); // aUv.y crowded to the rim, mean ~0.85
    expect(mean(edge.aUv, 2, 1)).toBeGreaterThan(mean(surface.aUv, 2, 1));
  });

  it("bias 0 leaves the width draw untouched, and skews it otherwise", () => {
    const implicit = buildParticleAttributes(500, 7, 1); // bias defaults to 0
    const explicitZero = buildParticleAttributes(500, 7, 1, 0);
    expect(Array.from(implicit.aUv)).toEqual(Array.from(explicitZero.aUv));
    const neg = buildParticleAttributes(3000, 7, 1, -0.8); // crowds aUv.x → 0
    const pos = buildParticleAttributes(3000, 7, 1, 0.8); // crowds aUv.x → 1
    expect(mean(neg.aUv, 2, 0)).toBeLessThan(mean(explicitZero.aUv, 2, 0));
    expect(mean(pos.aUv, 2, 0)).toBeGreaterThan(mean(explicitZero.aUv, 2, 0));
  });

  it("buffer lengths match the count", () => {
    const a = buildParticleAttributes(42, 3, 0.5, 0.2);
    expect(a.position.length).toBe(42 * 3);
    expect(a.aSeed.length).toBe(42);
    expect(a.aRnd.length).toBe(42 * 4);
    expect(a.aUv.length).toBe(42 * 2);
  });
});
