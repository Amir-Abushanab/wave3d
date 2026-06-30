import * as THREE from "three";

/** Native plane size for folded() — keep this exact (400) so the vertex
 *  shader's displace/twist frequencies (calibrated to this scale) stay faithful. */
const NATIVE = 400;
const FOLD_X = 16; // |x| < 16 is the semicircular hinge; outside it the two flat arms
const SHIFT = NATIVE / 4; // recentre the folded cross-section along x

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Base wave geometry — `folded()`: a flat PlaneGeometry folded into a hairpin
 * (sideways-U) cross-section, then stood up so the fold runs along the wave's length.
 *
 *   - Each vertex gets a half-thickness `r` (per-vertex math below): tight along the
 *     width centreline, flaring toward the long edges.
 *   - The strip |x| < FOLD_X becomes a semicircular hinge; the plane's two halves bend
 *     around it into parallel arms offset to +r and -r.
 *   - Two −90° rotations (about X then Y) orient the U upright and down its length.
 *
 * folded() leaves the U open along one side and hollow at both ends, so at oblique
 * camera angles you could see straight through it. We weld the open side and cap both
 * ends with extra triangles so the mesh is a watertight solid — welding/capping adds
 * faces only, no vertex positions move.
 *
 * All further deformation (displacement, twist, transform) happens in the vertex shader
 * on top of this base. UVs: u along the fold/length, v across the width.
 */
export class WaveGeometry {
  readonly geometry: THREE.BufferGeometry;
  private segments = -1;

  constructor(segments: number) {
    this.geometry = new THREE.BufferGeometry();
    this.resize(segments);
  }

  resize(segments: number): void {
    if (segments === this.segments) return;
    this.segments = segments;

    // subX along the fold, subY across the width (twice as dense).
    const subX = THREE.MathUtils.clamp(Math.round(segments), 48, 200);
    const subY = subX * 2;

    const plane = new THREE.PlaneGeometry(NATIVE, NATIVE, subX, subY);
    const pos = plane.attributes.position as THREE.BufferAttribute;
    const uv = plane.attributes.uv as THREE.BufferAttribute;
    const v = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const uy = uv.getY(i);
      // r: cross-section half-thickness — tight (2) along the width centreline, flaring (4)
      // toward the long edges. The pow() term is a sharp parabolic bump peaking at uv.y = 0.5.
      const r = 4 - 2 * Math.pow(4 * uy * (1 - uy), 9.5);

      if (v.x < -FOLD_X) {
        v.z += r; // long arm, at +r
      } else if (v.x < FOLD_X) {
        // semicircular hinge: z sweeps +r → -r, x collapses to the bend
        v.z = Math.cos(THREE.MathUtils.mapLinear(v.x, -FOLD_X, FOLD_X, 0, Math.PI)) * r;
        v.x =
          Math.cos(THREE.MathUtils.mapLinear(v.x, -FOLD_X, FOLD_X, -Math.PI / 2, Math.PI / 2)) * r -
          FOLD_X;
      } else {
        v.z -= r; // folded-over arm, mirrored back at -r
        v.x = -v.x;
      }

      v.x += SHIFT;
      v.applyAxisAngle(X_AXIS, -Math.PI / 2);
      v.applyAxisAngle(Y_AXIS, -Math.PI / 2);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;

    // Seal the hairpin's OPEN side. folded() leaves the two arm tips unconnected — the
    // plane's u=0 and u=subX edges, which fold to adjacent tips at +r and -r — so at oblique
    // camera angles you can see through the U to the background. Weld those two edges with a
    // strip of triangles, closing the tube. No vertex positions move; this only adds faces
    // over the previously-open seam.
    const cols = subX + 1;
    const srcIdx = plane.getIndex();
    const merged = srcIdx ? Array.from(srcIdx.array as ArrayLike<number>) : [];
    // (a) Weld the U's side opening: the u=0 and u=subX edges fold to adjacent tips at ±r.
    for (let iy = 0; iy < subY; iy++) {
      const a = iy * cols; // (row iy, col 0)  — arm-A tip
      const b = (iy + 1) * cols; // (row iy+1, col 0)
      const c = a + subX; // (row iy, col subX) — arm-B tip
      const d = b + subX; // (row iy+1, col subX)
      merged.push(a, c, b, b, c, d);
    }
    // (b) Cap the two length-ends (v=0 and v=subX rows): the folded sheet is a hollow channel
    // open at both ends, so an edge-on camera sees straight through it. Fan-triangulate each
    // end's U cross-section (apex = the col-0 tip) to close it — making the wave a closed solid.
    for (const row of [0, subY]) {
      const apex = row * cols;
      for (let ix = 1; ix < subX; ix++) merged.push(apex, row * cols + ix, row * cols + ix + 1);
    }
    plane.setIndex(merged);

    plane.computeVertexNormals();

    // Move the baked attributes onto our reusable geometry, then drop the temp.
    this.geometry.setIndex(plane.getIndex());
    this.geometry.setAttribute("position", plane.getAttribute("position"));
    this.geometry.setAttribute("uv", plane.getAttribute("uv"));
    this.geometry.setAttribute("normal", plane.getAttribute("normal"));
    this.geometry.computeBoundingSphere();
    plane.dispose();
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
