# @wave3d/vite

A dev-only Vite plugin that captures a [wave3d](https://github.com/Amir-Abushanab/wave3d) poster straight from the browser already rendering it. No headless browser, no Playwright. Posters stay in sync as you edit the config over HMR, and `vite build` just references the committed file.

## 📦 Install

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

Opt a `<wave-3d>` in by naming its output file. The plugin snapshots it when the wave is ready, re-snapshots on every HMR edit, and writes only when the frame actually changes:

```html
<wave-3d preset="Hero" poster="/hero.webp" data-wave3d-poster-out="hero.webp"></wave-3d>
```

`public/hero.webp` is written from the live wave. The `poster` attribute then serves it as the reduced-motion, no-WebGL, and Save-Data fallback.

### React / mountWave

There's no `<wave-3d>` node to auto-detect, so register the handle (`createWave` / `mountWave`) or renderer (React's `onReady`) yourself:

```tsx
import { registerPoster } from "@wave3d/vite/client";

<Wave3D
  preset="Hero"
  poster="/hero.webp"
  onReady={(renderer) => registerPoster(renderer, "hero.webp")}
/>;
```

## Options

| Option       | Default        | What                                                                     |
| ------------ | -------------- | ------------------------------------------------------------------------ |
| `outDir`     | `"public"`     | directory posters are written to, relative to the Vite root              |
| `type`       | `"image/webp"` | captured image MIME type                                                 |
| `quality`    | `0.92`         | encoder quality (0–1)                                                    |
| `posterTime` | `0`            | fixed animation time to capture, for a reproducible frame. `null` = live |

## Credits

Built by [Amir Abushanab](https://github.com/Amir-Abushanab).

## License

[MIT](https://github.com/Amir-Abushanab/wave3d/blob/main/LICENSE)
