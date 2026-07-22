# @wave3d/element

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
