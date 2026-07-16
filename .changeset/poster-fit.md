---
"@wave3d/core": minor
"@wave3d/element": minor
"@wave3d/react": minor
---

Add a `posterFit` option for the poster image's `object-fit`, and **change its default from `"cover"`
to `"fill"`**.

The live canvas renders edge-to-edge at the container's aspect, but the poster was hard-coded to
`object-fit: cover` via an inline style consumers couldn't override — so it cropped, and the
poster→canvas handoff visibly shifted the wave even when the poster matched the design. `"fill"`
maps the poster into the box exactly like the canvas, so a poster captured at the container's aspect
now hands off with no jump. Override with `posterFit: "cover" | "contain" | "fill"` (`@wave3d/core`
option, `@wave3d/react` prop) or the `poster-fit` attribute on `<wave-3d>` — e.g. a non-wave /
different-aspect placeholder that should crop rather than stretch can opt back into `"cover"`.
