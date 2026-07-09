# @wave3d/vite

A dev-only Vite plugin that captures a [wave3d](https://github.com/Amir-Abushanab/wave3d) poster from the browser already rendering it and writes it to disk — no headless browser, no Playwright. Posters stay in sync as you edit the config (via HMR), and `vite build` does nothing but reference the committed file.

## Install

```sh
pnpm add -D @wave3d/vite
```

`vite` (`>=5`) is a peer dependency.

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { wave3dPoster } from "@wave3d/vite";

export default defineConfig({
  plugins: [wave3dPoster()],
});
```

Opt a `<wave-3d>` in by naming its output file. The plugin snapshots it when the wave is ready and re-snapshots on every HMR edit, writing only when the frame actually changes:

```html
<wave-3d preset="Hero" poster="/hero.webp" data-wave3d-poster-out="hero.webp"></wave-3d>
```

`public/hero.webp` is written from the live wave; the `poster` attribute then serves it for the reduced-motion / no-WebGL / Save-Data fallback.

### React / mountWave

There's no `<wave-3d>` node to auto-detect, so register the handle (`createWave`/`mountWave`) or renderer (React's `onReady`) explicitly:

```tsx
import { registerPoster } from "@wave3d/vite/client";

<Wave3D
  preset="Hero"
  poster="/hero.webp"
  onReady={(renderer) => registerPoster(renderer, "hero.webp")}
/>;
```

## Options

| Option       | Default        | What                                                                          |
| ------------ | -------------- | ----------------------------------------------------------------------------- |
| `outDir`     | `"public"`     | Directory posters are written to, relative to the Vite root                   |
| `type`       | `"image/webp"` | Captured image MIME type                                                      |
| `quality`    | `0.92`         | Encoder quality (0–1)                                                         |
| `posterTime` | `0`            | Fixed animation-time captured (a reproducible frame); `null` = the live frame |

## Credits

Created by [Amir Abushanab](https://github.com/Amir-Abushanab).

## License

[MIT](https://github.com/Amir-Abushanab/wave3d/blob/main/LICENSE)
