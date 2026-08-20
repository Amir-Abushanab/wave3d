---
"@wave3d/core": minor
---

Particles now react to the pointer field, so a wave's dust belongs to its wave under the cursor instead of staying pinned to the un-poked surface.

The pointer-field math (screen falloff, ribbon-flow footprint, agitate / push / drag-wake / click-ripples) moved into one shared GLSL chunk that the wave vertex shader and the particle emitter both call — the same single-source-of-truth split already used for the wave deform. Two samples per mote:

- **Weld** — the field at the mote's spawn point, so dust still sitting on the surface takes the ribbon's own displacement. Weighted by how far the mote has actually travelled from its birth patch (not by age), so dust with no drift / rise / swirl / wander clings for its whole life.
- **Shove** — the field at the mote's own position, so the cursor also pushes dust that has drifted free and a click ripple blows through the cloud. Scaled by the new `particles.pointerShove` (default 1; 0 = airborne motes ignore the cursor), exposed as "cursor shove" in the studio.

Inert without a hover field on the wave: the particle program compiles without the pointer path at all, and a wave that renders pixel-identically today keeps doing so.
