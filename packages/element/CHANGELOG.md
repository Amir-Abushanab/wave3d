# @wave3d/element

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
