# @wave3d/element

The `<wave-3d>` custom element: a drop-in animated **3D gradient wave** for Vue, Svelte, or plain HTML. Design one in [Wave Studio](https://wave-studio.pages.dev), export the snippet for your framework, paste it in.

Poster-first: it shows a poster immediately, then upgrades to live WebGL only when the browser can run it. It falls back to the poster on no-WebGL, Save-Data, reduced motion, or a lost context, with `three.js` code-split out of the initial load.

## 📦 Install

```sh
pnpm add @wave3d/element three
```

`three` is a peer dependency; `@wave3d/core` is bundled in.

## Usage

Importing the package registers `<wave-3d>` for you:

```html
<script type="module">
  import "@wave3d/element";
</script>

<wave-3d preset="Hero" poster="/wave.png" style="width:480px;height:270px"></wave-3d>
```

## Attributes & properties

| Attribute    | What                                                                              |
| ------------ | --------------------------------------------------------------------------------- |
| `preset`     | a built-in preset name (lazy-loads the presets chunk)                             |
| `config`     | an inline JSON config                                                             |
| `src`        | URL to a config JSON to fetch                                                     |
| `poster`     | poster image shown before or instead of WebGL                                     |
| `poster-fit` | poster `object-fit`: `fill` (default, matches the canvas) \| `cover` \| `contain` |
| `fade-ms`    | poster→canvas crossfade in ms (default `300`; `0` swaps instantly)                |
| `paused`     | pause or resume the animation                                                     |
| `lazy`       | defer the upgrade until visible                                                   |
| `webgl`      | `auto` \| `force` \| `off`                                                        |

There's also a `config` **property** (merged last, over the attributes) and a read-only `handle` getter. Precedence: **default → `preset` → `src` → `config` attribute → `config` property**.

## Events

- `wave3d-ready`: `detail` is the live `WaveRenderer`.
- `wave3d-fallback`: `detail` is the fallback reason.

## Capture a poster

Grab the live frame once the wave is running, e.g. to generate the poster that reduced-motion, no-WebGL, and Save-Data visitors see:

```js
const wave = document.querySelector("wave-3d");
wave.addEventListener("wave3d-ready", async () => {
  const blob = await wave.handle.snapshot(); // WebP of the current frame, transparent
  // host or cache `blob`, then use it as the poster
});
```

`handle.snapshot(options?)` resolves `null` until the wave is running. Options: `type` (default `"image/webp"`), `quality`, `transparent` (default `true`), and `time` (a fixed animation time — pass `0` for the frame the wave opens on, so the poster matches the first live frame).

### Capture at the pixel ratio it will be shown at

`snapshot()` returns the canvas at its **backing-store** size, which is the element's CSS size times the device pixel ratio (capped by `dprMax`). If you generate posters in a headless browser, that browser's `deviceScaleFactor` therefore decides the poster's resolution — and the default is `1`.

A poster captured at `deviceScaleFactor: 1` is half the resolution the same canvas renders at on a 2× display. The browser stretches the poster to fill the element while the live canvas behind it does not, so the crossfade lands on a visible sharpening — edges tighten, and because soft edges bloom outward the poster reads as slightly _heavier_ than the live scene rather than merely blurrier.

Drive the capture at the ratio your readers actually have:

```js
const page = await browser.newPage({
  viewport: { width: 1440, height: 820 },
  deviceScaleFactor: 2,
});
```

Two things that go with it: keep the encoder quality high enough that it does not ring the high-contrast edges (a lossy poster shows up as outlines tracing every ribbon), and remember that a fixed-aspect poster is stretched by `poster-fit` while the canvas re-frames itself — capture at the aspect the element is widest at.

## Custom tag name

```ts
import { register } from "@wave3d/element";
register("my-wave"); // instead of the default <wave-3d>
```

## Credits

Built by [Amir Abushanab](https://github.com/Amir-Abushanab).

## License

[MIT](https://github.com/Amir-Abushanab/wave3d/blob/main/LICENSE)
