---
"@wave3d/core": patch
"@wave3d/element": patch
---

Lights: a screen-bounded `spread`, and `setLights()` for lights that move.

- **`LightConfig.spread`** (optional, world units) is how far a light reaches measured on the
  screen plane: past that distance from the light's own projection its contribution fades to
  nothing. Absent or 0 is the light as it always was, shaded by angle alone. On the view plane
  rather than in 3D on purpose: a light that follows something on the page (a button, the cursor)
  wants a pool of one on-screen size, and the ribbon's depth under any one spot varies by thousands
  of units across the sheet, so a world-space range would swell, shrink and vanish as the surface
  rolls under it. Both backends; the studio's light folder gets the knob.
- **`renderer.setLights(lights)` / `handle.setLights(lights)`** replace the scene's lights and push
  only their uniforms, where `set()` re-normalises the whole config, re-pushes every uniform and
  re-seats the camera. Safe to call every frame. Staged before the upgrade. The studio's light
  gizmo now goes through the same method.
