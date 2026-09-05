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
 * and performs npm OIDC trusted publishing) plus a local `git tag` per published package, so we do
 * both directly — but only for versions the registry confirms are missing, so we never provoke the
 * E403. For each package we publish we create the tag and report it — see announceTag for what
 * changesets/action actually reads (a CHANGESETS_OUTPUT ndjson file, NOT this script's stdout).
 * The action then runs `git push origin <tag>` for each, which is why the tag must already exist
 * in this checkout, and cuts the GitHub Releases.
 *
 * Also self-heals: an already-on-npm version whose git tag never made it to origin (a past run
 * that published, then died before tags were pushed) gets its tag and `New tag:` line restored,
 * so no release stays permanently tagless. See restoreMissingTags.
 *
 * Run via `pnpm release`, which builds the packages first. Pass `--dry-run` to preview.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
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

/** Annotated tag at HEAD, like `changeset publish` makes; a pre-existing tag only warns. */
function ensureLocalTag(tag) {
  try {
    execFileSync("git", ["tag", tag, "-m", tag], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    console.error(`warning: could not create git tag ${tag}: ${String(err?.stderr ?? err)}`);
  }
}

/**
 * Announce a tag: the local tag, the `New tag:` line for the log, and the event changesets/action
 * actually acts on.
 *
 * v2 does NOT scan stdout — that was v1. It hands this script a file path in `CHANGESETS_OUTPUT`
 * and, after the script exits, reads one JSON object per line from it, creating each tag through
 * the GitHub API and cutting a Release for it. A script that only prints `New tag:` publishes to
 * npm and leaves every release untagged: exactly how 0.9.0 shipped, from a green run, with the
 * action warning "Failed to read changesets output ... Ensure the custom publish script passes
 * CHANGESETS_OUTPUT to the Changesets CLI".
 *
 * The `type` discriminator is not optional — the action matches on it, and a line without it is
 * read and dropped in silence. The printed line is now only for whoever reads the log; the file is
 * what CI acts on. The local annotated tag still matters too: the action pushes tags with
 * `git push origin <tag>`, which needs them to exist in this checkout.
 *
 * Outside the action (a laptop publish, or --dry-run) there is no file, and printing is the whole job.
 */
function announceTag(tag) {
  ensureLocalTag(tag);
  console.log(`New tag: ${tag}`);
  const output = process.env.CHANGESETS_OUTPUT;
  if (!output) return;
  const packageName = tag.slice(0, tag.lastIndexOf("@"));
  try {
    appendFileSync(output, `${JSON.stringify({ type: "git-tag", tag, packageName })}\n`);
  } catch (err) {
    // Loud, but not fatal: the packages are already on npm by this point, and failing the run
    // would not un-publish them. A missing tag is recoverable on the next run's restore pass.
    console.error(`warning: could not record ${tag} in CHANGESETS_OUTPUT: ${String(err)}`);
  }
}

/**
 * A version can be live on npm yet have no git tag or GitHub Release: a previous run published,
 * then died before changesets/action pushed the tags (0.3.0 lost its tags to the changesets↔npm 11
 * crash, 0.4.1 to this script not creating them), or the first publish ran from a laptop. Such a
 * version never re-enters `pending`, so without this pass its tag would stay lost on every future
 * run. Re-create it here (at this run's commit — the original release commit isn't knowable) and
 * re-print `New tag:` so changesets/action pushes it and cuts the Release. Never fails the run.
 */
function restoreMissingTags(onNpm) {
  if (onNpm.length === 0) return;
  let remote;
  try {
    const raw = execFileSync("git", ["ls-remote", "--tags", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    remote = new Set(
      raw
        .split("\n")
        .map((line) => line.split("\t")[1])
        .filter(Boolean)
        .map((ref) => ref.replace("refs/tags/", "").replace(/\^\{\}$/, "")),
    );
  } catch (err) {
    console.error(
      `warning: could not list origin tags, skipping tag restore: ${String(err?.stderr ?? err)}`,
    );
    return;
  }
  for (const p of onNpm) {
    const tag = `${p.name}@${p.version}`;
    if (remote.has(tag)) continue;
    if (dryRun) {
      console.log(`(dry run) would restore missing tag ${tag}`);
      continue;
    }
    console.log(`Restoring missing tag for already-published ${tag}`);
    announceTag(tag);
  }
}

const pkgs = publishablePackages();
const label = (list) => list.map((p) => `${p.name}@${p.version}`).join(", ");
const pending = pkgs.filter((p) => !isPublished(p.name, p.version));

restoreMissingTags(pkgs.filter((p) => !pending.includes(p)));

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
    // changesets/action will `git push origin <tag>`, so the tag must exist locally.
    announceTag(`${p.name}@${p.version}`);
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
