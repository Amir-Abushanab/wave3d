---
"@wave3d/core": patch
---

Fix a config with bloom rendering a **blank white thumbnail**.

`prepThumbConfig` swaps the authored background for a white card so thumbnails read against the picker UI, but it left the post passes that scatter light out of bright pixels — `bloomStrength` and `innerLight` — running at values tuned against the original (usually dark) background. White sits far above any sane `bloomThreshold`, so those passes bloomed the card itself and washed the whole frame out: a bloom preset came back 0.3% non-white, i.e. blank. Both are now zeroed alongside the background swap.

Only configs that actually set bloom or inner light are affected; every other preset's thumbnail is pixel-identical.
