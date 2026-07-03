import { clamp } from "../util/math";

/** Pixel dimensions and selected preset for every visual export surface. */
export interface ExportSize {
  preset: string;
  width: number;
  height: number;
  /** Preserve `aspectRatio` when either output dimension changes. */
  lockAspectRatio: boolean;
  /** Ratio captured from the current preset or when the lock is enabled. */
  aspectRatio: number;
}

export interface ExportPreset {
  label: string;
  width: number;
  height: number;
}

export interface ExportGpuWarning {
  short: string;
  detail: string;
}

export const CUSTOM_EXPORT_PRESET = "custom";
export const MIN_OUTPUT_DIMENSION = 64;
export const MAX_OUTPUT_DIMENSION = 8192;

export const EXPORT_PRESETS: Record<string, ExportPreset> = {
  "full-hd": { label: "Full HD · 16:9", width: 1920, height: 1080 },
  "web-16-9": { label: "Website / video · 16:9", width: 1600, height: 900 },
  "open-graph": { label: "Social link card · 1.91:1", width: 1200, height: 630 },
  "instagram-square": { label: "Social post · 1:1", width: 1080, height: 1080 },
  "instagram-portrait": { label: "Social portrait · 4:5", width: 1080, height: 1350 },
  "story-portrait": { label: "Story / reel · 9:16", width: 1080, height: 1920 },
  "ultra-hd-4k": { label: "4K UHD · 16:9", width: 3840, height: 2160 },
  "ultra-hd-8k": { label: "8K UHD · 16:9", width: 7680, height: 4320 },
};

// ---- Still-image formats ----

export type ImageFormat = "png" | "webp" | "jpeg";

export interface ImageFormatDefinition {
  label: string;
  mime: string;
  extension: string;
  lossy: boolean;
  supportsTransparency: boolean;
}

export const IMAGE_FORMATS: Record<ImageFormat, ImageFormatDefinition> = {
  png: {
    label: "PNG",
    mime: "image/png",
    extension: "png",
    lossy: false,
    supportsTransparency: true,
  },
  webp: {
    label: "WebP",
    mime: "image/webp",
    extension: "webp",
    lossy: true,
    supportsTransparency: true,
  },
  jpeg: {
    label: "JPEG",
    mime: "image/jpeg",
    extension: "jpg",
    lossy: true,
    supportsTransparency: false,
  },
};

/** Canvas encoders silently fall back to PNG for unsupported MIME types. Check the data-URL
 *  prefix so the UI only advertises formats this browser can actually produce. */
export function canExportImageFormat(format: ImageFormat): boolean {
  const { mime } = IMAGE_FORMATS[format];
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL(mime).startsWith(`data:${mime}`);
}

// ---- Recording (video / GIF) formats ----

/** MediaRecorder containers (WebM/MP4). GIF is encoded separately (frame capture), so
 *  RecordFormat is the full set the recording UI offers. */
export type VideoFormat = "webm" | "mp4";
export type RecordFormat = VideoFormat | "gif";

// MediaRecorder mime candidates per container, best-quality first. MP4/H.264 recording works
// in Chromium and Safari but not Firefox, so pickVideoMime falls back to WebM when the
// requested container isn't supported — recording never silently fails.
const VIDEO_MIME_CANDIDATES: Record<VideoFormat, string[]> = {
  mp4: ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1", "video/mp4"],
  webm: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
};

const isMimeSupported = (mime: string): boolean =>
  typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime);

/** Whether this browser's MediaRecorder can record the given container at all. */
export function canRecordFormat(format: VideoFormat): boolean {
  return VIDEO_MIME_CANDIDATES[format].some(isMimeSupported);
}

/** Pick a MediaRecorder mime type + file extension for the requested container, falling back
 *  to WebM if the browser can't record it. */
export function pickVideoMime(format: VideoFormat): { mime: string; ext: VideoFormat } {
  const wanted = VIDEO_MIME_CANDIDATES[format].find(isMimeSupported);
  if (wanted) return { mime: wanted, ext: format };
  const webm = VIDEO_MIME_CANDIDATES.webm.find(isMimeSupported) ?? "video/webm";
  return { mime: webm, ext: "webm" }; // graceful fallback (e.g. MP4 unsupported here)
}

export const DEFAULT_EXPORT_SIZE: ExportSize = {
  preset: "full-hd",
  width: EXPORT_PRESETS["full-hd"].width,
  height: EXPORT_PRESETS["full-hd"].height,
  lockAspectRatio: true,
  aspectRatio: EXPORT_PRESETS["full-hd"].width / EXPORT_PRESETS["full-hd"].height,
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
  size.aspectRatio = preset.width / preset.height;
}

function validAspectRatio(size: ExportSize): number {
  return Number.isFinite(size.aspectRatio) && size.aspectRatio > 0
    ? size.aspectRatio
    : size.width / size.height;
}

/** Apply one manually edited dimension and update the other when the ratio is locked. */
export function applyCustomExportDimension(
  size: ExportSize,
  dimension: "width" | "height",
  value: number,
): void {
  size.preset = CUSTOM_EXPORT_PRESET;
  const rounded = Math.round(value);
  if (!size.lockAspectRatio) {
    size[dimension] = clamp(rounded, MIN_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION);
    size.aspectRatio = size.width / size.height;
    return;
  }

  const ratio = validAspectRatio(size);
  if (dimension === "width") {
    const minWidth = Math.ceil(Math.max(MIN_OUTPUT_DIMENSION, MIN_OUTPUT_DIMENSION * ratio));
    const maxWidth = Math.floor(Math.min(MAX_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION * ratio));
    size.width = clamp(rounded, minWidth, maxWidth);
    size.height = clamp(Math.round(size.width / ratio), MIN_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION);
  } else {
    const minHeight = Math.ceil(Math.max(MIN_OUTPUT_DIMENSION, MIN_OUTPUT_DIMENSION / ratio));
    const maxHeight = Math.floor(Math.min(MAX_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION / ratio));
    size.height = clamp(rounded, minHeight, maxHeight);
    size.width = clamp(Math.round(size.height * ratio), MIN_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION);
  }
}

/** Capture the current dimensions as the ratio future locked edits preserve. */
export function captureExportAspectRatio(size: ExportSize): void {
  size.aspectRatio = size.width / size.height;
}

export function aspectRatioLabel(width: number, height: number): string {
  const divisor = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

export function exportGpuWarning(width: number, height: number): ExportGpuWarning | null {
  const pixels = width * height;
  if (pixels >= 7680 * 4320) {
    return {
      short: "GPU very heavy",
      detail: "Very GPU-heavy — 8K may exceed some devices’ WebGL limits.",
    };
  }
  if (pixels >= 3840 * 2160) {
    return {
      short: "GPU heavy",
      detail: "GPU-heavy output — previewing, recording, and exporting may take longer.",
    };
  }
  return null;
}
