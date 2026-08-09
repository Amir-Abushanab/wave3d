---
"@wave3d/core": minor
---

Add a **shed-from-edge** particle emitter: dust that peels off a wave's DEFORMED edge (silk dissolving into glitter). The vertex deform (displacement / helix / twist / radial) is extracted into a shared `waveShapeChunk` GLSL function used by BOTH the wave vertex shader and the particle shader, so the shed dust rides the exact same deform as the ribbon it comes off. The extraction is verified byte-identical for existing waves via the pixel-digest harness.

Adds `particles.shed` (`{ rate, drift, fromWave, bias }`) as a second emitter mode alongside the ambient field, plus studio controls. `bias` (−1..1, default 0) skews the spray toward one flank of the edge instead of haloing the whole rim, so the glitter can cluster off a single side. The "Solar Plume" preset sheds off its plume. Behind `#ifdef SHED`, so field-only fields compile none of it and stay byte-identical when shed is off.
