/**
 * The dynamic-import target for the TSL / WebGPU backend.
 *
 * This module exists ONLY so `three/webgpu` has a single, isolated entry point. Importing it pulls
 * three's whole node system — measured at ~197 KB gzipped as its own chunk against 89 KB for the
 * eager entry — so nothing reachable from the package entry may import it, or the bundler folds it
 * back into the main bundle and every consumer pays for a backend they did not ask for.
 *
 * `.dependency-cruiser.cjs` enforces that boundary; this is not a convention anyone has to remember.
 */
export { WaveRendererGPU } from "./WaveRendererGPU";
