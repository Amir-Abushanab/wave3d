import { describe, expect, it } from "vitest";
import { arcPath, samplePath, straightPath, PATH_SAMPLES } from "./wavePath";

const clamp = (v: number): number => Math.max(-1, Math.min(1, v));

/** Distance between consecutive samples — the thing that has to stay even, since it IS the strand
 *  spacing the comb inherits. */
function steps(points: ReturnType<typeof samplePath>): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i++) out.push(points[i].pos.distanceTo(points[i - 1].pos));
  return out;
}

describe("the swept path", () => {
  it("reproduces the straight ribbon, so taking a path changes nothing until a point moves", () => {
    // This is the contract the whole editor rests on: double-clicking a wave gives it a path, and
    // the frame has to be identical or the ribbon would jump the moment you entered.
    const f = samplePath(straightPath());
    expect(f[0].pos.x).toBeCloseTo(-200, 4);
    expect(f[f.length - 1].pos.x).toBeCloseTo(200, 4);
    for (const s of f) {
      expect(s.pos.y).toBeCloseTo(0, 4);
      expect(s.pos.z).toBeCloseTo(0, 4);
      // +Y surface normal and +Z width: the same frame the un-pathed geometry has.
      expect(s.normal.y).toBeCloseTo(1, 4);
      expect(Math.abs(s.binormal.z)).toBeCloseTo(1, 4);
      expect(s.width).toBe(1);
    }
  });

  it("samples by ARC LENGTH, so bunched control points don't bunch the strands", () => {
    // Points crowded into one end: sampling by curve parameter would put most of the ribbon there.
    const f = samplePath([
      { x: -200, y: 0, z: 0 },
      { x: -190, y: 20, z: 0 },
      { x: -180, y: -20, z: 0 },
      { x: 200, y: 0, z: 0 },
    ]);
    const d = steps(f);
    const min = Math.min(...d);
    const max = Math.max(...d);
    expect(max / min).toBeLessThan(1.5);
  });

  it("carries the frame instead of rebuilding it, so it never flips through an inflection", () => {
    // An S-curve: a Frenet frame's normal points at the centre of curvature, so it would swap sides
    // exactly where the curve changes hand — the ribbon would snap 180° mid-sweep.
    const f = samplePath([
      { x: -200, y: 0, z: 0 },
      { x: -80, y: 90, z: 0 },
      { x: 80, y: -90, z: 0 },
      { x: 200, y: 0, z: 0 },
    ]);
    for (let i = 1; i < f.length; i++) {
      expect(f[i].normal.dot(f[i - 1].normal)).toBeGreaterThan(0.9);
    }
  });

  it("keeps the frame orthonormal the whole way", () => {
    const f = samplePath(arcPath(0.75));
    for (const s of f) {
      expect(s.normal.length()).toBeCloseTo(1, 3);
      expect(s.binormal.length()).toBeCloseTo(1, 3);
      expect(Math.abs(s.normal.dot(s.binormal))).toBeLessThan(1e-3);
    }
  });

  it("closes a ring when the last point sits on the first — no flag, and no kink", () => {
    const ring = arcPath(1);
    expect(ring[0]).toEqual(ring[ring.length - 1]); // that repeat IS the declaration
    const f = samplePath(ring);
    // Ends meet...
    expect(f[0].pos.distanceTo(f[f.length - 1].pos)).toBeLessThan(6);
    // ...and the seam is no sharper than the rest of the curve, which is what "no kink" means.
    const d = steps(f);
    expect(Math.max(...d) / Math.min(...d)).toBeLessThan(1.5);
  });

  it("interpolates width between points, so a throat tapers instead of stepping", () => {
    const f = samplePath([
      { x: -200, y: 0, z: 0, width: 1 },
      { x: 0, y: 0, z: 0, width: 0.2 },
      { x: 200, y: 0, z: 0, width: 1 },
    ]);
    expect(f[0].width).toBeCloseTo(1, 2);
    expect(f[Math.floor(PATH_SAMPLES / 2)].width).toBeCloseTo(0.2, 1);
    expect(f[f.length - 1].width).toBeCloseTo(1, 2);
    // Monotone into the waist: any local rise would be a dent in the ribbon's silhouette.
    const half = f.slice(0, Math.floor(PATH_SAMPLES / 2));
    for (let i = 1; i < half.length; i++)
      expect(half[i].width).toBeLessThanOrEqual(half[i - 1].width + 1e-6);
  });

  it("reports the twist it used, so a resampled path does not silently untwist", () => {
    // The studio densifies a path before sculpting it, by re-sampling and writing the frames back
    // as control points. A frame cannot be stored in a PathPoint — only x/y/z/width/twist can — so
    // if the sampler does not hand the roll back, densifying resets the ribbon to unrolled. That is
    // not subtle: on a 360-degree twist it flipped the surface a full half-turn.
    const src = Array.from({ length: 9 }, (_, i) => {
      const u = i / 8;
      return { x: -200 + 400 * u, y: Math.sin(u * Math.PI) * 60, z: 0, width: 1, twist: u * 360 };
    });
    // Exactly what densifyPath does: resample to more points, carrying width and twist across.
    const densified = samplePath(src, 15).map((f) => ({
      x: f.pos.x,
      y: f.pos.y,
      z: f.pos.z,
      width: f.width,
      twist: f.twist,
    }));
    expect(densified.at(-1)?.twist).toBeCloseTo(360, 0);

    const before = samplePath(src, 64);
    const after = samplePath(densified, 64);
    for (let i = 0; i < 64; i++) {
      // Same surface orientation the whole way — a few degrees of resampling error, not a flip.
      const deg = (Math.acos(clamp(before[i].normal.dot(after[i].normal))) * 180) / Math.PI;
      expect(deg).toBeLessThan(12);
    }
  });

  it("keeps an arc's length at the ribbon's own, whatever the turns", () => {
    // The radius is derived from the 400-unit length, so a tighter coil is not a shorter ribbon —
    // otherwise the strand comb would stretch or bunch as the turns changed.
    for (const turns of [0.25, 0.5, 1]) {
      const total = steps(samplePath(arcPath(turns))).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(360);
      expect(total).toBeLessThan(410);
    }
  });
});
