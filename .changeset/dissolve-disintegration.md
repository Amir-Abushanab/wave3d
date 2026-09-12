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
  into a cone: the vortex a constant-radius helix cannot reach. 1 (the default) is the cylinder it
  always wound. `radialCone` does the equivalent for the radial fan — it lifts the fan out of its own
  plane as it spreads, turning the flat plume into a TRUMPET whose combed strands run down the slant
  into the throat, which is a shape neither the twists nor the helix can reach (a helix carries the
  ribbon around an axis, but its WIDTH never follows the slant).

`edgeFeather` now applies to the WIREFRAME theme as well as the solid one. Without it a wireframe
ribbon stops dead at its end-cap — a flat cross-section that reads as a straight cut drawn across the
strands, glaring the moment a ribbon curls back into frame. Clear-gap strands also stop writing
DEPTH: they are thin transparent slivers layered many deep, and two sheets passing near-coplanar
would otherwise decide who occludes whom by depth precision, which is arbitrary and differs between
backends; with the write off they composite in wave order, which is stable.

`lineGapOpacity` decides what sits between the strands. At 1 (the default) the gaps are painted with
the page background, which is what the wireframe theme has always done — and which makes a wireframe
wave an opaque CARD: stack two and the front one's gaps hide the back one behind flat page colour
instead of showing it through. At 0 they are clear, so the strands composite over whatever is really
behind them and a stack of combs builds depth out of its own overlaps. `radialSwirl` lets the radial
fan's ANGLE advance along the band as well as across it; radius already grows with uv.y, so angle
growing with it too is exactly what curls a straight arm into a spiral one wrapping the throat.

Two rendering fixes the look depends on. The hardened stripe's edge is floored by its own
SCREEN-SPACE derivative rather than a constant: a hard step on strands already thinner than a pixel
is the classic moire generator, and holding the transition at ~1.4 px makes the edge exactly as crisp
as the strand can support — razor-sharp where it resolves, box-filtered to a flat tone where it does
not. And a `"square"` particle now cuts its OWN shard from its quad — its own extent, proportion and
quarter-turn, with a squared extent for the heavy tail real rubble has — because a field of identical
squares reads as grain rather than debris.

New preset **Disintegration**: engraved bands converging on a throat over warm paper, crumbling into
blocky debris across a straight edge, with scroll wired to finish the job.
