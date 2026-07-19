#!/usr/bin/env node
/**
 * Guarded publish: publishes only the package versions npm doesn't already have, driving
 * `pnpm publish` directly rather than `changeset publish`.
 *
 * @changesets/cli 2.31 is broken against the npm 11 the release workflow installs for OIDC trusted
 * publishing. Its pre-publish check misreads npm 11 and thinks an already-published package (e.g.
 * @wave3d/vite holding at 0.1.1 while core/react/element bump) is unpublished, tries to publish over
 * it, then crashes on npm 11's E403 JSON (`Cannot read properties of undefined (reading 'includes')`)
 * — aborting *before* it prints the `New tag:` lines changesets/action relies on. The packages still
 * reach npm, but the job goes red with no git tags and no GitHub Releases.
 *
 * `changeset publish` is itself only a wrapper around `pnpm publish` (which rewrites workspace: deps
 * and performs npm OIDC trusted publishing), so we call that directly — but only for versions the
 * registry confirms are missing, so we never provoke the E403. For each package we publish we print
 * the `New tag:` line ourselves; changesets/action scans this script's stdout for those (it ignores
 * our exit code) and creates the git tag (at the release commit, via the GitHub API) and the Release.
 *
 * Run via `pnpm release`, which builds the packages first. Pass `--dry-run` to preview.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dryRun = process.argv.includes("--dry-run");
const packagesDir = new URL("../packages/", import.meta.url);

/** Every non-private package under packages/, with its directory. */
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
    out.push({
      name: pkg.name,
      version: pkg.version,
      dir: fileURLToPath(new URL(`${entry.name}/`, packagesDir)),
    });
  }
  return out;
}

/** Is this exact name@version already on the npm registry? */
function isPublished(name, version) {
  try {
    // --prefer-online revalidates npm's HTTP cache instead of trusting a possibly-stale local
    // packument, so a version published moments ago is still seen.
    const raw = execFileSync("npm", ["view", name, "versions", "--json", "--prefer-online"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let versions = JSON.parse(raw);
    if (!Array.isArray(versions)) versions = [versions]; // single-version packages come back as a bare string
    return versions.includes(version);
  } catch (err) {
    const stderr = String(err?.stderr ?? "");
    if (stderr.includes("E404") || stderr.includes("404")) return false; // genuinely not on npm
    // Network / registry / auth hiccup is not evidence the version is unpublished — fail loudly
    // rather than trigger a bogus publish.
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
  console.log("(dry run) skipping publish");
  process.exit(0);
}

const published = [];
const failed = [];
for (const p of pending) {
  try {
    // The same call `changeset publish` makes for a pnpm workspace: from the package dir (so
    // workspace: deps get rewritten), --access public per .changeset/config.json, and
    // --no-git-checks so pnpm doesn't balk at CI's git state. Provenance + npm OIDC trusted
    // publishing come from the workflow env (NPM_CONFIG_PROVENANCE, id-token).
    execFileSync("pnpm", ["publish", "--access", "public", "--no-git-checks"], {
      cwd: p.dir,
      stdio: "inherit",
    });
    console.log(`New tag: ${p.name}@${p.version}`);
    published.push(p);
  } catch {
    // A non-zero exit is benign only if the version is already on npm (our pre-check raced a
    // concurrent publish, or misfired); anything else is a real publish failure.
    if (isPublished(p.name, p.version)) {
      console.error(`${p.name}@${p.version} is already on npm — skipping.`);
    } else {
      failed.push(p);
    }
  }
}

if (failed.length > 0) {
  console.error(`Failed to publish: ${label(failed)}`);
  process.exit(1);
}
console.log(`Published: ${label(published)}`);
