---
"@wave3d/core": patch
---

Bring the bundled `wave3d` agent skill up to date with the shipped API. It had drifted since 0.1.0
and was missing:

- the whole **post-effects** layer (`grain`, `blur`, `bloomStrength`, `innerLight`, `dither`,
  `halftone`, `halftoneCmyk`, `heatmap`, `paperTexture` and their knobs), including the
  `0` = pass-removed cost contract and which are scene- vs finish-zone
- **`@wave3d/vite`**, the dev-time poster-capture plugin
- **`posterFit`** (`"fill"` default | `"cover"` | `"contain"`)

`metadata.library_version` is now synced from `@wave3d/core`'s real version by the root `version`
script, so it rides the Version Packages PR instead of drifting again.
