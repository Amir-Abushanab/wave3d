/**
 * Preset-parity runner. Boots the harness under headless Chromium (which does expose WebGPU, but
 * ONLY over a secure context — hence the localhost dev server rather than a file:// or about:blank
 * page), renders every preset + gallery config, and compares.
 *
 *   node parity/run.mjs                      render each config on BOTH backends and compare
 *   node parity/run.mjs --self               render WebGL twice (harness determinism check)
 *   node parity/run.mjs --capture            write PNGs to parity/refs/ for cross-machine work
 *
 * The default mode renders both backends in the SAME page load, so GPU, driver, browser and
 * config are identical and the backend is the only variable. Nothing binary is versioned: both
 * renderers build from this source tree, so baselines are always reproducible.
 *
 * Cross-backend output is never bit-identical (WebGPU defaults to a HalfFloat output buffer and
 * resolves MSAA differently), so the gate is perceptual — see THRESHOLDS.
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REFS = resolve(HERE, "refs");
const OUT = resolve(HERE, "out");

// A config passes when the two renders agree perceptually. maxDelta alone is a bad gate: a single
// pixel on a hard edge legitimately flips far under a different MSAA resolve, so the mass metrics
// carry the decision and maxDelta is reported for triage only.
const THRESHOLDS = { mae: 2.0, interiorOver8: 1.0, interiorOver24: 0.25 };

/**
 * Configs the port does not reach THRESHOLDS on. All five are order-dependent transparency; the
 * README says why, and why there is no cheap fix.
 *
 * Ceilings ~25% above measured, so a driver change does not rewrite the file. Per-config on purpose:
 * one global threshold loose enough for the worst of them would let a real regression through on the
 * other 34.
 */
const ALLOW = {
  "preset:Neon Dark Multistrand": { mae: 6.0, interiorOver8: 19.0, interiorOver24: 8.5 },
  "preset:Corkscrew": { mae: 1.5, interiorOver8: 8.0, interiorOver24: 5.0 },
  "preset:Kaleidoscope": { mae: 1.0, interiorOver8: 3.0, interiorOver24: 2.0 },
  "preset:Wave 3": { mae: 1.0, interiorOver8: 3.0, interiorOver24: 2.0 },
  "preset:Vaporwave Sunset": { mae: 0.6, interiorOver8: 1.5, interiorOver24: 0.5 },
};

const args = process.argv.slice(2);
const MODE = args.includes("--capture")
  ? "capture"
  : args.includes("--self")
    ? "self"
    : args.includes("--path-identity")
      ? "path-identity"
      : "compare";
// A straight path is the identity: adding one to a wave must not move a pixel, on either backend.
// Same backend on both sides, so this is held far tighter than the cross-backend thresholds. The
// exact mapping measures mae ≤ 0.001 across every config; relying on hardware filtering of the LUT
// measured 0.05–0.09, and each mapping bug the check was built to catch measured 1–51.
const IDENTITY = { mae: 0.01, interiorOver8: 0.002, interiorOver24: 0.001 };
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7);
// Synthetic pointer configs get a pinned cursor so the interaction path is actually exercised.
const FIXED_POINTER = { x: 0.18, y: -0.12, radius: 0.6, vx: 0.4, vy: 0.15 };
const NO_POST = args.includes("--no-post"); // diagnostic: material only, post chain zeroed
// Diagnostic: --set key=value (repeatable) overrides config on BOTH sides, to isolate one effect.
const OVERRIDES = Object.fromEntries(
  args
    .filter((a) => a.startsWith("--set="))
    .map((a) => a.slice(6).split("="))
    .map(([k, v]) => [
      k,
      v === "true" ? true : v === "false" ? false : Number.isNaN(Number(v)) ? v : Number(v),
    ]),
);

const dataUrlToBuffer = (u) => Buffer.from(u.slice(u.indexOf(",") + 1), "base64");
/** Runs in the page. One function for both backends, so their options cannot drift apart. */
const renderWith = ([name, opts, backend]) => window.waveParity.render(name, { ...opts, backend });
const slug = (n) => n.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

async function main() {
  const server = await createServer({ configFile: resolve(HERE, "vite.config.ts") });
  await server.listen();
  const url = `http://localhost:${server.config.server.port}/`;

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=WebGPU",
      "--ignore-gpu-blocklist",
      "--enable-gpu",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .waitForFunction(() => window.waveParity?.ready === true, null, { timeout: 60_000 })
    .catch(async () => {
      throw new Error(
        `harness never became ready.\n${await page.textContent("#log")}\n${pageErrors.join("\n")}`,
      );
    });

  const gpu = await page.evaluate(async () => {
    if (!navigator.gpu) return { available: false };
    const a = await navigator.gpu.requestAdapter().catch(() => null);
    return { available: !!a, features: a ? [...a.features].length : 0 };
  });
  console.log(`WebGPU adapter: ${gpu.available ? `yes (${gpu.features} features)` : "NO"}`);
  if (MODE === "compare" && !gpu.available)
    throw new Error("WebGPU unavailable — cannot compare backends");

  let names = await page.evaluate(() => window.waveParity.names());
  if (ONLY) names = names.filter((n) => n.includes(ONLY));
  console.log(`${names.length} configs · mode=${MODE}\n`);

  await mkdir(MODE === "capture" ? REFS : OUT, { recursive: true });
  if (MODE !== "capture")
    await rm(OUT, { recursive: true, force: true }).then(() => mkdir(OUT, { recursive: true }));

  const rows = [];
  for (const name of names) {
    const file = `${slug(name)}.png`;
    try {
      if (MODE === "capture") {
        const png = await page.evaluate(
          (n) => window.waveParity.render(n, { backend: "webgl" }),
          name,
        );
        await writeFile(resolve(REFS, file), dataUrlToBuffer(png));
        rows.push({ name, status: "captured" });
        console.log(`  captured  ${name}`);
        continue;
      }

      if (MODE === "path-identity") {
        for (const be of ["webgl", "webgpu"]) {
          const plain = await page.evaluate(renderWith, [name, { noPost: NO_POST }, be]);
          const pathed = await page.evaluate(renderWith, [
            name,
            { noPost: NO_POST, pathIdentity: true },
            be,
          ]);
          const d = await page.evaluate(([a, b]) => window.waveParity.diff(a, b), [plain, pathed]);
          const ok =
            d.mae <= IDENTITY.mae &&
            d.interiorOver8 <= IDENTITY.interiorOver8 &&
            d.interiorOver24 <= IDENTITY.interiorOver24;
          rows.push({
            name: `${name} [${be}]`,
            status: ok ? "pass" : "FAIL",
            ...d,
            diffPng: undefined,
          });
          console.log(
            `  ${ok ? "pass  " : "FAIL  "}  ${`${name} [${be}]`.padEnd(42)} mae=${d.mae.toFixed(3)} ` +
              `interior>8=${d.interiorOver8.toFixed(3)}% >24=${d.interiorOver24.toFixed(3)}% max=${d.maxDelta}`,
          );
          if (!ok) {
            const f = `${slug(name)}-${be}-identity`;
            await writeFile(resolve(OUT, `${f}.plain.png`), dataUrlToBuffer(plain));
            await writeFile(resolve(OUT, `${f}.pathed.png`), dataUrlToBuffer(pathed));
            await writeFile(resolve(OUT, `${f}.diff.png`), dataUrlToBuffer(d.diffPng));
          }
        }
        continue;
      }

      // Both renders happen in this page load: same GPU, same driver, same config object shape.
      const backend = MODE === "self" ? "webgl" : "webgpu";
      // ONE options object for both sides, differing only in `backend`. Maintaining two call sites
      // let a flag reach one backend and not the other twice already, each time producing a
      // confident-looking comparison of two different things.
      const opts = {
        noPost: NO_POST,
        overrides: OVERRIDES,
        pointer: name.startsWith("synthetic:pointer")
          ? { ...FIXED_POINTER, ripple: name.includes("ripples") }
          : undefined,
      };
      const expected = await page.evaluate(renderWith, [name, opts, "webgl"]);
      const actual = await page.evaluate(renderWith, [name, opts, backend]);

      const d = await page.evaluate(([a, b]) => window.waveParity.diff(a, b), [expected, actual]);
      const within = (t) =>
        d.mae <= t.mae &&
        d.interiorOver8 <= t.interiorOver8 &&
        d.interiorOver24 <= t.interiorOver24;
      // "allow" is reported distinctly from "pass" so a known divergence can never read as clean.
      // Not in --self, and not under --no-post/--set: those render something else, so an allowance
      // recorded for the shipped config would be passing a number it was never measured against.
      const allowance =
        MODE === "self" || NO_POST || Object.keys(OVERRIDES).length ? undefined : ALLOW[name];
      const pass = within(THRESHOLDS) || (!!allowance && within(allowance));
      const allowed = pass && !within(THRESHOLDS);
      rows.push({
        name,
        status: pass ? (allowed ? "allow" : "pass") : "FAIL",
        ...d,
        diffPng: undefined,
      });
      console.log(
        `  ${allowed ? "allow " : pass ? "pass  " : "FAIL  "}  ${name.padEnd(34)} mae=${d.mae.toFixed(2)} ` +
          `interior>8=${d.interiorOver8.toFixed(2)}% >24=${d.interiorOver24.toFixed(2)}% ` +
          `(edge ${d.pctEdge.toFixed(1)}%, bias ${d.interiorBias.map((v) => v.toFixed(2)).join("/")}, max=${d.maxDelta})`,
      );
      if (!pass) {
        await writeFile(resolve(OUT, `${slug(name)}.actual.png`), dataUrlToBuffer(actual));
        await writeFile(resolve(OUT, `${slug(name)}.expected.png`), dataUrlToBuffer(expected));
        await writeFile(resolve(OUT, `${slug(name)}.diff.png`), dataUrlToBuffer(d.diffPng));
      }
    } catch (e) {
      rows.push({ name, status: "ERROR", error: String(e?.message ?? e) });
      console.log(`  ERROR     ${name} — ${String(e?.message ?? e).split("\n")[0]}`);
    }
  }

  await browser.close();
  await server.close();

  const failed = rows.filter(
    (r) => r.status === "FAIL" || r.status === "ERROR" || r.status === "NO-REF",
  );
  await writeFile(
    resolve(MODE === "capture" ? REFS : OUT, "report.json"),
    JSON.stringify({ mode: MODE, thresholds: THRESHOLDS, rows }, null, 2),
  );
  const allowed = rows.filter((r) => r.status === "allow").length;
  console.log(
    `\n${rows.length - failed.length}/${rows.length} ok` +
      (allowed ? ` (${allowed} within a recorded allowance, not the thresholds)` : "") +
      (failed.length ? ` — ${failed.length} need attention (see parity/out/)` : ""),
  );
  if (pageErrors.length) console.log(`page errors:\n  ${pageErrors.slice(0, 5).join("\n  ")}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
