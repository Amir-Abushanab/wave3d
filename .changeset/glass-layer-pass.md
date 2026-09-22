---
"@wave3d/core": patch
---

Glass: the layer count follows the deformed sheet, frost stops paying for an invisible blur, and a
soft edge no longer draws a dark line.

- **Thickness and droplet fusion read the wrong shape.** The layer-count capture was drawn with a
  stock override material, whose vertex stage knows nothing of the wave's deformation and which
  culls back faces — so it counted the rest-pose plane, front faces only. Measured against the
  normal pass (the wave's own program): a tenth of the real silhouette on Liquid Glass. Each glass
  wave now has a companion program on its own vertex stage and uniforms; the two captures match
  exactly, on both backends.
- **Frost is gated on its radius in pixels.** The default 0.08 is a 0.29 px scatter, which eleven
  taps can only average back to the sample they surround — 33 backdrop taps per fragment for
  nothing. One RGB gather now, and none under half a pixel.
- **Edge feather and opacity fade toward the unbent backdrop.** Glass draws opaque, so scaling the
  colour by an alpha no blend ever reads faded the feather toward black and drew a hard dark line
  along the silhouette. This was also the "unexplained" two-level darkening on the WebGPU backend:
  both glass parity cases now pass the thresholds with no allowance.
- **Glass gets a vertex-stage normal, and the normal pass is gone.** The geometry bakes each
  vertex's two grid neighbours; the vertex shader runs the same deformation on them (pointer bump
  included) and crosses the tangents, so the normal is exact and interpolates smoothly where the
  fragment's `dFdx` normal was constant per triangle — a 120 px refraction turned every triangle
  edge into a seam. The caustic is now the Jacobian of the offset from ±3 px finite differences of
  that interpolated normal in the same pass, so the normal buffer, its render target and the third
  geometry pass are gone. Bent images are coherent now; presets tuned against the old faceted
  refraction (Liquid Glass) look smoother and blobbier than before.
- **TSL: varyings created inside `positionNode` were never reaching the fragment.** The closure
  runs when the vertex stage is _built_, after `buildWaveMaterial` has returned, so a varying
  handed to the fragment builders by value was always `null` — the glass normal silently fell back
  to the faceted one on WebGPU, and the pointer field's hue shift, lighten and strand thinning have
  been missing on that backend since they were ported. Both are now read at build time, and a
  missing varying throws instead of falling back.
- The backdrop excludes waves by depth toward the camera (array order breaks ties), so a wave
  moved behind a sheet stays visible through it; the passes restore the clear colour; a wave
  switched to glass live leaves the transparent list.

Liquid Glass at 1000×700: 2.1 → 1.4 ms/frame on WebGL, 1.1 → 0.7 on WebGPU. Parity: Liquid Glass
mae 0.08, synthetic glass 0.23, both without an allowance.
