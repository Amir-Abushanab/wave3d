# @wave3d/element

The `<wave-3d>` custom element — a framework-agnostic drop-in animated **3D gradient wave** for Vue, Svelte, or plain HTML.

Poster-first and lazy: it shows a poster immediately, then upgrades to live WebGL only when the browser can run it (falling back to the poster on no-WebGL, Save-Data, reduced-motion, or context loss), with `three.js` code-split out of the initial load.

## Install

```sh
pnpm add @wave3d/element three
```

`three` is a peer dependency; `@wave3d/core` is bundled in.

## Usage

Importing the package registers `<wave-3d>` automatically:

```html
<script type="module">
  import "@wave3d/element";
</script>

<wave-3d preset="Hero" poster="/wave.png" style="width:480px;height:270px"></wave-3d>
```

## Attributes & properties

| Attribute | What                                                  |
| --------- | ----------------------------------------------------- |
| `preset`  | a built-in preset name (lazy-loads the presets chunk) |
| `config`  | an inline JSON config                                 |
| `src`     | URL to a config JSON to fetch                         |
| `poster`  | poster image shown before / instead of WebGL          |
| `paused`  | pause / resume the animation                          |
| `lazy`    | defer the upgrade until visible                       |
| `webgl`   | `auto` \| `force` \| `off`                            |

Also a `config` **property** (merged last, over the attributes) and a read-only `handle` getter. Config precedence: **default ← `preset` ← `src` ← `config` attribute ← `config` property**.

## Events

- `wave3d-ready` — `detail` is the live `WaveRenderer`.
- `wave3d-fallback` — `detail` is the fallback reason.

## Capture a poster

Grab the live frame as an image once the wave is running — e.g. to generate the `poster` that reduced-motion, no-WebGL, and Save-Data visitors see:

```js
const wave = document.querySelector("wave-3d");
wave.addEventListener("wave3d-ready", async () => {
  const blob = await wave.handle.snapshot(); // WebP of the current frame, transparent
  // host / cache `blob`, then use it as the poster
});
```

`handle.snapshot(options?)` resolves `null` until the wave is running. Options: `type` (default `"image/webp"`), `quality`, `transparent` (default `true`).

## Custom tag name

```ts
import { register } from "@wave3d/element";
register("my-wave"); // instead of the default <wave-3d>
```

## Credits

Created by [Amir Abushanab](https://github.com/Amir-Abushanab).

## License

[MIT](https://github.com/Amir-Abushanab/wave3d/blob/main/LICENSE)
