// The dynamic-import target for the shell. The `.` entry's `createWave` reaches the heavy renderer
// (and, through it, three.js) via `import("./core-loader")`, so a bundler code-splits three out of
// the initial load — the drop-in component ships a tiny shell and fetches the engine only when a
// wave actually upgrades. The standalone/CDN build imports this statically instead (three bundled).
export { WaveRenderer } from "./renderer/WaveRenderer";
export { createDefaultConfig } from "./config/model";
