#!/usr/bin/env node
/**
 * Validate every gallery/waves/*.json submission. Wired into `pnpm check`, so a malformed
 * submission fails CI before a maintainer reviews the PR. Structural + safety checks only
 * (no rendering): required fields, procedural-only (no embedded `data:` URIs), a size cap,
 * and a unique kebab-case slug per file.
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

  // Procedural only: reject embedded media. Keeps files small and sidesteps the copyright and
  // storage concerns — reference a built-in map or a hosted image URL instead.
  if (/data:(image|video)\//i.test(raw))
    flag(file, "embedded data: URI — waves must be procedural (built-in maps or a hosted URL)");
}

if (problems.length) {
  console.error(`gallery: ${problems.length} problem(s) across ${files.length} submission(s):`);
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
console.log(`gallery: ${files.length} submission(s) OK`);
