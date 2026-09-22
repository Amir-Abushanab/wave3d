---
"@wave3d/core": patch
---

Studio: **Finish now sits above Color & Gradient**, so the material is chosen before the palette
whose meaning it changes. Under glass, `blend` and Noise Bands are greyed out or hidden (the glass
shader never reads them) and the palette editor carries a note that the palette only sets the hue of
the transmission. **Caustics, fold thickness and droplet fusion** get sliders, and every glass
control has a hover hint grounded in what the shader does with it. The `wave3d` skill gains a glass
section.

Shaping a path: each point's pick target is nearly twice the dot, and the cursor says what a click
here does — an arrow with a "+" over the ribbon (double-click adds a point, drag sculpts), a "−"
over a point (double-click removes it, drag moves it), and a plain pointer on a point that cannot be
removed.
