#!/usr/bin/env node
/**
 * Validate every gallery/waves/*.json submission. Wired into `pnpm check`, so a malformed
 * submission fails CI before a maintainer reviews the PR. Structural + safety checks only
 * (no rendering): required fields, no embedded raster/video (inline SVG is fine — see below),
 * a size cap, and a unique kebab-case slug per file.
 */
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../gallery/waves/", import.meta.url);
const MAX_KB = 24; // procedural configs are a few KB; this leaves generous headroom
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HANDLE = /^[A-Za-z0-9-]{1,39}$/; // a GitHub username

let files;
try {
  files = readdirSync(dir).filter((f) => f.endsWith(".json"));
} catch {
  console.log("gallery: no gallery/waves/ yet — nothing to validate");
  process.exit(0);
}

const problems = [];
const flag = (file, msg) => problems.push(`${file}: ${msg}`);

for (const file of files.sort()) {
  const slug = file.replace(/\.json$/, "");
  if (!SLUG.test(slug)) flag(file, "filename must be kebab-case (a-z, 0-9, hyphens)");

  const raw = readFileSync(new URL(file, dir), "utf8");
  const kb = Buffer.byteLength(raw) / 1024;
  if (kb > MAX_KB) flag(file, `${kb.toFixed(1)} KB is over the ${MAX_KB} KB cap`);

  let wave;
  try {
    wave = JSON.parse(raw);
  } catch (e) {
    flag(file, "invalid JSON: " + e.message);
    continue;
  }

  if (typeof wave.title !== "string" || !wave.title.trim() || wave.title.length > 60)
    flag(file, "`title` must be a non-empty string of at most 60 characters");
  if (typeof wave.author !== "string" || !HANDLE.test(wave.author))
    flag(file, "`author` must be your GitHub handle");
  if (wave.config == null || typeof wave.config !== "object" || Array.isArray(wave.config))
    flag(file, "`config` must be a StudioConfig object");

  // Reject embedded RASTER media (and video): it is what makes a submission heavy, and it carries
  // the copyright and storage concerns — reference a built-in map or a hosted URL instead.
  //
  // Inline SVG is allowed, so an uploaded particle sprite can ship with the wave: it is vector text
  // measured in hundreds of bytes, which is the same order as the config around it. The MAX_KB cap
  // above is the real guard — including against an SVG that smuggles a raster in via <image
  // href="data:image/png;...">, which this pattern deliberately catches on its own. Rendering is
  // safe regardless: sprite artwork only ever reaches an <img>, which sandboxes scripts in SVG.
  if (/data:(?:video\/|image\/(?!svg\+xml))/i.test(raw))
    flag(
      file,
      "embedded raster/video data: URI — waves must be procedural (built-in maps, a hosted URL, or inline SVG)",
    );
}

if (problems.length) {
  console.error(`gallery: ${problems.length} problem(s) across ${files.length} submission(s):`);
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
console.log(`gallery: ${files.length} submission(s) OK`);
