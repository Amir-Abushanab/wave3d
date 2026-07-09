# Wave Studio

A browser studio for authoring **3D gradient waves** — the glossy, twisting _wave of light_ seen across Stripe's designs. Tweak it live, then export a **config**, an **image**, a **video**, or a **drop-in embed**.

![Wave Studio](assets/screenshot.png)

## Quick start

```bash
pnpm install
pnpm dev     # opens the studio at the printed localhost URL
```

Requires Node 18+ and [pnpm](https://pnpm.io).

## The studio

A wave is a strip swept along a curve, driven entirely by one JSON-serializable `WaveConfig`. The panel lets you:

- **Shape** it — spine sweep, twist, taper, width, edge feather, and light.
- **Color** it — linear / radial / conic / mesh gradients, palettes, and built-in image maps.
- **Finish** it — grain, blur, glow, sheen, and hue / contrast / saturation.
- **Layer** it — multiple strands with per-strand overrides, plus presets, randomize, and undo/redo.

## Exports

Pick a size preset (or a custom W×H) in **Output**, then export:

| Export          | What you get                                                                         |
| --------------- | ------------------------------------------------------------------------------------ |
| **Image**       | An exact-size **PNG**, **WebP**, or **JPEG** still (PNG/WebP keep transparency).     |
| **Video / GIF** | A **WebM** or **MP4** clip, an animated **GIF**, or a full-colour animated **WebP**. |
| **Embed**       | A self-contained **`.html`** page with the runtime inlined — no other files needed.  |
| **Config**      | The **`.json`** `WaveConfig` — save it, reload it, or copy a share link.             |

## Drop it into your own site

The engine ships as framework-agnostic packages. Each is a **poster-first, self-optimizing** background: it shows a poster, then upgrades to live WebGL only when the browser can (falling back on no-WebGL, Save-Data, reduced-motion, or context loss), with three.js code-split out of the initial load.

```sh
pnpm add @wave3d/react three     # React
pnpm add @wave3d/element three   # <wave-3d> for Vue / Svelte / plain HTML
```

```tsx
import { Wave3D } from "@wave3d/react";
<Wave3D preset="Hero" poster="/wave.png" style={{ width: 480, height: 270 }} />;
```

Or a single `<script>` from a CDN (three bundled):

```html
<script type="module">
  import { mountWave } from "https://esm.sh/@wave3d/core/standalone";
  mountWave(document.getElementById("wave"), {
    /* your exported wave.json */
  });
</script>
```

`three` is a peer dependency (`>=0.180 <1`); add `@types/three` for TypeScript. Per-package docs live in [`@wave3d/core`](packages/core), [`@wave3d/react`](packages/react), and [`@wave3d/element`](packages/element).

## How it works

Each strand is a wave swept along a smooth curve — carried by parallel transport, twisted around the tangent, and extruded to a tapering width — then coloured by a gradient with a satin sheen and a soft-focus blur pass. The renderer, the panel, and every export all read from the same `WaveConfig`. As a background it behaves: it clamps DPR, pauses when offscreen or hidden, and honours `prefers-reduced-motion`.

## Deploying & releasing

CI deploys the studio to Cloudflare Pages on `main`, and [Changesets](https://github.com/changesets/changesets) publishes the `@wave3d/*` packages to npm. The setup steps live in **[DEPLOY.md](DEPLOY.md)**.

## Credits

Created by [Amir Abushanab](https://github.com/Amir-Abushanab). Built with [Three.js](https://threejs.org), [Tweakpane](https://tweakpane.github.io/docs/), and [Vite](https://vitejs.dev).

## License

[MIT](./LICENSE)
