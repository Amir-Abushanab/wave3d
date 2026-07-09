// Client helper for React / mountWave, where the wave handle isn't on a DOM node (the `<wave-3d>`
// element is auto-detected without this). Pass a WaveHandle (createWave/mountWave) or a WaveRenderer
// (React's `onReady`). Call it from `onReady` or right after `mountWave`. In a production build the
// dev plugin isn't present, so `window.__wave3dPoster` is undefined and this is a harmless no-op.

interface Registrar {
  register(target: unknown, out: string): void;
}

type PosterWindow = typeof globalThis & {
  __wave3dPoster?: Registrar;
  __wave3dPosterQueue?: [unknown, string][];
};

/**
 * Register a wave for dev-time poster capture. `out` is the file written under the plugin's
 * `outDir` (e.g. `"hero.webp"`). Guard with `import.meta.env.DEV` if you want it fully tree-shaken
 * from production bundles.
 */
export function registerPoster(target: unknown, out: string): void {
  if (typeof window === "undefined") return;
  const w = window as PosterWindow;
  const reg = w["__wave3dPoster"];
  if (reg) reg.register(target, out);
  else (w["__wave3dPosterQueue"] ??= []).push([target, out]);
}
