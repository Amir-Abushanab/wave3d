import * as THREE from "three";

/** Across-width subdivisions. Length subdivisions come from `segments`.
 *  The fold + displacement run along the LENGTH, so the width needs far fewer
 *  segments than the length; keeping this modest avoids huge per-strand meshes
 *  (×strandCount ×DoubleSide) that can exhaust GPU memory on rebuild. */
const CROSS = 48;

/**
 * A static, flat, subdivided unit plane (x,z ∈ [-0.5, 0.5], uv 0→1). All the
 * deformation — noise displacement, the three-axis twist, transform — happens in
 * the vertex shader (matching Stripe's model), so this geometry never changes per
 * frame; only the shader's uTime uniform advances.
 *
 * UVs: u (0→1) along the length (x), v (0→1) across the width (z).
 */
export class WaveGeometry {
  readonly geometry = new THREE.BufferGeometry();
  private segments = 0;

  constructor(segments: number) {
    this.resize(segments);
  }

  resize(segments: number): void {
    if (segments === this.segments) return;
    this.segments = segments;
    const ringsX = segments + 1;
    const ringsZ = CROSS + 1;
    const positions = new Float32Array(ringsX * ringsZ * 3);
    const uvs = new Float32Array(ringsX * ringsZ * 2);

    for (let i = 0; i < ringsX; i++) {
      for (let j = 0; j < ringsZ; j++) {
        const idx = i * ringsZ + j;
        positions[idx * 3] = i / segments - 0.5;
        positions[idx * 3 + 1] = 0;
        positions[idx * 3 + 2] = j / CROSS - 0.5;
        uvs[idx * 2] = i / segments;
        uvs[idx * 2 + 1] = j / CROSS;
      }
    }

    const indices: number[] = [];
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < CROSS; j++) {
        const a = i * ringsZ + j;
        const b = (i + 1) * ringsZ + j;
        const c = i * ringsZ + (j + 1);
        const d = (i + 1) * ringsZ + (j + 1);
        indices.push(a, b, c, c, b, d);
      }
    }

    this.geometry.setIndex(indices);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
