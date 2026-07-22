# @wave3d/core

## 0.4.1

### Patch Changes

- [#11](https://github.com/Amir-Abushanab/wave3d/pull/11) [`cb924c7`](https://github.com/Amir-Abushanab/wave3d/commit/cb924c70e29d914cb650143d315d7c33d43edeed) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Bring the bundled `wave3d` agent skill up to date with the shipped API. It had drifted since 0.1.0
  and was missing:

  - the whole **post-effects** layer (`grain`, `blur`, `bloomStrength`, `innerLight`, `dither`,
    `halftone`, `halftoneCmyk`, `heatmap`, `paperTexture` and their knobs), including the
    `0` = pass-removed cost contract and which are scene- vs finish-zone
  - **`@wave3d/vite`**, the dev-time poster-capture plugin
  - **`posterFit`** (`"fill"` default | `"cover"` | `"contain"`)

  `metadata.library_version` is now synced from `@wave3d/core`'s real version by the root `version`
  script, so it rides the Version Packages PR instead of drifting again.

## 0.4.0

### Minor Changes

- [#9](https://github.com/Amir-Abushanab/wave3d/pull/9) [`08b957c`](https://github.com/Amir-Abushanab/wave3d/commit/08b957c3b981920845d68ebf32a9600d87f72715) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add config-driven post-processing effects to the wave renderer. Each is an optional
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

## 0.3.0

### Minor Changes

- [#3](https://github.com/Amir-Abushanab/wave3d/pull/3) [`6926a8b`](https://github.com/Amir-Abushanab/wave3d/commit/6926a8b81ddb8c05ccc9461cd89e2b28afaae38d) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add an optional, additive, default-off interactivity layer, scoped **per wave**. Each `WaveConfig`
  gains an `interaction` block with three parts: **`hover`** (a cursor-follow pointer field — local
  agitation, a ± repel/attract push dome, a drag-wake trough, strand-thinning, hue/lighten),
  **`press`** (click/tap ripples), and
  **`bindings`** that smoothly drive that wave's params from an input. Sources: `scroll`, `hover`,
  `pointerX`/`pointerY`, `pointerSpeed`, `press`, `scrollVelocity`, `appear`, and developer-fed
  `custom:*`. Each wave's hover field has its own `smoothing` (cursor-follow lag — vary it across a
  stack for a parallax drag). Shared inputs (one cursor + scroll: `radius`, `touch`) and scene-param
  bindings (`timeOffset`, `cameraZoom`, `blur`, `grain`) live on `SceneConfig.interaction`. Adds
  `setInteractionInput()` on the renderer and the shell `WaveHandle`, the React `interaction` prop
  (targets the first wave), and a Wave Studio authoring UI (per-wave Hover / Click & touch / Bindings
  sections plus a global inputs + scroll-preview folder). Entirely opt-in: omit the block(s) and the
  compiled shader and rendered pixels are byte-identical to before.

- [#3](https://github.com/Amir-Abushanab/wave3d/pull/3) [`6926a8b`](https://github.com/Amir-Abushanab/wave3d/commit/6926a8b81ddb8c05ccc9461cd89e2b28afaae38d) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add a `posterFit` option for the poster image's `object-fit`, and **change its default from `"cover"`
  to `"fill"`**.

  The live canvas renders edge-to-edge at the container's aspect, but the poster was hard-coded to
  `object-fit: cover` via an inline style consumers couldn't override — so it cropped, and the
  poster→canvas handoff visibly shifted the wave even when the poster matched the design. `"fill"`
  maps the poster into the box exactly like the canvas, so a poster captured at the container's aspect
  now hands off with no jump. Override with `posterFit: "cover" | "contain" | "fill"` (`@wave3d/core`
  option, `@wave3d/react` prop) or the `poster-fit` attribute on `<wave-3d>` — e.g. a non-wave /
  different-aspect placeholder that should crop rather than stretch can opt back into `"cover"`.

## 0.2.2

### Patch Changes

- [`e270931`](https://github.com/Amir-Abushanab/wave3d/commit/e270931a31d485d8cbf7adcb1bbc849d33b0e731) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Expose the offscreen thumbnail helpers from `@wave3d/core/studio`: `createThumbHost`, `prepThumbConfig`, and `renderThumbFrame` render a config to a still frame with a reused `WaveRenderer` (used by the studio's preset/history thumbnails and the wave gallery).

## 0.2.1

### Patch Changes

- [`0efadf6`](https://github.com/Amir-Abushanab/wave3d/commit/0efadf62fea3f3713ec917af2506cb13a1206266) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Rewrite the README and package description for clarity: a quick studio-to-site walkthrough, scannable exports, and tidied prose. No API changes.

## 0.2.0

### Minor Changes

- Add `handle.snapshot()` (with `SnapshotOptions`) to capture the running wave as an image, plus an optional fixed-frame `time` on `captureImage` / `snapshot` for reproducible posters.

### Patch Changes

- Migrate the renderer from the deprecated `THREE.Clock` to `THREE.Timer`, silencing a three.js deprecation warning.
