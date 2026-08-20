import type { StudioConfig } from "@wave3d/core";
import { showToast } from "./ui/Toast";

const REPO = "Amir-Abushanab/wave3d";

/**
 * "Publish to gallery": open GitHub's new-file page for gallery/waves/ with the current wave
 * prefilled (title + handle are placeholders to edit). Also copies the same JSON as a fallback for
 * when a big config overruns GitHub's URL length — which an inline SVG particle sprite makes more
 * likely, since encodeURIComponent roughly triples a base64 payload. The clipboard write starts
 * before window.open so it runs while this document still has focus.
 *
 * If you have write access GitHub defaults to committing to `main`, so the toast nudges you to pick
 * "Create a new branch" (which opens a PR). Contributors without write access get an auto-fork + PR.
 */
export function publishToGallery(config: StudioConfig): void {
  // Title/handle on their own lines (easy to edit) with the config compacted onto one, so the whole
  // thing stays short enough to prefill via GitHub's ?value=. (gallery/waves is excluded from oxfmt,
  // so the compact config doesn't trip format:check.)
  const json = `{\n  "title": "My wave",\n  "author": "your-github-handle",\n  "config": ${JSON.stringify(config)}\n}\n`;

  const base = `https://github.com/${REPO}/new/main?filename=gallery/waves/my-wave.json`;
  const prefilled = `${base}&value=${encodeURIComponent(json)}`;
  const fits = prefilled.length < 8000; // very long URLs get truncated; fall back to a paste

  try {
    void navigator.clipboard.writeText(json);
  } catch {
    /* no clipboard (insecure context) — the prefill or the console log below covers it */
  }
  window.open(fits ? prefilled : base, "_blank", "noopener");
  if (!fits) console.log(json);

  const steps = ' Set your title + handle, then pick "Create a new branch" to open a PR.';
  // Mirrors scripts/validate-gallery.mjs: inline SVG (e.g. an uploaded particle sprite) travels with
  // the wave, but raster and video do not. Keep the two patterns in step — this is the only warning
  // an author sees before CI rejects the PR, so it has to name the fix, not just the rule.
  const imgNote = /data:(?:video\/|image\/(?!svg\+xml))/i.test(json)
    ? " (Heads up: embedded images/video are rejected — use a built-in map, a hosted URL, or an SVG.)"
    : "";
  showToast({
    message: (fits ? "Wave prefilled." : "Config copied — paste it in.") + steps + imgNote,
    duration: 7000,
  });
}
