---
"@wave3d/core": minor
---

Particles are **per-wave**: each wave carries its own optional `particles` block, and every sprite spawns on THAT wave's DEFORMED surface / edge (silk dissolving into glitter) and drifts outward from it. The vertex deform (displacement / helix / twist / radial) is extracted into a shared `waveShapeChunk` GLSL function used by BOTH the wave vertex shader and the particle shader, so the dust rides the exact same deform as the ribbon it comes off. The extraction is verified byte-identical for existing waves via the pixel-digest harness.

Knobs: `count / size / color / seed / life / twinkle / sizeJitter`, plus `edgeBias` (0 = spawn across the whole surface … 1 = the outer rim / edge only), `drift` (outward distance as it ages), and `bias` (−1..1, skews the spawn toward one flank of the edge). Studio controls live in a per-wave "Particles" folder. Byte-identical when off — an absent block means no THREE.Points for that wave.
