---
"@wave3d/core": minor
---

Add a **shed-from-edge** particle emitter: dust that peels off a wave's DEFORMED edge (silk dissolving into glitter). The vertex deform (displacement / helix / twist / radial) is extracted into a shared `waveShapeChunk` GLSL function used by BOTH the wave vertex shader and the particle shader, so the shed dust rides the exact same deform as the ribbon it comes off. The extraction is verified byte-identical for existing waves via the pixel-digest harness.

Adds `particles.shed` (`{ rate, drift, fromWave }`) as a third emitter mode alongside the ring + ambient field, plus studio controls. The "Solar Plume" preset now sheds off its plume. Behind `#ifdef SHED`, so ring/field-only fields compile none of it and stay byte-identical when shed is off.
