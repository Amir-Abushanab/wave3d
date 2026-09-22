---
"@wave3d/core": minor
---

`webgl="auto"` now upgrades only onto a GPU.

A software rasteriser (SwiftShader, llvmpipe, Microsoft Basic Render) keeps the poster and reports a
new `"software-renderer"` fallback reason. The probe already asked for this via
`failIfMajorPerformanceCaveat`, which does not deliver it — Chrome hands back a SwiftShader context
regardless — so a machine with no usable GPU was running the full renderer at ~2 fps with seconds of
blocked main thread, when the element was already carrying the right answer in its poster.

`probeWebGL()` and `isSoftwareRenderer(gl)` are exported, because otherwise every consumer wanting
this writes the same `WEBGL_debug_renderer_info` read, and the failure mode is silent: the extension
is hidden under some privacy settings, and treating "cannot tell" as "software" downgrades people
with a perfectly good GPU who then see a poster forever with nothing to report. An unreadable
renderer counts as hardware.

If you want the live render on a software renderer, that is `webgl="force"`.
