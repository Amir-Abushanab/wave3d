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

## Shader-math check

```sh
pnpm --filter @wave3d/core parity:math
```

Verifies each ported shader function against the GLSL original directly, rather than waiting for a
preset to look wrong — a mismatch in shared maths surfaces as 22 confusing preset failures instead
of one clear one. Covers the simplex noise (whole field plus point probes), `expStep`, and the
three-axis twist. Both implementations are rendered to a 24-bit-encoded target and
compared per sample; noise currently agrees at **max|Δ| = 0 over 65,536 samples**, i.e.
bit-identical across the WGSL and GLSL backends, and every point probe is at 0 bar one twist case
at 1.2e-7 (float reassociation between the matrix and vector forms).

This is not ceremony. It immediately caught a sign error in the twist: the GLSL applies its rotation
row-vector style (`vec4(pos,1) * R`), and because `mat4(...)` fills column-major while that literal
is written out by rows, the matrix is already the transpose — so the product is a **+angle**
rotation, not the −angle it reads as. Every preset would have been subtly mis-shaped.

Two traps this check walked into, both worth knowing before writing another comparison:

- **The node pipeline applies an output color-space transfer; a raw `ShaderMaterial` does not.**
  Comparing them directly measures sRGB encoding, not your shader. Set
  `renderer.outputColorSpace = NoColorSpace` on the WebGPU side for any numeric comparison.
- **`QuadMesh` has its own fullscreen-triangle UV setup.** Render both sides through the same
  geometry and camera, or the two shaders sample different points and every value disagrees.

## Current state of the port

Both backends render all 22 configs. Fourteen sit at `mae` 0.7–3.1 with 2–7% of interior pixels
differing by more than 8/255, and a mean signed bias under ±1 — i.e. symmetric rounding, not a
systematic error. That is the precision floor: the fiber texture is sampled at ~600x frequency, so
last-bit differences in uv interpolation land on either side of a quantisation boundary.

The outliers all trace to work that is not done yet, not to the shaders:

| config                      | interior >8 | cause                                                           |
| --------------------------- | ----------- | --------------------------------------------------------------- |
| `Particle Zoo`              | 100 %       | particle field not ported (WebGPU has no point size)            |
| `rainbow-mesh-double-helix` | 99 %        | `innerLight` post effect not ported                             |
| `dna-double-helix`          | 50 %        | bloom not ported                                                |
| `Neon Dark Multistrand`     | 25 %        | bloom not ported                                                |
| `Wireframe`                 | 23 %        | bloom; only 1.2% differ by >24, the rest is strand-width jitter |

`--no-post` renders both backends with every effect zeroed, which is what separates "the shader is
wrong" from "the post chain is wrong" — two bugs that look identical in a whole-frame diff.

The thresholds above are the target, not the present state; they stay where they are until the post
chain and particles land, so the gate keeps pointing at real work.

## What the shader-math check has confirmed

`simplexNoise`, `expStep`, the three-axis twist, the helix, and uniform-count `Loop`/`Break` all
agree with the GLSL to 0 or ~1e-7. Two findings worth keeping:

- **`dFdy` is NOT sign-flipped between the backends** — both report `+1` for a quad whose uv rises
  with screen Y. Worth knowing, because the Y-axis convention does differ elsewhere and `crease`
  (`dFdy(vUv).y` through `mapLinear(v, -1, 1, 0, 1)`) would invert the whole surface if it applied.
- **`screenCoordinate` DOES differ**: it follows WebGPU's top-left origin and flips Y on WebGL to
  match, where `gl_FragCoord` is bottom-left. The film grain keys off it, so unflipped it produced
  a completely different grain pattern — visually similar, speckle across every pixel of a diff.
