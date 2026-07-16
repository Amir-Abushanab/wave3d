// The `@wave3d/core` entry: the lightweight poster-fallback shell (createWave / mountWave) plus the
// framework-agnostic config model. Deliberately free of any static three or renderer import — the
// shell fetches the engine on demand via a dynamic import (see ./core-loader), so a bundler keeps
// three.js out of this module's initial load. For a synchronous, three-bundled build see
// ./standalone (the CDN entry) or import ./renderer directly.
export * from "./config/model";
// Explicit (not `export *`) so the internal createWaveImpl — which the standalone build uses to
// avoid bundling the dynamic-import path — stays off the public surface.
export { createWave, mountWave } from "./shell/createWave";
export type {
  WaveOptions,
  WaveHandle,
  WaveState,
  FallbackReason,
  SnapshotOptions,
  PosterFit,
} from "./shell/createWave";

// Type-only re-exports (erased at build time — no runtime three import) so consumers can type
// `onReady(r)` / renderer options.
export type { WaveRenderer, WaveRendererOptions } from "./renderer/WaveRenderer";
