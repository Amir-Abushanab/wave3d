/**
 * "Copy for your agent" — the clipboard payload that hands a designed wave to a coding agent.
 *
 * Three parts: a task line, the current wave's snippet (so the agent reproduces THIS wave rather
 * than a generic one), and @wave3d's own skill doc as reference. The doc is the exact
 * `packages/core/skills/wave3d/SKILL.md` that the published agent skill ships, inlined at build
 * time via `?raw` — so the button and the skill can never drift, and there's no runtime fetch to
 * fail. Its YAML frontmatter is tooling metadata (name/description/sources) that reads as noise to
 * an agent consuming the doc as prose, so it's stripped.
 *
 * The snippet deliberately carries NO poster: the studio's inline poster is a base64 LQIP data-URI,
 * which is kilobytes of pure noise in an agent's context. The task text asks for a poster instead.
 */
import skillDoc from "../../../../packages/core/skills/wave3d/SKILL.md?raw";
import { diffFromDefault, generateSnippet, type CodeTarget } from "./exportCode";
import type { StudioConfig } from "@wave3d/core";

const TASK = `Add an animated 3D gradient wave to my site — the exact wave I designed in Wave Studio.

1. Install the package for my framework: \`pnpm add @wave3d/react three\` (or the matching adapter —
   the reference below has the table). \`three\` is a peer dependency; add \`@types/three\` for TypeScript.
2. Mount the component using the config under "THE WAVE I DESIGNED" verbatim. Those numbers ARE the
   design — reproduce them exactly, don't re-tune or "clean up" the values.
3. Give the container a real size (it fills its parent), and wire up a poster image for first paint.

Use the reference below — @wave3d's own agent skill doc — to pick the right entry point for my stack
and get the config, poster and SSR details right.`;

/** Strip a leading `---\n…\n---` YAML frontmatter block. */
function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, "");
}

/**
 * Build the full agent brief for a wave. `target` picks which adapter the embedded snippet uses
 * (the reference doc covers the rest).
 */
export function buildAgentBrief(config: StudioConfig, target: CodeTarget = "react"): string {
  const snippet = generateSnippet(target, diffFromDefault(config));
  return [
    TASK,
    "--- THE WAVE I DESIGNED ---",
    snippet,
    "--- REFERENCE: the @wave3d agent skill ---",
    stripFrontmatter(skillDoc).trim(),
  ].join("\n\n");
}
