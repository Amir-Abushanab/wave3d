# wave-studio

## 0.1.9

### Patch Changes

- Updated dependencies [[`51e9f48`](https://github.com/Amir-Abushanab/wave3d/commit/51e9f480f98da5b7a446115a282ec34355a9e90d), [`51e9f48`](https://github.com/Amir-Abushanab/wave3d/commit/51e9f480f98da5b7a446115a282ec34355a9e90d), [`51e9f48`](https://github.com/Amir-Abushanab/wave3d/commit/51e9f480f98da5b7a446115a282ec34355a9e90d)]:
  - @wave3d/core@0.7.0

## 0.1.8

### Patch Changes

- [#17](https://github.com/Amir-Abushanab/wave3d/pull/17) [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Make the helix drivable from interaction inputs: `helixPhase`, `helixTurns` and `helixRadius` join the per-wave binding targets, so `{ source: "scroll", target: "helixPhase", to: 360 }` spins a coil exactly one turn down the page, and hover or press can wind, unwind, or open it.

  `waveDefines` now compiles the helix path for a wave that binds one of these but authors `helixRadius`/`helixRoll` at 0 — otherwise driving the radius up from a resting 0 would have nowhere to land. Same precedent as `detailAmount` and the second displacement octave. Waves with neither a helix nor a helix binding are unaffected.

- [#17](https://github.com/Amir-Abushanab/wave3d/pull/17) [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add a **Corkscrew** preset showcasing the helix mode, and surface the Helix section better in the studio.

  Corkscrew is a single wave with `helixRoll: 1`, which rolls the ribbon's cross-section in step with the sweep so the flat strip becomes an auger blade winding around its own length axis; `helixRadius` then lifts that blade off the axis so the turns read as a screw thread rather than a flat twist. It carries a mesh gradient rather than a stop ramp, so the colour field runs along the blade and each turn picks up a different part of the spectrum. There is no twist on it at all — the shape is unreachable with `twistFrequency`, whose `expStep` angle is monotone and can only ramp once.

  It is framed down the axis rather than side-on, so the coil reads as a screw receding into the frame and each turn shows its blade face instead of an edge.

  The studio's Helix folder is now open by default like its sibling shape sections, and has its own icon: a coil seen side-on. Two crossing strands (the DNA glyph) collapse into a figure-8 at the 13px the panel actually renders, and more than two loops turn to mush, so it's a two-loop spring — and deliberately unlike the Twist rotate-arrow sitting directly above it.

- [#17](https://github.com/Amir-Abushanab/wave3d/pull/17) [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Widen the displacement-amount slider from ±12 to ±120, and add panel controls for the new helix (turns / radius / roll / phase) and wireframe rungs (count / thickness).

  ±12 held the noise swell to 3% of the 400-unit ribbon, which put every large-amplitude look out of reach of the panel entirely — configs have never been clamped, so those shapes were editable only by hand-writing JSON in the config editor.

- Updated dependencies [[`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002), [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002), [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002), [`c32bef1`](https://github.com/Amir-Abushanab/wave3d/commit/c32bef107c6f68ff2c09447155ebabb982854349), [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002), [`6d556f6`](https://github.com/Amir-Abushanab/wave3d/commit/6d556f6a1ca6b72ff4f820d9b795e5a7d478ea0f), [`1311194`](https://github.com/Amir-Abushanab/wave3d/commit/1311194be433db096950143a11e8dc0df1ac9002)]:
  - @wave3d/core@0.6.0

## 0.1.7

### Patch Changes

- Updated dependencies [[`f359f19`](https://github.com/Amir-Abushanab/wave3d/commit/f359f195df6ad75c210213b11496932a52f29711), [`398a825`](https://github.com/Amir-Abushanab/wave3d/commit/398a8258308c3e4ab3528605718d2ad0a694a485)]:
  - @wave3d/core@0.5.0

## 0.1.6

### Patch Changes

- Updated dependencies [[`cb924c7`](https://github.com/Amir-Abushanab/wave3d/commit/cb924c70e29d914cb650143d315d7c33d43edeed)]:
  - @wave3d/core@0.4.1

## 0.1.5

### Patch Changes

- Updated dependencies [[`08b957c`](https://github.com/Amir-Abushanab/wave3d/commit/08b957c3b981920845d68ebf32a9600d87f72715)]:
  - @wave3d/core@0.4.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`6926a8b`](https://github.com/Amir-Abushanab/wave3d/commit/6926a8b81ddb8c05ccc9461cd89e2b28afaae38d), [`6926a8b`](https://github.com/Amir-Abushanab/wave3d/commit/6926a8b81ddb8c05ccc9461cd89e2b28afaae38d)]:
  - @wave3d/core@0.3.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`e270931`](https://github.com/Amir-Abushanab/wave3d/commit/e270931a31d485d8cbf7adcb1bbc849d33b0e731)]:
  - @wave3d/core@0.2.2

## 0.1.2

### Patch Changes

- Updated dependencies [[`0efadf6`](https://github.com/Amir-Abushanab/wave3d/commit/0efadf62fea3f3713ec917af2506cb13a1206266)]:
  - @wave3d/core@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @wave3d/core@0.2.0
