# @wave3d/react

A drop-in animated **3D gradient wave** for React: the `<Wave3D>` component. Design one in [Wave Studio](https://wave-studio.pages.dev), export the React snippet, paste it here.

It renders a server-safe `<div>`, then on the client shows a poster and upgrades to live WebGL only when the browser can run it. It falls back to the poster on no-WebGL, Save-Data, reduced motion, or a lost context, with `three.js` code-split out of the initial load.

## 📦 Install

```sh
pnpm add @wave3d/react three   # + @types/three for TypeScript
```

`react` (`>=18`) and `three` are peer dependencies; `@wave3d/core` is bundled in.

## Usage

```tsx
import { Wave3D } from "@wave3d/react";

<Wave3D preset="Hero" poster="/wave.png" style={{ width: 480, height: 270 }} />;
```

Server-render your own poster by passing it as a child. The shell adopts it:

```tsx
<Wave3D poster="/wave.png">
  <img data-wave3d-poster src="/wave.png" alt="" />
</Wave3D>
```

## Capture a poster

`onReady` hands you the live `WaveRenderer`. Capture the current frame to generate the poster that reduced-motion, no-WebGL, and Save-Data visitors see:

```tsx
<Wave3D
  preset="Hero"
  onReady={async (renderer) => {
    const blob = await renderer.captureImage("image/webp"); // transparent by default
    // host or cache `blob`, then serve it as the poster
  }}
/>
```

## Props

| Prop                     | Type                                      | Notes                                                                       |
| ------------------------ | ----------------------------------------- | --------------------------------------------------------------------------- |
| `preset`                 | `string \| () => Partial<StudioConfig>`   | a name (lazy-loads the presets chunk) or a function preset (tree-shakeable) |
| `config`                 | `Partial<StudioConfig>`                   | escape hatch, applied last                                                  |
| `poster`                 | `string`                                  | poster image shown before or instead of WebGL                               |
| `posterFit`              | `"fill" \| "cover" \| "contain"`          | poster `object-fit`; `"fill"` (default) matches the canvas                  |
| `lazy`                   | `boolean`                                 | defer the upgrade until visible                                             |
| `webgl`                  | `"auto" \| "force" \| "off"`              | force or disable the WebGL upgrade                                          |
| `respectReducedMotion`   | `boolean`                                 | freeze on the poster for reduced-motion users                               |
| `onReady` / `onFallback` | `(renderer) => void` / `(reason) => void` | lifecycle callbacks                                                         |
| `className`, `style`     |                                           | forwarded to the container `<div>`                                          |

Plus flat shortcuts mapped onto the first wave and scene: `palette`, `sheen`, `iridescence`, `speed`, `opacity`, `blendMode`, `theme`, `background`, `transparentBackground`, `quality`, `dprMax`, `loopSeconds`, `paused`, and more. Precedence: **default → preset → flat props → `config`**.

## Credits

Built by [Amir Abushanab](https://github.com/Amir-Abushanab).

## License

[MIT](https://github.com/Amir-Abushanab/wave3d/blob/main/LICENSE)
