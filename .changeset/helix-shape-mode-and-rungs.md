---
"@wave3d/core": minor
---

Add a **helix** shape mode and wireframe **rungs** — periodic shapes the wave could not previously express.

The three twists rotate by `freq * expStep(uv, power)`, and `expStep` is a monotone falloff whose crossover always sits at the ribbon's midpoint regardless of power, so a twist can only ever ramp once — it can't coil. Their axes are also 45°/90° off the ribbon's length, so pushing the frequency up just balls the sheet into a rosette rather than winding it. Four new per-wave fields sweep a _periodic_ angle along the length instead:

- `helixTurns` — full turns from one end of the ribbon to the other.
- `helixRadius` — carries the whole ribbon around the axis with its orientation intact, so a narrow ribbon reads as a single strand. Two waves 180° apart in `helixPhase` are a double helix that genuinely swaps depth at each crossing.
- `helixRoll` — rolls the ribbon's own cross-section in step with the sweep (1 = a rigid twisted ribbon), swinging its two long edges onto opposite sides of the axis so one wave becomes a ladder whose edges are both strands. The roll is about the ribbon's width centre (`RIBBON_Z_CENTER`), not the origin — the fold leaves the width at [-100, 84], so rotating about the origin would put the two edges at radii 100 and 84.
- `helixPhase` — degrees; the per-wave knob that puts a second wave on the opposite side of the same helix.

The wireframe theme gains `rungAmount` / `rungThickness`, a second line family carved at constant `uv.y` so it runs ACROSS the ribbon where `lineAmount`'s lines run along it — the two cross into a ladder. Rung width comes from `fwidth`, so a rung holds its pixel width at any zoom or ribbon scale (the lengthwise term's `dFdy(vUv).x` is the derivative of the wrong axis for this direction).

Both are additive and default to off: the helix path only compiles when `helixRadius` or `helixRoll` is non-zero, rungs only when `rungAmount > 0` on a wireframe wave, so any existing config compiles the same program and renders the same pixels.
