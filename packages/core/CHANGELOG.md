# @wave3d/core

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
