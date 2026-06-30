# Wave Studio

An open-source, browser-based studio for authoring **3D gradient waves** — the glossy, twisting _wave of light_ (a strip swept along a curve, with the gradient running along its length and a satin sheen) seen across Stripe's designs.

Tweak every parameter live, then export the result as a **config**, a **drop-in embed**, a **PNG**, or a **WebM video**.

![Wave Studio](docs/screenshot.png)

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
- **Global** — background, transparency, blend mode, strand count, quality, DPR clamp, speed, pause, camera distance.
- **Color & Finish** — gradient stops, hue shift, contrast, saturation, gradient shift/repeat, **stratified lines** (amount/thickness/strength), flow speed, grain, texture, blur (+ samples).
- **Spine** — the sweep: length, displacement frequency x/y, amount.
- **Transform** — position, rotation, scale of the whole strand.
- **Twist** — the fold: frequency x/y, power.
- **Wave & Light** — width, taper, edge feather, bevel, satin sheen, glow, light direction.
- **Strands** — per-strand overrides (opacity, hue, width, speed, seed, offset, twist). Multiple strands overlap for depth.

## Exports

All from the **Actions** folder:

| Export                        | What you get                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| **Save / Load state (.json)** | The full `WaveConfig`. This is the preset format — version it, share it, re-import it. |
| **Export PNG**                | A still of the current frame (transparent if “transparent bg” is on).                  |
| **Record / stop (.webm)**     | A video capture of the animation.                                                      |
| **Export embed (.html)**      | A self-contained page that renders this exact wave on any site.                        |

### Embedding on your own site

1. Build the runtime once:
   ```bash
   pnpm build:embed      # → dist-embed/wave-studio-embed.js  (Three.js bundled in, ~137 kB gzip)
   ```
2. Use **Export embed (.html)** in the studio, drop the generated `wave-embed.html` and `wave-studio-embed.js` together, or wire it up yourself:
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

- `src/wave/` — config schema, `WaveGeometry`, shaders, and the framework-agnostic `WaveRenderer`.
- `src/ui/` — the Tweakpane control panel.
- `src/export/` — config / PNG / WebM / embed exporters.
- `embed/` — the `mountWave` entry for the standalone runtime.

## Tech

[Three.js](https://threejs.org) · [Tweakpane](https://tweakpane.github.io/docs/) · [Vite](https://vitejs.dev) · TypeScript.

## License

[MIT](./LICENSE).
