# Third-Party Notices

This project includes code derived from third-party open-source software.

## @paper-design/shaders

- Source: https://github.com/paper-design/shaders
- Homepage: https://shaders.paper.design
- License: Apache License 2.0 — full text in
  [`licenses/paper-design-shaders-Apache-2.0.txt`](./licenses/paper-design-shaders-Apache-2.0.txt)
- NOTICE (from the upstream `NOTICE` file):

  > Powered by Paper Shaders: https://shaders.paper.design

Some post-processing fragment shaders in
`packages/core/src/renderer/shaders.ts` are **derived from** the corresponding
`@paper-design/shaders` fragment shaders. Significant change made in adapting
them: paper's shaders are standalone generative canvases sized by their own
world-space/fit machinery; here they are adapted into **post-processing passes
over the Wave Studio render target** — the source is bound to the composited
scene (`tDiffuse`, sampled at full-frame `vUv`) and paper's sizing / fit /
aspect UV plumbing is removed or simplified.

Derived shaders (see per-shader header comments in that file for the exact
upstream source):

| Our shader                  | Upstream `@paper-design/shaders` |
| --------------------------- | -------------------------------- |
| `ditherFragmentShader`      | `image-dithering`                |
| `halftoneFragmentShader`    | `halftone-dots`                  |
| `flutedGlassFragmentShader` | `fluted-glass`                   |

The remaining post effects are original to this project: `godraysFragmentShader`,
`heatmapFragmentShader`, `halftoneCmykFragmentShader`, and `paperTextureFragmentShader`.
(Paper's `paper-texture` depends on a bundled noise-texture asset for its fibre / crumple /
fold / roughness noise, so it is not ported as lean GLSL — the version here is original,
in the spirit of it.)
