---
"@wave3d/core": minor
---

Add two optional, default-off features for building luminous "plume" compositions:

- **Radial wave mode** — a per-wave vertex-shader warp (`radialAmount`/`radialArc`/`radialSpread`/`radialRadius`/`radialCenter`) that fans the ribbon's length radially from the local origin, so the combed fibers read as individual radial strands. Placed with the wave's `position` transform.
- **Particle field** — an additive GPU dust/sparkle layer (optional `particles` block) with an ambient-field emitter, driven entirely by `uTime` + a seeded layout so it stays deterministic (timeOffset scrub / loopSeconds / paused all hold).

Each is byte-identical when off (no scene node, pass, or shader `#define`). Ships with a "Latte Ring" preset and studio controls.
