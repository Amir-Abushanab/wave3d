---
"@wave3d/core": minor
---

Add two optional, default-off features for building luminous "plume" compositions:

- **Radial wave mode** — a per-wave vertex-shader warp (`radialAmount`/`radialArc`/`radialSpread`/`radialRadius`/`radialCenter`) that fans the ribbon's length radially from the local origin, so the combed fibers read as individual radial strands. Placed with the wave's `position` transform.
- **Per-wave particles** — an additive GPU dust/sparkle layer (an optional `particles` block on each wave) whose sprites spawn on that wave's deformed surface / edge and drift outward, driven entirely by `uTime` + a seeded layout so it stays deterministic (timeOffset scrub / loopSeconds / paused all hold).

Each is byte-identical when off (no scene node, pass, or shader `#define`). Ships with a "Latte Ring" preset and studio controls.
