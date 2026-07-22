/**
 * Keep the wave3d skill's `metadata.library_version` in step with @wave3d/core's real version.
 *
 * Runs as part of the root `version` script, which the Changesets action invokes when it builds the
 * "Version Packages" PR — so the bump lands in the same commit as the package.json/CHANGELOG bumps
 * and the skill can't silently drift the way it did between 0.1.0 and 0.4.0.
 *
 * Idempotent: exits quietly when the value already matches. Fails loudly if the frontmatter field
 * is missing, since a silent no-op would let the drift return.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = resolve(root, "packages/core/skills/wave3d/SKILL.md");
const PKG = resolve(root, "packages/core/package.json");

const { version } = JSON.parse(readFileSync(PKG, "utf8"));
const md = readFileSync(SKILL, "utf8");

// Only touch the field inside the leading YAML frontmatter block.
const end = md.indexOf("\n---", 4);
if (!md.startsWith("---\n") || end === -1) {
  throw new Error(`${SKILL}: no YAML frontmatter block`);
}
const head = md.slice(0, end);
const field = /^(\s*library_version:\s*)"?[^"\n]*"?$/m;
if (!field.test(head)) {
  throw new Error(`${SKILL}: no metadata.library_version field in the frontmatter`);
}

const next = head.replace(field, `$1"${version}"`) + md.slice(end);
if (next === md) {
  console.log(`skill version already ${version}`);
} else {
  writeFileSync(SKILL, next);
  console.log(`skill library_version -> ${version}`);
}
