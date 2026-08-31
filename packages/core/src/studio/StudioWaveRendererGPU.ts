/**
 * The studio editor on the TSL/WebGPU backend: {@link StudioWaveRenderer} with the GPU backend
 * layered on top via {@link withTslBackend}. The composition is safe because the two classes
 * override disjoint base hook sets (editor: camera/overlay hooks; backend: renderer/material/post
 * hooks) — see the mixin's doc comment.
 *
 * This module transitively imports `three/webgpu` (~197 KB gzipped), so it must only ever be
 * reached through the dynamic import in `loadStudioWaveRendererGPU` (./index.ts). A static import
 * from any eager module fails `scripts/check-webgpu-chunk.mjs`.
 */
import { withTslBackend } from "../renderer/WaveRendererGPU";
import { StudioWaveRenderer } from "./StudioWaveRenderer";

export const StudioWaveRendererGPU = withTslBackend(StudioWaveRenderer);
