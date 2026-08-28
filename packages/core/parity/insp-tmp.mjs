import { chromium } from "playwright";
import { createServer } from "vite";
const server = await createServer({
  configFile: new URL("./vite.config.ts", import.meta.url).pathname,
});
await server.listen();
const b = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=WebGPU", "--enable-gpu"],
});
const p = await b.newPage();
await p.goto(`http://localhost:${server.config.server.port}/`, { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => window.waveParity?.ready === true, null, { timeout: 60000 });
for (const n of ["preset:Wireframe", "preset:Aurora", "preset:Neon Dark Multistrand"])
  console.log(n, await p.evaluate((x) => window.waveParity.inspect(x), n));
await b.close();
await server.close();
