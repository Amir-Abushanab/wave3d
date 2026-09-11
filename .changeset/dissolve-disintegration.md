---
"@wave3d/core": minor
---

Disintegration — a wave can now come apart. `WaveConfig.dissolve` sweeps a front across the ribbon
and eats it away chunk by chunk, so the surface CRUMBLES rather than fading: holes open in it, the
holes merge, and the last fragments break off. Absent ⇒ intact, and the `DISSOLVE` path is never
compiled.

```ts
dissolve: { amount: 0.3, axis: "screenX", reverse: true, band: 0.55, scale: 150, blocky: 0.75, dust: 1 }
```

`amount` is the whole animation (0 whole, 1 gone, whatever the `band` fray width) and it is a
binding target, so `{ source: "scroll", target: "dissolveAmount", to: 1 }` snaps the wave as the page
moves. `scale` dices the sheet and `blocky` sets the chunk character, from organic tatters to hard
quantized cells.

**The axis can leave the ribbon.** `"length"` / `"width"` ride the wave's own uv and bend with it;
`"screenX"` / `"screenY"` are a straight line on the CANVAS, which is what lets a whole multi-wave
stack crumble as one object — give every wave the same axis and amount and they share one edge
however each is rotated. The crumb pattern stays on the surface either way.

**The dust is the surface.** `dissolve.dust` pins the wave's own `particles` field to that same
front: a mote does not exist until the front reaches its patch, then peels off and drifts on from
there, so the debris and the holes are one event instead of two effects that happen to overlap.
Under a screen-space front the debris also blows along the sweep, away from the part still standing.

Three supporting knobs, each inert at its default:

- `ParticlesConfig.shape: "square"` — a hard-edged screen-aligned chip, the blocky debris a dissolve
  sheds — and `ParticlesConfig.blend: "normal"`, which alpha-blends the field instead of adding it.
  Additive dust can only brighten, so it is invisible on a white page and can never read as dark;
  `"normal"` is what soot, ash and ink need.
- `lineSharpness` (wireframe) steepens the strand profile, which turns `lineThickness` into a DUTY
  CYCLE. The stripe is a soft ramp by default, so thickness alone goes from pale hairlines to flat
  solid without ever passing through dense ink; hardening it gives engraved black strands with the
  page still showing between them. `lineDepthFade` turns off the recede into the background colour,
  which a deep or stacked composition needs — the default is tuned for a single ribbon.
- `helixTaper` scales the helix radius along the ribbon's length, so the coil can open from the axis
  into a cone: the vortex / funnel / plume a constant-radius helix cannot reach. 1 (the default) is
  the cylinder it always wound.

New preset **Disintegration**: an engraved cluster of ribbons on warm paper, crumbling into blocky
dust across a straight edge, with scroll wired to finish the job.
