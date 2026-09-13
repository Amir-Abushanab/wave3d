/**
 * The wave PATH: a centreline the ribbon is swept along, replacing the straight one the folded
 * geometry is born with.
 *
 * Everything else in the shape pipeline bends a ribbon whose centreline is fixed — the twists rotate
 * it, the helix carries it around an axis, the radial fan splays it — so none of them can make a
 * ribbon that changes direction more than once, crosses itself, or narrows where the author wants it
 * to. A path can, because it IS the centreline: the author moves control points and the ribbon
 * follows.
 *
 * The GPU cannot evaluate this per vertex. A frame that does not spin has to be carried ALONG the
 * curve (see {@link samplePath}), which is an integration, not a closed form. So the CPU bakes a
 * small lookup table — position, frame and width at N points along the curve — and the vertex shader
 * samples it by the vertex's own position along the length. That also makes dragging cheap: a moved
 * control point rewrites a 128×3 texture, not 80k vertices.
 */
import * as THREE from "three";
import type { PathPoint } from "../config/model";

/** Samples baked into the lookup table. 128 is well past the point where a ribbon 400 units long
 *  shows faceting, and the texture is still only 1.5 KB. */
export const PATH_SAMPLES = 128;

/** Rows in the LUT: position (+width), frame normal, frame binormal. */
export const PATH_ROWS = 3;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

/** Catmull-Rom through the control points, clamped at the ends (so the curve starts and finishes
 *  exactly on the first and last point rather than overshooting). */
function curveOf(points: PathPoint[]): THREE.CatmullRomCurve3 {
  const vs = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  // CLOSURE IS INFERRED, not a flag: a path whose last point sits on its first is a ring, and
  // Catmull-Rom closes it smoothly once the duplicate is dropped. Leaving it open instead would put
  // a visible kink exactly where the two ends meet, and asking for a `closed` boolean would be a
  // knob for something the points already say.
  const closed = vs.length > 2 && vs[0].distanceTo(vs[vs.length - 1]) < 0.5;
  if (closed) vs.pop();
  // A two-point path is a straight line; Catmull-Rom needs three to have a tangent at the ends, so
  // duplicate into a midpoint rather than special-casing the whole sampler.
  if (vs.length === 2) vs.splice(1, 0, vs[0].clone().lerp(vs[1], 0.5));
  return new THREE.CatmullRomCurve3(vs, closed, "catmullrom", 0.5);
}

/** Interpolate the per-point scalars (width / twist) along the same normalized parameter the curve
 *  uses, so a point's width lands where that point does. */
function scalarAt(
  points: PathPoint[],
  t: number,
  key: "width" | "twist",
  fallback: number,
): number {
  if (points.length === 1) return points[0][key] ?? fallback;
  const f = t * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(f));
  const a = points[i][key] ?? fallback;
  const b = points[i + 1][key] ?? fallback;
  const u = f - i;
  // Smoothstep between control points: a linear ramp puts a visible crease in the ribbon's width
  // exactly at each point, which reads as a dent rather than a taper.
  return a + (b - a) * (u * u * (3 - 2 * u));
}

/** One sample of the swept frame: where the ribbon's centre is, which way its surface faces, which
 *  way its width runs, and how wide it is there. */
export interface PathSample {
  pos: THREE.Vector3;
  /** Surface normal — the axis displacement and the fold's thickness ride. */
  normal: THREE.Vector3;
  /** Across the ribbon's width. */
  binormal: THREE.Vector3;
  width: number;
}

/**
 * Sample the path into evenly spaced frames.
 *
 * Two details decide whether the result is usable:
 *
 * - ARC LENGTH, not curve parameter. Catmull-Rom runs fast through straight stretches and slow
 *   through tight ones, so sampling by `t` would bunch the ribbon's strands wherever the author
 *   happened to put a control point. `getSpacedPoints` walks it by distance instead, which keeps the
 *   comb even however the path is dragged.
 * - PARALLEL TRANSPORT, not a Frenet frame. Frenet builds its normal from curvature, which flips
 *   through every inflection and is undefined on a straight stretch — the ribbon would snap 180°
 *   mid-sweep. Carrying the previous frame forward and only rotating it by the tangent's own change
 *   gives a frame that never spins, which is what a physical ribbon does.
 */
export function samplePath(points: PathPoint[], samples = PATH_SAMPLES): PathSample[] {
  const curve = curveOf(points);
  const pts = curve.getSpacedPoints(samples - 1);
  const out: PathSample[] = [];

  // Seed the frame: any vector perpendicular to the first tangent will do, but picking the one
  // closest to +Y keeps an un-twisted path's surface facing the same way the un-pathed ribbon's does.
  let tangent = curve.getTangentAt(0).normalize();
  let normal = tmpA.set(0, 1, 0).clone();
  if (Math.abs(normal.dot(tangent)) > 0.99) normal.set(1, 0, 0);
  normal.sub(tmpB.copy(tangent).multiplyScalar(normal.dot(tangent))).normalize();

  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const nextTangent = curve.getTangentAt(Math.min(t, 1)).normalize();
    // Rotate the carried normal by the same rotation that takes the old tangent to the new one.
    const axis = tmpB.copy(tangent).cross(nextTangent);
    const sin = axis.length();
    if (sin > 1e-6) {
      const angle = Math.atan2(sin, tangent.dot(nextTangent));
      normal.applyAxisAngle(axis.divideScalar(sin), angle);
    }
    tangent = nextTangent.clone();
    // Re-orthogonalize against drift: 128 small rotations accumulate error that would otherwise
    // shear the cross-section.
    normal.sub(tmpC.copy(tangent).multiplyScalar(normal.dot(tangent))).normalize();

    const twist = THREE.MathUtils.degToRad(scalarAt(points, t, "twist", 0));
    const n = normal.clone();
    if (twist !== 0) n.applyAxisAngle(tangent, twist);
    const b = n.clone().cross(tangent).normalize();

    out.push({
      pos: pts[i].clone(),
      normal: n,
      binormal: b,
      width: Math.max(0, scalarAt(points, t, "width", 1)),
    });
  }
  return out;
}

/**
 * Bake the frames into an RGBA float texture the vertex shader can read: three rows of
 * {@link PATH_SAMPLES} texels — position (+width in alpha), normal, binormal.
 *
 * Linear filtering across the row is what makes 128 samples enough; the shader re-normalizes the two
 * frame vectors after the interpolation, since a lerp between unit vectors is not one.
 */
export function bakePathTexture(points: PathPoint[], samples = PATH_SAMPLES): THREE.DataTexture {
  const data = new Float32Array(samples * PATH_ROWS * 4);
  writePathTexture(data, points, samples);
  const tex = new THREE.DataTexture(data, samples, PATH_ROWS, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Rewrite an existing LUT in place — what a control-point drag calls, so editing costs one small
 *  texture upload per frame instead of a geometry rebuild. */
export function writePathTexture(
  data: Float32Array,
  points: PathPoint[],
  samples = PATH_SAMPLES,
): void {
  const frames = samplePath(points, samples);
  for (let i = 0; i < samples; i++) {
    const f = frames[i];
    let o = i * 4;
    data[o] = f.pos.x;
    data[o + 1] = f.pos.y;
    data[o + 2] = f.pos.z;
    data[o + 3] = f.width;
    o = (samples + i) * 4;
    data[o] = f.normal.x;
    data[o + 1] = f.normal.y;
    data[o + 2] = f.normal.z;
    data[o + 3] = 0;
    o = (samples * 2 + i) * 4;
    data[o] = f.binormal.x;
    data[o + 1] = f.binormal.y;
    data[o + 2] = f.binormal.z;
    data[o + 3] = 0;
  }
}

/**
 * Points along a circular arc in the wave's local XY plane, `turns` of a full circle — 1 closes the
 * ring (the first point is repeated, which is how a path says it is closed). The radius follows from
 * the ribbon's own 400-unit length, so the sweep neither stretches nor bunches whatever the turns.
 */
export function arcPath(turns: number, count = 9): PathPoint[] {
  const r = 400 / (2 * Math.PI * Math.max(Math.abs(turns), 1e-3));
  const span = 2 * Math.PI * turns;
  const out: PathPoint[] = [];
  for (let i = 0; i < count; i++) {
    const a = -span / 2 + (span * i) / (count - 1);
    out.push({ x: Math.sin(a) * r, y: r - Math.cos(a) * r, z: 0 });
  }
  if (Math.abs(Math.abs(turns) - 1) < 1e-6) out[out.length - 1] = { ...out[0] };
  return out;
}

/** The default path for a wave that is taking one for the first time: the straight centreline it
 *  already has, as three points, so entering path mode changes nothing until a point is dragged. */
export function straightPath(): PathPoint[] {
  return [
    { x: -200, y: 0, z: 0, width: 1, twist: 0 },
    { x: 0, y: 0, z: 0, width: 1, twist: 0 },
    { x: 200, y: 0, z: 0, width: 1, twist: 0 },
  ];
}
