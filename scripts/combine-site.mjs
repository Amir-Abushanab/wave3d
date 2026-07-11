#!/usr/bin/env node
/**
 * Combine the two static builds into one deployable tree: the studio at the root and the gallery
 * under /gallery/. `pnpm build:site` builds both apps first, then this copies the gallery's dist
 * into apps/studio/dist/gallery so a single Cloudflare Pages deploy serves both origins.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const studioDist = path("../apps/studio/dist");
const galleryDist = path("../apps/gallery/dist");
const target = path("../apps/studio/dist/gallery");

if (!existsSync(studioDist)) throw new Error("apps/studio/dist missing — build the studio first");
if (!existsSync(galleryDist))
  throw new Error("apps/gallery/dist missing — build the gallery first");

rmSync(target, { recursive: true, force: true });
cpSync(galleryDist, target, { recursive: true });
console.log("combined site: studio at /, gallery at /gallery/");
