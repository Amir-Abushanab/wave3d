# @wave3d/core

Framework-agnostic **3D gradient-wave** renderer + config model — the engine behind [Wave Studio](https://github.com/Amir-Abushanab/wave3d).

A glossy, twisting _wave of light_: a strip swept along a curve, with a gradient running along its length and a satin sheen. Everything is driven by a single JSON-serializable `WaveConfig`, so the renderer and every export read from one source of truth.

## Install

```sh
pnpm add @wave3d/core three   # three is a peer dependency
```

`three` is a peer dependency (`>=0.180 <1`); add `@types/three` for TypeScript.

## Drop-in wave (poster-first, self-optimizing)

The `.` entry is a lightweight shell: it shows a poster immediately, then lazily upgrades to the live WebGL wave only when the browser can run it (falling back to the poster on no-WebGL, Save-Data, reduced-motion, or context loss). `three.js` is code-split out of the initial load.

```ts
import { createWave } from "@wave3d/core";

const handle = createWave(document.getElementById("wave"), config, {
  poster: "/wave.png",
});
// handle.set(nextConfig) · handle.pause() · handle.play() · handle.snapshot() · handle.destroy()
```

Capture the live frame as an image — a poster you can host and reuse for reduced-motion / no-WebGL / Save-Data visitors — with `handle.snapshot()` (resolves `null` until running):

```ts
const blob = await handle.snapshot(); // options: { type?, quality?, transparent? } — WebP, transparent
```

## Single `<script>` from a CDN (three bundled)

```html
<script type="module">
  import { mountWave } from "https://esm.sh/@wave3d/core/standalone";
  mountWave(document.getElementById("wave"), {
    /* config */
  });
</script>
```

## Entry points

| Import                    | What                                                         |
| ------------------------- | ------------------------------------------------------------ |
| `@wave3d/core`            | poster-first shell (`createWave`/`mountWave`) + config model |
| `@wave3d/core/renderer`   | the raw `WaveRenderer` + `WaveGeometry` (static three)       |
| `@wave3d/core/presets`    | the built-in `PRESETS`                                       |
| `@wave3d/core/studio`     | `StudioWaveRenderer` + randomizers                           |
| `@wave3d/core/standalone` | single-file build with three bundled (the CDN entry)         |

## Framework wrappers

- **React** — [`@wave3d/react`](https://www.npmjs.com/package/@wave3d/react): the `<Wave3D>` component.
- **Vue / Svelte / plain HTML** — [`@wave3d/element`](https://www.npmjs.com/package/@wave3d/element): the `<wave-3d>` custom element.

## Credits

Created by [Amir Abushanab](https://github.com/Amir-Abushanab).

## License

[MIT](https://github.com/Amir-Abushanab/wave3d/blob/main/LICENSE)
