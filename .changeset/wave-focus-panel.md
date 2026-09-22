---
"@wave3d/core": patch
---

Selecting a wave in the viewport now reveals its config. Double-click a ribbon, or pick one with the
transform gizmo, and the panel expands that wave's folder, scrolls it into view and flashes it —
instead of leaving you to find "Wave 3" in a rail of identical folders.

`StudioWaveRenderer.onWaveChanged` now carries the selected wave's index, matching `onLightsChanged`.
