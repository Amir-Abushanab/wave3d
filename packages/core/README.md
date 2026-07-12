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

Add an optional `interaction` block for cursor-follow effects and inputs that drive parameters. It's off by default — omit it and the wave (and its compiled shader) stays byte-for-byte unchanged.

```ts
createWave(el, {
  interaction: {
    // Pointer field: swell + click ripples + strand thinning under the cursor.
    pointer: { hump: 8, ripple: 6, thin: 0.4 },
    bindings: [
      { source: "scroll", target: "timeOffset", to: 40 }, // scrub the wave as the page scrolls
      { source: "hover", target: "displaceAmount", to: 12 }, // taller folds while hovered
    ],
  },
});
```

Each binding rests at the authored value (`from` defaults to it) and moves toward `to` as its input rises 0→1 — sources: `scroll`, `hover`, `pointerX` / `pointerY`, `pointerSpeed`, `press`, `scrollVelocity`, `appear`, and `custom:*`. Pair `scroll → timeOffset` with a low `speed` for a wave that scrubs _with_ the page instead of drifting on its own; set a per-wave `interactionInfluence` (0–2) to stagger the response across a stack for depth. In React it's the flat `interaction` prop on `<Wave3D>`.

Feed your own signal with a `custom:` source and `setInteractionInput`:

```ts
const h = createWave(el, {
  interaction: { bindings: [{ source: "custom:audio", target: "displaceAmount", to: 30 }] },
});
analyser.onLevel = (v) => h.setInteractionInput("audio", v); // v in 0..1
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
