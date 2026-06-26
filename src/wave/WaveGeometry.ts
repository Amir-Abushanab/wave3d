import * as THREE from "three";

/** Native plane size for Stripe's folded() — keep this exact (400) so the vertex
 *  shader's displace/twist frequencies (calibrated to this scale) stay faithful.
 *  The world-size is set later by the mesh transform (uScale) + camera distance. */
const NATIVE = 400;
const FOLD_X = 16; // |x| < 16 is the semicircular hinge; outside it the two flat arms
const SHIFT = NATIVE / 4; // Stripe's `n.x += e/4` recentre after folding

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Stripe's exact hero geometry — the baked `folded()` hairpin (bundle 4925).
 *
 * A flat PlaneGeometry(400, 400) is folded in place: one half (x < -16) lifts to
 * +r in z, the other half (x > 16) mirrors back over it at -r, and the two are
 * joined by a semicircular U-bend across x ∈ [-16, 16]. The fold half-gap
 * `r = 4 - 2·(4·v·(1-v))^9.5` is tight (2) along the width centreline and flares
 * (4) toward the long edges — that subtle taper is what gives the ribbon its
 * clay-like cross-section. Finally the whole thing is rotated -90° about X then Y.
 *
 * All further deformation (Y-displacement, the three-axis twist, the transform)
 * happens in the vertex shader on top of this baked base — exactly as Stripe does.
 *
 * UVs are PlaneGeometry's: u along the fold/length, v across the width.
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

    // subX runs along the fold (Stripe 128), subY across the width (Stripe 256).
    const subX = THREE.MathUtils.clamp(Math.round(segments), 48, 200);
    const subY = subX * 2;

    const plane = new THREE.PlaneGeometry(NATIVE, NATIVE, subX, subY);
    const pos = plane.attributes.position as THREE.BufferAttribute;
    const uv = plane.attributes.uv as THREE.BufferAttribute;
    const v = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const uy = uv.getY(i);
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
