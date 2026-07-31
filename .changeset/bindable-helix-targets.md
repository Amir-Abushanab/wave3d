---
"@wave3d/core": minor
"wave-studio": patch
---

Make the helix drivable from interaction inputs: `helixPhase`, `helixTurns` and `helixRadius` join the per-wave binding targets, so `{ source: "scroll", target: "helixPhase", to: 360 }` spins a coil exactly one turn down the page, and hover or press can wind, unwind, or open it.

`waveDefines` now compiles the helix path for a wave that binds one of these but authors `helixRadius`/`helixRoll` at 0 — otherwise driving the radius up from a resting 0 would have nowhere to land. Same precedent as `detailAmount` and the second displacement octave. Waves with neither a helix nor a helix binding are unaffected.
