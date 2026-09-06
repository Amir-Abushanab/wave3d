---
"@wave3d/element": minor
---

Add a `fade-ms` attribute to `<wave-3d>`, exposing the shell's `fadeMs` option (poster→canvas crossfade duration, default 300ms) to the framework-agnostic element. `fade-ms="0"` swaps with no crossfade, which is what you want when the poster and the first live frame already match — a long dissolve between a frozen still and an animating scene is visible precisely because the two are no longer the same frame by the time it ends. Previously only reachable through `createWave`, so element users had no way to tune it.

Also documents capturing posters at the device pixel ratio they will be displayed at: `snapshot()` returns the canvas backing store, so a headless capture at the default `deviceScaleFactor: 1` produces a poster at half the resolution a 2× display renders the live canvas at, and the handoff shows up as a sharpening.
