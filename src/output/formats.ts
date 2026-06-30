/** Pixel dimensions and selected preset for every visual export surface. */
export interface ExportSize {
  preset: string;
  width: number;
  height: number;
}

export interface ExportPreset {
  label: string;
  width: number;
  height: number;
}

export const CUSTOM_EXPORT_PRESET = "custom";

export const EXPORT_PRESETS: Record<string, ExportPreset> = {
  "web-16-9": { label: "Website / video · 16:9", width: 1600, height: 900 },
  "open-graph": { label: "Social link card · 1.91:1", width: 1200, height: 630 },
  "instagram-square": { label: "Social post · 1:1", width: 1080, height: 1080 },
  "instagram-portrait": { label: "Social portrait · 4:5", width: 1080, height: 1350 },
  "story-portrait": { label: "Story / reel · 9:16", width: 1080, height: 1920 },
  "full-hd": { label: "Full HD · 16:9", width: 1920, height: 1080 },
};

export const DEFAULT_EXPORT_SIZE: ExportSize = {
  preset: "web-16-9",
  width: EXPORT_PRESETS["web-16-9"].width,
  height: EXPORT_PRESETS["web-16-9"].height,
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function applyExportPreset(size: ExportSize, presetId: string): void {
  const preset = EXPORT_PRESETS[presetId];
  size.preset = presetId;
  if (!preset) return;
  size.width = preset.width;
  size.height = preset.height;
}

export function aspectRatioLabel(width: number, height: number): string {
  const divisor = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}
