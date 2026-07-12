#!/usr/bin/env node
/**
 * Guarded publish. Shells into `changeset publish`, but leans on the npm registry
 * as the source of truth so two @changesets/cli 2.31 + npm-OIDC bugs can't redden
 * the release:
 *
 *   1. No-op runs. `changesets/action` runs the publish command on every push to
 *      main with no pending changesets, expecting a clean no-op. Under npm OIDC /
 *      trusted publishing, `changeset publish` instead throws
 *      `TypeError: Cannot read properties of undefined (reading 'includes')`. We
 *      check the registry first and skip publishing entirely when nothing is new.
 *
 *   2. Mixed sets. When the publish set contains an already-published package (e.g.
 *      the independent @wave3d/vite standing still while only the fixed
 *      core/react/element group bumped), `changeset publish` throws that same error
 *      — but only *after* publishing the genuinely-new packages and printing their
 *      `New tag:` lines. So we tolerate the non-zero exit and let the registry
 *      decide: if everything we meant to ship actually landed, it's a success. The
 *      changesets action still reads those `New tag:` lines from stdout to push
 *      tags + cut GitHub Releases; we only fail for real if something is missing.
 *
 * Run via `pnpm release`, which builds first and puts `changeset` on PATH.
 * Pass `--dry-run` to report what would publish without publishing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const packagesDir = new URL("../packages/", import.meta.url);

/** Every non-private package.json under packages/. */
function publishablePackages() {
  const out = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(new URL(`${entry.name}/package.json`, packagesDir), "utf8"));
    } catch {
      continue; // no readable package.json in this directory
    }
    if (pkg.private || !pkg.name || !pkg.version) continue;
    out.push({ name: pkg.name, version: pkg.version });
  }
  return out;
}

/** Is this exact name@version already on the npm registry? */
function isPublished(name, version) {
  try {
    const raw = execFileSync("npm", ["view", name, "versions", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let versions = JSON.parse(raw);
    if (!Array.isArray(versions)) versions = [versions]; // single-version packages come back as a bare string
    return versions.includes(version);
  } catch (err) {
    const stderr = String(err?.stderr ?? "");
    if (stderr.includes("E404") || stderr.includes("404")) return false; // package/version genuinely not on npm
    // Any other failure (network, registry hiccup, auth) is not evidence that the
    // version is unpublished. Fail loudly rather than trigger a bogus publish.
    throw err;
  }
}

const pkgs = publishablePackages();
const label = (list) => list.map((p) => `${p.name}@${p.version}`).join(", ");
const pending = pkgs.filter((p) => !isPublished(p.name, p.version));

if (pending.length === 0) {
  console.log(`Nothing to publish. Already on npm: ${label(pkgs)}`);
  process.exit(0);
}

console.log(`Publishing: ${label(pending)}`);
if (dryRun) {
  console.log("(dry run) skipping `changeset publish`");
  process.exit(0);
}

// See bug #2 in the header: a non-zero exit here doesn't mean the publish failed — the new packages
// land (and print their `New tag:` lines) before changeset chokes on an already-published one.
try {
  execFileSync("pnpm", ["exec", "changeset", "publish"], { stdio: "inherit" });
} catch {
  console.error("`changeset publish` exited non-zero — verifying against the registry…");
}

// Did everything we meant to ship actually land? Re-check a few times to ride out npm propagation
// (each `npm view` is a fresh network round-trip, so the loop is naturally paced — no sleep needed).
let missing = pending;
for (let attempt = 0; attempt < 4 && missing.length > 0; attempt++) {
  try {
    missing = missing.filter((p) => !isPublished(p.name, p.version));
  } catch {
    /* transient registry error — keep `missing` and try again */
  }
}
if (missing.length > 0) {
  console.error(`Failed to publish: ${label(missing)}`);
  process.exit(1);
}
console.log(`Published: ${label(pending)}`);
