// The `@wave3d/core` entry: the lightweight poster-fallback shell (createWave / mountWave) plus the
// framework-agnostic config model. Deliberately free of any static three or renderer import — the
// shell fetches the engine on demand via a dynamic import (see ./core-loader), so a bundler keeps
// three.js out of this module's initial load. For a synchronous, three-bundled build see
// ./standalone (the CDN entry) or import ./renderer directly.
export * from "./config/model";
// Explicit (not `export *`) so the internal createWaveImpl — which the standalone build uses to
// avoid bundling the dynamic-import path — stays off the public surface.
export { createWave, mountWave } from "./shell/createWave";
// The capability probe, exported because every consumer that wants "only upgrade on a GPU" would
// otherwise hand-roll the same WEBGL_debug_renderer_info read — and the failure mode of getting it
// wrong is silent: treat "cannot read the renderer" as "software" and you downgrade people whose
// privacy settings hide the extension, who then see a poster forever with nothing to report.
export { probeWebGL, isSoftwareRenderer, hasWebGL } from "./shell/probe";
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
export type { TiltStatus } from "./renderer/tilt";
