---
"@wave3d/core": minor
---

Add responsive framing controls, so a wave authored on a wide screen no longer arrives cropped on a
narrow one.

The canvas has always tracked its container, but the _framing_ was a hardcoded cover of the 16:9
reference frame. Cover binds on height as soon as the container is narrower than 16:9, so a portrait
phone (390×844 @ dpr 2) zoomed in 2.25× and showed only ~26% of the authored width — the wave read
as a sliver. The only lever was `cameraZoom`, and computing it meant inverting the cover math by
hand, per breakpoint.

Two new scene fields, both authorable in the studio's Camera folder:

- **`cameraMinVisibleWidth`** (0..1) — a floor on how much of the authored width survives. It clamps
  the _base_ zoom, before the `cameraZoom` multiplier, so the fraction reads against your own
  composition: `1` shows exactly the horizontal span you see at 16:9 whatever zoom you authored at,
  `0.6` shows 60% of it. This is the dial for the narrow-screen crop.
- **`cameraFit`** — `"cover"` (default) | `"contain"` | `"width"` | `"height"`, switching the
  mapping outright. `"width"` is identical to `"cover"` above 16:9 and reveals vertically instead of
  cropping below it.

They compose rather than conflict: the clamp is a pure zoom ceiling layered on the fit, so it only
ever widens the view and is inert for `contain`/`width`. Both default to today's behaviour and are
backfilled on load, so every existing config, preset, and share link frames exactly as before.
