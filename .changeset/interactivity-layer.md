---
"@wave3d/core": minor
---

Add an optional, additive, default-off interactivity layer. A new `SceneConfig.interaction` block turns on a **pointer field** (cursor-follow swell, swoosh, local agitation, click ripples, strand-thinning, and hue/lighten) plus **input→param bindings** — `scroll`, `hover`, `pointerX`/`pointerY`, `pointerSpeed`, `press`, `scrollVelocity`, `appear`, and developer-fed `custom:*` — that smoothly drive whitelisted wave/scene params. Adds a per-wave `interactionInfluence`, `setInteractionInput()` on the renderer and the shell `WaveHandle`, the React `interaction` prop, and a full Wave Studio authoring panel. Entirely opt-in: omit the block and the compiled shader and rendered pixels are byte-identical to before.
