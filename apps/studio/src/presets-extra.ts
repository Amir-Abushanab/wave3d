/**
 * Studio-only presets that ?inline copyrighted artwork (One Piece / Spider-Man). Kept out of the
 * published @wave3d/core package for IP reasons; the studio layers them into the preset list
 * (apps/studio/src/presets.ts). Each derives from the core "Wave 3" preset.
 */
import onePieceLogoUrl from "./assets/one-piece-logo.png?inline";
import spiderManComicPanelsUrl from "./assets/spider-man-comic-panels.webp?inline";
import spiderManLogoUrl from "./assets/spider-man-logo.svg?inline";
import { PRESETS as CORE_PRESETS } from "@wave3d/core/presets";
import type { StudioConfig } from "@wave3d/core";

export const PRESETS_EXTRA: Record<string, () => StudioConfig> = {
  "One Piece — Grand Line": () => {
    const c = CORE_PRESETS["Wave 3"]();
    const w = c.waves[0];
    w.paletteImageUrl = onePieceLogoUrl;
    w.usePaletteTexture = true;
    w.paletteTextureScale = { x: 1, y: 1 };
    w.paletteTextureOffset = { x: 0, y: 0 };
    w.paletteTextureRotation = 90;
    w.blendMode = "normal";
    w.hueShift = 0;
    w.colorContrast = 1;
    w.colorSaturation = 1;
    w.creaseLight = 0.65;
    w.creaseSoftness = 0.8;
    w.speed = 0.065;
    c.grain = 0.25;
    c.blur = 0.006;
    c.cameraZoom = 1;
    c.background = "#061426";
    c.backgroundMode = "gradient";
    c.backgroundGradientSource = "grandLine";
    c.backgroundGradientType = "conic";
    c.backgroundGradientAngle = 180;
    c.transparentBackground = false;
    return c;
  },
  "Spider-Man — Webbed City": () => {
    const c = CORE_PRESETS["Wave 3"]();
    const w = c.waves[0];
    w.paletteImageUrl = spiderManLogoUrl;
    w.usePaletteTexture = true;
    w.paletteTextureScale = { x: 1, y: 1 };
    w.paletteTextureOffset = { x: 0, y: -0.28 };
    w.paletteTextureRotation = 90;
    w.theme = "wireframe";
    // Tuned in the studio and imported from spiderman-wave.json for a denser,
    // irregular filament field that reads more like a web than parallel ribbons.
    w.fiberCount = 1;
    w.fiberStrength = 0.96;
    w.lineAmount = 1200;
    w.lineThickness = 1.89;
    w.lineDerivativePower = 0.41;
    w.maxWidth = 392;
    w.blendMode = "additive";
    w.hueShift = 0;
    w.colorContrast = 1;
    w.colorSaturation = 0;
    w.creaseLight = 1;
    w.creaseSoftness = 0.9;
    w.speed = 0.075;
    // Flatten the strong Wave-3 twist so the whole "SPIDER-MAN" wordmark lies readably
    // across the ribbon instead of the "SPIDER" end folding/compressing away.
    w.displaceAmount = -5.0;
    w.twistFrequency = { x: 0.02, y: 0.08, z: -0.12 };
    w.twistPower = { x: 3.0, y: 2.0, z: 3.0 };
    c.grain = 0.25;
    c.blur = 0.012;
    // Camera framing exported from the studio (spidey-wave.json), positioned so the wave's
    // edges just touch the frame border.
    c.cameraPosition = { x: -186.495, y: -4.931, z: 603.82 };
    c.cameraTarget = { x: -210.954, y: -3.372, z: 4.321 };
    c.cameraDistance = 600;
    c.cameraZoom = 1.208;
    // Black contributes nothing under additive blending, so only the white web lines
    // brighten the comic-panel image. The logo remains visible as a cutout in the web.
    c.background = "#000000";
    c.backgroundMode = "image";
    c.backgroundImageUrl = spiderManComicPanelsUrl;
    c.backgroundImageFit = "cover";
    c.backgroundImageZoom = 1;
    c.backgroundImagePosition = { x: 0, y: 0 };
    c.transparentBackground = false;
    return c;
  },
};
