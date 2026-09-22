---
name: wave3d
description: >
  Add an animated 3D gradient "wave of light" (the glossy twisting ribbon seen across Stripe's
  designs) to a website as a drop-in component, powered by three.js/WebGL. Load this when a user
  wants a @wave3d package — @wave3d/react (<Wave3D>), @wave3d/element (<wave-3d>), @wave3d/core
  (createWave / mountWave) or @wave3d/vite (build-time posters) — or asks for an animated gradient
  hero background, a poster-first lazy WebGL wave, a CDN <script> wave, film-grain / bloom / dither
  / halftone post effects on a wave, or how to reproduce a wave exported from Wave Studio.
metadata:
  type: core
  library: "@wave3d/core"
  library_version: "0.11.0"
sources:
  - "wave3d/wave3d:README.md"
  - "wave3d/wave3d:packages/core/src/config/model.ts"
  - "wave3d/wave3d:packages/core/src/shell/createWave.ts"
  - "wave3d/wave3d:packages/core/src/presets.ts"
  - "wave3d/wave3d:packages/vite/README.md"
---

# @wave3d — drop-in animated 3D gradient waves

A self-optimizing gradient wave for the web: it shows a **poster first**, then **lazily** upgrades
to the live WebGL wave only when the browser can actually run it — falling back to the poster on
no-WebGL / Save-Data / reduced-motion / context-loss — with **three.js code-split out of the initial
load**. Framework-agnostic core, with React and web-component adapters.

## When to use

- Adding an animated gradient hero / background / accent to a site (React, Vue, Svelte, plain HTML).
- Reproducing a wave designed in Wave Studio (paste the studio's "Export code" snippet).
- You need a WebGL background that is well-behaved: lazy, poster-fallback, reduced-motion aware.

## Install

```sh
pnpm add @wave3d/react three     # React
pnpm add @wave3d/element three   # <wave-3d> for Vue / Svelte / plain HTML
pnpm add @wave3d/core three      # framework-agnostic createWave
pnpm add -D @wave3d/vite         # optional: capture posters at dev time
```

`three` is a **peer dependency** of `@wave3d/core` (`>=0.180 <1`). For TypeScript, also add
`@types/three` (three ships no types). Everything is **ESM-only** (`type: module`).

## Choosing an entry

| Need                                 | Use                                                                |
| ------------------------------------ | ------------------------------------------------------------------ |
| React                                | `import { Wave3D } from "@wave3d/react"`                           |
| Vue / Svelte / plain HTML            | `import "@wave3d/element"` → `<wave-3d>`                           |
| Framework-agnostic, own DOM          | `import { createWave } from "@wave3d/core"` (the poster shell)     |
| Direct renderer (no shell/poster)    | `import { WaveRenderer } from "@wave3d/core/renderer"`             |
| One `<script>` from a CDN (three in) | `import { mountWave } from "@wave3d/core/standalone"` (via esm.sh) |
| Built-in presets                     | `import { PRESETS } from "@wave3d/core/presets"`                   |
| Poster written to disk at dev time   | `import { wave3dPoster } from "@wave3d/vite"` (Vite plugin)        |

The `.` entry (`@wave3d/core`) has **no static three import** — the engine arrives via a dynamic
import, so bundlers keep three out of your initial chunk until a wave actually upgrades.

## Quick starts

**React**

```tsx
import { Wave3D } from "@wave3d/react";

<Wave3D preset="Hero" poster="/wave.png" style={{ width: "100%", aspectRatio: "16 / 9" }} />;
```

**Web component** (Vue / Svelte / HTML)

```html
<script type="module">
  import "@wave3d/element";
</script>
<wave-3d
  preset="Hero"
  poster="/wave.png"
  style="display:block;width:100%;aspect-ratio:16/9"
></wave-3d>
```

**Vanilla / core**

```ts
import { createWave } from "@wave3d/core";

const handle = createWave(document.getElementById("wave"), {/* config */}, { poster: "/wave.png" });
// handle: { state, renderer, set(config), play(), pause(), destroy() }
```

## Config model

A wave is one JSON-serializable `StudioConfig`: scene fields (`background`, `quality`, `dprMax`,
`loopSeconds`, `paused`, camera…) plus a `waves: WaveConfig[]` array (each wave has its own
`palette`, `fiberCount`, `speed`, `displaceAmount`, `twist…`, `helix…`, `blendMode`, `theme`,
transform…). Omitted fields fall back to `createDefaultConfig()`.

**Shape: twist vs helix.** `twistFrequency`/`twistPower` rotate by `freq * expStep(uv, power)`, a
MONOTONE falloff — good for one dramatic ramp, but it can never repeat, so it cannot make a coil.
`helixTurns` sweeps a _periodic_ angle along the ribbon's length instead, and is the only way to get
a repeating helix:

- `helixRadius` carries the whole ribbon around the axis (orientation intact). A narrow ribbon
  (small `scale.z`) then reads as one strand — **two waves 180° apart in `helixPhase` are a double
  helix**, and they genuinely swap depth at every crossing.
- `helixRoll` rolls the ribbon's own cross-section in step (1 = rigid twisted ribbon), swinging its
  two long edges onto opposite sides of the axis, so **one wave becomes a ladder whose edges are
  both strands**. Add `rungAmount` (wireframe theme) for the rungs between them.
- `radialCone` (on the radial fan, not the helix) lifts the fan out of its own plane as it spreads,
  turning the flat plume into a TRUMPET whose combed strands run down the slant into the throat. A
  helix carries the ribbon around an axis but its WIDTH never follows the slant, so this is the only
  route to a cone mouth.
- `radialSwirl` (degrees) lets the fan's ANGLE advance along the band as well as across it. Radius
  already grows with uv.y, so angle growing with it too is what curls a straight arm into a SPIRAL
  one wrapping the throat. Narrow the `radialArc` and a few of these, posed a quarter-turn apart,
  read as one vortex.
- Both are off at 0, and the helix code path isn't compiled unless `helixRadius` or `helixRoll` is
  non-zero — a wave without one renders byte-identically to before.

**Which shape control to reach for.** They overlap less than they look:

| want                                                                  | use       | why not the other                                                                                                                                                      |
| --------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a coil, a spring, a double helix                                      | `helix*`  | it carries the ribbon around an axis WITHOUT banking it, and it is animatable — `helixPhase` / `helixTurns` / `helixRadius` are binding targets, so scroll can spin it |
| a fan, a plume, a trumpet                                             | `radial*` | it remaps the ribbon's WIDTH to an angle; a path only moves the centreline, so it can never splay a sheet into a sector                                                |
| anything else: an S-curve, a knot, a ring, a throat, a shape you draw | `path`    | the others bend a centreline that stays put                                                                                                                            |

A path SWEEPS with a transported frame, so it banks into its curves like a
rollercoaster track; a helix TRANSLATES around an axis, so the ribbon keeps facing the same way. Same
coil, different object — which is why both stay.

**`path` — the ribbon's centreline, and the one shape control the others cannot substitute for.**
Everything else deforms a ribbon whose centreline is fixed: the twists rotate it, the helix carries it
around an axis, the radial fan splays it. So none of them can make a ribbon that changes direction
more than once, crosses itself, or is wide here and narrow there. A path can, because it IS the
centreline.

```ts
path: [
  { x: -200, y: 0, z: -8 },
  { x: 0, y: 120, z: 32, width: 0.3, twist: 45 }, // a throat, and a quarter turn of the section
  { x: 200, y: 0, z: -8 },
];
```

- Points are where the centreline goes, in the wave's LOCAL space. The un-pathed ribbon runs
  x −200 → +200 along the plane z = −8 (the folded geometry's centre), so a straight path there —
  `straightPath()` — reproduces any wave exactly, twists and all. Absent ⇒ that straight ribbon.
- `width` per point is what a separate "pinch" knob would be, and `twist` (degrees) rotates the
  cross-section. Both interpolate smoothly between points.
- A path whose LAST point sits on its FIRST is a closed ring. That is the whole declaration — there
  is no `closed` flag, because the points already say it.
- `arcPath(turns)` builds one: `arcPath(1)` is a closed ring whose radius comes from the ribbon's own
  length, `arcPath(0.35)` an open curve.
- It is swept by ARC LENGTH with a parallel-transported frame, so the strand comb stays even wherever
  the points are dragged and the ribbon never flips through an inflection.

**In the studio, double-click a ribbon to shape it.** The primary gesture is dragging the RIBBON
itself: it moves like putty, with the push falling off smoothly along the length so only the part you
grabbed follows (hold Shift for a fingertip-tight push instead of a palm). The path densifies itself
as you sculpt, so there is always something local to move. Control points are still there for
precision — drag a handle, double-click a point to remove it, double-click the ribbon to insert one —
and Escape leaves. The gestures are listed on a bar while the mode is on, and the cursor says what is
under it (grab on the ribbon, pointer on a handle). The wave takes a straight path on entry, so nothing moves until you move it.

**Disintegration (`WaveConfig.dissolve`).** A front sweeps across the wave and eats it away chunk by
chunk, so the surface CRUMBLES rather than fading. Absent ⇒ intact and byte-identical.

```ts
dissolve: { amount: 0.3, axis: "screenX", reverse: true, band: 0.55, scale: 150, blocky: 0.75, dust: 1 }
```

- `amount` is the whole animation: 0 whole, 1 gone, whatever the `band` (fray width). It is a binding
  target, so `{ source: "scroll", target: "dissolveAmount", to: 1 }` snaps the wave as the page moves.
- `axis` `"length"` / `"width"` ride the ribbon's own uv; **`"screenX"` / `"screenY"` are a straight
  line on the canvas**, which is what makes a multi-wave STACK crumble as one object — give every
  wave the same axis and amount and they share one edge. `reverse` flips which end goes first.
- `scale` sets how finely the sheet is diced and `blocky` the chunk character (0 organic tatters,
  1 hard quantized cells).
- `dust` pins the wave's own `particles` field to that same front: each mote is the chunk that just
  left, so the dust and the holes are ONE event. Under a screen axis the debris also blows along the
  sweep instead of radiating in every direction. Pair with `shape: "square"` and `blend: "normal"`
  for hard dark debris — `blend` defaults to `"additive"`, which can only brighten and so is
  invisible on a pale page.

**Which way the stripes run is the biggest single decision.** `lineAmount` carves at constant uv.x, so
each strand runs the ribbon's LENGTH; `rungAmount` carves at constant uv.y, so each crosses its WIDTH.
On a twisting ribbon the two look nothing alike: along-stripes just follow the flow, while
across-stripes ARE the twist made visible — they fan wide where the sheet faces the camera, pinch to a
dense line where it turns edge-on, and sweep as nested arcs through a fold. For a striped-ribbon look,
reach for rungs first and set `lineThickness: 0` to switch the lengthwise family off. `rungThickness`
is in PIXELS, so it must come DOWN as `rungAmount` goes up or the strands merge into solid; and past
~300-400 rungs the periods go sub-pixel in a small embed, where a pixel-width stripe stops being
stable (it falls back to the strands' analytic duty cycle, which is a flat tone, not detail).

**A wireframe strand is a MASK, not a material — unless you light it.** Its colour comes from its uv
alone, so it holds one tone wherever the surface turns, which is why a dense wireframe reads as
hatching however it is posed. `lineLight` (0..1) shades it with the same derivative normal and scene
`lights` the solid theme uses, AND gives each strand a round cross-section so a specular travels along
one strand and not its neighbour — which is what separates combed thread from print. One knob, not
three: shading a flat stripe barely reads, so the rounding is not optional to it. Default 0.

**`lineDerivativePower` decides whether a close-framed wave has any ink.** It scales strand thickness
by the screen-space uv derivative, which is right for a ribbon seen whole (strands thicken where the
surface turns away, which reads as light on a curve). But the bigger a sheet gets on screen the
SMALLER its uv derivative, so framed close the strands thin to pale grey exactly where you want them
black. Set it to 0 and `lineThickness` alone is the duty cycle, crisp at any zoom.

**Wireframe ink (`theme: "wireframe"`).** The strand is a soft ramp by default, so `lineThickness`
alone goes from pale hairlines to flat solid without passing through dense ink. `lineSharpness`
(0..1) steepens it, which turns `lineThickness` into a DUTY CYCLE and gives engraved black strands
with the background still showing between them; `lineDepthFade` (default 1) turns off the recede
into the background colour, which a deep or stacked composition needs.

**`lineGapColor` is the one to know about** — it decides what sits BETWEEN the strands, which is most
of what a wireframe looks like. Absent, the gaps take the page background, so the wave is a window
onto the page (dark strands, paper between) and, being opaque, the near fold HIDES the far one, which
is what makes a stack read solid. Give it a dark colour and the ribbon becomes its own body: bright
combed lines on a dark ground. Set it to `"transparent"` (or an 8-digit hex) and the gaps go clear, so
stacked folds show through each other — airier, at the cost of that occlusion. Note that `lineAmount` counts strands across the whole of uv.x, which the
radial fan maps to `radialArc`, so a narrow arc needs a proportionally SMALLER count or the strands
go sub-pixel and average to grey. `edgeFeather` now applies to the wireframe too — without it a
ribbon ends at a flat end-cap that reads as a straight cut across the strands.

**Glass (`theme: "glass"`) is a lens over whatever is behind it — so put something there.** The
sheet draws opaque and samples the frame behind it, bent along its own normal: over a flat page it is
a silvered ribbon with a bright rim and nothing more; a gradient, an image or another wave behind it
is what makes it read. The palette only sets the HUE of what gets through — `glassTint` (default
0.12) and `glassDensity` decide how much — and `blendMode`, `lights`, `fiber*` and noise bands are
not read at all. The knobs: `glassStrength` (bend at the silhouette, px), `glassChroma` (dispersion),
`glassRim` / `glassRimPower`, `glassSpec`, `glassIrid` + `glassFilmNm`, `glassFrost` (scatter; under
~0.1 it is sub-pixel and skipped), `glassCaustic`, `glassLayerGain` (a fold over itself thickens),
`glassFusion` (two close sheets bend along one merged silhouette), and the liquid trio `glassRipple`
/ `glassRippleScale` / `glassFlow`. `glassRipple`, `glassStrength` and `glassTint` are binding
targets.

**React flat props** are a shortcut mapped onto `waves[0]` and the scene:
`palette` (`string[]` | `ColorStop[]`), `fiberCount`, `fiberStrength`, `sheen`, `iridescence`,
`displaceAmount`, `speed`, `opacity`, `blendMode`, `theme` → the first wave; `background`,
`transparentBackground`, `quality`, `dprMax`, `loopSeconds`, `introRamp`, `paused` → the scene.
**Precedence: default ← preset ← flat props ← `config`** (the `config` prop wins).

The studio's **Export code** button generates a ready-made snippet (a minimal config diff + a
poster) for every entry — the fastest way to hand a designed wave to a developer.

## Interactivity (optional)

Interactivity is **per wave** and **off by default / additive** — omit it and the wave renders
byte-for-byte as before. Each `WaveConfig.interaction` has three parts: **`hover`** (the cursor-follow
field — `agitate` churn, `push` ± repel/attract dome, `wake` drag-trough, `thin`, `hueShift`,
`lighten`), **`press`** (`ripple` rings from a click/tap), and **`bindings`** that smoothly drive
that wave's params from an input.
Sources: `scroll`, `hover`, `pointerX` / `pointerY`, `pointerSpeed`, `press`, `scrollVelocity`,
`appear`, `tiltX` / `tiltY` (device tilt — see below), or a developer-fed `custom:*` (via `handle.setInteractionInput(name, value)` /
`renderer.setInteractionInput`). Each binding rests at the authored value and moves toward `to` as
its input rises 0→1 — `{ source: "hover", target: "displaceAmount", to: 12 }` grows the folds on
hover. `helixPhase` / `helixTurns` / `helixRadius` are bindable too, so
`{ source: "scroll", target: "helixPhase", to: 360 }` spins a helix exactly one turn down the page
(and the helix path is compiled for a wave that binds one but authors radius/roll at 0). Each wave's
`hover.smoothing` sets its own cursor-follow lag (vary it across a stack for a parallax drag). **Shared inputs** (one cursor + scroll: `radius`, `touch`) and **scene-param
bindings** (`timeOffset`, `cameraZoom`, `blur`, `grain` — e.g. `scroll → timeOffset` scrubs the whole
wave with the page) live on `SceneConfig.interaction`. In React the flat `interaction` prop targets
the first wave; the studio authors it per wave (Hover / Click & touch / Bindings) plus a global
Interaction folder for the shared inputs and a scroll preview.

**Touch is ignored unless you opt in.** `SceneConfig.interaction.touch` defaults to `false`, and
coarse pointers are dropped before any handler runs — so on a phone, `hover`, `press`/`ripple` and
the `hover` / `pointerX` / `pointerY` / `pointerSpeed` / `press` sources are all inert no matter what
you tune. Set `interaction: { touch: true }` on the scene to follow the finger while it is down
(listeners are passive, so this does **not** block page scrolling). Untouched by the gate: `scroll`,
`scrollVelocity` and `appear` read container progress through the viewport, not pointer events, so
they drive normally on mobile — scroll bindings are the way to stay reactive with `touch` off.

**Tilt is the input a phone has that a desktop doesn't.** `tiltX` / `tiltY` read the device's
orientation sensor, normalized 0..1 the way a ball would roll on the screen (`tiltX` → 1 as the
right edge drops, `tiltY` → 1 as the bottom edge drops) and resting at 0.5 in whatever pose the
reader was already holding — the first reading becomes the neutral centre, so a phone held at the
usual 50° doesn't peg every binding at one end. Binding either source is what arms the sensor; a
scene that mentions neither attaches no `deviceorientation` listener. `SceneConfig.interaction.tilt`
is optional tuning on top: `range` (degrees to the 0/1 ends, default 25), `smoothing` (default
0.18), `invertX` / `invertY`, and `pointer: true` — which lets tilt drive the shared CURSOR, so a
scene authored entirely for `pointerX` / `pointerY` and the per-wave hover field comes alive on a
phone without a second set of bindings (a real finger always wins).

```ts
interaction: { tilt: { range: 20 }, bindings: [{ source: "tiltX", target: "cameraZoom", to: 1.2 }] }
```

**iOS gets no tilt, on purpose.** Safari gates the sensor behind a modal permission dialog, and
nothing in this library opens one — a tilt-bound scene on an iPhone reads 0.5 on both axes and looks
exactly like a scene with no tilt. Treat tilt as an enhancement some phones don't get, the way you
would a hover state; don't build a fallback for it and don't build a permission button for it.

If a page genuinely warrants asking — an interactive piece a reader came to play with, not a
background — `enableTilt()` on the renderer / handle / element is the explicit opt-in. Call it from
a tap handler, directly, without awaiting anything first or the gesture is spent. `tiltStatus()`
reports `"unsupported"` (no sensor), `"prompt"` (gated, inert unless you ask), `"denied"`,
`"listening"` or `"live"`. Everywhere but iOS tilt is live as soon as it is bound and `enableTilt()`
is a no-op that resolves true. `recenterTilt()` re-takes the neutral pose after a change of grip.

## Post effects (optional)

Passes over the finished composite. Each is a plain **scene-level** `SceneConfig` field (a sibling of
`background` / `quality`, **not** per wave) that defaults to off, and setting it to `0` removes the
pass entirely — cost and pixels identical to never having set it.

| Field           | Extra knobs                                                  | Effect                                                      |
| --------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| `grain`         | —                                                            | Static film-grain speckle.                                  |
| `blur`          | `blurSamples`                                                | Soft-focus spin blur, smeared toward the top/bottom edges.  |
| `bloomStrength` | `bloomRadius`, `bloomThreshold`                              | Glow bleed off the bright ribbon (three's UnrealBloomPass). |
| `innerLight`    | `innerLightDensity`, `innerLightDecay`, `innerLightX`/`Y`    | Volumetric light streaks from a light point (X/Y in UV).    |
| `dither`        | `ditherScale` (cell px), `ditherSteps` (levels/channel, >=2) | Ordered (Bayer) dithering + posterization.                  |
| `halftone`      | `halftoneCell`, `halftoneAngle`                              | Rotated dot screen; dot size tracks local brightness.       |
| `halftoneCmyk`  | `halftoneCmykCell`                                           | Four rotated screens — subtractive CMYK print look.         |
| `heatmap`       | —                                                            | Luminance → thermal-palette recolour.                       |
| `paperTexture`  | `paperTextureScale`                                          | Fibrous printed-paper substrate overlay.                    |

`bloomStrength` and `innerLight` are **scene-zone** — they scatter the raw wave, so they read as
light. The rest are **finish-zone** stylization, applied after tone-map + sRGB (`dither` runs last).
Only `blur` and `grain` are bindable from an interaction input; the others are authored values.

## Presets

18 built-in presets (`@wave3d/core/presets`): **Hero**, **Wave 2**, **Wave 3**, **Wave 4**,
**Wireframe**, **Neon Dark Multistrand**, **Mesh Gradient**, **Solar Bloom**, **Latte Ring**,
**Particle Zoo**, **Holographic**, **Aurora**, **Palestine**, **Spain**, **Vaporwave Sunset**,
**Corkscrew**, **Disintegration**, **Kaleidoscope**.

- React: `preset="Hero"` (a **string** lazy-imports the presets chunk) or
  `preset={() => PRESETS["Hero"]()}` (a **function** is tree-shakeable — bundles only that preset).
- Core/element: `createWave(el, PRESETS["Hero"]())` or `<wave-3d preset="Hero">`.

## Poster & fallback recipe

The shell shows a poster immediately, then crossfades to the live wave.

- **Poster source:** the `poster` option/prop (URL or data-URI), or — for SSR — an
  `<img data-wave3d-poster>` you render inside the container; the shell **adopts** it (no hydration
  flash). React: pass it as a child.
- **`posterFit`** (`"fill"` default | `"cover"` | `"contain"`) sets how the poster maps into the box.
  The `fill` default matters: it makes the poster match the canvas exactly, so the handoff doesn't
  visibly jump.
- **Make a poster:** the studio's Export dialog, or capture the live frame at runtime — once
  running, `handle.snapshot()` (core/element) or `onReady(renderer)` → `renderer.captureImage()`
  (React) resolves an image Blob you can host and feed back as the `poster`.
- **`@wave3d/vite`** automates that in a Vite app: `wave3dPoster()` snapshots the wave from the
  browser already rendering it and writes the file to `public/` — mark a `<wave-3d>` with
  `data-wave3d-poster-out="hero.webp"`, or call `registerPoster(handle, out)` from
  `@wave3d/vite/client` for React / `createWave`. Re-snapshots over HMR; `vite build` just uses the
  committed file.
- **`onFallback(reason)`** fires when the shell keeps the poster instead of upgrading; reasons:
  `"no-webgl" | "software-renderer" | "reduced-motion" | "save-data" | "context-lost" |
"load-error"`.
- **`webgl="auto"` upgrades only onto a GPU.** A software rasteriser (SwiftShader, llvmpipe) keeps
  the poster and reports `"software-renderer"` — it can run the wave, at roughly 2 fps with seconds
  of blocked main thread, which is worse for the page than the still it already has. Use
  `webgl="force"` if you want the live render anyway. `probeWebGL()` and `isSoftwareRenderer(gl)`
  are exported for pages that need the same answer for their own reasons; note that an unreadable
  renderer string counts as HARDWARE, because the extension is hidden under some privacy settings
  and guessing "software" there downgrades people silently.
- **`paused` does not decline the upgrade.** It stops FRAMES: the engine is still fetched, the
  renderer still builds, ready still fires and the poster is still swapped for a static canvas.
  `webgl="off"` is the one that keeps the poster and builds nothing.
- **`onStateChange(state)`**: `"poster" → "loading" → "running"`, or `"fallback"`.

## Performance

- Lazy by default (`lazy: true`, IntersectionObserver, `rootMargin: "200px"`) — the wave (and three)
  only load near the viewport.
- Honors **Save-Data** (permanent poster) and **prefers-reduced-motion** (a frozen full frame;
  `reducedMotionBehavior: "poster"` to show the poster instead) — both on by default.
- `dprMax` clamps device-pixel-ratio (default 2). `quality` and `waves.length` changing forces a
  geometry **rebuild** (costlier than a uniform refresh); `fiberCount`, `loopSeconds` (0 = off),
  and `paused` are cheap. The renderer already pauses offscreen and when the tab is hidden.
- Every enabled **post effect** is one more full-screen pass — leave the ones you aren't using at
  `0` (that removes the pass, rather than running it as a no-op).

## SSR / Next.js

- `@wave3d/react` is already marked `"use client"` — import it directly in a client component.
- All packages are **import-safe under Node** (no top-level DOM access; `@wave3d/element`'s
  self-register is guarded), so SSR / RSC imports don't throw. The canvas only mounts client-side.
- Render a `<div>` with an `<img data-wave3d-poster>` child on the server for a zero-flash poster.

## Pitfalls

- **three is a peer** — you must install it (`>=0.180 <1`); `@types/three` for TypeScript.
- **The container needs a size** — the wave fills it; give it width/height (e.g. `aspect-ratio`).
- **Don't recreate per render** — in React, changing flat props/`config` updates the live wave in
  place; only a remount (or `handle.destroy()`) tears it down. (StrictMode double-mount is safe.)
- **`waves` replaces wholesale** — config merges are shallow, so a `waves` array you pass replaces
  the default; include complete wave objects (the Export-code diff already does this).
- **reduced-motion defaults to true** — a motion-sensitive visitor sees a static frame, not motion.
