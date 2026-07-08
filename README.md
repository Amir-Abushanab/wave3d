# Wave Studio

An open-source, browser-based studio for authoring **3D gradient waves** — the glossy, twisting _wave of light_ (a strip swept along a curve, with the gradient running along its length and a satin sheen) seen across Stripe's designs.

Tweak every parameter live, then export the result as a **config**, a **drop-in embed**, a
**PNG/WebP/JPEG image**, or a **WebM video**.

![Wave Studio](assets/screenshot.png)

## Quick start

```bash
pnpm install
pnpm dev           # open the printed localhost URL
```

Requires Node 18+ (developed on Node 24) and [pnpm](https://pnpm.io).

## Using the studio

[TODO: update this]
The control panel groups every parameter:

- **Actions** — presets, randomize, reset, and all exports.
- **Global** — blend mode, strand count, quality, DPR clamp, speed, pause, and animation phase.
- **Background** — transparency, solid color, editable linear/radial/conic gradients, built-in
  high-resolution image maps, custom image or looping video upload, cover/contain/stretch fitting,
  zoom/crop, and X/Y positioning.
- **Color & Gradient** — linear, radial, conic, and draggable iOS-style mesh gradients; gradient
  stops and presets (including Mesh Gradient, Palestine Colors, One Piece — Grand Line, and
  Spider-Man — Webbed City); built-in 2D image maps such as Vaporwave, Kaleidoscope, and Nebula;
  plus custom image or looping video textures with scale/offset/rotation controls.
- **Finish** — hue shift, contrast, saturation, fibers, grain, texture, blur, volume, glow, and
  wireframe controls.
- **Spine** — the sweep: length, displacement frequency x/y, amount.
- **Transform** — position, rotation, scale of the whole strand.
- **Twist** — the fold: frequency x/y, power.
- **Wave & Light** — width, taper, edge feather, bevel, satin sheen, glow, light direction.
- **Strands** — per-strand overrides (opacity, hue, width, speed, seed, offset, twist). Multiple strands overlap for depth.

## Exports

Visual exports live in **Output**; state and sharing tools remain in **Actions**:

| Export                        | What you get                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| **Save / Load state (.json)** | The full `WaveConfig`. This is the preset format — version it, share it, re-import it. |
| **Export image**              | An exact-size PNG, WebP, or JPEG still (PNG/WebP preserve transparency).               |
| **Record / stop (.webm)**     | A video capture at the selected output dimensions.                                     |
| **Export embed (.html)**      | A standalone responsive page with the complete wave runtime included.                  |

Choose a social, website, or video preset in **Output**, or enter a custom width and height.
The bordered preview is the shared capture area for image, video, and embed exports; editor
controls and the size badge are never included. The exported HTML is self-contained and does not
need a neighboring JavaScript file. Built-in image-map presets are drawn inside the runtime, so
they remain embedded without remote image requests. Uploaded wave and background images or videos
are stored as data URLs in the config, so saved states and standalone embeds keep them too. Videos
can make those files substantially larger than image-only states.

### Embedding on your own site

1. Build the runtime once:
   ```bash
   pnpm build:embed      # → dist-embed/wave-studio-embed.js  (Three.js bundled in, ~137 kB gzip)
   ```
2. Use **Export embed (.html)** in the studio for a standalone file, or wire the runtime up yourself:
   ```html
   <div id="wave" style="position:fixed; inset:0"></div>
   <script type="module">
     import { mountWave } from "./wave-studio-embed.js";
     const config = {
       /* paste your exported wave.json here */
     };
     mountWave(document.getElementById("wave"), config);
   </script>
   ```

`mountWave(container, config?, options?)` returns `{ renderer, set(config), destroy() }`.

## Performance & accessibility

The renderer is built to be a well-behaved background:

- Clamps `devicePixelRatio` (configurable) and resizes via `ResizeObserver`.
- Pauses the render loop when offscreen (`IntersectionObserver`) and when the tab is hidden (`visibilitychange`).
- Honors `prefers-reduced-motion` by freezing on a static frame.
- Quality levers — strand count, geometry subdivision, and blur samples — are all exposed.

## How it works

Each strand is a wave swept along a smooth spine curve: the curve is sampled, frames are carried along it by parallel transport (no Frenet flips), the cross-section is twisted around the tangent, and the strip is extruded to a tapering width — rebuilt each frame in `WaveGeometry`. The fragment shader colours it with a gradient along the length, overlays fine **stratified lines running across the wave** (`abs(sin(uv.y · lineAmount))`), adds a subtle sheen and rim glow, and feathers the edges and ends. A post pass then applies a **golden-angle soft-focus blur and dither grain**. Everything is driven by a single JSON-serializable `WaveConfig`, so the renderer, the panel, and every export read from the same source of truth.

This is a pnpm monorepo:

- `packages/core/` — **`@wave3d/core`**: the framework-agnostic engine. `config/model.ts` (schema),
  `renderer/` (`WaveGeometry`, shaders, `WaveRenderer`), `shell/` (the `createWave` poster-fallback
  drop-in), `presets.ts`, `studio/` (`StudioWaveRenderer` + randomizers), `standalone.ts` (CDN entry).
- `packages/react/` — **`@wave3d/react`**: the `<Wave3D>` component.
- `packages/element/` — **`@wave3d/element`**: the `<wave-3d>` custom element (Vue/Svelte/plain HTML).
- `apps/studio/` — the Wave Studio app (Tweakpane panel in `ui/`, exporters in `export/`).

## Packages

Drop a self-optimizing wave into any site — it shows a poster first, then lazily upgrades to the
live WebGL wave only when the browser can run it (falling back to the poster on no-WebGL, Save-Data,
reduced-motion, or context loss), with three.js code-split out of the initial load.

```sh
pnpm add @wave3d/react @wave3d/core three   # React ( + @types/three for TS)
pnpm add @wave3d/element @wave3d/core three  # <wave-3d> for Vue / Svelte / plain HTML
```

```tsx
import { Wave3D } from "@wave3d/react";
<Wave3D preset="Hero" poster="/wave.png" style={{ width: 480, height: 270 }} />;
```

```html
<script type="module">
  import "@wave3d/element";
</script>
<wave-3d preset="Hero" poster="/wave.png" style="width:480px;height:270px"></wave-3d>
```

Or a single `<script>` from a CDN (three bundled):

```html
<script type="module">
  import { mountWave } from "https://esm.sh/@wave3d/core/standalone";
  mountWave(document.getElementById("wave"), {
    /* config */
  });
</script>
```

`three` is a peer dependency of `@wave3d/core` (`>=0.180 <1`); add `@types/three` for TypeScript.

## Deploying & releasing

CI (GitHub Actions) runs `pnpm check` + `pnpm build` on every push, **deploys the studio to
Cloudflare Pages** on `main`, and **publishes the packages to npm** on a `v*` tag. The one-time
account setup (Cloudflare + npm secrets, custom domain) lives in **[DEPLOY.md](DEPLOY.md)**.

To publish manually instead (maintainer): create the free `@wave3d` organization on
[npmjs.com](https://www.npmjs.com) (the scope is public; each package already sets
`publishConfig.access: "public"`), then `pnpm -r build` and
`pnpm -r --filter "@wave3d/*" publish` — pnpm rewrites the `workspace:^` peer ranges to real
versions and applies each package's `publishConfig.exports` (pointing at `dist/`) automatically.

## Tech

[Three.js](https://threejs.org) · [Tweakpane](https://tweakpane.github.io/docs/) · [Vite](https://vitejs.dev) · TypeScript.

The bundled classic One Piece logo is sourced from
[PNGMart](https://www.pngmart.com/image/636405). One Piece and its logo are owned by their
respective rights holders; this project is not affiliated with or endorsed by them.

The Spider-Man preset uses a modified version of the public-domain
[2002 movie wordmark](https://commons.wikimedia.org/wiki/File:Spider-Man-Logo.svg) from Wikimedia
Commons. Spider-Man and its logo are trademarks of their respective rights holders; this project
is not affiliated with or endorsed by them. Its comic-panel background is an original generated
asset.

## Credits

Created by [Amir Abushanab](https://github.com/Amir-Abushanab).

## License

[MIT](./LICENSE).
