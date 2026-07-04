/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make module initialization and refactoring brittle.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolved",
      severity: "error",
      comment: "Every import must resolve to a file or installed package.",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-undeclared-dependencies",
      severity: "error",
      comment: "Runtime imports must be declared in the owning package's package.json.",
      from: {},
      to: {
        dependencyTypes: ["npm-no-pkg", "npm-unknown"],
      },
    },
    {
      name: "core-does-not-depend-on-app",
      severity: "error",
      comment: "The reusable @wave3d/core package must never reach into the studio application.",
      from: { path: "^packages/core/" },
      to: { path: "^apps/" },
    },
    {
      name: "renderer-stays-below-shell-and-studio",
      severity: "error",
      comment:
        "The renderer core is the lowest layer: it must not import the shell entry, the studio subclass, or the package index.",
      from: { path: "^packages/core/src/renderer/" },
      to: { path: "^packages/core/src/(?:index\\.ts$|shell/|studio/)" },
    },
    {
      name: "adapters-only-depend-on-core",
      severity: "error",
      comment:
        "Adapters (@wave3d/react, @wave3d/element) may depend on @wave3d/core only — not the studio app or each other.",
      from: { path: "^packages/(react|element)/" },
      to: {
        path: "^(?:apps/|packages/)",
        pathNot: ["^packages/core/", "^packages/$1/"],
      },
    },
    {
      name: "studio-ui-does-not-depend-on-app-or-exports",
      severity: "error",
      comment:
        "UI components may use the wave engine, but not app entry points or export orchestration.",
      from: { path: "^apps/studio/src/ui/" },
      to: { path: "^apps/studio/src/(?:export|main|preview)" },
    },
    {
      name: "studio-exports-do-not-depend-on-ui-or-app",
      severity: "error",
      comment:
        "Export utilities may use the wave engine, but not UI components or app entry points.",
      from: { path: "^apps/studio/src/export/" },
      to: { path: "^apps/studio/src/(?:ui|main|preview)" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg"],
    },
    // Never cruise build output (the bundled dist chunks are legitimately circular).
    exclude: {
      path: "(?:^|/)dist/",
    },
    includeOnly: ["^(?:apps|packages)/"],
    moduleSystems: ["es6"],
    prefix: `cursor://file/${process.cwd()}/`,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    reporterOptions: {
      mermaid: {
        minify: false,
      },
    },
  },
};
