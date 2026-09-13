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
- `radialCone` lifts the radial fan out of its own plane as it spreads, turning the flat plume into a
  TRUMPET whose combed strands run down the slant into the throat — a shape neither the twists nor
  the helix can reach, since a helix carries the ribbon around an axis but its WIDTH never follows a
  slant. `radialSwirl` curls each arm around the throat (see above).

**`WaveConfig.path` — a centreline the ribbon is swept along, dragged in the studio.** Every other
deform bends a ribbon whose centreline is fixed, so none of them can make one that changes direction
more than once, crosses itself, or is wide here and narrow there. A path can, because it IS the
centreline: control points in the wave's local space, each with an optional `width` and `twist`.
Absent ⇒ the straight ribbon, byte-identical.

Points are swept by ARC LENGTH with a parallel-transported frame. Both matter: sampling by curve
parameter would bunch the strand comb wherever the author happened to crowd points, and a Frenet
frame would flip the ribbon 180° at every inflection. A path whose last point sits on its first is a
closed ring — that repeat is the whole declaration, rather than a `closed` flag for something the
points already say. `arcPath(turns)` builds one.

**Double-click a ribbon in the studio and shape it like putty.** The primary gesture is dragging the
RIBBON, not a control point: the push falls off smoothly along the length, so only the part under the
cursor follows and the rest stays where you left it (Shift narrows the push from a palm to a
fingertip). The path densifies itself on the first sculpt, because a three-point path can only be
bent as a whole and that feels like bending wire rather than pressing clay. Control points remain for
precision — drag a handle, double-click one to remove it, double-click the ribbon to insert one — and
Escape leaves.

While the mode is on, a bar lists the gestures (none of them are discoverable from a canvas) and the
cursor reports what is under it: grab on the ribbon, pointer on a control point, move on empty space.

Picking goes through a proxy strip rebuilt from the current frames, because the ribbon's vertices are
only deformed on the GPU: a raycast against the wave's own mesh would hit the straight ribbon the
geometry was born as rather than the curve on screen. The frames themselves are baked into a small
texture the vertex shader samples, so a sculpt costs one 128×3 texture write per frame rather than an
80k-vertex geometry rebuild.

This REPLACES three controls added earlier in this same unreleased batch: `pinch` (a path's per-point
`width`), `wrapAmount` (a closed path) and `helixTaper` (a path whose points spiral outward). All
three were knobs for shapes the centreline already says.

`helix*` and `radial*` are NOT replaced, and the difference is worth knowing: a path SWEEPS the
ribbon with a transported frame, so it banks into its curves like a rollercoaster track, where a
helix TRANSLATES the ribbon around an axis, so it keeps facing the same way — the same coil, a
different object. The radial fan remaps the ribbon's WIDTH to an angle, which a centreline cannot do
at all. And the helix is animatable where a path is not: `helixPhase` / `helixTurns` / `helixRadius`
are binding targets, so scroll can spin a coil.

Rungs (`rungAmount`, the cross-wise stripe family) are now usable as a wave's PRIMARY striping rather
than just a DNA-ladder accent. `lineSharpness` hardens the merged coverage, after the rungs have been
folded in, so a cross-wise family reaches dense ink the same way a lengthwise one does; and a rung
whose period has gone sub-pixel now falls back to its ANALYTIC duty cycle — the flat tone those
strands average to — instead of being point-sampled once per period, which is both what a compressed
region should look like and where two backends previously stopped agreeing.

`edgeFeather` now applies to the WIREFRAME theme as well as the solid one. Without it a wireframe
ribbon stops dead at its end-cap — a flat cross-section that reads as a straight cut drawn across the
strands, glaring the moment a ribbon curls back into frame. Clear-gap strands also stop writing
DEPTH: they are thin transparent slivers layered many deep, and two sheets passing near-coplanar
would otherwise decide who occludes whom by depth precision, which is arbitrary and differs between
backends; with the write off they composite in wave order, which is stable.

`lineGapColor` decides what sits between the strands, which is most of what a wireframe looks like.
Absent (the default, and what the theme has always drawn) the gaps take the page background: the wave
is a window onto the page, and being opaque the near fold HIDES the far one, which is what makes a
stack read as one solid object. A colour makes the ribbon its own body — bright combed lines on a
dark ground. `"transparent"`, or an 8-digit hex, leaves the gaps clear so stacked folds show through
each other: airier, at the cost of that occlusion. `radialSwirl` lets the radial
fan's ANGLE advance along the band as well as across it; radius already grows with uv.y, so angle
growing with it too is exactly what curls a straight arm into a spiral one wrapping the throat.

Two rendering fixes the look depends on. The hardened stripe's edge is floored by its own
SCREEN-SPACE derivative rather than a constant: a hard step on strands already thinner than a pixel
is the classic moire generator, and holding the transition at ~1.4 px makes the edge exactly as crisp
as the strand can support — razor-sharp where it resolves, box-filtered to a flat tone where it does
not. And a `"square"` particle now cuts its OWN shard from its quad — its own extent, proportion and
quarter-turn, with a squared extent for the heavy tail real rubble has — because a field of identical
squares reads as grain rather than debris.

**Wireframe strands can be lit.** Until now a strand's colour came from its uv alone, so it held one
tone wherever the surface turned — which is why a dense wireframe reads as hatching however it is
posed or coloured. `lineLight` (0..1) shades it with the same derivative normal, scene `lights` and
view-facing term the solid theme uses. `lineRound` goes further and bends the normal ACROSS each
stripe, so every strand is a half-round filament with a lit crest and dark flanks: that is what lets
a specular (`lineSpecular`) run along one strand and not its neighbour, and it is the difference
between a drawing of a combed surface and a combed surface. All three default to off, and the block
is only compiled when `lineLight` > 0.

One more thing worth knowing about the wireframe, learned the hard way: `lineDerivativePower` decides
whether a close-framed wave has any ink at all. It scales strand thickness by the screen-space uv
derivative — right for a ribbon seen whole, since strands then thicken where the surface turns away —
but the bigger a sheet gets on screen the smaller that derivative is, so framed close the strands
thin to pale grey exactly where they should be black. At 0, `lineThickness` alone is the duty cycle
and the strands stay crisp at any zoom (it also removes a derivative from the cross-backend budget:
the preset's parity went from 0.86% of pixels over 8 to 0.03%).

New preset **Disintegration**: a broad combed sheet curling around a spiral eye over warm paper,
crumbling into blocky debris across a straight edge, with scroll wired to finish the job.
