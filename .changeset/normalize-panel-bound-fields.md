---
"@wave3d/core": patch
---

Backfill every config field the studio binds, so a partial or hand-edited config can't produce an unusable panel. `ensureSceneDefaults` skipped `timeOffset`, `background` and `transparentBackground`, and `normalizeWave` skipped `twistMotion` — a config omitting one left the value `undefined`, which Tweakpane rejects with `No matching controller for '<field>'`. Separately, `normalizeWaveColour` threw `Cannot read properties of undefined` on a wave with no `palette` at all (`{"waves":[{}]}`), out of the very normalizer meant to make untrusted configs safe.

Also repairs the _elements_ of `lights` and `noiseBands` (only the arrays themselves were checked, so `"lights":[{}]` left `color`/`intensity`/`position` absent, and non-object entries are now dropped), and hardens the numeric guards to reject `NaN`/`Infinity` — `typeof NaN === "number"` passed, so a poisoned value reached the shader and rendered a blank frame with no error. Out-of-range values are deliberately left alone rather than clamped, so a `timeOffset` beyond the studio slider's range still drives a paused scene frame by frame. Normalizing every preset and the default config is byte-identical to before.
