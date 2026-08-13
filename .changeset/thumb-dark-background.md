---
"@wave3d/core": patch
---

Preset/gallery thumbnails now keep a preset's **own dark background** instead of always swapping in a white card. Any solid-theme preset authored on a dark, opaque colour (e.g. "Latte Ring") reads best on that dark ground — a bright wave shows against it and bloom behaves — where the white card washed the warm wave out. Light/transparent-background presets still get the white card (with the light-scatter passes zeroed) so their shape stands out.
