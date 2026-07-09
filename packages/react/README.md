# @wave3d/react

A drop-in, self-optimizing animated **3D gradient wave** for React — the `<Wave3D>` component.

Poster-first and lazy: it renders a server-safe `<div>`, then on the client mounts the wave — showing a poster immediately and upgrading to live WebGL only when the browser can run it (falling back to the poster on no-WebGL, Save-Data, reduced-motion, or context loss), with `three.js` code-split out of the initial load.

## Install

```sh
pnpm add @wave3d/react @wave3d/core three   # + @types/three for TypeScript
```

`react` (`>=18`), `@wave3d/core`, and `three` are peer dependencies.

## Usage

```tsx
import { Wave3D } from "@wave3d/react";

<Wave3D preset="Hero" poster="/wave.png" style={{ width: 480, height: 270 }} />;
```

Server-render your own poster by passing it as a child — the shell adopts it:

```tsx
<Wave3D poster="/wave.png">
  <img data-wave3d-poster src="/wave.png" alt="" />
</Wave3D>
```

## Capture a poster

`onReady` hands you the live `WaveRenderer` — capture the current frame as an image (e.g. to generate the `poster` that reduced-motion / no-WebGL / Save-Data visitors see):

```tsx
<Wave3D
  preset="Hero"
  onReady={async (renderer) => {
    const blob = await renderer.captureImage("image/webp"); // transparent by default
    // host / cache `blob`, then serve it as the poster
  }}
/>
```

## Props

| Prop                     | Type                                      | Notes                                                                       |
| ------------------------ | ----------------------------------------- | --------------------------------------------------------------------------- |
| `preset`                 | `string \| () => Partial<StudioConfig>`   | a name (lazy-loads the presets chunk) or a function preset (tree-shakeable) |
| `config`                 | `Partial<StudioConfig>`                   | escape hatch, applied last                                                  |
| `poster`                 | `string`                                  | poster image shown before / instead of WebGL                                |
| `lazy`                   | `boolean`                                 | defer the upgrade until visible                                             |
| `webgl`                  | `"auto" \| "force" \| "off"`              | force or disable the WebGL upgrade                                          |
| `respectReducedMotion`   | `boolean`                                 | freeze on the poster for reduced-motion users                               |
| `onReady` / `onFallback` | `(renderer) => void` / `(reason) => void` | lifecycle callbacks                                                         |
| `className`, `style`     | —                                         | forwarded to the container `<div>`                                          |

Plus flat shortcuts mapped onto the first wave / scene: `palette`, `sheen`, `iridescence`, `speed`, `opacity`, `blendMode`, `theme`, `background`, `transparentBackground`, `quality`, `dprMax`, `loopSeconds`, `paused`, and more. Precedence: **default ← preset ← flat props ← `config`**.

## Credits

Created by [Amir Abushanab](https://github.com/Amir-Abushanab).

## License

[MIT](https://github.com/Amir-Abushanab/wave3d/blob/main/LICENSE)
