#!/usr/bin/env bash
# Keeps the Version Packages PR honest against the CURRENT main, not the commit a version run
# checked out. Called by .github/workflows/version.yml, twice per run (it never publishes; that
# is release.yml):
#
#   precheck  Before changesets/action. Writes skip=true to $GITHUB_OUTPUT when there is nothing
#             to version (no changesets in the checkout), or when main has since moved under
#             packages/ or .changeset/: this run's versioning is already stale, and that newer
#             push has its own version run queued behind this one (the paths are in the push
#             filter, and the concurrency group runs one at a time), which versions from it.
#   ensure    After it. Decides the run's real outcome from the action's (OUTCOME = success,
#             failure or skipped), closes an open Version PR whose branch carries no version
#             newer than current main, and opens the PR the action pushed a branch for but
#             failed to open.
#
# The race this closes (orb3d #16): a run for commit X waited behind the native jobs while the
# Version PR was merged; it then ran `changeset version` on X, where main still had the old
# versions, force-pushed changeset-release/main based on X and opened a PR whose versions main
# already had. changesets/action bases that branch on the run's own sha (context.sha), and looks
# for an open PR, never at main.
#
# Works in a shallow checkout: each check compares two trees, never history.
# Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF, GITHUB_OUTPUT; for ensure also OUTCOME
# and STARTED (unix time taken at the start of the job).
set -euo pipefail

branch=changeset-release/main
output=${GITHUB_OUTPUT:-/dev/stdout}

# 0 when version $1 has higher precedence than $2. Release beats a prerelease of the same core.
newer() {
  [ "$1" != "$2" ] || return 1
  local a=${1%%[-+]*} b=${2%%[-+]*} top
  if [ "$a" != "$b" ]; then
    top=$(printf '%s\n%s\n' "$a" "$b" | sort -V | tail -n1)
    [ "$top" = "$a" ]
    return
  fi
  [ "$1" = "$a" ] && return 0
  [ "$2" = "$b" ] && return 1
  top=$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1)
  [ "$top" = "$1" ]
}

# Lines "name old -> new" for each package whose version on ref $1 is newer than on ref $2.
# Only the `version` field: whole package.json files also differ by any dependency edit main got
# since, which is not a pending release (orb3d #12).
bumps() {
  local f new old
  for f in $(git ls-tree -r --name-only "$1" -- packages | grep -E '^packages/[^/]+/package\.json$'); do
    new=$(git show "$1:$f" | jq -r '.version // empty')
    old=$( (git show "$2:$f" 2>/dev/null || echo '{}') | jq -r '.version // empty')
    if [ -n "$new" ] && { [ -z "$old" ] || newer "$new" "$old"; }; then
      printf '%s %s -> %s\n' "$(git show "$1:$f" | jq -r .name)" "${old:-(new)}" "$new"
    fi
  done
}

# Fetch origin's $1 into refs/remotes/origin/$1. Depth 1 only in a shallow checkout, where a plain
# fetch of a branch based on an older commit could pull in history; in a full one, --depth would
# make the clone shallow under `changeset version`, which walks history for the changelog.
fetch_ref() {
  local depth=()
  if [ "$(git rev-parse --is-shallow-repository)" = true ]; then depth=(--depth=1); fi
  git fetch --no-tags --quiet ${depth[@]+"${depth[@]}"} origin "+refs/heads/$1:refs/remotes/origin/$1"
}

precheck() {
  local pending head moved
  pending=$(find .changeset -maxdepth 1 -name '*.md' ! -name README.md 2>/dev/null | head -n1)
  if [ -z "$pending" ]; then
    echo "::notice::no changesets in this checkout; nothing to version"
    echo "skip=true" >>"$output"
    return
  fi
  if [ "${GITHUB_REF:-}" != refs/heads/main ]; then
    echo "skip=false" >>"$output"
    return
  fi
  fetch_ref main
  head=$(git rev-parse refs/remotes/origin/main)
  if [ "$head" = "$GITHUB_SHA" ]; then
    echo "skip=false" >>"$output"
    return
  fi
  moved=$(git diff --name-only "$GITHUB_SHA" "$head" -- .changeset packages)
  if [ -z "$moved" ]; then
    echo "::notice::main moved to $head, but not under packages/ or .changeset/, so versioning $GITHUB_SHA is still accurate"
    echo "skip=false" >>"$output"
    return
  fi
  echo "::notice::main moved to $head since this run's $GITHUB_SHA, changing $(grep -c . <<<"$moved") file(s) under packages/ or .changeset/. Skipping the Version PR: the version run for that push is queued behind this one and versions from it."
  echo "skip=true" >>"$output"
}

close_stale() {
  local number=$1 tip=$2
  echo "::notice::closing version PR #$number: $branch carries no version newer than main"
  gh pr close "$number" --comment "Closing as stale: every version on \`$branch\` (${tip:0:7}) is already on main ($(git rev-parse --short refs/remotes/origin/main)), so merging it would publish nothing. The version workflow's guard closed it. A version run for a newer push opens a fresh one if changesets are pending."
  gh api -X DELETE "repos/$GITHUB_REPOSITORY/git/refs/heads/$branch" >/dev/null
}

ensure() {
  local bump="" tip_sha="" tip=0 pushed_here=no pr number updated
  # Main first, then the PR list: a PR merged in between is then no longer listed as open, rather
  # than listed open and compared against a main that lacks its merge.
  fetch_ref main
  # Exit 2 is "no such branch"; anything else is an error, and must not read as "no bump", which
  # would close a good PR.
  local rc=0
  git ls-remote --exit-code --heads origin "$branch" >/dev/null || rc=$?
  if [ "$rc" != 0 ] && [ "$rc" != 2 ]; then
    echo "::error::git ls-remote failed ($rc)"
    exit 1
  fi
  if [ "$rc" = 0 ]; then
    fetch_ref "$branch"
    tip_sha=$(git rev-parse "refs/remotes/origin/$branch")
    bump=$(bumps "refs/remotes/origin/$branch" refs/remotes/origin/main)
    tip=$(git log -1 --format=%ct "$tip_sha")
  fi
  if [ "$tip" -ge "${STARTED:-0}" ] && [ -n "$tip_sha" ]; then pushed_here=yes; fi

  pr=$(gh pr list --head "$branch" --base main --state open --json number,updatedAt --jq '.[0] // empty')
  if [ -n "$pr" ]; then
    number=$(jq -r .number <<<"$pr")
    if [ -z "$bump" ]; then
      close_stale "$number" "$tip_sha"
      if [ "$OUTCOME" = failure ]; then exit 1; fi
      exit 0
    fi
    updated=$(date -u -d "$(jq -r .updatedAt <<<"$pr")" +%s)
    if [ "$OUTCOME" = failure ] && [ "$updated" -lt "$STARTED" ] && [ "$pushed_here" = no ]; then
      echo "::error::changesets/action failed before touching the open version PR #$number, so that PR is stale: it predates this run's changesets. See the action's log above."
      exit 1
    fi
    echo "::notice::version PR #$number is open and bumps $(printf '%s' "$bump" | tr '\n' ';')"
    exit 0
  fi

  if [ "$OUTCOME" = skipped ]; then
    echo "::notice::versioning was skipped; nothing to open"
    exit 0
  fi
  if [ -z "$bump" ]; then
    echo "::notice::$branch carries no version newer than main; nothing to open"
    if [ "$OUTCOME" = failure ]; then exit 1; fi
    exit 0
  fi
  if [ "$OUTCOME" = failure ] && [ "$pushed_here" = no ]; then
    echo "::error::changesets/action failed before pushing $branch; the branch on origin is from an earlier run, not this run's version bump. See the action's log above."
    exit 1
  fi

  echo "No open version PR but $branch bumps $(printf '%s' "$bump" | tr '\n' ';'). Opening it here."
  gh pr create --base main --head "$branch" \
    --title "chore: version packages" \
    --body "Automated version bump from changesets. Merging this publishes the bumped \`@${GITHUB_REPOSITORY#*/}/*\` packages to npm. Opened by the version workflow's guard because \`changesets/action\` could not create it."
}

case "${1:-}" in
  precheck) precheck ;;
  ensure) ensure ;;
  *)
    echo "usage: $0 precheck|ensure" >&2
    exit 2
    ;;
esac
