/** Runs the TSL-vs-GLSL shader-math checks under headless Chromium (WebGPU needs a secure context). */
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

let noise, math;
try {
  await page.waitForFunction(
    () => typeof window.waveNoiseCheck === "function" && typeof window.waveMathCheck === "function",
    null,
    { timeout: 60_000 },
  );
  noise = await page.evaluate(() => window.waveNoiseCheck());
  math = await page.evaluate(() => window.waveMathCheck());
} catch (e) {
  console.error("shader-math check failed:", String(e).split("\n")[0]);
  console.error(errors.slice(0, 8).join("\n"));
  await browser.close();
  await server.close();
  process.exit(1);
}
await browser.close();
await server.close();

// The two paths compute the same arithmetic through different codegen, so float reassociation makes
// exact equality unrealistic in principle — but every case here has landed at 0, and anything above
// ~1e-4 means the maths actually differs rather than the last bit moving.
const TOL = 1e-4;
let worst = noise.maxAbs;

console.log(
  `noise field, ${noise.samples} samples: max|Δ|=${noise.maxAbs.toExponential(3)} mean|Δ|=${noise.mean.toExponential(3)}`,
);
console.log("\npoint probes:                                          GLSL           TSL");
for (const m of math) {
  if (m.delta > worst) worst = m.delta;
  console.log(
    `  ${m.delta <= TOL ? "ok  " : "FAIL"}  ${m.name.padEnd(44)} ${m.glsl.toFixed(7).padStart(12)}  ${m.tsl.toFixed(7).padStart(12)}  Δ=${m.delta.toExponential(2)}`,
  );
}

const ok = worst <= TOL;
console.log(`\nworst |Δ| = ${worst.toExponential(3)} — ${ok ? "PASS" : `FAIL (tolerance ${TOL})`}`);
if (errors.length) console.log("page errors:\n  " + errors.slice(0, 5).join("\n  "));
process.exit(ok ? 0 : 1);
