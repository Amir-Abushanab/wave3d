# Preset parity

Guards the TSL/WebGPU port: every shipped preset and gallery config is rendered on **both**
backends and compared, so a shader that ports incorrectly fails loudly instead of shipping.

```sh
pnpm --filter @wave3d/core parity          # render all 22 configs on both backends, compare
pnpm --filter @wave3d/core parity --self   # render WebGL twice — checks the harness itself
pnpm --filter @wave3d/core parity:serve    # open the harness by hand for debugging
```

Both renders happen in one page load, so GPU, driver, browser and config are identical and the
backend is the only variable. Nothing binary is versioned — both renderers build from this source
tree, so baselines are reproducible on demand (`--capture` writes PNGs into `refs/` when you do
need to compare across machines).

## Why perceptual, not digests

Same-backend refactors can be checked with exact SHA-256 pixel digests. Cross-backend renders
**cannot** be bit-identical: WebGPU defaults to a `HalfFloatType` output buffer, resolves MSAA
differently, and the noise functions diverge in the last ULP. So the gate is a perceptual one:

| metric      | threshold | why                                                                    |
| ----------- | --------- | ---------------------------------------------------------------------- |
| `mae`       | ≤ 2.0     | mean absolute per-channel delta — catches any broad colour/shape drift |
| `pctOver8`  | ≤ 1.0 %   | share of pixels differing enough to notice under inspection            |
| `pctOver24` | ≤ 0.25 %  | share differing enough to notice at a glance                           |

`maxDelta` is reported for triage but is deliberately **not** a gate: one pixel on a hard edge
legitimately flips far under a different MSAA resolve. Measured on the WebGL renderer against
itself, all 22 configs land at `mae = 0.00` with `maxDelta ≤ 12`, so the headroom above is real.

Failures write `<config>.actual.png`, `.expected.png` and an 8×-amplified `.diff.png` into `out/`.

## Determinism

`paused: true`, `timeOffset: 0`, `setOutputSize()` (which pins DPR to 1), and
`captureImage(…, time)` — which fixes `uTime` and forces the intro ramp full. Each config gets a
fresh renderer that is disposed after capture, so palette textures, particle fields and composer
targets never leak between configs.

WebGPU is only exposed to a **secure context**, which is why the runner drives a localhost dev
server rather than a `file://` or `about:blank` page — on `about:blank`, `navigator.gpu` is
`undefined` even in a browser that fully supports it.

## Noise check

```sh
pnpm --filter @wave3d/core parity:noise
```

The wave's entire silhouette comes out of one simplex function, so the TSL port of it is verified
on its own rather than through the presets — a mismatch there would surface as 22 confusing preset
failures instead of one clear one. Both implementations are rendered to a 24-bit-encoded target and
compared per sample; they currently agree at **max|Δ| = 0 over 65,536 samples**, i.e. bit-identical
across the WGSL and GLSL backends.

Two traps this check walked into, both worth knowing before writing another comparison:

- **The node pipeline applies an output color-space transfer; a raw `ShaderMaterial` does not.**
  Comparing them directly measures sRGB encoding, not your shader. Set
  `renderer.outputColorSpace = NoColorSpace` on the WebGPU side for any numeric comparison.
- **`QuadMesh` has its own fullscreen-triangle UV setup.** Render both sides through the same
  geometry and camera, or the two shaders sample different points and every value disagrees.
