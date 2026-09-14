---
"@wave3d/core": patch
---

Double-clicking empty space now leaves path editing, as it was always meant to. The wave being
edited is excluded from `pickWave`'s bounding-sphere fallback — on a large ribbon that sphere covers
most of the viewport, so every double-click re-picked the same wave and Escape was the only way out.
