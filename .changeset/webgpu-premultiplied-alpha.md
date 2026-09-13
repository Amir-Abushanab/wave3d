---
"@wave3d/core": patch
---

Fix transparency on the WebGPU backend. Anywhere a wave was partly transparent it composited too
bright — the soft ENDS every ribbon has by default (`edgeFeather`), the antialiased flank of every
wireframe strand, every particle, and any wave with `opacity` below 1.

`NodeMaterial.setupOutput()` does call `setupPremultipliedAlpha()` — but on its own `basicOutput`,
which it discards the moment a custom `outputNode` is set. So the wave material was getting the
premultiplied BLEND FACTORS without the premultiply. Since `blendMode` defaults to `"squared"`,
which asks for premultiplied factors, this was every wave. The material now premultiplies its own
output, exactly as the GLSL does under the `PREMULTIPLIED_ALPHA` define Three injects for it.

WebGL was always correct and is untouched — byte-identical. The scale of the WebGPU error, measured
against it: a ribbon at `opacity: 0.5` went from 13.3 % of its pixels visibly wrong to 0.02 %, and
the densest particle case in the parity suite from `mae` 12.18 to 0.17. The cross-backend suite goes
from 7 of 39 configs passing to 34.

It hid for so long because the opaque body of every frame kept agreeing perfectly, so the residual
looked like "dense additive dust is a hard case" rather than a bug — which is what the parity
README used to say.
