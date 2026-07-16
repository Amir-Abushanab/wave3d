import "./gallery.css";
import "./page-transition.css"; // subtle crossfade when hopping between the studio and the gallery
import { createWave } from "@wave3d/core";
import type { StudioConfig } from "@wave3d/core";

interface Wave {
  title: string;
  author: string;
  config: StudioConfig;
}

// Every gallery/waves/*.json (repo root), inlined at build time.
const waves = Object.values(
  import.meta.glob<Wave>("../../../gallery/waves/*.json", { eager: true, import: "default" }),
).sort((a, b) => a.title.localeCompare(b.title));

// "Open in studio": gzip + base64url the config into #w= (matches the studio's encoder). The studio
// and gallery are one app now — studio at "/", gallery at "/gallery/" — so a root link works.
function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function studioHref(config: StudioConfig): Promise<string> {
  const gz = await new Response(
    new Blob([JSON.stringify(config)]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  return "/#w=" + bytesToB64url(new Uint8Array(gz));
}

function card(wave: Wave): HTMLElement {
  const el = document.createElement("article");
  el.className = "card";

  // A live, animated wave (poster-first + self-optimizing) — not a still frame. `lazy: false` so it
  // upgrades on mount rather than waiting for the viewport. (For a large gallery, lazy: true would
  // gate WebGL contexts to visible cards.)
  const media = document.createElement("div");
  media.className = "media";
  createWave(media, wave.config, { lazy: false });

  const meta = document.createElement("div");
  meta.className = "meta";
  const title = document.createElement("h2");
  title.textContent = wave.title;
  const by = document.createElement("a");
  by.className = "by";
  by.textContent = "@" + wave.author;
  by.href = "https://github.com/" + wave.author;
  by.target = "_blank";
  by.rel = "noopener";
  meta.append(title, by);

  // Shown only on hover (CSS). Just a label — the stretched link below is the real click target.
  const open = document.createElement("span");
  open.className = "open";
  open.textContent = "Open in studio →";

  // Stretched link: a click anywhere on the card opens it in the studio. The author link sits above
  // it (z-index) so clicking the handle goes to GitHub instead.
  const link = document.createElement("a");
  link.className = "card-link";
  link.setAttribute("aria-label", `Open ${wave.title} in the studio`);
  void studioHref(wave.config).then((href) => (link.href = href));

  el.append(media, meta, open, link);
  return el;
}

const app = document.getElementById("app")!;
app.innerHTML = `
  <header class="hero">
    <h1>🌊 Wave gallery</h1>
    <p>Community waves. <a href="/">Make your own →</a></p>
  </header>
  <main class="grid"></main>`;

const grid = app.querySelector(".grid")!;
if (waves.length === 0) {
  grid.innerHTML = `<p class="empty">No waves yet. Be the first: design one in the studio and hit Publish to gallery.</p>`;
} else {
  for (const wave of waves) grid.appendChild(card(wave));
}
