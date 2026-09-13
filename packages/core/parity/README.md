# Preset parity

Guards the TSL/WebGPU port: every shipped preset and gallery config is rendered on **both**
backends and compared, so a shader that ports incorrectly fails loudly instead of shipping.

```sh
pnpm --filter @wave3d/core parity          # render all 39 configs on both backends, compare
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
itself, every config lands at `mae = 0.00` with `maxDelta ≤ 12`, so the headroom above is real.

**These are a CEILING, not a regression detector, and the difference matters.** Two deliberately
injected bugs — WebGPU colour 1.5 % bright, and WebGPU geometry scaled by 1.004 — both sail
through green. The second pushes `preset:Wireframe`'s `maxDelta` from 46 to 255 and `mae` from 0.09
to 0.49, and the gate still says pass, because a sub-pixel silhouette shift moves a lot of pixels a
little and the thresholds are sized for "would a person notice". So the suite catches a shader that
is WRONG; it does not catch one that has DRIFTED. Catching drift needs a per-config baseline to
compare against, which is not built: the numbers below are the record instead, so check a change
against them rather than against the pass/fail column alone.

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
preset to look wrong — a mismatch in shared maths surfaces as 39 confusing preset failures instead
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

**34 of 39 configs pass**, every one of them at `mae <= 0.62`. The five that do not are named below,
and they share one cause.

It was 7 of 39 until two bugs were found, and both are worth knowing about because neither looked
like a bug from the numbers:

- **A custom `outputNode` never gets premultiplied alpha.** See the traps section — this was the
  single largest source of divergence in the whole suite, and it had been filed under "dense
  additive dust is just hard".
- **The edge mask could not see a FEATHERED silhouette**, so it charged the ribbon's soft rim to
  the shader. See `edgeMask` in `harness.ts`. `preset:Hero` went from 1.24 % of interior pixels over
  8 to 0.07 % on that fix alone, and its true interior — everything past the rim — had been at
  0.2 % all along.

### The five that remain

| config                         |  mae | interior >8 | interior >24 |
| ------------------------------ | ---: | ----------: | -----------: |
| `preset:Neon Dark Multistrand` | 4.79 |      15.3 % |        6.8 % |
| `preset:Corkscrew`             | 1.16 |       6.4 % |        3.9 % |
| `preset:Kaleidoscope`          | 0.77 |       2.2 % |        1.5 % |
| `preset:Wave 3`                | 0.73 |       2.2 % |        1.4 % |
| `preset:Vaporwave Sunset`      | 0.41 |       1.0 % |        0.3 % |

All five are ORDER-DEPENDENT TRANSPARENCY, and it is the same mechanism each time: a wave is
`transparent: true` with `depthWrite: true`, so wherever alpha < 1 the result depends on the order
fragments arrive in and on how the depth test resolves near-coplanar surfaces. Neither is promised
to match across two rasterisers. These five are simply the configs that stack the most
semi-transparent surface on itself — a corkscrew crossing itself five times, three wireframe layers
at 425 strands, a kaleidoscope of stacked waves.

`edgeFeather` is what makes this reach every preset rather than only the ones that set an opacity:
it ramps each ribbon's two ENDS to transparent by default, so every wave has a soft region even at
`opacity: 1`. Setting `--set waves.0.edgeFeather=0` takes `preset:Corkscrew` from `mae` 1.16 to 0.18
and it passes.

There is no free fix. Forcing `depthWrite: false` on every wave makes `Neon Dark Multistrand` pass
outright (`mae` 4.79 → 0.07, interior >8 15.3 % → 0.00 %) — but it also removes the occlusion that
makes a stack read as one solid object, and the disagreement simply moves into blend order instead:
the same change sends `Kaleidoscope` to `mae` 23.46 and `Wave 3` to 10.59. Correctly ordered
transparency is order-independent transparency, which is a much larger change than a port fix.

`--no-post` renders both backends with every effect zeroed, which separates "the shader is wrong"
from "the post chain is wrong" — two bugs that look identical in a whole-frame diff. `--set k=v`
(repeatable, dotted paths, e.g. `--set waves.0.particles.count=0`) isolates one setting at a time.

## Points versus sprites

WebGPU point primitives are fixed at one pixel, so the particle field is instanced sprites there and
`THREE.Points` on WebGL. Those two rasterise differently, and it is measurable.

This difference is real, but for a long time it was blamed for far more than it causes. The
`synthetic:dust-*` cases used to sit at `mae` 2.8-12 and this table was the standing explanation;
they now sit at 0.17-0.62, and nothing about the rasterisers changed — the premultiplied-alpha trap
below was doing almost all of it. A plausible known cause is the most comfortable place for a real
bug to hide, so the measurements:

| nominal size | WebGL point        | WebGPU sprite      |
| ------------ | ------------------ | ------------------ |
| 3.6 px       | 2 px wide, 4 lit   | 4 px wide, 12 lit  |
| 6 px         | 4 px wide, 16 lit  | 6 px wide, 24 lit  |
| 12 px        | 10 px wide, 80 lit | 12 px wide, 96 lit |

`sizeNode` itself is exact — a sizeNode of 8 renders an 8x8 sprite. It is the WebGL point that comes
out roughly 2 px narrower than asked for. So each mote covers about 1.5x more pixels on WebGPU and
the dust reads slightly brighter. That is deliberately NOT compensated for: the correction would be
a fudge tuned to one driver's point rasteriser, and it would be wrong wherever that driver behaves
differently. With the premultiply fixed, every dust case passes anyway — the residual it leaves is
an `interior >8` of 0.1-0.3 %, which is where it always should have been.

## What the shader-math check has confirmed

`simplexNoise`, `expStep`, the three-axis twist, the helix, and uniform-count `Loop`/`Break` all
agree with the GLSL to 0 or ~1e-7. Two findings worth keeping:

- **`dFdy` is NOT sign-flipped between the backends** — both report `+1` for a quad whose uv rises
  with screen Y. Worth knowing, because the Y-axis convention does differ elsewhere and `crease`
  (`dFdy(vUv).y` through `mapLinear(v, -1, 1, 0, 1)`) would invert the whole surface if it applied.
- **`screenCoordinate` DOES differ**: it follows WebGPU's top-left origin and flips Y on WebGL to
  match, where `gl_FragCoord` is bottom-left. The film grain keys off it, so unflipped it produced
  a completely different grain pattern — visually similar, speckle across every pixel of a diff.

## Two ways this harness lied

Both produced confident, plausible numbers while measuring nothing, and both are worth knowing about
before trusting a comparison of your own:

- **A flag reached one backend and not the other.** The runner used to build the two `render()`
  calls separately, and twice a new option was added to one and not the other — so it compared
  WebGL _with_ post against WebGPU _without_, and blamed the difference on the port. It now builds
  ONE options object and passes it to both, differing only in `backend`.
- **A custom `outputNode` silently loses premultiplied alpha.** `NodeMaterial.setupOutput()` does
  call `setupPremultipliedAlpha()` — on its own `basicOutput`, which it then throws away the instant
  a custom `outputNode` is set (`if (isCustomOutput) resultNode = this.outputNode`). So the material
  got the premultiplied BLEND FACTORS without the premultiply, and every partly transparent pixel
  composited too bright. Because `blendMode` defaults to `"squared"`, which asks for premultiplied
  factors, this was every wave. It read as "dense additive dust is a hard case" for as long as only
  the dust synthetics were bright enough to show it: `synthetic:dust-stack` was at `mae` 12.18 and
  is now at 0.17. The lesson is not about that one API — it is that a difference which only shows up
  where alpha < 1 will always look like a hard case rather than a bug, because the opaque 95 % of
  every frame keeps agreeing perfectly.
- **Additive dust on a white background saturates and clips.** Nine particle cases passed while the
  TSL field was rendering _nothing at all_: both frames were blown out to the same white. The dust
  synthetics now use a dark background, which is what surfaced the real bug (a per-instance accessor
  that made every mote read the same element). If a case cannot fail, it is not a test.
