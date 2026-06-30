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
      comment: "Runtime imports must be declared in package.json.",
      from: {},
      to: {
        dependencyTypes: ["npm-no-pkg", "npm-unknown"],
      },
    },
    {
      name: "wave-core-is-independent",
      severity: "error",
      comment:
        "The reusable wave engine must not depend on studio UI, exports, or app entry points.",
      from: { path: "^src/wave/" },
      to: { path: "^(?:src/(?:ui|export|main|preview)|embed/)" },
    },
    {
      name: "ui-does-not-depend-on-app-or-exports",
      severity: "error",
      comment:
        "UI components may use the wave engine, but not app entry points or export orchestration.",
      from: { path: "^src/ui/" },
      to: { path: "^(?:src/(?:export|main|preview)|embed/)" },
    },
    {
      name: "exports-do-not-depend-on-ui-or-app",
      severity: "error",
      comment:
        "Export utilities may use the wave engine, but not UI components or app entry points.",
      from: { path: "^src/export/" },
      to: { path: "^(?:src/(?:ui|main|preview)|embed/)" },
    },
    {
      name: "embed-only-uses-wave-core",
      severity: "error",
      comment: "The public embed must remain isolated from studio-only code.",
      from: { path: "^embed/" },
      to: { path: "^src/(?!wave/)" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg"],
    },
    includeOnly: ["^(?:src|embed)/"],
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
