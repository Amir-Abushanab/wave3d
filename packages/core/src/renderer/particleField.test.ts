/**
 * The particle field must be DETERMINISTIC: there is no pixel-snapshot harness, so this is the guard
 * that the seeded layout reproduces (which is what lets timeOffset scrub / loopSeconds / paused give
 * the same frame every time). We test the pure attribute builder, not the GPU.
 */
import { describe, expect, it } from "vitest";
import { buildParticleAttributes } from "./particleField";

describe("particle attributes are deterministic", () => {
  it("same (count, seed, mix) → byte-identical buffers", () => {
    const a = buildParticleAttributes(500, 7, 0.5, 0.5);
    const b = buildParticleAttributes(500, 7, 0.5, 0.5);
    expect(Array.from(a.aSeed)).toEqual(Array.from(b.aSeed));
    expect(Array.from(a.aRnd)).toEqual(Array.from(b.aRnd));
    expect(Array.from(a.aEmitter)).toEqual(Array.from(b.aEmitter));
    expect(Array.from(a.aUv)).toEqual(Array.from(b.aUv));
  });

  it("different seeds diverge", () => {
    const a = buildParticleAttributes(500, 7, 0.5, 0.5);
    const b = buildParticleAttributes(500, 8, 0.5, 0.5);
    expect(Array.from(a.aSeed)).not.toEqual(Array.from(b.aSeed));
  });

  it("routes the emitter mix by weight", () => {
    // (count, seed, fieldWeight, shedWeight) → emitter 0 = field, 1 = shed.
    const field = buildParticleAttributes(100, 1, 1, 0);
    expect(Array.from(field.aEmitter).every((e) => e === 0)).toBe(true);
    const shed = buildParticleAttributes(100, 1, 0, 1);
    expect(Array.from(shed.aEmitter).every((e) => e === 1)).toBe(true);
    const split = buildParticleAttributes(100, 1, 3, 1); // 75% field / 25% shed by weight
    expect(Array.from(split.aEmitter).filter((e) => e === 0).length).toBe(75);
    // no weights at all → everything falls to the ambient field (a bare `{ count }` block is dust).
    const bare = buildParticleAttributes(10, 1, 0, 0);
    expect(Array.from(bare.aEmitter).every((e) => e === 0)).toBe(true);
  });

  it("buffer lengths match the count", () => {
    const a = buildParticleAttributes(42, 3, 1, 1);
    expect(a.position.length).toBe(42 * 3);
    expect(a.aSeed.length).toBe(42);
    expect(a.aRnd.length).toBe(42 * 4);
    expect(a.aEmitter.length).toBe(42);
    expect(a.aUv.length).toBe(42 * 2);
  });
});
