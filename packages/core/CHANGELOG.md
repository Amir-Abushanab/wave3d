# @wave3d/core

## 0.11.1

### Patch Changes

- [#33](https://github.com/Amir-Abushanab/wave3d/pull/33) [`dcef321`](https://github.com/Amir-Abushanab/wave3d/commit/dcef321dc3b393b37a4f729a0a7e00ae4f50cc38) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Glass: the caustic is continuous across the mesh. It was the Jacobian of the refraction taken from
  screen-space derivatives of the interpolated normal — exact, but a different constant in every
  triangle, and the fold's pole in `1/|det J|` amplified each jump into a visible cell. On a coarse or
  heavily bent sheet the caustic drew the mesh: a lattice of squares stepping along every bright
  ridge, at any `glassCaustic` above zero.

  The geometry now bakes one ring of grid neighbours further out, the vertex stage builds the normal
  at both neighbours as well as at the vertex, and the fragment gets `dN/du`, `dN/dv`, the two
  tangents and where a unit uv step lands on screen — all interpolated, so continuous across shared
  vertices. The caustic differentiates along those, chained through the inverse of the (u, v) → pixel
  map, which is linear under the orthographic camera. Three more deformations per vertex, on glass
  waves only. Parity, both backends: Liquid Glass `mae` 0.08 → 0.06, synthetic glass 0.23 → 0.21.

## 0.11.0

### Minor Changes

- [#31](https://github.com/Amir-Abushanab/wave3d/pull/31) [`4c8a1ac`](https://github.com/Amir-Abushanab/wave3d/commit/4c8a1acd08818df5ff8a5f82c4021a811990b750) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Disintegration — a wave can now come apart. `WaveConfig.dissolve` sweeps a front across the ribbon
  and eats it away chunk by chunk, so the surface CRUMBLES rather than fading: holes open in it, the
  holes merge, and the last fragments break off. Absent ⇒ intact, and the `DISSOLVE` path is never
  compiled.

  ```ts
  dissolve: { amount: 0.3, axis: "screenX", reverse: true, band: 0.55, scale: 150, blocky: 0.75, dust: 1 }
  ```

  `amount` is the whole animation (0 whole, 1 gone, whatever the `band` fray width) and it is a
  binding target, so `{ source: "scroll", target: "dissolveAmount", to: 1 }` snaps the wave as the page
  moves. `scale` dices the sheet and `blocky` sets the chunk character, from organic tatters to hard
  quantized cells.

  **The axis can leave the ribbon.** `"length"` / `"width"` ride the wave's own uv and bend with it;
  `"screenX"` / `"screenY"` are a straight line on the CANVAS, which is what lets a whole multi-wave
  stack crumble as one object — give every wave the same axis and amount and they share one edge
  however each is rotated. The crumb pattern stays on the surface either way.

  **The dust is the surface.** `dissolve.dust` pins the wave's own `particles` field to that same
  front: a mote does not exist until the front reaches its patch, then peels off and drifts on from
  there, so the debris and the holes are one event instead of two effects that happen to overlap.
  Under a screen-space front the debris also blows along the sweep, away from the part still standing.

  Three supporting knobs, each inert at its default:

  - `ParticlesConfig.shape: "square"` — a hard-edged screen-aligned chip, the blocky debris a dissolve
    sheds — and `ParticlesConfig.blend: "normal"`, which alpha-blends the field instead of adding it.
    Additive dust can only brighten, so it is invisible on a white page and can never read as dark;
    `"normal"` is what soot, ash and ink need.
  - `lineSharpness` (wireframe) steepens the strand profile, which turns `lineThickness` into a DUTY
    CYCLE. The stripe is a soft ramp by default, so thickness alone goes from pale hairlines to flat
    solid without ever passing through dense ink; hardening it gives engraved black strands with the
    page still showing between them. `lineDepthFade` turns off the recede into the background colour,
    which a deep or stacked composition needs — the default is tuned for a single ribbon.
  - `radialCone` lifts the radial fan out of its own plane as it spreads, turning the flat plume into a
    TRUMPET whose combed strands run down the slant into the throat — a shape neither the twists nor
    the helix can reach, since a helix carries the ribbon around an axis but its WIDTH never follows a
    slant. `radialSwirl` curls each arm around the throat (see above).

  **`WaveConfig.path` — a centreline the ribbon is swept along, dragged in the studio.** Every other
  deform bends a ribbon whose centreline is fixed, so none of them can make one that changes direction
  more than once, crosses itself, or is wide here and narrow there. A path can, because it IS the
  centreline: control points in the wave's local space, each with an optional `width` and `twist`.
  Absent ⇒ the straight ribbon, byte-identical.

  Points are swept by ARC LENGTH with a parallel-transported frame. Both matter: sampling by curve
  parameter would bunch the strand comb wherever the author happened to crowd points, and a Frenet
  frame would flip the ribbon 180° at every inflection. A path whose last point sits on its first is a
  closed ring — that repeat is the whole declaration, rather than a `closed` flag for something the
  points already say. `arcPath(turns)` builds one.

  A straight path is exactly the identity for ANY wave — twists, helix and radial fan included — which
  is what lets the studio give a ribbon a path on double-click without it moving. Points are where the
  centreline goes in the wave's local space, and the ribbon's own centreline runs along z = −8, so
  `straightPath()` sits there. `parity --path-identity` holds this to float noise on both backends.

  **Double-click a ribbon in the studio and shape it like putty.** The primary gesture is dragging the
  RIBBON, not a control point: the push falls off smoothly along the length, so only the part under the
  cursor follows and the rest stays where you left it (Shift narrows the push from a palm to a
  fingertip). The path densifies itself on the first sculpt, because a three-point path can only be
  bent as a whole and that feels like bending wire rather than pressing clay. Control points remain for
  precision — drag a handle, double-click one to remove it, double-click the ribbon to insert one — and
  Escape leaves.

  While the mode is on, a bar lists the gestures (none of them are discoverable from a canvas) and the
  cursor reports what is under it: grab on the ribbon, pointer on a control point, move on empty space.

  Picking goes through a proxy strip rebuilt from the current frames, because the ribbon's vertices are
  only deformed on the GPU: a raycast against the wave's own mesh would hit the straight ribbon the
  geometry was born as rather than the curve on screen. The frames themselves are baked into a small
  texture the vertex shader samples, so a sculpt costs one 128×3 texture write per frame rather than an
  80k-vertex geometry rebuild.

  This REPLACES three controls added earlier in this same unreleased batch: `pinch` (a path's per-point
  `width`), `wrapAmount` (a closed path) and `helixTaper` (a path whose points spiral outward). All
  three were knobs for shapes the centreline already says.

  `helix*` and `radial*` are NOT replaced, and the difference is worth knowing: a path SWEEPS the
  ribbon with a transported frame, so it banks into its curves like a rollercoaster track, where a
  helix TRANSLATES the ribbon around an axis, so it keeps facing the same way — the same coil, a
  different object. The radial fan remaps the ribbon's WIDTH to an angle, which a centreline cannot do
  at all. And the helix is animatable where a path is not: `helixPhase` / `helixTurns` / `helixRadius`
  are binding targets, so scroll can spin a coil.

  Rungs (`rungAmount`, the cross-wise stripe family) are now usable as a wave's PRIMARY striping rather
  than just a DNA-ladder accent. `lineSharpness` hardens the merged coverage, after the rungs have been
  folded in, so a cross-wise family reaches dense ink the same way a lengthwise one does; and a rung
  whose period has gone sub-pixel now falls back to its ANALYTIC duty cycle — the flat tone those
  strands average to — instead of being point-sampled once per period, which is both what a compressed
  region should look like and where two backends previously stopped agreeing.

  `edgeFeather` now applies to the WIREFRAME theme as well as the solid one. Without it a wireframe
  ribbon stops dead at its end-cap — a flat cross-section that reads as a straight cut drawn across the
  strands, glaring the moment a ribbon curls back into frame. Clear-gap strands also stop writing
  DEPTH: they are thin transparent slivers layered many deep, and two sheets passing near-coplanar
  would otherwise decide who occludes whom by depth precision, which is arbitrary and differs between
  backends; with the write off they composite in wave order, which is stable.

  `maxWidth` is **removed**. It multiplied the uv derivative inside the same power as `lineThickness`,
  and pow(a·b, p) = pow(a, p)·pow(b, p) — so every value of it was already reachable by scaling the
  thickness, and at `lineDerivativePower: 0` (what a close-framed wave wants) it did nothing at all.
  The reference width is now the 1232 it always defaulted to, so a wave that left it alone is
  byte-identical; a config that SET it renders with thicker strands, and the fix is one multiplication:
  `lineThickness × (maxWidth / 1232) ^ lineDerivativePower`.

  `lineGapColor` decides what sits between the strands, which is most of what a wireframe looks like.
  Absent (the default, and what the theme has always drawn) the gaps take the page background: the wave
  is a window onto the page, and being opaque the near fold HIDES the far one, which is what makes a
  stack read as one solid object. A colour makes the ribbon its own body — bright combed lines on a
  dark ground. `"transparent"`, or an 8-digit hex, leaves the gaps clear so stacked folds show through
  each other: airier, at the cost of that occlusion. `radialSwirl` lets the radial
  fan's ANGLE advance along the band as well as across it; radius already grows with uv.y, so angle
  growing with it too is exactly what curls a straight arm into a spiral one wrapping the throat.

  Two rendering fixes the look depends on. The hardened stripe's edge is floored by its own
  SCREEN-SPACE derivative rather than a constant: a hard step on strands already thinner than a pixel
  is the classic moire generator, and holding the transition at ~1.4 px makes the edge exactly as crisp
  as the strand can support — razor-sharp where it resolves, box-filtered to a flat tone where it does
  not. And a `"square"` particle now cuts its OWN shard from its quad — its own extent, proportion and
  quarter-turn, with a squared extent for the heavy tail real rubble has — because a field of identical
  squares reads as grain rather than debris.

  **Wireframe strands can be lit.** Until now a strand's colour came from its uv alone, so it held one
  tone wherever the surface turned — which is why a dense wireframe reads as hatching however it is
  posed or coloured. `lineLight` (0..1) shades it with the same derivative normal, scene `lights` and
  view-facing term the solid theme uses. `lineRound` goes further and bends the normal ACROSS each
  stripe, so every strand is a half-round filament with a lit crest and dark flanks: that is what lets
  a specular (`lineSpecular`) run along one strand and not its neighbour, and it is the difference
  between a drawing of a combed surface and a combed surface. All three default to off, and the block
  is only compiled when `lineLight` > 0.

  One more thing worth knowing about the wireframe, learned the hard way: `lineDerivativePower` decides
  whether a close-framed wave has any ink at all. It scales strand thickness by the screen-space uv
  derivative — right for a ribbon seen whole, since strands then thicken where the surface turns away —
  but the bigger a sheet gets on screen the smaller that derivative is, so framed close the strands
  thin to pale grey exactly where they should be black. At 0, `lineThickness` alone is the duty cycle
  and the strands stay crisp at any zoom (it also removes a derivative from the cross-backend budget:
  the preset's parity went from 0.86% of pixels over 8 to 0.03%).

  New preset **Disintegration**: a broad combed sheet curling around a spiral eye over warm paper,
  crumbling into blocky debris across a straight edge, with scroll wired to finish the job.

- [#31](https://github.com/Amir-Abushanab/wave3d/pull/31) [`8c221fc`](https://github.com/Amir-Abushanab/wave3d/commit/8c221fc8dfaa50c9f58ef54dbfbbc3de69edde71) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - `webgl="auto"` now upgrades only onto a GPU.

  A software rasteriser (SwiftShader, llvmpipe, Microsoft Basic Render) keeps the poster and reports a
  new `"software-renderer"` fallback reason. The probe already asked for this via
  `failIfMajorPerformanceCaveat`, which does not deliver it — Chrome hands back a SwiftShader context
  regardless — so a machine with no usable GPU was running the full renderer at ~2 fps with seconds of
  blocked main thread, when the element was already carrying the right answer in its poster.

  `probeWebGL()` and `isSoftwareRenderer(gl)` are exported, because otherwise every consumer wanting
  this writes the same `WEBGL_debug_renderer_info` read, and the failure mode is silent: the extension
  is hidden under some privacy settings, and treating "cannot tell" as "software" downgrades people
  with a perfectly good GPU who then see a poster forever with nothing to report. An unreadable
  renderer counts as hardware.

  If you want the live render on a software renderer, that is `webgl="force"`.

- [#31](https://github.com/Amir-Abushanab/wave3d/pull/31) [`7077a27`](https://github.com/Amir-Abushanab/wave3d/commit/7077a279a7624be2f52c38fbfbd676ceac7b3cee) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - `WaveConfig.name` — call a wave something. Absent ⇒ it stays "Wave 3". The studio binds it at the
  top of each wave's folder and uses it for the folder title and the path-editing cheatsheet, because
  a stack of "Wave 1…5" says nothing about which one is the collar and which is the sheet.

### Patch Changes

- [#31](https://github.com/Amir-Abushanab/wave3d/pull/31) [`daf59ce`](https://github.com/Amir-Abushanab/wave3d/commit/daf59ce6155f50a0aef5e3d45b6d379e7fe3d530) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Double-clicking empty space now leaves path editing, as it was always meant to. The wave being
  edited is excluded from `pickWave`'s bounding-sphere fallback — on a large ribbon that sphere covers
  most of the viewport, so every double-click re-picked the same wave and Escape was the only way out.

- [#31](https://github.com/Amir-Abushanab/wave3d/pull/31) [`8fce3d3`](https://github.com/Amir-Abushanab/wave3d/commit/8fce3d38efccc5fb881378d882275171fb6462e1) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Glass: the layer count follows the deformed sheet, frost stops paying for an invisible blur, and a
  soft edge no longer draws a dark line.

  - **Thickness and droplet fusion read the wrong shape.** The layer-count capture was drawn with a
    stock override material, whose vertex stage knows nothing of the wave's deformation and which
    culls back faces — so it counted the rest-pose plane, front faces only. Measured against the
    normal pass (the wave's own program): a tenth of the real silhouette on Liquid Glass. Each glass
    wave now has a companion program on its own vertex stage and uniforms; the two captures match
    exactly, on both backends.
  - **Frost is gated on its radius in pixels.** The default 0.08 is a 0.29 px scatter, which eleven
    taps can only average back to the sample they surround — 33 backdrop taps per fragment for
    nothing. One RGB gather now, and none under half a pixel.
  - **Edge feather and opacity fade toward the unbent backdrop.** Glass draws opaque, so scaling the
    colour by an alpha no blend ever reads faded the feather toward black and drew a hard dark line
    along the silhouette. This was also the "unexplained" two-level darkening on the WebGPU backend:
    both glass parity cases now pass the thresholds with no allowance.
  - **Glass gets a vertex-stage normal, and the normal pass is gone.** The geometry bakes each
    vertex's two grid neighbours; the vertex shader runs the same deformation on them (pointer bump
    included) and crosses the tangents, so the normal is exact and interpolates smoothly where the
    fragment's `dFdx` normal was constant per triangle — a 120 px refraction turned every triangle
    edge into a seam. The caustic is now the Jacobian of the offset from ±3 px finite differences of
    that interpolated normal in the same pass, so the normal buffer, its render target and the third
    geometry pass are gone. Bent images are coherent now; presets tuned against the old faceted
    refraction (Liquid Glass) look smoother and blobbier than before.
  - **TSL: varyings created inside `positionNode` were never reaching the fragment.** The closure
    runs when the vertex stage is _built_, after `buildWaveMaterial` has returned, so a varying
    handed to the fragment builders by value was always `null` — the glass normal silently fell back
    to the faceted one on WebGPU, and the pointer field's hue shift, lighten and strand thinning have
    been missing on that backend since they were ported. Both are now read at build time, and a
    missing varying throws instead of falling back.
  - The backdrop excludes waves by depth toward the camera (array order breaks ties), so a wave
    moved behind a sheet stays visible through it; the passes restore the clear colour; a wave
    switched to glass live leaves the transparent list.

  Liquid Glass at 1000×700: 2.1 → 1.4 ms/frame on WebGL, 1.1 → 0.7 on WebGPU. Parity: Liquid Glass
  mae 0.08, synthetic glass 0.23, both without an allowance.

- [#31](https://github.com/Amir-Abushanab/wave3d/pull/31) [`2d93a06`](https://github.com/Amir-Abushanab/wave3d/commit/2d93a06cf281886b39ff6cabf1682110ec5638e5) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Studio: **Finish now sits above Color & Gradient**, so the material is chosen before the palette
  whose meaning it changes. Under glass, `blend` and Noise Bands are greyed out or hidden (the glass
  shader never reads them) and the palette editor carries a note that the palette only sets the hue of
  the transmission. **Caustics, fold thickness and droplet fusion** get sliders, and every glass
  control has a hover hint grounded in what the shader does with it. The `wave3d` skill gains a glass
  section.

  Shaping a path: each point's pick target is nearly twice the dot, and the cursor says what a click
  here does — an arrow with a "+" over the ribbon (double-click adds a point, drag sculpts), a "−"
  over a point (double-click removes it, drag moves it), and a plain pointer on a point that cannot be
  removed.

- [#31](https://github.com/Amir-Abushanab/wave3d/pull/31) [`40eb90d`](https://github.com/Amir-Abushanab/wave3d/commit/40eb90d6c1a0729db3932c264f3f1a19a83082d5) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - A wave no longer fast-forwards when you come back to its tab. Leave a page while the engine was still
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

- [#31](https://github.com/Amir-Abushanab/wave3d/pull/31) [`0d60f25`](https://github.com/Amir-Abushanab/wave3d/commit/0d60f25b59d2b0f2984d3999bac4f72782c6a619) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - The path-editing hint bar now has a **Done** button, names the two double-click gestures that were
  undocumented (double-click another wave to shape that one; double-click empty space to leave), and
  sits clear of the history cluster's default dock instead of directly on top of it.

- [#31](https://github.com/Amir-Abushanab/wave3d/pull/31) [`28016aa`](https://github.com/Amir-Abushanab/wave3d/commit/28016aa11dee61288c3a5f34bf5a30f95b11c81a) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Fix a sculpted path losing its twist. `PathSample` now reports the roll it applied, and the
  studio's densify step carries it across instead of writing `twist: 0`.

  The studio resamples a path to more control points before sculpting it, so there is something local
  to push. A frame cannot be stored in a `PathPoint` — only x/y/z/width/twist can — so dropping the
  roll there resampled the ribbon back to unrolled. On a 360° twist that flipped the surface a full
  half-turn (measured: 179.5° of frame divergence, now 6°, which is ordinary 9→15 resampling error).

  It only bit paths under 12 points, since densify is a no-op above that — which is why a
  hand-authored path with many points never showed it.

- [#31](https://github.com/Amir-Abushanab/wave3d/pull/31) [`efb4eb0`](https://github.com/Amir-Abushanab/wave3d/commit/efb4eb0c0f12c90630dd79715a21b8fea51676b5) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Selecting a wave in the viewport now reveals its config. Double-click a ribbon, or pick one with the
  transform gizmo, and the panel expands that wave's folder, scrolls it into view and flashes it —
  instead of leaving you to find "Wave 3" in a rail of identical folders.

  `StudioWaveRenderer.onWaveChanged` now carries the selected wave's index, matching `onLightsChanged`.

- [#31](https://github.com/Amir-Abushanab/wave3d/pull/31) [`b9ebf9f`](https://github.com/Amir-Abushanab/wave3d/commit/b9ebf9fd48f445d0b9ba4eb8519581dfe349f2e9) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Fix transparency on the WebGPU backend. Anywhere a wave was partly transparent it composited too
  bright — the soft ENDS every ribbon has by default (`edgeFeather`), the antialiased flank of every
  wireframe strand, every particle, and any wave with `opacity` below 1.

  `NodeMaterial.setupOutput()` does call `setupPremultipliedAlpha()` — but on its own `basicOutput`,
  which it discards the moment a custom `outputNode` is set. So the wave material was getting the
  premultiplied BLEND FACTORS without the premultiply. Since `blendMode` defaults to `"squared"`,
  which asks for premultiplied factors, this was every wave. The material now premultiplies its own
  output, exactly as the GLSL does under the `PREMULTIPLIED_ALPHA` define Three injects for it.

  WebGL was always correct and is untouched — byte-identical. The scale of the WebGPU error, measured
  against it: a ribbon at `opacity: 0.5` went from 13.3 % of its pixels visibly wrong to 0.02 %, and
  the densest particle case in the parity suite from `mae` 12.18 to 0.17. The cross-backend suite goes
  from 7 of 39 configs passing to 34.

  It hid for so long because the opaque body of every frame kept agreeing perfectly, so the residual
  looked like "dense additive dust is a hard case" rather than a bug — which is what the parity
  README used to say.

## 0.10.0

No changes in this release.

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
