# @wave3d/core

## 0.2.0

### Minor Changes

- Add `handle.snapshot()` (with `SnapshotOptions`) to capture the running wave as an image, plus an optional fixed-frame `time` on `captureImage` / `snapshot` for reproducible posters.

### Patch Changes

- Migrate the renderer from the deprecated `THREE.Clock` to `THREE.Timer`, silencing a three.js deprecation warning.
