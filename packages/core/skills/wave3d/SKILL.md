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
  library_version: "0.3.0"
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

const handle = createWave(
  document.getElementById("wave"),
  {
    /* config */
  },
  { poster: "/wave.png" },
);
// handle: { state, renderer, set(config), play(), pause(), destroy() }
```

## Config model

A wave is one JSON-serializable `StudioConfig`: scene fields (`background`, `quality`, `dprMax`,
`loopSeconds`, `paused`, camera…) plus a `waves: WaveConfig[]` array (each wave has its own
`palette`, `fiberCount`, `speed`, `displaceAmount`, `twist…`, `blendMode`, `theme`, transform…).
Omitted fields fall back to `createDefaultConfig()`.

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
`appear`, or a developer-fed `custom:*` (via `handle.setInteractionInput(name, value)` /
`renderer.setInteractionInput`). Each binding rests at the authored value and moves toward `to` as
its input rises 0→1 — `{ source: "hover", target: "displaceAmount", to: 12 }` grows the folds on
hover. Each wave's `hover.smoothing` sets its own cursor-follow lag (vary it across a stack for a
parallax drag). **Shared inputs** (one cursor + scroll: `radius`, `touch`) and **scene-param
bindings** (`timeOffset`, `cameraZoom`, `blur`, `grain` — e.g. `scroll → timeOffset` scrubs the whole
wave with the page) live on `SceneConfig.interaction`. In React the flat `interaction` prop targets
the first wave; the studio authors it per wave (Hover / Click & touch / Bindings) plus a global
Interaction folder for the shared inputs and a scroll preview.

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

14 built-in presets (`@wave3d/core/presets`): **Hero**, **Wave 2**, **Wave 3**, **Wave 4**,
**Wireframe**, **Neon Dark Multistrand**, **Mesh Gradient**, **Solar Bloom**, **Holographic**,
**Aurora**, **Palestine**, **Spain**, **Vaporwave Sunset**, **Kaleidoscope**.

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
  `"no-webgl" | "reduced-motion" | "save-data" | "context-lost" | "load-error"`.
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
