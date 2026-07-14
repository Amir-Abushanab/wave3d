# @wave3d/core

The framework-agnostic renderer and config model behind [Wave Studio](https://wave-studio.pages.dev): glossy, twisting 3D gradient waves driven by one JSON config.

A wave is a strip swept along a curve, with a gradient running down its length and a satin sheen. The renderer and every export read from the same `WaveConfig`, so what you design is exactly what ships.

> 💡 Fastest way in: design a wave in **[Wave Studio](https://wave-studio.pages.dev)**, hit **⟨⟩ Export code**, and copy the snippet. This package is what that snippet imports.

## 📦 Install

```sh
pnpm add @wave3d/core three   # three is a peer dependency
```

`three` is a peer dependency (`>=0.180 <1`); add `@types/three` for TypeScript.

## Drop-in wave

The default entry is poster-first: it shows a poster immediately, then upgrades to live WebGL only when the browser can run it. It falls back to the poster on no-WebGL, Save-Data, reduced motion, or a lost context, and `three.js` is code-split out of the initial load.

```ts
import { createWave } from "@wave3d/core";

const handle = createWave(document.getElementById("wave"), config, {
  poster: "/wave.png",
});
// handle.set(nextConfig) · handle.pause() · handle.play() · handle.snapshot() · handle.destroy()
```

Capture the live frame as an image you can host and reuse as the poster for reduced-motion, no-WebGL, and Save-Data visitors:

```ts
const blob = await handle.snapshot(); // resolves null until running. options: { type?, quality?, transparent? }
```

## Single `<script>` from a CDN

`three` is bundled into the standalone build, so this needs nothing else:

```html
<script type="module">
  import { mountWave } from "https://esm.sh/@wave3d/core/standalone";
  mountWave(document.getElementById("wave"), {
    /* your exported config */
  });
</script>
```

## Interactive waves

Interactivity is **per wave** and **off by default** — omit it and the wave (and its compiled shader) is byte-for-byte unchanged. Each wave takes an optional `interaction` with three parts:

- **`hover`** — the cursor-follow field: `hump` (swell), `swoosh`, `agitate`, `thin`, `hueShift`, `lighten`, and `smoothing` (this wave's follow-lag — vary it across a stack for a parallax drag).
- **`press`** — `ripple` (rings from a click / tap).
- **`bindings`** — inputs that drive this wave's params: `{ source, target, from?, to }`.

```tsx
// React — the flat `interaction` prop targets the first wave:
<Wave3D
  interaction={{
    hover: { hump: 8, thin: 0.4 }, // swell + strand-thinning under the cursor
    press: { ripple: 6 }, // click ripples
    bindings: [{ source: "hover", target: "displaceAmount", to: 12 }], // taller folds while hovered
  }}
/>
```

Each binding rests at the authored value (`from` defaults to it) and moves toward `to` as its input rises 0→1 — sources: `scroll`, `hover`, `pointerX` / `pointerY`, `pointerSpeed`, `press`, `scrollVelocity`, `appear`, and `custom:*`.

Shared inputs (one cursor + scroll) and scene-wide effects live on the scene-level `interaction`:

```ts
createWave(el, {
  interaction: {
    radius: 0.3, // shared pointer falloff (fraction of viewport height)
    touch: false, // follow touch pointers too
    bindings: [{ source: "scroll", target: "timeOffset", to: 40 }], // scrub the whole wave with scroll
  },
  waves: [
    /* each wave carries its own `interaction` (hover / press / bindings) */
  ],
});
```

Pair `scroll → timeOffset` with a low `speed` for a wave that scrubs _with_ the page instead of drifting on its own. Feed your own signal with a `custom:` source and `setInteractionInput`:

```tsx
<Wave3D
  interaction={{ bindings: [{ source: "custom:audio", target: "displaceAmount", to: 30 }] }}
  onReady={(r) => {
    analyser.onLevel = (v) => r.setInteractionInput("audio", v); // v in 0..1
  }}
/>
```

## Entry points

| Import                    | What                                                           |
| ------------------------- | -------------------------------------------------------------- |
| `@wave3d/core`            | poster-first shell (`createWave` / `mountWave`) + config model |
| `@wave3d/core/renderer`   | the raw `WaveRenderer` and `WaveGeometry` (static three)       |
| `@wave3d/core/presets`    | the built-in `PRESETS`                                         |
| `@wave3d/core/studio`     | `StudioWaveRenderer` + randomizers                             |
| `@wave3d/core/standalone` | single-file build with three bundled (the CDN entry)           |

## Framework wrappers

Prefer a component? Reach for the wrapper for your framework:

- **React** → [`@wave3d/react`](https://www.npmjs.com/package/@wave3d/react): the `<Wave3D>` component.
- **Vue, Svelte, or plain HTML** → [`@wave3d/element`](https://www.npmjs.com/package/@wave3d/element): the `<wave-3d>` custom element.

## Credits

Built by [Amir Abushanab](https://github.com/Amir-Abushanab).

## License

[MIT](https://github.com/Amir-Abushanab/wave3d/blob/main/LICENSE)
