// Dev-only: renders the wave full-frame on white (no UI panel) so the default
// composition/colours can be checked in isolation. Not part of the production build.
import { WaveRenderer } from "@wave3d/core/renderer";
import { createDefaultConfig, PRESETS } from "@wave3d/core";

const stage = document.getElementById("stage") as HTMLElement;
const p = new URLSearchParams(location.search);
const presetName = p.get("preset");
const config = presetName && PRESETS[presetName] ? PRESETS[presetName]() : createDefaultConfig();
// Every wave field now lives on the wave; preview only tweaks the first wave.
const s0 = config.waves[0];
// Preview forces an opaque white background for composition testing — but the wireframe theme's
// background IS part of its look (it's the between-line colour), so keep the preset's own.
if (s0.theme !== "wireframe") {
  config.transparentBackground = false;
  config.background = "#ffffff";
}
// ?notex disables the baked palette texture (procedural-gradient fallback) for testing.
if (p.has("notex")) s0.usePaletteTexture = false;
if (p.get("pal")) s0.paletteSource = p.get("pal") as string;
if (p.get("palurl")) s0.paletteImageUrl = p.get("palurl") as string; // load a palette image (URL) via TextureLoader instead of the named palette
if (p.has("mh")) config.mirrorH = true;
if (p.has("mv")) config.mirrorV = true;
if (p.has("lightedit"))
  config.lights = [{ position: { x: 16, y: 18, z: 22 }, color: "#ffffff", intensity: 1 }];
const num = (k: string, set: (v: number) => void): void => {
  const v = p.get(k);
  if (v !== null) set(parseFloat(v));
};
num("rotX", (v) => (s0.rotation.x = v));
num("rotY", (v) => (s0.rotation.y = v));
num("rotZ", (v) => (s0.rotation.z = v));
num("sx", (v) => (s0.scale.x = Math.abs(s0.scale.x) * v)); // sign flips/mirrors X
num("sz", (v) => (s0.scale.z = v)); // fold depth — opens/closes the hairpin twist
num("tw", (v) => {
  s0.twistFrequency = {
    x: s0.twistFrequency.x * v,
    y: s0.twistFrequency.y * v,
    z: s0.twistFrequency.z * v,
  };
}); // scale the shader twist (1.0 ≈ gentle 30°; higher turns the ribbon over)
num("crease", (v) => (s0.creaseLight = v));
num("creasesharp", (v) => (s0.creaseSharpness = v));
num("creasesoft", (v) => (s0.creaseSoftness = v));
num("round", (v) => (s0.roundness = v));
num("sheen", (v) => (s0.sheen = v));
num("sat", (v) => (s0.colorSaturation = v));
num("con", (v) => (s0.colorContrast = v));
num("hue", (v) => (s0.hueShift = v));
num("streak", (v) => (s0.fiberStrength = v));
num("dist", (v) => {
  config.cameraDistance = v;
  config.cameraPosition = { x: 0, y: 0, z: v };
});
num("zoom", (v) => (config.cameraZoom = v)); // ortho framing
num("panx", (v) => (config.cameraTarget = { ...config.cameraTarget, x: v }));
num("pany", (v) => (config.cameraTarget = { ...config.cameraTarget, y: v }));
const renderer = new WaveRenderer(stage, config, { skipIntroRamp: import.meta.env.DEV });
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
// Dev-only debug handle (preview itself isn't in the production build; guarded for consistency).
if (import.meta.env.DEV) {
  (window as unknown as { wave: unknown }).wave = { renderer, config };
}
