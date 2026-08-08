/**
 * Built-in presets: each a complete studio config (scene + one or more waves) in the wave model.
 * IP-clean — no copyrighted assets. The studio layers its own extra presets (and its historical
 * "Stripe *" display names) on top; see apps/studio/src/presets.ts.
 */
import { createDefaultConfig, makeStops, makeWaveSpread } from "./config/model";
import type { StudioConfig, NoiseBand } from "./config/model";

const RAD = 180 / Math.PI;

/** Build a preset from a set of wave parameters. rotation/hue are given in RADIANS and
 *  converted to degrees. All presets are solid-theme, so they reuse the hero palette +
 *  surfaceColor fibers (600/0.2) and sheen 0, like the hero. camTarget/zoom frame the
 *  wave (we pan the look-at to centre each one). */
function buildPreset(p: {
  speed: number;
  contrast: number;
  sat: number;
  hueRad: number;
  dispX: number;
  dispZ: number;
  dispAmt: number;
  pos: [number, number, number];
  rotRad: [number, number, number];
  scale: [number, number, number];
  twF: [number, number, number];
  twP: [number, number, number];
  glow: [number, number, number];
  grain: number;
  blur: number;
  zoom: number;
  camTarget: [number, number];
  noiseBands?: NoiseBand[];
  twistMotion?: boolean;
}): StudioConfig {
  const c = createDefaultConfig();
  const w = c.waves[0];
  w.speed = p.speed;
  w.colorContrast = p.contrast;
  w.colorSaturation = p.sat;
  w.hueShift = p.hueRad * RAD;
  w.displaceFrequency = { x: p.dispX, y: p.dispZ };
  w.displaceAmount = p.dispAmt;
  w.position = { x: p.pos[0], y: p.pos[1], z: p.pos[2] };
  w.rotation = { x: p.rotRad[0] * RAD, y: p.rotRad[1] * RAD, z: p.rotRad[2] * RAD };
  w.scale = { x: p.scale[0], y: p.scale[1], z: p.scale[2] };
  w.twistFrequency = { x: p.twF[0], y: p.twF[1], z: p.twF[2] };
  w.twistPower = { x: p.twP[0], y: p.twP[1], z: p.twP[2] };
  w.creaseLight = p.glow[0];
  w.creaseSharpness = p.glow[1];
  w.creaseSoftness = p.glow[2];
  if (p.noiseBands) w.noiseBands = p.noiseBands;
  if (p.twistMotion) w.twistMotion = true;
  c.grain = p.grain;
  c.blur = p.blur;
  c.cameraPosition = { x: 100, y: 0, z: 5000 };
  c.cameraTarget = { x: p.camTarget[0], y: p.camTarget[1], z: 0 };
  c.cameraZoom = p.zoom;
  return c;
}

/** Presets: each a complete studio config (scene + one or more waves) in the wave model. */
export const PRESETS: Record<string, () => StudioConfig> = {
  // The app's default wave: a centred, full-frame ribbon (window-independent framing).
  // Shown first and named "Hero"; several presets below derive from it.
  Hero: () =>
    buildPreset({
      speed: 0.04,
      contrast: 1,
      sat: 1,
      hueRad: -0.00159265,
      dispX: 0.005831,
      dispZ: 0.016001,
      dispAmt: -7.821,
      pos: [380, -301.7, -11.1],
      rotRad: [-0.44959, -0.11759, 1.874407],
      scale: [9, 8, 5],
      twF: [-0.65, 0.41, -0.58],
      twP: [3.63, 0.7, 3.95],
      glow: [1.98, 0.806, 0.834],
      grain: 1.1,
      blur: 0.02,
      zoom: 0.55,
      camTarget: [-420, -200], // user-tuned default framing
    }),
  // Stripe's real hero, recreated faithfully: an orthographic ×10 scene that overflows the
  // frame, so only the twisted crop shows. This is the model's plain default config.
  "Wave 2": () => createDefaultConfig(),
  // camTarget on the waves below is a first-pass centring; tune per-wave. NOTE: Wave 4 also
  // uses a variant vertex shader (animated twist-X wobble) we don't fully replicate — its
  // STATIC frame is close, the motion differs.
  "Wave 3": () =>
    buildPreset({
      speed: 0.08,
      contrast: 1,
      sat: 1,
      hueRad: -0.00159265,
      dispX: 0.005831,
      dispZ: 0.016001,
      dispAmt: -7.821,
      pos: [-200.7, -65.4, -11.1],
      rotRad: [-2.875593, 3.095927, -2.925927],
      scale: [3, 3, 3],
      twF: [0.059, 0.32, -0.397],
      twP: [3.63, 0.44, 5.99],
      glow: [3.86, 0.923, 1],
      grain: 1.2,
      blur: 0.02,
      zoom: 1.3,
      camTarget: [-104, 13], // centred; zoomed in (wide/flat wave)
    }),
  "Wave 4": () =>
    buildPreset({
      speed: 0.0525,
      contrast: 0.969,
      sat: 1.383,
      hueRad: 0.0376991,
      dispX: 0.005,
      dispZ: 0.0212,
      dispAmt: 6.68,
      pos: [206.1, -438, -11.1],
      rotRad: [-0.666018, -0.031416, 0.779115],
      scale: [6.0501, 8.3983, 6.9854],
      twF: [-0.424, 0.024, -1.312],
      twP: [1.81, 0.94, 4.76],
      glow: [1.55, 1.174, 0.972],
      grain: 0.576,
      blur: 0,
      zoom: 0.9316,
      camTarget: [194, -402], // centred on the wave
      twistMotion: true, // variant vertex shader — animated twist-X wobble
      noiseBands: [
        {
          startX: 0.856,
          endX: 1,
          startY: 0,
          endY: 0.913,
          feather: 0.5,
          strength: 0.346,
          frequency: 1018,
          colorAttenuation: 1,
          parabolaPower: 0,
        },
        {
          startX: 0.038,
          endX: 0.538,
          startY: 0.105,
          endY: 1,
          feather: 0.3315,
          strength: 1,
          frequency: 190,
          colorAttenuation: 0,
          parabolaPower: 2.11,
        },
      ],
    }),
  // The dark-background hero: identical geometry/camera to the default hero, but theme
  // "wireframe" → the line shader on a dark page background, with grain 1.2. Same palette.
  Wireframe: () => {
    const c = createDefaultConfig();
    c.waves[0].theme = "wireframe";
    c.grain = 1.2;
    c.background = "#0a2540"; // dark navy page background
    c.transparentBackground = false;
    return c;
  },
  "Neon Dark Multistrand": () => {
    const c = createDefaultConfig();
    const w = c.waves[0];
    w.theme = "wireframe"; // line shader on the near-black background — neon wireframe look
    w.blendMode = "additive";
    w.palette = makeStops(["#00f5d4", "#00bbf9", "#9b5de5", "#f15bb5", "#fee440"]);
    w.creaseLight = 1.0;
    c.background = "#05060c";
    c.transparentBackground = false; // fill the dark bg so the neon lines read on black (not the page)
    c.waves = makeWaveSpread(w, 3); // three overlapping neon waves
    c.waveCount = 3;
    return c;
  },
  "Mesh Gradient": () => {
    const c = PRESETS["Hero"](); // the centred default "Hero" wave
    const w = c.waves[0];
    w.gradientType = "mesh";
    w.meshGradientPoints = [
      { color: "#0a84ff", x: 0.06, y: 0.9, influence: 0.68 },
      { color: "#64d2ff", x: 0.88, y: 0.92, influence: 0.72 },
      { color: "#bf5af2", x: 0.5, y: 0.64, influence: 0.58 },
      { color: "#ff375f", x: 0.1, y: 0.14, influence: 0.7 },
      { color: "#ff9f0a", x: 0.84, y: 0.12, influence: 0.74 },
      { color: "#30d158", x: 0.94, y: 0.5, influence: 0.54 },
    ];
    w.meshGradientSoftness = 0.68;
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.06;
    w.colorSaturation = 1.12;
    w.fiberStrength = 0.14;
    c.grain = 0.3;
    c.blur = 0.008;
    c.background = "#070914";
    c.backgroundMode = "color";
    c.transparentBackground = false;
    return c;
  },
  "Solar Bloom": () => {
    // Radial gradient: a warm core blooming out to a deep-indigo edge. usePaletteTexture off so
    // our own stops map along the radial gradCoord instead of sampling the baked hero LUT.
    const c = PRESETS["Hero"]();
    const w = c.waves[0];
    w.usePaletteTexture = false;
    w.gradientType = "radial";
    w.gradientShift = 0.14;
    w.palette = [
      { color: "#fff3c4", pos: 0 }, // warm-white core
      { color: "#ffd166", pos: 0.22 }, // gold
      { color: "#ff8c42", pos: 0.42 }, // orange
      { color: "#ff5d8f", pos: 0.62 }, // coral-pink
      { color: "#a64dff", pos: 0.82 }, // violet
      { color: "#241246", pos: 1 }, // deep indigo edge
    ];
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.05;
    w.colorSaturation = 1.18;
    w.fiberStrength = 0.12;
    c.grain = 0.3;
    c.blur = 0.01;
    // Deep warm radial vignette behind the bloom.
    c.background = "#0a0714";
    c.backgroundMode = "gradient";
    c.backgroundGradientType = "radial";
    c.backgroundGradientSource = "stops";
    c.backgroundPalette = makeStops(["#2a1330", "#08040f"]);
    c.transparentBackground = false;
    return c;
  },
  "Solar Plume": () => {
    // A luminous combed-silk plume that fans radially from a low source, wrapping a black eclipse
    // disc that a field of golden dust rings. Exercises all three new features: the radial wave mode,
    // the eclipse occluder, and the particle layer (ring + ambient field).
    const c = PRESETS["Hero"]();
    const w = c.waves[0];
    // Fan the ribbon into a plume — the combed fibers become the radial strands.
    w.radialAmount = 0.9;
    w.radialArc = 130;
    w.radialCenter = 48; // aim the fan up-and-right from the source
    w.radialRadius = 55;
    w.radialSpread = 1.45;
    w.radialSource = { x: 0, y: 0, z: 0 };
    // Face the fan at the camera (local X–Y = the screen plane) and seat its source low-left.
    w.rotation = { x: 0, y: 0, z: 0 };
    w.position = { x: -370, y: -320, z: 0 };
    w.scale = { x: 1.2, y: 1.2, z: 1.2 };
    w.opacity = 0.85;
    // Warm silk: pale gold core → gold → amber along the strand length (uv.y = radius).
    w.usePaletteTexture = false;
    w.gradientType = "linear";
    w.gradientAngle = 0; // run the gradient along the length (radius), not across the fan
    w.gradientShift = 0.1;
    w.palette = [
      { color: "#f7ead2", pos: 0 }, // pale gold core
      { color: "#f3d9a6", pos: 0.42 }, // warm cream
      { color: "#e8b26a", pos: 0.72 }, // gold
      { color: "#c8853a", pos: 1 }, // amber tips
    ];
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.05;
    w.colorSaturation = 1.15;
    w.fiberCount = 600;
    w.fiberStrength = 0.22;
    w.edgeFeather = 0.28; // soft, vaporous ribbon ends
    // Scene: a near-black void with gentle bloom on the silk + dust.
    c.background = "#050404";
    c.backgroundMode = "color";
    c.transparentBackground = false;
    c.grain = 0.25;
    c.blur = 0;
    c.bloomStrength = 0.25;
    c.bloomRadius = 0.55;
    c.bloomThreshold = 0.7;
    c.cameraTarget = { x: 0, y: -40, z: 0 };
    c.cameraZoom = 1;
    // Eclipse disc, centre-right — a black void the dust rings and the plume can wrap.
    c.eclipse = 1;
    c.eclipseRadius = 0.19;
    c.eclipseCenter = { x: 0.6, y: 0.42 };
    c.eclipseSoftness = 0.06;
    c.eclipseColor = "#050404"; // matches the void → reads as a clean hole in the glow
    // Golden dust: a ring around the eclipse rim + an ambient field across the frame.
    c.particles = {
      count: 8000,
      size: 2,
      sizeJitter: 0.7,
      color: "#ffd597",
      seed: 7,
      life: 7,
      twinkle: 0.7,
      ring: { radius: 0.21, width: 0.13, density: 0.68, spin: 0.04 },
      field: { density: 0.4, drift: 0.15 },
    };
    return c;
  },
  Holographic: () => {
    // Conic gradient: an iridescent oil-slick sweep. The palette wraps (first ≈ last stop) so
    // the conic seam is invisible.
    const c = PRESETS["Hero"]();
    const w = c.waves[0];
    w.usePaletteTexture = false;
    w.gradientType = "conic";
    w.gradientShift = 0.08;
    w.palette = [
      { color: "#8ef6e4", pos: 0 }, // mint (seam)
      { color: "#6ec3ff", pos: 0.18 }, // sky
      { color: "#9b8cff", pos: 0.36 }, // periwinkle
      { color: "#ff8ad8", pos: 0.54 }, // pink
      { color: "#ffd98e", pos: 0.72 }, // peach
      { color: "#a0f0c8", pos: 0.88 }, // seafoam
      { color: "#8ef6e4", pos: 1 }, // mint again (seamless wrap)
    ];
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.04;
    w.colorSaturation = 1.12;
    w.fiberStrength = 0.12;
    c.grain = 0.28;
    c.blur = 0.01;
    // Subtle deep teal → violet wash behind the iridescence.
    c.background = "#05060c";
    c.backgroundMode = "gradient";
    c.backgroundGradientType = "linear";
    c.backgroundGradientAngle = 135;
    c.backgroundGradientSource = "stops";
    c.backgroundPalette = makeStops(["#04121a", "#0a0518"]);
    c.transparentBackground = false;
    return c;
  },
  Aurora: () => {
    // Mesh gradient: a moody aurora — teals/greens drifting into violet over a night-sky base
    // (distinct from the brighter iOS-style "Mesh Gradient").
    const c = PRESETS["Hero"]();
    const w = c.waves[0];
    w.gradientType = "mesh";
    w.meshGradientPoints = [
      { color: "#0a1f3c", x: 0.08, y: 0.12, influence: 0.62 },
      { color: "#1fddb0", x: 0.3, y: 0.7, influence: 0.78 },
      { color: "#57f5a3", x: 0.58, y: 0.86, influence: 0.7 },
      { color: "#3a86ff", x: 0.82, y: 0.55, influence: 0.62 },
      { color: "#a15cff", x: 0.5, y: 0.32, influence: 0.7 },
      { color: "#071433", x: 0.92, y: 0.08, influence: 0.6 },
    ];
    w.meshGradientSoftness = 0.72;
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.05;
    w.colorSaturation = 1.18;
    w.fiberStrength = 0.12;
    c.grain = 0.3;
    c.blur = 0.008;
    // Dark night-sky MESH backdrop (also shows off the mesh background type).
    c.background = "#03060f";
    c.backgroundMode = "gradient";
    c.backgroundGradientType = "mesh";
    c.backgroundMeshPoints = [
      { color: "#02040c", x: 0.15, y: 0.85, influence: 0.7 },
      { color: "#08243a", x: 0.5, y: 0.5, influence: 0.75 },
      { color: "#0a0f2e", x: 0.85, y: 0.7, influence: 0.7 },
      { color: "#04121a", x: 0.7, y: 0.2, influence: 0.6 },
      { color: "#000208", x: 0.12, y: 0.12, influence: 0.6 },
    ];
    c.backgroundMeshSoftness = 0.75;
    c.transparentBackground = false;
    return c;
  },
  Palestine: () => {
    const c = PRESETS["Hero"](); // the centred default "Hero" wave
    const w = c.waves[0];
    w.paletteSource = "palestine";
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1;
    w.colorSaturation = 1;
    c.grain = 0.35;
    c.background = "#f2efe8";
    c.transparentBackground = true;
    return c;
  },
  Spain: () => {
    const c = PRESETS["Hero"](); // the centred default "Hero" wave
    const w = c.waves[0];
    w.paletteSource = "spain";
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.18;
    w.colorSaturation = 1.25;
    w.creaseLight = 1.6; // moderate crease-light: rich crimson without washing to salmon (Hero's is 1.98)
    c.grain = 0.3;
    c.background = "#1a0608"; // deep oxblood stage
    c.backgroundMode = "color";
    c.transparentBackground = false; // opaque, so the dark stage makes the flag pop
    return c;
  },
  "Vaporwave Sunset": () => {
    // The Hero wave re-posed/re-framed, plus the vaporwave palette.
    const c = PRESETS["Hero"](); // the centred default "Hero" wave
    const w = c.waves[0];
    w.position.x = 525;
    w.rotation.x = -0.64 * RAD;
    w.rotation.z = 1.68 * RAD;
    w.paletteSource = "vaporwave";
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.08;
    w.colorSaturation = 1.15;
    w.creaseLight = 1.25;
    c.cameraZoom = 1.1;
    c.cameraTarget = { x: 150, y: 360, z: 0 };
    c.background = "#09051f";
    c.transparentBackground = false;
    return c;
  },
  Corkscrew: () => {
    // The helix mode, shown off on its own: `helixRoll` at 1 rolls the ribbon's cross-section in
    // step with the sweep, so the flat strip becomes an auger blade winding around its own length
    // axis, and `helixRadius` lifts that blade off the axis so the turns read as a screw thread
    // rather than a flat twist. No twist at all — this shape is unreachable with twistFrequency,
    // whose expStep angle is monotone and can only ramp once (see the helix docs in config/model).
    const c = PRESETS["Hero"]();
    const w = c.waves[0];
    w.helixTurns = 5;
    w.helixRadius = 45;
    w.helixRoll = 1;
    w.helixPhase = 0;
    w.twistFrequency = { x: 0, y: 0, z: 0 };
    w.twistPower = { x: 4, y: 4, z: 2 };
    // A slow swell along the blade so it breathes; the corkscrew itself is static geometry.
    w.displaceAmount = 16;
    w.displaceFrequency = { x: 0.006, y: 0.0008 };
    w.speed = 0.1;
    w.position = { x: 0, y: 0, z: 0 };
    w.rotation = { x: 0, y: 0, z: 12 }; // tilt so it climbs across the frame
    w.scale = { x: 3, y: 3, z: 1.5 };
    // Mesh gradient: the colour field runs along the blade, so each turn picks up a different part
    // of the spectrum instead of the one hue a linear stop ramp would give.
    w.gradientType = "mesh";
    w.meshGradientPoints = [
      { color: "#0a84ff", x: 0.06, y: 0.9, influence: 0.68 },
      { color: "#64d2ff", x: 0.88, y: 0.92, influence: 0.72 },
      { color: "#bf5af2", x: 0.5, y: 0.64, influence: 0.58 },
      { color: "#ff375f", x: 0.1, y: 0.14, influence: 0.7 },
      { color: "#ff9f0a", x: 0.84, y: 0.12, influence: 0.74 },
      { color: "#30d158", x: 0.94, y: 0.5, influence: 0.54 },
    ];
    w.meshGradientSoftness = 0.68;
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.06;
    w.colorSaturation = 1.12;
    w.fiberStrength = 0.14;
    // Framed down the axis rather than side-on: the coil reads as a screw receding into the frame,
    // and each turn shows its blade face instead of an edge. cameraDistance is the orbit radius
    // (= |position − target|); the camera is orthographic, so it's the rig's dolly, not the scale —
    // cameraZoom sets that.
    c.cameraPosition = { x: -526.009, y: -285.284, z: -425.489 };
    c.cameraTarget = { x: -95.046, y: -17.053, z: -105.608 };
    c.cameraDistance = 600;
    c.cameraZoom = 1.176;
    c.grain = 0.3;
    c.blur = 0.008;
    c.bloomStrength = 0.35;
    c.bloomRadius = 0.6;
    c.bloomThreshold = 0.55;
    c.background = "#070914";
    c.backgroundMode = "color";
    c.transparentBackground = false;
    return c;
  },
  Kaleidoscope: () => {
    const c = PRESETS["Wave 3"]();
    const w = c.waves[0];
    w.paletteSource = "kaleidoscope";
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1.05;
    w.colorSaturation = 1.12;
    c.grain = 0.5;
    return c;
  },
};
