---
"@wave3d/core": minor
"wave-studio": patch
---

Add a **Corkscrew** preset showcasing the helix mode, and surface the Helix section better in the studio.

Corkscrew is a single wave with `helixRoll: 1`, which rolls the ribbon's cross-section in step with the sweep so the flat strip becomes an auger blade winding around its own length axis; `helixRadius` then lifts that blade off the axis so the turns read as a screw thread rather than a flat twist. It carries a mesh gradient rather than a stop ramp, so the colour field runs along the blade and each turn picks up a different part of the spectrum. There is no twist on it at all — the shape is unreachable with `twistFrequency`, whose `expStep` angle is monotone and can only ramp once.

It is framed down the axis rather than side-on, so the coil reads as a screw receding into the frame and each turn shows its blade face instead of an edge.

The studio's Helix folder is now open by default like its sibling shape sections, and has its own icon: a coil seen side-on. Two crossing strands (the DNA glyph) collapse into a figure-8 at the 13px the panel actually renders, and more than two loops turn to mush, so it's a two-loop spring — and deliberately unlike the Twist rotate-arrow sitting directly above it.
