---
"@wave3d/core": patch
---

A wave no longer fast-forwards when you come back to its tab. Leave a page while the engine was still
loading and the renderer was built with the document hidden — but it assumed it was visible
(`pageVisible = true`, never read from the document), so it marked itself running with no frame to
run on. Returning fired a `visibilitychange` that found nothing to restart, the delta baseline was
never reset, and the first frame was handed the whole absence at once while the intro ramp was still
at zero: `time × ramp` then swept minutes of motion through about a second. Measured on a live site,
19.8 s of wave time in the first 600 ms after a 20 s absence.

The renderer now reads `document.visibilityState` when it is built, the same as `@materials3d/core`.
And a single frame can no longer advance the clock by more than a second, which covers the same stall
where no `visibilitychange` arrives to announce it — an embedding webview that parks
`requestAnimationFrame`, a debugger pause, a sleeping machine. It is a ceiling rather than a jitter
clamp on purpose: recordings run on this same wall-clock loop, so a slow frame still advances by its
real length and a `loopSeconds` export still closes.

Old against new in a real hidden tab: built while hidden, 12.86 s of wave time in the first second
back, now 0.99 s; a 300 s stall with no event, the clock jumped 300.02 s, now 1.01 s.
