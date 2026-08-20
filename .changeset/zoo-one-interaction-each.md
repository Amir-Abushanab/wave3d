---
"@wave3d/core": patch
---

Give each "Particle Zoo" specimen its own way of answering the cursor, so the preset showcases the interactivity layer as well as the particle styles — and shows each dust field reacting alongside its ribbon.

| specimen            | mechanic                                                                        |
| ------------------- | ------------------------------------------------------------------------------- |
| Embers (dome)       | `hover.agitate` — stir the fire, embers scatter                                 |
| Snow (sheet)        | `hover.push` negative — press a hollow into the drift, flakes sink with it      |
| Sparks (radial fan) | `press.ripple` — a ring radiates from the click and blows out through the burst |
| Fireflies (helix)   | a `hover → helixPhase` binding — winds the coil, dust rides round with it       |
| Bubbles (twist)     | `hover.wake` + `thin` — drag a trough through the water, bubbles trail in it    |

Fireflies deliberately has no `hover` block: its particle program never compiles the pointer path at all, yet its dust still follows the wave, because each field mirrors its wave's live shape uniforms every frame. The other four set `particles.pointerShove` to taste (snow barely moves, sparks take the full ring).

Scene-level: a tight `radius` (0.22) so hovering one specimen doesn't stir its neighbours, and `touch: true` — it's a showcase, and the listeners are passive so it doesn't block page scrolling.
