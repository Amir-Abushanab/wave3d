---
"@wave3d/core": patch
---

Expose the offscreen thumbnail helpers from `@wave3d/core/studio`: `createThumbHost`, `prepThumbConfig`, and `renderThumbFrame` render a config to a still frame with a reused `WaveRenderer` (used by the studio's preset/history thumbnails and the wave gallery).
