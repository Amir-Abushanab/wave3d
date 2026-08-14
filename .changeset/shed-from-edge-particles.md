---
"@wave3d/core": minor
---

Particles are **per-wave**: each wave carries its own optional `particles` block, and every sprite spawns on THAT wave's DEFORMED surface / edge (silk dissolving into glitter) and drifts outward from it. The vertex deform (displacement / helix / twist / radial) is extracted into a shared `waveShapeChunk` GLSL function used by BOTH the wave vertex shader and the particle shader, so the dust rides the exact same deform as the ribbon it comes off. The extraction is verified byte-identical for existing waves via the pixel-digest harness.

Knobs: `count / size / color / color2 / seed / life / twinkle / sizeJitter`, plus `edgeBias` (0 = spawn across the whole surface … 1 = the outer rim / edge only), `drift` (outward distance as it ages), and `bias` (−1..1, skews the spawn toward one flank of the edge).

**Variety** beyond the round glitter — motion styles `rise` (screen-vertical buoyancy: + embers, − snow), `swirl` (orbit around the wave), and `wander` (curl-noise turbulence for fireflies / motes); a `shape` render style (`glitter` / `soft` / `ring` / `star` / `streak`); and `color2` for two-tone dust. Each is 0 / default = off. Studio controls live in a per-wave "Particles" folder with a **"style" picker** that loads ready-made looks (glitter / embers / snow / sparks / fireflies / bubbles — exported as `PARTICLE_PRESETS`), and a **"Particle Zoo"** preset demos all of them in one scene (five waves, one style each). Byte-identical when off — an absent block means no THREE.Points for that wave.
