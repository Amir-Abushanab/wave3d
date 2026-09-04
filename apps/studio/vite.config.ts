import { defineConfig, type Plugin } from "vite";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

// One app, two pages: the studio at "/" and the wave gallery at "/gallery/". The embeddable
// @wave3d/core runtime is built separately via the core package's `build:standalone` (predev/prebuild);
// the HTML exporter fetches that asset and inlines it into the downloaded file.
const root = import.meta.dirname;

/** Canonical origin, in one place. Override with SITE_URL once the site moves to its own domain. */
const SITE_URL = (process.env.SITE_URL ?? "https://wave-studio.pages.dev").replace(/\/+$/, "");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};
/** Text files carry `%SITE_URL%`; images are copied byte-for-byte. */
const isText = (name: string) => name.endsWith(".txt") || name.endsWith(".xml");

/**
 * `static/` holds the deploy-root files the crawlers and social cards want — robots.txt, sitemap.xml,
 * the OG cards, the touch icon. They can't ride in `publicDir`: that slot is taken by the core's
 * standalone build output. Served in dev, emitted to the dist root on build, `%SITE_URL%` substituted
 * in both (and in the HTML) so the origin is written once.
 */
function staticRoot(): Plugin {
  const dir = resolve(root, "static");
  const render = (name: string) => {
    const body = readFileSync(resolve(dir, name));
    return isText(name) ? body.toString("utf8").replaceAll("%SITE_URL%", SITE_URL) : body;
  };
  return {
    name: "wave3d:static-root",
    transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", SITE_URL),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? "").split("?")[0].replace(/^\//, "");
        const file = resolve(dir, name);
        if (!name || name.includes("/") || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
          return next();
        }
        res.setHeader("Content-Type", MIME[extname(name)] ?? "application/octet-stream");
        res.end(render(name));
      });
    },
    generateBundle() {
      for (const name of readdirSync(dir)) {
        this.emitFile({ type: "asset", fileName: name, source: render(name) });
      }
    },
  };
}

export default defineConfig({
  base: "/",
  publicDir: "../../packages/core/dist/standalone",
  plugins: [staticRoot()],
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      input: {
        studio: resolve(root, "index.html"),
        gallery: resolve(root, "gallery/index.html"),
      },
    },
  },
});
