// @vitest-environment jsdom
/**
 * Drift audit for the control panel's config bindings.
 *
 * Tweakpane picks a controller from the VALUE it is handed, and throws
 * `No matching controller for '<key>'` for anything it has no widget for — notably `undefined`.
 * So every config field the panel binds has to be backfilled by @wave3d/core's normalizers, and a
 * field added to the panel without a matching backfill takes the whole panel down (that is exactly
 * how `timeOffset` broke it: optional in the type, set only in createDefaultConfig).
 *
 * Rather than restate the field list here — which would drift immediately — this reads the real
 * `addBinding` call sites out of ControlPanel.ts, normalizes the most minimal config a user can
 * hand-edit, and asks Tweakpane itself to bind each one.
 */
import { describe, expect, it } from "vitest";
import { Pane } from "tweakpane";
import { ensureStudioConfig, type StudioConfig } from "@wave3d/core";
// Vite's `?raw` rather than node:fs — this package has no Node types, and it keeps the audit
// pinned to the real source file (a rename breaks the import instead of silently matching nothing).
import SOURCE from "./ControlPanel.ts?raw";

/** Receivers backed by the document config — the ones the normalizers are responsible for. */
const CONFIG_RECEIVERS: Record<string, (c: StudioConfig) => unknown> = {
  cfg: (c) => c,
  "this.config": (c) => c,
  "cfg.backgroundImagePosition": (c) => c.backgroundImagePosition,
  wave: (c) => c.waves[0],
  "wave.paletteTextureScale": (c) => c.waves[0].paletteTextureScale,
  "wave.paletteTextureOffset": (c) => c.waves[0].paletteTextureOffset,
  "wave.displaceFrequency": (c) => c.waves[0].displaceFrequency,
  "wave.twistFrequency": (c) => c.waves[0].twistFrequency,
  "wave.twistPower": (c) => c.waves[0].twistPower,
  "wave.position": (c) => c.waves[0].position,
  "wave.rotation": (c) => c.waves[0].rotation,
  "wave.scale": (c) => c.waves[0].scale,
  light: (c) => c.lights[0],
  "light.position": (c) => c.lights[0].position,
  band: (c) => c.waves[0].noiseBands[0],
};

/**
 * Receivers that are panel-local UI state, not document config: mode toggles, the camera sync
 * proxy, export size, and the interaction editor's slot rows (which are built from
 * `config.interaction` through helpers that supply their own defaults — the interaction block is
 * deliberately never backfilled, because absence means "off"). These are always constructed with
 * concrete values, so the normalizers have no say over them.
 */
const UI_STATE_RECEIVERS = new Set([
  "outputSize",
  "this.state",
  "camP",
  "editProxy",
  "waveDragProxy",
  "gizmoProxy",
  "uiInputs",
  "uiParticles",
  "uiHover",
  "uiPress",
  "scrollPrev",
  "slot",
  "on",
]);

/** Every `addBinding(receiver, "key")` in the panel, grouped by receiver. */
function parseDirectBindings(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of SOURCE.matchAll(/addBinding\(\s*([A-Za-z_][\w.]*)\s*,\s*["'](\w+)["']/g)) {
    const keys = out.get(m[1]) ?? new Set<string>();
    keys.add(m[2]);
    out.set(m[1], keys);
  }
  return out;
}

/** The `vec()` helper binds x/y/z of whatever object it's handed — one slider per axis. */
function parseVecReceivers(): string[] {
  return [...SOURCE.matchAll(/\bvec\(\s*\w+,\s*([\w.]+),/g)].map((m) => m[1]);
}

/** The most minimal config a hand-edit can produce, with one light and one band so those
 *  element-level bindings are covered too. */
function minimalConfig(): StudioConfig {
  return ensureStudioConfig({
    waves: [{ noiseBands: [{}] }],
    lights: [{}],
  } as unknown as StudioConfig);
}

describe("every config field the panel binds survives normalization", () => {
  it("finds the binding call sites (guards against the regex silently matching nothing)", () => {
    const direct = parseDirectBindings();
    expect(direct.get("cfg")?.size ?? 0).toBeGreaterThan(30);
    expect(direct.get("wave")?.size ?? 0).toBeGreaterThan(30);
    expect(parseVecReceivers().length).toBeGreaterThan(5);
  });

  it("classifies every binding receiver, so a new one can't go unaudited", () => {
    const unknown = [...parseDirectBindings().keys(), ...parseVecReceivers()].filter(
      (r) => !(r in CONFIG_RECEIVERS) && !UI_STATE_RECEIVERS.has(r),
    );
    expect(
      unknown,
      "new addBinding receiver(s): add each to CONFIG_RECEIVERS (if it is document config, so its " +
        "fields get audited) or to UI_STATE_RECEIVERS (if it is panel-local state)",
    ).toEqual([]);
  });

  it("lets Tweakpane bind every one of them", () => {
    const config = minimalConfig();
    // Some Tweakpane widgets paint to a canvas, which jsdom doesn't implement; the binding itself
    // is what's under test, so stub it rather than let the warnings bury a real failure.
    HTMLCanvasElement.prototype.getContext = () => null;
    const pane = new Pane();
    const failures: string[] = [];
    try {
      for (const [receiver, keys] of parseDirectBindings()) {
        if (!(receiver in CONFIG_RECEIVERS)) continue; // UI state — covered by the test above
        const target = CONFIG_RECEIVERS[receiver](config);
        if (target === null || typeof target !== "object") {
          failures.push(`${receiver} is ${String(target)}, not an object`);
          continue;
        }
        for (const key of keys) {
          try {
            pane.addBinding(target as Record<string, unknown>, key);
          } catch (err) {
            failures.push(`${receiver}.${key} — ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    } finally {
      pane.dispose();
    }
    expect(failures, "field(s) the normalizers left in a state the panel can't bind").toEqual([]);
  });

  it("lets vec() read x/y/z off every object it is handed", () => {
    const config = minimalConfig();
    const failures: string[] = [];
    for (const receiver of new Set(parseVecReceivers())) {
      const target = CONFIG_RECEIVERS[receiver]?.(config);
      // vec() does `if (!(k in rec)) return`, which throws on a null/primitive receiver.
      if (target === null || typeof target !== "object") {
        failures.push(`${receiver} is ${String(target)} — vec() would throw on \`in\``);
        continue;
      }
      const axes = (["x", "y", "z"] as const).filter((k) => k in target);
      if (axes.length < 2) failures.push(`${receiver} has no axes to bind`);
      for (const axis of axes) {
        const v = (target as Record<string, unknown>)[axis];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          failures.push(`${receiver}.${axis} is ${String(v)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
