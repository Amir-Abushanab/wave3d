---
"@wave3d/core": patch
---

Fix a sculpted path losing its twist. `PathSample` now reports the roll it applied, and the
studio's densify step carries it across instead of writing `twist: 0`.

The studio resamples a path to more control points before sculpting it, so there is something local
to push. A frame cannot be stored in a `PathPoint` — only x/y/z/width/twist can — so dropping the
roll there resampled the ribbon back to unrolled. On a 360° twist that flipped the surface a full
half-turn (measured: 179.5° of frame divergence, now 6°, which is ordinary 9→15 resampling error).

It only bit paths under 12 points, since densify is a no-op above that — which is why a
hand-authored path with many points never showed it.
