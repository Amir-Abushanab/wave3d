---
"@wave3d/core": minor
---

The studio can now run on the TSL/WebGPU renderer: `@wave3d/core/studio` gains `loadStudioWaveRendererGPU()`, a lazy loader for a drop-in `StudioWaveRenderer` on the TSL backend (construct, then `await renderer.init()`). In the studio app it's the new **Actions → renderer** picker (or `?backend=webgpu`); switching reloads with the live config carried in the share-link hash.

Under the hood the TSL backend's overrides are now a mixin, `withTslBackend(Base)`, applied to `WaveRenderer` for the unchanged `WaveRendererGPU` and to `StudioWaveRenderer` for the studio — the two override disjoint hook sets, so the ~1,000 lines of editor code needed no fork. The lazy-chunk boundary is unchanged and still enforced: `three/webgpu` stays out of every eager entry, including `./studio`.
