/**
 * Guards the lazy-chunk boundary for the TSL/WebGPU backend.
 *
 * `three/webgpu` pulls three's entire node system — measured at ~197 KB gzipped as its own chunk,
 * against 89 KB for the eager entry. It must stay reachable ONLY through the dynamic import in
 * `shell/createWave.ts`, or bundlers fold it into the main bundle and every consumer pays for a
 * backend they never opted into.
 *
 * This walks the STATIC import graph from each eager entry point and fails if any reachable module
 * imports `three/webgpu` or `three/tsl` as a value. Dynamic `import()` calls are deliberately not
 * followed — that is exactly the boundary being enforced. Type-only imports are ignored, since they
 * are erased at build time (`renderer/tsl/types.ts` relies on that).
 *
 * A dependency-cruiser rule cannot do this job: its `includeOnly` filter drops npm modules from the
 * graph before rules are evaluated, so a rule targeting three would never fire.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CORE = join(ROOT, "packages/core/src");
const ENTRIES = [
  "index.ts",
  "standalone.ts",
  "core-loader.ts",
  "renderer/index.ts",
  "studio/index.ts",
];
const FORBIDDEN = /^three\/(?:webgpu|tsl)$/;

/** Static `import ... from "x"` / `export ... from "x"`, minus the type-only forms. */
function staticImports(src) {
  const out = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  for (const [, clause, spec] of src.matchAll(re)) {
    if (/^type\b/.test(clause.trim())) continue; // `import type { X } from ...` — erased at build
    out.push(spec);
  }
  // Bare side-effect imports: `import "x"`.
  for (const [, spec] of src.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) out.push(spec);
  return out;
}

function resolveLocal(spec, fromFile) {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(cand) && !cand.endsWith("/")) return cand;
  }
  return null;
}

const seen = new Set();
const violations = [];

async function walk(file, trail) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = await readFile(file, "utf8");
  for (const spec of staticImports(src)) {
    if (FORBIDDEN.test(spec)) {
      violations.push({ spec, trail: [...trail, file].map((f) => f.replace(`${ROOT}/`, "")) });
      continue;
    }
    const next = resolveLocal(spec, file);
    if (next) await walk(next, [...trail, file]);
  }
}

for (const entry of ENTRIES) {
  const file = join(CORE, entry);
  if (existsSync(file)) await walk(file, []);
}

if (violations.length > 0) {
  console.error(`webgpu chunk boundary violated by ${violations.length} import(s):\n`);
  for (const v of violations) {
    console.error(`  "${v.spec}" reached via:`);
    for (const step of v.trail) console.error(`    ${step}`);
    console.error("");
  }
  console.error("Reach the TSL backend through the dynamic import of renderer/gpu-loader.ts, or");
  console.error("make the import type-only if it is erased at build time.");
  process.exit(1);
}

console.log(`webgpu chunk boundary: OK (${seen.size} eager modules, none import three/webgpu|tsl)`);
