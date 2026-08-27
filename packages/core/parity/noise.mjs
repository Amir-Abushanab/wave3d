/** Runs the TSL-vs-GLSL noise check under headless Chromium (WebGPU needs a secure context). */
import { chromium } from "playwright";
import { createServer } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const server = await createServer({ configFile: resolve(HERE, "vite.config.ts") });
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=WebGPU",
    "--ignore-gpu-blocklist",
    "--enable-gpu",
  ],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`http://localhost:${server.config.server.port}/`, {
  waitUntil: "domcontentloaded",
});

let out;
try {
  await page.waitForFunction(() => typeof window.waveNoiseCheck === "function", null, {
    timeout: 60_000,
  });
  out = await page.evaluate(() => window.waveNoiseCheck());
} catch (e) {
  console.error("noise check failed:", String(e).split("\n")[0]);
  console.error(errors.slice(0, 8).join("\n"));
  await browser.close();
  await server.close();
  process.exit(1);
}
await browser.close();
await server.close();

// The two paths compute the same arithmetic in different codegen; float reassociation makes exact
// equality unrealistic, but anything above ~1e-4 means the hash or the lattice actually differs.
const TOL = 1e-4;
const ok = out.maxAbs <= TOL;
console.log(
  `noise TSL vs GLSL over ${out.samples} samples: max|Δ|=${out.maxAbs.toExponential(3)} mean|Δ|=${out.mean.toExponential(3)}`,
);
console.log(ok ? "PASS" : `FAIL — exceeds tolerance ${TOL}`);
if (errors.length) console.log("page errors:\n  " + errors.slice(0, 5).join("\n  "));
process.exit(ok ? 0 : 1);
