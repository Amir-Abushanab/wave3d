#!/usr/bin/env node
/**
 * Guarded publish. Only shells into `changeset publish` when a publishable
 * package's local version isn't on npm yet. On a no-op push (nothing new to
 * release) it exits 0 cleanly.
 *
 * Why: `changesets/action` runs the publish command on every push to main that
 * has no pending changeset files, expecting it to no-op when there's nothing to
 * ship. Under npm OIDC / trusted publishing, `changeset publish` (@changesets/cli
 * 2.31) instead throws `TypeError: Cannot read properties of undefined (reading
 * 'includes')` on that no-op path and reddens the run. This restores the no-op
 * safety by checking the registry (ground truth) before ever invoking it.
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
const pending = pkgs.filter((p) => !isPublished(p.name, p.version));
const label = (list) => list.map((p) => `${p.name}@${p.version}`).join(", ");

if (pending.length === 0) {
  console.log(`Nothing to publish. Already on npm: ${label(pkgs)}`);
  process.exit(0);
}

console.log(`Publishing: ${label(pending)}`);
if (dryRun) {
  console.log("(dry run) skipping `changeset publish`");
  process.exit(0);
}
execFileSync("pnpm", ["exec", "changeset", "publish"], { stdio: "inherit" });
