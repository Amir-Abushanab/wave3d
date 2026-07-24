---
"@wave3d/core": patch
---

Fix two resize bugs that consumers could not patch from the outside, because the observer is
internal to the renderer.

**Redundant resizes did full reallocation work.** `resize()` is expensive — `composer.setSize`
reallocates every pass's render target, and `applyBackground()` rebuilds a container-sized canvas
and re-uploads a texture for gradient/image backgrounds. The ResizeObserver callback ran it 1:1, so
observations that changed nothing still paid for it: the observer reports fractional content-box
sizes, so sub-pixel layout shifts triggered a full reallocation, as did every observation while an
export frame is pinned and the container isn't driving the buffer at all. Observer-driven resizes
are now coalesced into a rAF and skipped entirely unless the backing-buffer metrics (w, h, dpr)
actually changed. Genuine per-frame changes — a mobile URL bar collapsing animates the container
height — still resize every frame, since the canvas would otherwise stretch; only the redundant work
is removed. `resize()` itself stays synchronous and unconditional for context restore and
`setOutputSize`, which must re-apply even when the metrics are identical.

**DPR changes left a stale, blurry backing buffer.** `ResizeObserver` watches the CSS box only, so
browser zoom or dragging the window to a monitor with a different `devicePixelRatio` changed the
ratio without changing the box, and the canvas stayed at its old resolution until something else
forced a resize. The renderer now watches `(resolution: Xdppx)` alongside the existing
`prefers-reduced-motion` query, re-arming at the new ratio each time it fires.

The background canvas is deliberately still rebuilt on every genuine size change: its dimensions
feed the gradient geometry (`cx`/`cy`, the radial radius, the linear-gradient angle) and the
`backgroundImageFit` cover/contain math, and `scene.background` stretches that texture over the
viewport — so its aspect has to track the display or backgrounds shear.
