# @wave3d/vite example

A minimal Vite app exercising [`@wave3d/vite`](../../packages/vite) — and the plugin's dev/test harness.

- A `<wave-3d>` element auto-captured to `public/hero.webp` (via `data-wave3d-poster-out`).
- A second wave mounted with `createWave()` and opted in with `registerPoster()` → `public/second.webp` (the React / `mountWave` path).

Each poster is keyed by its output filename, so the two waves capture and dedup independently.

```sh
pnpm --filter wave3d-poster-example dev
```

Open it and the posters are written from the live waves — re-captured when you edit `wave-config.js`, skipped (config-hash unchanged) when you edit anything else. `public/` is gitignored: the posters are generated, not committed.
