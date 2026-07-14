---
"@wave3d/core": minor
---

Add an optional, additive, default-off interactivity layer, scoped **per wave**. Each `WaveConfig`
gains an `interaction` block with three parts: **`hover`** (a cursor-follow pointer field — swell,
swoosh, local agitation, strand-thinning, hue/lighten), **`press`** (click/tap ripples), and
**`bindings`** that smoothly drive that wave's params from an input. Sources: `scroll`, `hover`,
`pointerX`/`pointerY`, `pointerSpeed`, `press`, `scrollVelocity`, `appear`, and developer-fed
`custom:*`. Each wave's hover field has its own `smoothing` (cursor-follow lag — vary it across a
stack for a parallax drag). Shared inputs (one cursor + scroll: `radius`, `touch`) and scene-param
bindings (`timeOffset`, `cameraZoom`, `blur`, `grain`) live on `SceneConfig.interaction`. Adds
`setInteractionInput()` on the renderer and the shell `WaveHandle`, the React `interaction` prop
(targets the first wave), and a Wave Studio authoring UI (per-wave Hover / Click & touch / Bindings
sections plus a global inputs + scroll-preview folder). Entirely opt-in: omit the block(s) and the
compiled shader and rendered pixels are byte-identical to before.
