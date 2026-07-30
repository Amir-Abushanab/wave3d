// npm-check-updates config, read by `pnpm ncu`.
// A .cjs config (not .ncurc.yml) because `target` has to be a function to vary per package, and
// this repo is "type": "module", so .cjs rather than .js.
module.exports = {
  // Never propose a version published less than 7 days ago. Compromised releases are typically
  // yanked within hours-to-days, so a week's lag lets the ecosystem find the bad ones first, at the
  // cost of adopting genuine fixes a week late. With target `latest`, a package whose newest release
  // falls inside the window drops back to the newest release OLDER than the window rather than being
  // skipped, so updates keep flowing. Only governs what ncu PROPOSES for direct deps — it is not an
  // install-time gate (pnpm's own `minimumReleaseAge` is that, and covers transitive deps too).
  cooldown: 7,

  target: (name) => {
    // TypeScript 7 typechecks and emits identically here, but tsdown warns that TS 7.0 "does not
    // yet have a stable API and is experimental. Some options will be unavailable" — not a risk
    // worth taking for packages whose published .d.ts is part of the contract. Stay on 6.x and keep
    // picking up its minors; drop this line once tsdown supports 7 without the caveat.
    if (name === "typescript") return "minor";
    return "latest";
  },
};
