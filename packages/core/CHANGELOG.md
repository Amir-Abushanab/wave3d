# @wave3d/core

## 0.9.0

### Minor Changes

- [`96bc785`](https://github.com/Amir-Abushanab/wave3d/commit/96bc785d1ef34e41d57326527efaff91b2293fbe) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - The studio can now run on the TSL/WebGPU renderer: `@wave3d/core/studio` gains `loadStudioWaveRendererGPU()`, a lazy loader for a drop-in `StudioWaveRenderer` on the TSL backend (construct, then `await renderer.init()`). In the studio app it's the new **Actions → renderer** picker (or `?backend=webgpu`); switching reloads with the live config carried in the share-link hash.

  Under the hood the TSL backend's overrides are now a mixin, `withTslBackend(Base)`, applied to `WaveRenderer` for the unchanged `WaveRendererGPU` and to `StudioWaveRenderer` for the studio — the two override disjoint hook sets, so the ~1,000 lines of editor code needed no fork. The lazy-chunk boundary is unchanged and still enforced: `three/webgpu` stays out of every eager entry, including `./studio`.

- [#24](https://github.com/Amir-Abushanab/wave3d/pull/24) [`cf7b331`](https://github.com/Amir-Abushanab/wave3d/commit/cf7b331189fd34e3bcc2071e85186819b2fa6e51) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Device tilt as an interaction input. `tiltX` / `tiltY` join the binding sources, reading the phone's
  orientation sensor normalized 0..1 the way a ball would roll on the screen and resting at 0.5 in
  whatever pose the reader was already holding — the first reading becomes the neutral centre, and the
  axes are rotated by the screen angle so `tiltX` means "toward the right edge" in every orientation.

  Binding either source is what arms the sensor; a scene that mentions neither attaches no
  `deviceorientation` listener. `SceneConfig.interaction.tilt` tunes it (`range`, `smoothing`,
  `invertX` / `invertY`) and `tilt.pointer` lets tilt stand in for the cursor, so a scene authored
  entirely for `pointerX` / `pointerY` and the per-wave hover field comes alive on a phone without a
  second set of bindings.

  **iOS gets no tilt, on purpose.** Safari gates the sensor behind a modal permission dialog, and
  nothing here opens one — a tilt-bound scene on an iPhone reads 0.5 on both axes and renders exactly
  as it would with no tilt at all. A decorative effect is not worth interrupting a reader for, so tilt
  is an enhancement some phones simply don't get. `enableTilt()` on the renderer / handle / element is
  the explicit opt-in for a page where tilt is the point; `tiltStatus()` reports where the sensor
  stands, and `recenterTilt()` re-takes the neutral pose after a change of grip.

  **The interactivity runtime is now a lazy chunk.** The controller, its listeners, the applier tables
  and the new tilt sensor (~3.8 KB gzipped) used to ship in every bundle, including the scenes that
  never interact; they are now reached through a dynamic import, and the eager core chunk drops from
  46.3 KB to 43.1 KB gzipped. The config predicates the renderer needs synchronously — the ones that
  decide which shader defines compile — moved to `renderer/interactionGates.ts`, and a
  dependency-cruiser rule fails the build if anything in the eager graph imports the runtime again.

  The one behavioural difference: interaction goes live a chunk-fetch after the first frame rather
  than on it. Nothing to react to until a reader moves, so it is invisible in practice —
  `setInteractionInput` calls made in that window are staged and replayed, and `enableTilt()` reports
  false (and starts the fetch) if it somehow lands first.

## 0.8.0

### Minor Changes

- [`d208e12`](https://github.com/Amir-Abushanab/wave3d/commit/d208e12a799bbf9ad05bdc0d5faf2686f11e2b00) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Particles now react to the pointer field, so a wave's dust belongs to its wave under the cursor instead of staying pinned to the un-poked surface.

  The pointer-field math (screen falloff, ribbon-flow footprint, agitate / push / drag-wake / click-ripples) moved into one shared GLSL chunk that the wave vertex shader and the particle emitter both call — the same single-source-of-truth split already used for the wave deform. Two samples per mote:

  - **Weld** — the field at the mote's spawn point, so dust still sitting on the surface takes the ribbon's own displacement. Weighted by how far the mote has actually travelled from its birth patch (not by age), so dust with no drift / rise / swirl / wander clings for its whole life.
  - **Shove** — the field at the mote's own position, so the cursor also pushes dust that has drifted free and a click ripple blows through the cloud. Scaled by the new `particles.pointerShove` (default 1; 0 = airborne motes ignore the cursor), exposed as "cursor shove" in the studio.

  Inert without a hover field on the wave: the particle program compiles without the pointer path at all, and a wave that renders pixel-identically today keeps doing so.

- [`d590076`](https://github.com/Amir-Abushanab/wave3d/commit/d590076adf123e1e1bb87550023877948e78fe14) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add `shape: "sprite"` — use your own artwork as the dust. Set `particles.spriteUrl` to an SVG (or raster) `data:` URI or URL and every particle in the field draws it.

  SVG is the format to reach for: the whole config travels inside save-states and share links, and a usable sprite is under a kilobyte where a PNG would be tens of them.

  **Cost is per field, not per particle.** The artwork is rasterized once into a single 256² texture that every particle samples, so a 20k-particle sprite field costs ~256 KB of texture — less than the per-particle attribute buffers that field already uploads (~800 KB). In the fragment shader a texture fetch replaces the procedural branch, so it is if anything cheaper than `star`.

  Details worth knowing:

  - **Tinted** by `color` / `color2`, so the field's colour knobs keep working. White artwork takes the tint exactly; coloured artwork multiplies it.
  - **Letterboxed** into a square, because a point sprite always is. Mipmapped, since `sizeJitter` and the birth/death fade draw one texture across a wide range of pixel sizes.
  - **Degrades, never blanks**: until the image rasterizes — or if it fails — the field draws "glitter". A failed URL is latched so it is not retried every frame.
  - **Size matters**: the built-in shapes are tuned for a 2-6px dot, which is far too small for artwork to read. The studio lifts the size on first upload.
  - Loading follows the background-image pattern (load → bind → request a redraw) rather than the palette's fire-and-forget loader, and preset thumbnails now preload sprite artwork — so a paused renderer, thumbnail, or poster does not capture blank dust.

  Gallery submissions accept inline SVG, so a sprite wave can be published with its artwork attached; embedded raster and video are still rejected, and the 24 KB file cap still applies.

### Patch Changes

- [`3c80b31`](https://github.com/Amir-Abushanab/wave3d/commit/3c80b315e19ce54bea48a5b2e0e5c08d50eee442) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Give each "Particle Zoo" specimen its own way of answering the cursor, so the preset showcases the interactivity layer as well as the particle styles — and shows each dust field reacting alongside its ribbon.

  | specimen            | mechanic                                                                        |
  | ------------------- | ------------------------------------------------------------------------------- |
  | Embers (dome)       | `hover.agitate` — stir the fire, embers scatter                                 |
  | Snow (sheet)        | `hover.push` negative — press a hollow into the drift, flakes sink with it      |
  | Sparks (radial fan) | `press.ripple` — a ring radiates from the click and blows out through the burst |
  | Fireflies (helix)   | a `hover → helixPhase` binding — winds the coil, dust rides round with it       |
  | Bubbles (twist)     | `hover.wake` + `thin` — drag a trough through the water, bubbles trail in it    |

  Fireflies deliberately has no `hover` block: its particle program never compiles the pointer path at all, yet its dust still follows the wave, because each field mirrors its wave's live shape uniforms every frame. The other four set `particles.pointerShove` to taste (snow barely moves, sparks take the full ring).

  Scene-level: a tight `radius` (0.22) so hovering one specimen doesn't stir its neighbours, and `touch: true` — it's a showcase, and the listeners are passive so it doesn't block page scrolling.

## 0.7.0

### Minor Changes

- [#19](https://github.com/Amir-Abushanab/wave3d/pull/19) [`51e9f48`](https://github.com/Amir-Abushanab/wave3d/commit/51e9f480f98da5b7a446115a282ec34355a9e90d) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add two optional, default-off features for building luminous "plume" compositions:

  - **Radial wave mode** — a per-wave vertex-shader warp (`radialAmount`/`radialArc`/`radialSpread`/`radialRadius`/`radialCenter`) that fans the ribbon's length radially from the local origin, so the combed fibers read as individual radial strands. Placed with the wave's `position` transform.
  - **Per-wave particles** — an additive GPU dust/sparkle layer (an optional `particles` block on each wave) whose sprites spawn on that wave's deformed surface / edge and drift outward, driven entirely by `uTime` + a seeded layout so it stays deterministic (timeOffset scrub / loopSeconds / paused all hold).

  Each is byte-identical when off (no scene node, pass, or shader `#define`). Ships with a "Latte Ring" preset and studio controls.

- [#19](https://github.com/Amir-Abushanab/wave3d/pull/19) [`51e9f48`](https://github.com/Amir-Abushanab/wave3d/commit/51e9f480f98da5b7a446115a282ec34355a9e90d) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Particles are **per-wave**: each wave carries its own optional `particles` block, and every sprite spawns on THAT wave's DEFORMED surface / edge (silk dissolving into glitter) and drifts outward from it. The vertex deform (displacement / helix / twist / radial) is extracted into a shared `waveShapeChunk` GLSL function used by BOTH the wave vertex shader and the particle shader, so the dust rides the exact same deform as the ribbon it comes off. The extraction is verified byte-identical for existing waves via the pixel-digest harness.

  Knobs: `count / size / color / color2 / seed / life / speed / twinkle / sizeJitter`, plus `edgeBias` (0 = spawn across the whole surface … 1 = the outer rim / edge only), `drift` (outward distance as it ages), and `bias` (−1..1, skews the spawn toward one flank of the edge). `speed` is a motion multiplier (1 = default, 0 = frozen) that scales the dust's cadence independently of the wave's own speed — and snaps to whole cycles under a seamless `loopSeconds`.

  **Variety** beyond the round glitter — motion styles `rise` (screen-vertical buoyancy: + embers, − snow), `swirl` (orbit around the wave), and `wander` (curl-noise turbulence for fireflies / motes); a `shape` render style (`glitter` / `soft` / `ring` / `star` / `streak`); and `color2` for two-tone dust. Each is 0 / default = off. Studio controls live in a per-wave "Particles" folder with a **"style" picker** that loads ready-made looks (glitter / embers / snow / sparks / fireflies / bubbles — exported as `PARTICLE_PRESETS`), and a **"Particle Zoo"** preset demos all of them in one scene (five waves, one style each). Byte-identical when off — an absent block means no THREE.Points for that wave.

### Patch Changes

- [#19](https://github.com/Amir-Abushanab/wave3d/pull/19) [`51e9f48`](https://github.com/Amir-Abushanab/wave3d/commit/51e9f480f98da5b7a446115a282ec34355a9e90d) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Preset/gallery thumbnails now keep a preset's **own dark background** instead of always swapping in a white card. Any solid-theme preset authored on a dark, opaque colour (e.g. "Latte Ring") reads best on that dark ground — a bright wave shows against it and bloom behaves — where the white card washed the warm wave out. Light/transparent-background presets still get the white card (with the light-scatter passes zeroed) so their shape stands out.

## 0.6.0

### Minor Changes

- [#17](https://github.com/Amir-Abushanab/wave3d/pull/17) [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Make the helix drivable from interaction inputs: `helixPhase`, `helixTurns` and `helixRadius` join the per-wave binding targets, so `{ source: "scroll", target: "helixPhase", to: 360 }` spins a coil exactly one turn down the page, and hover or press can wind, unwind, or open it.

  `waveDefines` now compiles the helix path for a wave that binds one of these but authors `helixRadius`/`helixRoll` at 0 — otherwise driving the radius up from a resting 0 would have nowhere to land. Same precedent as `detailAmount` and the second displacement octave. Waves with neither a helix nor a helix binding are unaffected.

- [#17](https://github.com/Amir-Abushanab/wave3d/pull/17) [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add a **Corkscrew** preset showcasing the helix mode, and surface the Helix section better in the studio.

  Corkscrew is a single wave with `helixRoll: 1`, which rolls the ribbon's cross-section in step with the sweep so the flat strip becomes an auger blade winding around its own length axis; `helixRadius` then lifts that blade off the axis so the turns read as a screw thread rather than a flat twist. It carries a mesh gradient rather than a stop ramp, so the colour field runs along the blade and each turn picks up a different part of the spectrum. There is no twist on it at all — the shape is unreachable with `twistFrequency`, whose `expStep` angle is monotone and can only ramp once.

  It is framed down the axis rather than side-on, so the coil reads as a screw receding into the frame and each turn shows its blade face instead of an edge.

  The studio's Helix folder is now open by default like its sibling shape sections, and has its own icon: a coil seen side-on. Two crossing strands (the DNA glyph) collapse into a figure-8 at the 13px the panel actually renders, and more than two loops turn to mush, so it's a two-loop spring — and deliberately unlike the Twist rotate-arrow sitting directly above it.

- [#17](https://github.com/Amir-Abushanab/wave3d/pull/17) [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add a **helix** shape mode and wireframe **rungs** — periodic shapes the wave could not previously express.

  The three twists rotate by `freq * expStep(uv, power)`, and `expStep` is a monotone falloff whose crossover always sits at the ribbon's midpoint regardless of power, so a twist can only ever ramp once — it can't coil. Their axes are also 45°/90° off the ribbon's length, so pushing the frequency up just balls the sheet into a rosette rather than winding it. Four new per-wave fields sweep a _periodic_ angle along the length instead:

  - `helixTurns` — full turns from one end of the ribbon to the other.
  - `helixRadius` — carries the whole ribbon around the axis with its orientation intact, so a narrow ribbon reads as a single strand. Two waves 180° apart in `helixPhase` are a double helix that genuinely swaps depth at each crossing.
  - `helixRoll` — rolls the ribbon's own cross-section in step with the sweep (1 = a rigid twisted ribbon), swinging its two long edges onto opposite sides of the axis so one wave becomes a ladder whose edges are both strands. The roll is about the ribbon's width centre (`RIBBON_Z_CENTER`), not the origin — the fold leaves the width at [-100, 84], so rotating about the origin would put the two edges at radii 100 and 84.
  - `helixPhase` — degrees; the per-wave knob that puts a second wave on the opposite side of the same helix.

  The wireframe theme gains `rungAmount` / `rungThickness`, a second line family carved at constant `uv.y` so it runs ACROSS the ribbon where `lineAmount`'s lines run along it — the two cross into a ladder. Rung width comes from `fwidth`, so a rung holds its pixel width at any zoom or ribbon scale (the lengthwise term's `dFdy(vUv).x` is the derivative of the wrong axis for this direction).

  Both are additive and default to off: the helix path only compiles when `helixRadius` or `helixRoll` is non-zero, rungs only when `rungAmount > 0` on a wireframe wave, so any existing config compiles the same program and renders the same pixels.

### Patch Changes

- [#16](https://github.com/Amir-Abushanab/wave3d/pull/16) [`c32bef1`](https://github.com/Amir-Abushanab/wave3d/commit/c32bef107c6f68ff2c09447155ebabb982854349) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Backfill every config field the studio binds, so a partial or hand-edited config can't produce an unusable panel. `ensureSceneDefaults` skipped `timeOffset`, `background` and `transparentBackground`, and `normalizeWave` skipped `twistMotion` — a config omitting one left the value `undefined`, which Tweakpane rejects with `No matching controller for '<field>'`. Separately, `normalizeWaveColour` threw `Cannot read properties of undefined` on a wave with no `palette` at all (`{"waves":[{}]}`), out of the very normalizer meant to make untrusted configs safe.

  Also repairs the _elements_ of `lights` and `noiseBands` (only the arrays themselves were checked, so `"lights":[{}]` left `color`/`intensity`/`position` absent, and non-object entries are now dropped), and hardens the numeric guards to reject `NaN`/`Infinity` — `typeof NaN === "number"` passed, so a poisoned value reached the shader and rendered a blank frame with no error. Out-of-range values are deliberately left alone rather than clamped, so a `timeOffset` beyond the studio slider's range still drives a paused scene frame by frame. Normalizing every preset and the default config is byte-identical to before.

- [#17](https://github.com/Amir-Abushanab/wave3d/pull/17) [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Fix a config with bloom rendering a **blank white thumbnail**.

  `prepThumbConfig` swaps the authored background for a white card so thumbnails read against the picker UI, but it left the post passes that scatter light out of bright pixels — `bloomStrength` and `innerLight` — running at values tuned against the original (usually dark) background. White sits far above any sane `bloomThreshold`, so those passes bloomed the card itself and washed the whole frame out: a bloom preset came back 0.3% non-white, i.e. blank. Both are now zeroed alongside the background swap.

  Only configs that actually set bloom or inner light are affected; every other preset's thumbnail is pixel-identical.

- [`6d556f6`](https://github.com/Amir-Abushanab/wave3d/commit/6d556f6a1ca6b72ff4f820d9b795e5a7d478ea0f) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Document the coarse-pointer gate in the agent skill. `SceneConfig.interaction.touch` defaults to `false` and drops touch pointers before any handler runs, but the skill described `press` ripples as firing on a "click/tap" without saying so — so hover/press values tuned for mobile silently did nothing. The skill now states the default, that opting in does not block page scrolling, and that `scroll` / `scrollVelocity` / `appear` are unaffected because they read container progress rather than pointer events.

- [#17](https://github.com/Amir-Abushanab/wave3d/pull/17) [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Fix waves added after the renderer was constructed rendering completely invisible. `uResolution` was seeded to `(1, 1)` in `makeUniforms()` and only ever written by `resize()`, so any wave created later — raising the wave count, or loading a multi-wave preset / share link / saved state through `setConfig` — kept `(1, 1)` until the next resize happened to fire. The solid theme's `edgeFade` vignette divides `gl_FragCoord` by `uResolution`, so the resulting screen coordinate is far above 1, `1.0 - smoothstep(1.0 - uEdgeFade, 1.0, sc)` collapses to 0, and the wave's alpha goes to zero everywhere: the mesh is in the scene, visible, and drawn (the draw call is issued and the triangles are submitted) but contributes no pixels. It bites at the default `edgeFade` of 0.04, and only stayed hidden because no shipped preset or gallery config has more than one wave.

  `makeUniforms()` now seeds `uResolution` from the current drawing-buffer size. Single-wave configs are unaffected — the constructor's own resize already set it.

## 0.5.0

### Minor Changes

- [`398a825`](https://github.com/Amir-Abushanab/wave3d/commit/398a8258308c3e4ab3528605718d2ad0a694a485) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add responsive framing controls, so a wave authored on a wide screen no longer arrives cropped on a
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

### Patch Changes

- [`f359f19`](https://github.com/Amir-Abushanab/wave3d/commit/f359f195df6ad75c210213b11496932a52f29711) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Fix two resize bugs that consumers could not patch from the outside, because the observer is
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

## 0.4.1

### Patch Changes

- [#11](https://github.com/Amir-Abushanab/wave3d/pull/11) [`cb924c7`](https://github.com/Amir-Abushanab/wave3d/commit/cb924c70e29d914cb650143d315d7c33d43edeed) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Bring the bundled `wave3d` agent skill up to date with the shipped API. It had drifted since 0.1.0
  and was missing:

  - the whole **post-effects** layer (`grain`, `blur`, `bloomStrength`, `innerLight`, `dither`,
    `halftone`, `halftoneCmyk`, `heatmap`, `paperTexture` and their knobs), including the
    `0` = pass-removed cost contract and which are scene- vs finish-zone
  - **`@wave3d/vite`**, the dev-time poster-capture plugin
  - **`posterFit`** (`"fill"` default | `"cover"` | `"contain"`)

  `metadata.library_version` is now synced from `@wave3d/core`'s real version by the root `version`
  script, so it rides the Version Packages PR instead of drifting again.

## 0.4.0

### Minor Changes

- [#9](https://github.com/Amir-Abushanab/wave3d/pull/9) [`08b957c`](https://github.com/Amir-Abushanab/wave3d/commit/08b957c3b981920845d68ebf32a9600d87f72715) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add config-driven post-processing effects to the wave renderer. Each is an optional
  `SceneConfig` field that defaults to off, so existing configs render byte-identically —
  a value of `0` removes the pass entirely (no cost).

  - **dither** — ordered Bayer dithering (`dither`, `ditherScale`, `ditherSteps`)
  - **halftone** — rotated dot screen (`halftone`, `halftoneCell`, `halftoneAngle`)
  - **halftoneCmyk** — subtractive CMYK halftone (`halftoneCmyk`, `halftoneCmykCell`)
  - **heatmap** — luminance-to-thermal remap (`heatmap`)
  - **paperTexture** — printed-paper grain/fibre (`paperTexture`, `paperTextureScale`)
  - **innerLight** — volumetric light streaks (`innerLight`, `innerLightDensity`,
    `innerLightDecay`, `innerLightX`, `innerLightY`)

  `dither` and `halftone` are near-exact ports of the corresponding
  [`@paper-design/shaders`](https://github.com/paper-design/shaders) fragment shaders
  (Apache-2.0, attributed in `THIRD-PARTY-NOTICES.md`); the rest are original. Also adds a
  `randomizePostFx` studio helper for sampling one effect at a time.

## 0.3.0

### Minor Changes

- [#3](https://github.com/Amir-Abushanab/wave3d/pull/3) [`6926a8b`](https://github.com/Amir-Abushanab/wave3d/commit/6926a8b81ddb8c05ccc9461cd89e2b28afaae38d) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add an optional, additive, default-off interactivity layer, scoped **per wave**. Each `WaveConfig`
  gains an `interaction` block with three parts: **`hover`** (a cursor-follow pointer field — local
  agitation, a ± repel/attract push dome, a drag-wake trough, strand-thinning, hue/lighten),
  **`press`** (click/tap ripples), and
  **`bindings`** that smoothly drive that wave's params from an input. Sources: `scroll`, `hover`,
  `pointerX`/`pointerY`, `pointerSpeed`, `press`, `scrollVelocity`, `appear`, and developer-fed
  `custom:*`. Each wave's hover field has its own `smoothing` (cursor-follow lag — vary it across a
  stack for a parallax drag). Shared inputs (one cursor + scroll: `radius`, `touch`) and scene-param
  bindings (`timeOffset`, `cameraZoom`, `blur`, `grain`) live on `SceneConfig.interaction`. Adds
  `setInteractionInput()` on the renderer and the shell `WaveHandle`, the React `interaction` prop
  (targets the first wave), and a Wave Studio authoring UI (per-wave Hover / Click & touch / Bindings
  sections plus a global inputs + scroll-preview folder). Entirely opt-in: omit the block(s) and the
  compiled shader and rendered pixels are byte-identical to before.

- [#3](https://github.com/Amir-Abushanab/wave3d/pull/3) [`6926a8b`](https://github.com/Amir-Abushanab/wave3d/commit/6926a8b81ddb8c05ccc9461cd89e2b28afaae38d) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add a `posterFit` option for the poster image's `object-fit`, and **change its default from `"cover"`
  to `"fill"`**.

  The live canvas renders edge-to-edge at the container's aspect, but the poster was hard-coded to
  `object-fit: cover` via an inline style consumers couldn't override — so it cropped, and the
  poster→canvas handoff visibly shifted the wave even when the poster matched the design. `"fill"`
  maps the poster into the box exactly like the canvas, so a poster captured at the container's aspect
  now hands off with no jump. Override with `posterFit: "cover" | "contain" | "fill"` (`@wave3d/core`
  option, `@wave3d/react` prop) or the `poster-fit` attribute on `<wave-3d>` — e.g. a non-wave /
  different-aspect placeholder that should crop rather than stretch can opt back into `"cover"`.

## 0.2.2

### Patch Changes

- [`e270931`](https://github.com/Amir-Abushanab/wave3d/commit/e270931a31d485d8cbf7adcb1bbc849d33b0e731) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Expose the offscreen thumbnail helpers from `@wave3d/core/studio`: `createThumbHost`, `prepThumbConfig`, and `renderThumbFrame` render a config to a still frame with a reused `WaveRenderer` (used by the studio's preset/history thumbnails and the wave gallery).

## 0.2.1

### Patch Changes

- [`0efadf6`](https://github.com/Amir-Abushanab/wave3d/commit/0efadf62fea3f3713ec917af2506cb13a1206266) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Rewrite the README and package description for clarity: a quick studio-to-site walkthrough, scannable exports, and tidied prose. No API changes.

## 0.2.0

### Minor Changes

- Add `handle.snapshot()` (with `SnapshotOptions`) to capture the running wave as an image, plus an optional fixed-frame `time` on `captureImage` / `snapshot` for reproducible posters.

### Patch Changes

- Migrate the renderer from the deprecated `THREE.Clock` to `THREE.Timer`, silencing a three.js deprecation warning.
