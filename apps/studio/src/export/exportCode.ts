/**
 * "Export code": turn the current wave into a copy-paste snippet for each @wave3d entry point.
 * The snippet embeds only the diff from the model defaults (so it's minimal), which the adapters/
 * shell merge back over `createDefaultConfig()` to reproduce the exact wave.
 */
import { createDefaultConfig, ensureStudioConfig } from "@wave3d/core";
import type { StudioConfig } from "@wave3d/core";
import type { WaveRenderer } from "@wave3d/core/renderer";
import { serializeForInlineScript } from "./exporters";

export type CodeTarget = "react" | "vue" | "svelte" | "vanilla" | "html";

function differs(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * The minimal config that reproduces this wave when merged over `createDefaultConfig()`. A SHALLOW
 * top-level diff: each key whose value differs from the (normalized) default is emitted WHOLE. The
 * shell and adapters merge config shallowly (`{ ...createDefaultConfig(), ...diff }`), so a nested
 * value has to be complete — a recursive/partial diff (e.g. a `cameraTarget` missing its `z`, or a
 * partial wave) would be clobbered by the merge and fail to reproduce. The baseline is normalized
 * with `ensureStudioConfig` so its backfilled defaults (bloomStrength, loopSeconds, …) don't show
 * as fake diffs.
 */
export function diffFromDefault(config: StudioConfig): Partial<StudioConfig> {
  const def = ensureStudioConfig(createDefaultConfig()) as unknown as Record<string, unknown>;
  const cur = config as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(cur)) {
    if (differs(cur[key], def[key])) out[key] = structuredClone(cur[key]);
  }
  return out as Partial<StudioConfig>;
}

/** Re-indent a multi-line JSON block so it sits nicely inside a snippet. */
function indent(json: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return json
    .split("\n")
    .map((line, i) => (i === 0 ? line : pad + line))
    .join("\n");
}

/** Build a copy-paste snippet for one target from a (minimal) config. */
export function generateSnippet(
  target: CodeTarget,
  config: Partial<StudioConfig>,
  opts: { posterPath?: string } = {},
): string {
  const pretty = JSON.stringify(config, null, 2);
  const attr = JSON.stringify(config); // compact — double-quoted JSON is safe inside a single-quoted attr
  const inline = serializeForInlineScript(config); // <-escaped — safe inside an inline <script>
  const poster = opts.posterPath;
  // When the poster is an inlined LQIP data-URI, flag it as a placeholder — a production app should
  // point `poster` at a hosted (higher-res, separately-cacheable) image instead.
  const noteText = "poster is an inline LQIP placeholder — swap in a hosted image for production";
  const posterNote = !poster?.startsWith("data:")
    ? ""
    : target === "vue" || target === "svelte" || target === "html"
      ? `<!-- ${noteText} -->\n`
      : `// ${noteText}\n`;

  switch (target) {
    case "react":
      return `${posterNote}// pnpm add @wave3d/react three
import { Wave3D } from "@wave3d/react";

export default function Wave() {
  return (
    <Wave3D
      config={${indent(pretty, 6)}}${poster ? `\n      poster=${JSON.stringify(poster)}` : ""}
      style={{ width: "100%", aspectRatio: "16 / 9" }}
    />
  );
}`;

    case "vue":
      return `${posterNote}<!-- pnpm add @wave3d/element three -->
<!-- main.ts: import "@wave3d/element";  (and in Vue, tell the compiler <wave-3d> is a custom
     element: app.config.compilerOptions.isCustomElement = (t) => t === "wave-3d") -->
<template>
  <wave-3d
    config='${attr}'${poster ? `\n    poster=${JSON.stringify(poster)}` : ""}
    style="display:block;width:100%;aspect-ratio:16/9"
  ></wave-3d>
</template>`;

    case "svelte":
      return `${posterNote}<!-- pnpm add @wave3d/element three -->
<script>
  import "@wave3d/element";
</script>

<wave-3d
  config='${attr}'${poster ? `\n  poster=${JSON.stringify(poster)}` : ""}
  style="display:block;width:100%;aspect-ratio:16/9"
></wave-3d>`;

    case "vanilla":
      return `${posterNote}// pnpm add @wave3d/core three
import { createWave } from "@wave3d/core";

createWave(
  document.getElementById("wave"),
  ${indent(pretty, 2)},
  { ${poster ? `poster: ${JSON.stringify(poster)}` : "/* lazy, poster, webgl … */"} },
);`;

    case "html":
      return `${posterNote}<div id="wave" style="width:100%;aspect-ratio:16/9"></div>
<script type="module">
  import { mountWave } from "https://esm.sh/@wave3d/core/standalone";
  mountWave(document.getElementById("wave"), ${inline}${poster ? `, { poster: ${JSON.stringify(poster)} }` : ""});
</script>`;
  }
}

/**
 * A tiny low-quality poster (data-URI) captured from the live canvas — a good SSR/first-paint
 * placeholder to drop into the snippet's `poster`. Downscaled to `maxEdge` px on its long side.
 */
export function generatePosterDataUri(renderer: WaveRenderer, maxEdge = 64): string {
  const source = renderer.canvas;
  const longEdge = Math.max(source.width, source.height) || 1;
  const scale = Math.min(1, maxEdge / longEdge);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(source.width * scale));
  out.height = Math.max(1, Math.round(source.height * scale));
  out.getContext("2d")?.drawImage(source, 0, 0, out.width, out.height);
  return out.toDataURL("image/webp", 0.6);
}
