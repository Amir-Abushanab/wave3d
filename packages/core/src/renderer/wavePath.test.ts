import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  arcPath,
  bakePathTexture,
  isClosedPath,
  samplePath,
  straightPath,
  PATH_SAMPLES,
} from "./wavePath";
import { RIBBON_Z_CENTER } from "./WaveGeometry";

const clamp = (v: number): number => Math.max(-1, Math.min(1, v));

/** The alpha channel of one LUT texel — where the bake keeps the arc length and the closure flag. */
const at = (tex: THREE.DataTexture, row: number, i: number): number =>
  (tex.image.data as Float32Array)[(row * PATH_SAMPLES + i) * 4 + 3];

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
      // On the ribbon's OWN centreline, which runs along z = RIBBON_Z_CENTER — not z = 0.
      expect(s.pos.y).toBeCloseTo(0, 4);
      expect(s.pos.z).toBeCloseTo(RIBBON_Z_CENTER, 4);
      // +Y surface normal and +Z width: the frame the un-pathed geometry has, SIGN INCLUDED. This
      // once asserted |binormal.z| = 1, and the abs hid a frame that was −Z: a straight path
      // mirrored every ribbon across its width, flipping the handedness of its twists.
      expect(s.normal.y).toBeCloseTo(1, 4);
      expect(s.binormal.z).toBeCloseTo(1, 4);
      expect(s.width).toBe(1);
    }
  });

  it("frames are right-handed everywhere, so a path never mirrors the ribbon", () => {
    // tangent × normal = binormal on every sample of a curve that turns in all three axes.
    const f = samplePath([
      { x: -200, y: 0, z: RIBBON_Z_CENTER },
      { x: -60, y: 90, z: 40 },
      { x: 60, y: -40, z: -70 },
      { x: 200, y: 20, z: RIBBON_Z_CENTER, twist: 120 },
    ]);
    for (let i = 1; i < f.length - 1; i++) {
      const t = f[i + 1].pos
        .clone()
        .sub(f[i - 1].pos)
        .normalize();
      expect(t.clone().cross(f[i].normal).dot(f[i].binormal)).toBeGreaterThan(0.99);
    }
  });

  it("bakes what the shader needs to continue past the ends: arc length and closure", () => {
    const open = bakePathTexture(straightPath());
    // Normal row alpha = arc length, the rate the shader extrapolates at past an open path's ends.
    expect(at(open, 1, 0)).toBeCloseTo(400, 2);
    expect(at(open, 2, 0)).toBe(0);
    const ring = bakePathTexture(arcPath(1));
    expect(at(ring, 2, 0)).toBe(1);
    expect(at(ring, 2, PATH_SAMPLES - 1)).toBe(1); // on every texel, so any read finds it
  });

  it("bakes a NEAREST texture — the shader interpolates, because float32 filtering is optional", () => {
    // Linear filtering of float32 needs OES_texture_float_linear / float32-filterable; without it
    // the texture is incomplete and reads as zero, collapsing every path onto the origin.
    const tex = bakePathTexture(straightPath());
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
  });

  it("declares a ring by repeating the first point, and nothing else", () => {
    expect(isClosedPath(arcPath(1))).toBe(true);
    expect(isClosedPath(arcPath(0.75))).toBe(false);
    expect(isClosedPath(straightPath())).toBe(false);
    // Two points cannot enclose anything, even when they coincide.
    expect(
      isClosedPath([
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ]),
    ).toBe(false);
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
