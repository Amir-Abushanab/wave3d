---
"@wave3d/core": minor
---

Add three optional, default-off features for building luminous "plume" compositions:

- **Radial wave mode** — a per-wave vertex-shader warp (`radialAmount`/`radialArc`/`radialSpread`/`radialRadius`/`radialCenter`/`radialSource`) that fans the ribbon's length radially from a source point, so the combed fibers read as individual radial strands.
- **Particle field** — an additive GPU dust/sparkle layer (optional `particles` block) with a ring emitter (around the eclipse) and an ambient field, driven entirely by `uTime` + a seeded layout so it stays deterministic (timeOffset scrub / loopSeconds / paused all hold).
- **Eclipse occluder disc** — a billboarded disc (`eclipse`/`eclipseRadius`/`eclipseCenter`/`eclipseSoftness`/`eclipseColor`) that occludes the waves behind it while the plume + particles draw over it.

Each is byte-identical when off (no scene node, pass, or shader `#define`). Ships with a "Solar Plume" preset and studio controls for all three.
