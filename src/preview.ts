// Dev-only: renders the wave full-frame on white (no UI panel) so the default
// composition/colours can be checked in isolation. Not part of the production build.
import { WaveRenderer } from "./wave/WaveRenderer";
import { createDefaultConfig, PRESETS } from "./wave/config";

const stage = document.getElementById("stage") as HTMLElement;
const p = new URLSearchParams(location.search);
const presetName = p.get("preset");
const config = presetName && PRESETS[presetName] ? PRESETS[presetName]() : createDefaultConfig();
// Preview forces an opaque white background for composition testing — but the wireframe theme's
// background IS part of its look (it's the between-line colour), so keep the preset's own.
if (config.theme !== "wireframe") {
  config.transparentBackground = false;
  config.background = "#ffffff";
}
// ?notex disables the baked palette texture (procedural-gradient fallback) for testing.
if (p.has("notex")) config.usePaletteTexture = false;
if (p.get("pal")) config.paletteSource = p.get("pal") as string;
if (p.get("palurl")) config.paletteImageUrl = p.get("palurl") as string; // load a palette image (URL) via TextureLoader instead of the named palette
if (p.has("mh")) config.mirrorH = true;
if (p.has("mv")) config.mirrorV = true;
if (p.has("lightedit"))
  config.lights = [{ position: { x: 16, y: 18, z: 22 }, color: "#ffffff", intensity: 1 }];
const num = (k: string, set: (v: number) => void): void => {
  const v = p.get(k);
  if (v !== null) set(parseFloat(v));
};
num("rotX", (v) => (config.rotation.x = v));
num("rotY", (v) => (config.rotation.y = v));
num("rotZ", (v) => (config.rotation.z = v));
num("sx", (v) => (config.scale.x = Math.abs(config.scale.x) * v)); // sign flips/mirrors X
num("sz", (v) => (config.scale.z = v)); // fold depth — opens/closes the hairpin twist
num("tw", (v) => {
  config.twistFrequency = {
    x: config.twistFrequency.x * v,
    y: config.twistFrequency.y * v,
    z: config.twistFrequency.z * v,
  };
}); // scale the shader twist (1.0 ≈ gentle 30°; higher turns the ribbon over)
num("glow", (v) => (config.glowAmount = v));
num("gpow", (v) => (config.glowPower = v));
num("gramp", (v) => (config.glowRamp = v));
num("vol", (v) => (config.volume = v));
num("pdy", (v) => (config.pdyLift = v));
num("sat", (v) => (config.colorSaturation = v));
num("con", (v) => (config.colorContrast = v));
num("hue", (v) => (config.hueShift = v));
num("fiber", (v) => (config.fiberThickness = v));
num("dist", (v) => {
  config.cameraDistance = v;
  config.cameraPosition = { x: 0, y: 0, z: v };
});
num("zoom", (v) => (config.cameraZoom = v)); // ortho framing
num("panx", (v) => (config.cameraTarget = { ...config.cameraTarget, x: v }));
num("pany", (v) => (config.cameraTarget = { ...config.cameraTarget, y: v }));
const renderer = new WaveRenderer(stage, config);
renderer.start();
const dbg = p.get("debug");
if (dbg !== null) renderer.setDebug(parseFloat(dbg));
if (p.has("fit")) renderer.fitToView();
if (p.has("lightedit")) void renderer.setLightEditMode(true);
if (p.has("az") || p.has("el")) {
  const o = renderer.getCameraOrbit();
  renderer.setCameraOrbit(
    p.has("az") ? parseFloat(p.get("az") as string) : o.azimuth,
    p.has("el") ? parseFloat(p.get("el") as string) : o.elevation,
    o.distance,
  );
}
if (p.has("roll")) renderer.rollView(parseFloat(p.get("roll") as string));
(window as unknown as { wave: unknown }).wave = { renderer, config };
