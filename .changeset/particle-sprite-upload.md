---
"@wave3d/core": minor
---

Add `shape: "sprite"` — use your own artwork as the dust. Set `particles.spriteUrl` to an SVG (or raster) `data:` URI or URL and every particle in the field draws it.

SVG is the format to reach for: the whole config travels inside save-states and share links, and a usable sprite is under a kilobyte where a PNG would be tens of them.

**Cost is per field, not per particle.** The artwork is rasterized once into a single 256² texture that every particle samples, so a 20k-particle sprite field costs ~256 KB of texture — less than the per-particle attribute buffers that field already uploads (~800 KB). In the fragment shader a texture fetch replaces the procedural branch, so it is if anything cheaper than `star`.

Details worth knowing:

- **Tinted** by `color` / `color2`, so the field's colour knobs keep working. White artwork takes the tint exactly; coloured artwork multiplies it.
- **Letterboxed** into a square, because a point sprite always is. Mipmapped, since `sizeJitter` and the birth/death fade draw one texture across a wide range of pixel sizes.
- **Degrades, never blanks**: until the image rasterizes — or if it fails — the field draws "glitter". A failed URL is latched so it is not retried every frame.
- **Size matters**: the built-in shapes are tuned for a 2-6px dot, which is far too small for artwork to read. The studio lifts the size on first upload.
- Loading follows the background-image pattern (load → bind → request a redraw) rather than the palette's fire-and-forget loader, and preset thumbnails now preload sprite artwork — so a paused renderer, thumbnail, or poster does not capture blank dust.

Gallery submissions accept inline SVG, so a sprite wave can be published with its artwork attached; embedded raster and video are still rejected, and the 24 KB file cap still applies.
