# @wave3d/react

## 0.9.0

### Patch Changes

- Updated dependencies [[`96bc785`](https://github.com/Amir-Abushanab/wave3d/commit/96bc785d1ef34e41d57326527efaff91b2293fbe), [`cf7b331`](https://github.com/Amir-Abushanab/wave3d/commit/cf7b331189fd34e3bcc2071e85186819b2fa6e51)]:
  - @wave3d/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [[`d208e12`](https://github.com/Amir-Abushanab/wave3d/commit/d208e12a799bbf9ad05bdc0d5faf2686f11e2b00), [`d590076`](https://github.com/Amir-Abushanab/wave3d/commit/d590076adf123e1e1bb87550023877948e78fe14), [`3c80b31`](https://github.com/Amir-Abushanab/wave3d/commit/3c80b315e19ce54bea48a5b2e0e5c08d50eee442)]:
  - @wave3d/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`51e9f48`](https://github.com/Amir-Abushanab/wave3d/commit/51e9f480f98da5b7a446115a282ec34355a9e90d), [`51e9f48`](https://github.com/Amir-Abushanab/wave3d/commit/51e9f480f98da5b7a446115a282ec34355a9e90d), [`51e9f48`](https://github.com/Amir-Abushanab/wave3d/commit/51e9f480f98da5b7a446115a282ec34355a9e90d)]:
  - @wave3d/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [[`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002), [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002), [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002), [`c32bef1`](https://github.com/Amir-Abushanab/wave3d/commit/c32bef107c6f68ff2c09447155ebabb982854349), [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002), [`6d556f6`](https://github.com/Amir-Abushanab/wave3d/commit/6d556f6a1ca6b72ff4f820d9b795e5a7d478ea0f), [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002)]:
  - @wave3d/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`f359f19`](https://github.com/Amir-Abushanab/wave3d/commit/f359f195df6ad75c210213b11496932a52f29711), [`398a825`](https://github.com/Amir-Abushanab/wave3d/commit/398a8258308c3e4ab3528605718d2ad0a694a485)]:
  - @wave3d/core@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies [[`cb924c7`](https://github.com/Amir-Abushanab/wave3d/commit/cb924c70e29d914cb650143d315d7c33d43edeed)]:
  - @wave3d/core@0.4.1

## 0.4.0

### Patch Changes

- Updated dependencies [[`08b957c`](https://github.com/Amir-Abushanab/wave3d/commit/08b957c3b981920845d68ebf32a9600d87f72715)]:
  - @wave3d/core@0.4.0

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

### Patch Changes

- Updated dependencies [[`6926a8b`](https://github.com/Amir-Abushanab/wave3d/commit/6926a8b81ddb8c05ccc9461cd89e2b28afaae38d), [`6926a8b`](https://github.com/Amir-Abushanab/wave3d/commit/6926a8b81ddb8c05ccc9461cd89e2b28afaae38d)]:
  - @wave3d/core@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`e270931`](https://github.com/Amir-Abushanab/wave3d/commit/e270931a31d485d8cbf7adcb1bbc849d33b0e731)]:
  - @wave3d/core@0.2.2

## 0.2.1

### Patch Changes

- [`0efadf6`](https://github.com/Amir-Abushanab/wave3d/commit/0efadf62fea3f3713ec917af2506cb13a1206266) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Rewrite the README and package description for clarity: a quick studio-to-site walkthrough, scannable exports, and tidied prose. No API changes.

- Updated dependencies [[`0efadf6`](https://github.com/Amir-Abushanab/wave3d/commit/0efadf62fea3f3713ec917af2506cb13a1206266)]:
  - @wave3d/core@0.2.1

## 0.2.0

### Minor Changes

- Add `handle.snapshot()` (with `SnapshotOptions`) to capture the running wave as an image, plus an optional fixed-frame `time` on `captureImage` / `snapshot` for reproducible posters.

- Bundle `@wave3d/core` as a dependency (previously a peer) and declare `three` as an explicit peer, so consumers install just the wrapper plus three (e.g. `pnpm add @wave3d/react three`).

### Patch Changes

- Updated dependencies []:
  - @wave3d/core@0.2.0
