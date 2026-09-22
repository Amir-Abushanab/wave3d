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
- The TSL normal pass is a real branch instead of a `select()` that evaluated the whole shade; the
  normal buffer is half float; the backdrop excludes waves by depth toward the camera (array order
  breaks ties), so a wave moved behind a sheet stays visible through it; the passes restore the
  clear colour; a wave switched to glass live leaves the transparent list.

Liquid Glass at 1000×700: 2.1 → 1.4 ms/frame on WebGL, 1.1 → 0.8 on WebGPU.
