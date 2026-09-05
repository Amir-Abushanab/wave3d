// The synchronous half of the interactivity layer: pure config predicates plus the one constant the
// shader is built against. Nothing here touches the DOM, holds state, or imports three.
//
// It is a SEPARATE MODULE for one reason — the tree-shaking boundary. The renderer needs these
// answers synchronously (they decide which shader defines compile and whether the layer runs at
// all), but the runtime behind them — the controller, its listeners, the applier tables, the tilt
// sensor — is ~3.8 KB gzipped that a scene with no `interaction` block never executes. Keeping the
// two in one file forced a static import of the whole layer into every bundle. Split, the renderer
// imports only this (a few hundred bytes) and reaches interaction.ts through a dynamic import, so
// the runtime is a chunk that is fetched only by pages that actually interact.
//
// The rule this file exists to enforce: NOTHING in the eager import graph may import
// `./interaction` — reach it through `import("./interaction")` instead.
import type { StudioConfig, WaveConfig } from "../config/model";
import type { SceneInteractionBinding, WaveInteractionBinding } from "../config/model";

/** Click-ripple ring-buffer size. MUST match the `[4]` array sizes in shaders.ts (POINTER_RIPPLES). */
export const RIPPLE_SLOTS = 4;

type AnyBinding = WaveInteractionBinding | SceneInteractionBinding;

/** The global master switch: only `scene.interaction.enabled === false` turns the whole layer off. */
function notDisabled(cfg: StudioConfig): boolean {
  return cfg.interaction?.enabled !== false;
}

/** Whether a wave has a pointer field (hover effects, or a click ripple). */
function waveHasPointerField(w: WaveConfig): boolean {
  const it = w.interaction;
  return !!it && (!!it.hover || (it.press?.ripple ?? 0) > 0);
}

/** Whether this wave has an active pointer field → its POINTER_FX shader path compiles. */
export function wavePointerFxActive(cfg: StudioConfig, w: WaveConfig): boolean {
  return notDisabled(cfg) && waveHasPointerField(w);
}

/** Whether this wave has active click ripples → its nested POINTER_RIPPLES path compiles. */
export function waveRipplesActive(cfg: StudioConfig, w: WaveConfig): boolean {
  return notDisabled(cfg) && (w.interaction?.press?.ripple ?? 0) > 0;
}

/** Whether ANY wave has a pointer field (so the renderer bothers writing the shared pointer uniforms). */
export function anyPointerFxActive(cfg: StudioConfig): boolean {
  return notDisabled(cfg) && cfg.waves.some(waveHasPointerField);
}

/** Whether the interaction layer should run at all (any wave interaction, or any scene binding).
 *  This is the predicate that decides whether the runtime chunk is ever fetched. */
export function interactionActive(cfg: StudioConfig): boolean {
  if (!notDisabled(cfg)) return false;
  if ((cfg.interaction?.bindings?.length ?? 0) > 0) return true;
  return cfg.waves.some((w) => {
    const it = w.interaction;
    return !!it && (!!it.hover || (it.press?.ripple ?? 0) > 0 || (it.bindings?.length ?? 0) > 0);
  });
}

/** True when any binding in the list reads the orientation sensor. */
function anyTiltSource(bindings: readonly AnyBinding[] | undefined): boolean {
  if (!bindings) return false;
  for (let i = 0; i < bindings.length; i++) {
    const s = bindings[i].source;
    if (s === "tiltX" || s === "tiltY") return true;
  }
  return false;
}

/**
 * Whether anything in this scene reads the orientation sensor: a `tiltX` / `tiltY` binding anywhere,
 * or the opt-in that lets tilt stand in for the cursor. A tilt BINDING is the switch — the
 * `interaction.tilt` block is tuning, exactly as `pointerX` needs no "pointer" block — so a scene
 * that never mentions tilt attaches no `deviceorientation` listener and touches no sensor. Indexed
 * loops and no closures: unlike {@link interactionActive} this one is checked every frame.
 */
export function tiltActive(cfg: StudioConfig): boolean {
  if (!notDisabled(cfg)) return false;
  if (cfg.interaction?.tilt?.pointer) return true;
  if (anyTiltSource(cfg.interaction?.bindings)) return true;
  for (let w = 0; w < cfg.waves.length; w++) {
    if (anyTiltSource(cfg.waves[w].interaction?.bindings)) return true;
  }
  return false;
}
