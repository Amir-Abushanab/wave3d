---
"@wave3d/core": minor
---

Add config-driven post-processing effects to the wave renderer. Each is an optional
`SceneConfig` field that defaults to off, so existing configs render byte-identically —
a value of `0` removes the pass entirely (no cost).

- **dither** — ordered Bayer dithering (`dither`, `ditherScale`, `ditherSteps`)
- **halftone** — rotated dot screen (`halftone`, `halftoneCell`, `halftoneAngle`)
- **halftoneCmyk** — subtractive CMYK halftone (`halftoneCmyk`, `halftoneCmykCell`)
- **heatmap** — luminance-to-thermal remap (`heatmap`)
- **paperTexture** — printed-paper grain/fibre (`paperTexture`, `paperTextureScale`)
- **innerLight** — volumetric light streaks (`innerLight`, `innerLightDensity`,
  `innerLightDecay`, `innerLightX`, `innerLightY`)

`dither` and `halftone` are near-exact ports of the corresponding
[`@paper-design/shaders`](https://github.com/paper-design/shaders) fragment shaders
(Apache-2.0, attributed in `THIRD-PARTY-NOTICES.md`); the rest are original. Also adds a
`randomizePostFx` studio helper for sampling one effect at a time.
