---
"@wave3d/core": patch
---

Fix waves added after the renderer was constructed rendering completely invisible. `uResolution` was seeded to `(1, 1)` in `makeUniforms()` and only ever written by `resize()`, so any wave created later — raising the wave count, or loading a multi-wave preset / share link / saved state through `setConfig` — kept `(1, 1)` until the next resize happened to fire. The solid theme's `edgeFade` vignette divides `gl_FragCoord` by `uResolution`, so the resulting screen coordinate is far above 1, `1.0 - smoothstep(1.0 - uEdgeFade, 1.0, sc)` collapses to 0, and the wave's alpha goes to zero everywhere: the mesh is in the scene, visible, and drawn (the draw call is issued and the triangles are submitted) but contributes no pixels. It bites at the default `edgeFade` of 0.04, and only stayed hidden because no shipped preset or gallery config has more than one wave.

`makeUniforms()` now seeds `uResolution` from the current drawing-buffer size. Single-wave configs are unaffected — the constructor's own resize already set it.
