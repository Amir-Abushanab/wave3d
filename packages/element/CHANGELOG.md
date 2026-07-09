# @wave3d/element

## 0.2.0

### Minor Changes

- Add `handle.snapshot()` (with `SnapshotOptions`) to capture the running wave as an image, plus an optional fixed-frame `time` on `captureImage` / `snapshot` for reproducible posters.

- Bundle `@wave3d/core` as a dependency (previously a peer) and declare `three` as an explicit peer, so consumers install just the wrapper plus three (e.g. `pnpm add @wave3d/react three`).

### Patch Changes

- Updated dependencies []:
  - @wave3d/core@0.2.0
