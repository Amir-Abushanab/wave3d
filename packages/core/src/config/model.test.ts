/**
 * The normalizers are the trust boundary for untrusted config: hand-edited JSON, share links, save
 * states written by an older (or newer) version. Their contract is that whatever comes out is safe
 * to render AND safe to bind a UI control to — so `undefined`, `NaN` and missing nested objects must
 * not survive, and normalizing must never itself throw.
 *
 * Each shape below is one that really did break the studio (see the companion drift audit in
 * apps/studio, which is what keeps this list from going stale as fields are added).
 */
import { describe, expect, it } from "vitest";
import { createDefaultConfig, ensureStudioConfig, type StudioConfig } from "./model";
import { PRESETS } from "../presets";

/** Every leaf the panel could bind must be a value Tweakpane has a controller for. */
function assertBindableLeaves(value: unknown, path = "config"): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertBindableLeaves(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertBindableLeaves(v, `${path}.${k}`);
    return;
  }
  // `undefined` is what Tweakpane rejects with "No matching controller"; NaN/Infinity bind fine but
  // poison the shader, so neither may survive normalization.
  expect(value, `${path} is not bindable`).not.toBe(undefined);
  if (typeof value === "number") {
    expect(Number.isFinite(value), `${path} is ${value}`).toBe(true);
  }
}

/**
 * Normalizing MAY add backfilled fields — presets are deliberately partial — but every field the
 * author did write must come out untouched, all the way down. This is the guard against a "repair"
 * quietly restyling shipped work by clamping or reinterpreting authored values.
 */
function expectAuthoredValuesPreserved(raw: unknown, normalized: unknown, path = "config"): void {
  if (Array.isArray(raw)) {
    expect(normalized, `${path} stopped being an array`).toBeInstanceOf(Array);
    expect((normalized as unknown[]).length, `${path} changed length`).toBe(raw.length);
    raw.forEach((v, i) =>
      expectAuthoredValuesPreserved(v, (normalized as unknown[])[i], `${path}[${i}]`),
    );
    return;
  }
  if (raw !== null && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      expectAuthoredValuesPreserved(v, (normalized as Record<string, unknown>)[k], `${path}.${k}`);
    }
    return;
  }
  expect(normalized, `${path} was rewritten`).toBe(raw);
}

/** Untrusted input, so the tests deliberately pass shapes the type doesn't allow. */
const hostile = (o: unknown): StudioConfig => o as StudioConfig;

describe("ensureStudioConfig repairs configs that used to break the panel", () => {
  it("backfills scene fields the studio binds directly", () => {
    // These four were missing from the normalizers: absent meant `undefined`, which the panel
    // could not build a control for ("No matching controller for 'timeOffset'").
    const c = ensureStudioConfig(hostile({ waves: [{}] }));
    expect(c.timeOffset).toBe(0);
    expect(c.background).toBe("#ffffff");
    expect(c.transparentBackground).toBe(true);
    expect(c.waves[0].twistMotion).toBe(false);
  });

  it("does not throw on a wave with no palette", () => {
    // `{"waves":[{}]}` used to throw "Cannot read properties of undefined (reading 'length')"
    // out of normalizeWaveColour — a crash in the very code meant to make input safe.
    const c = ensureStudioConfig(hostile({ waves: [{}] }));
    expect(c.waves[0].palette.length).toBeGreaterThan(1);
    expect(typeof c.waves[0].palette[0].color).toBe("string");
  });

  it("repairs light elements, not just the lights array", () => {
    const c = ensureStudioConfig(hostile({ waves: [{}], lights: [{}] }));
    expect(c.lights[0].color).toBe("#ffffff");
    expect(c.lights[0].intensity).toBe(1);
    expect(c.lights[0].position).toEqual({ x: 800, y: 900, z: 1100 });
  });

  it("repairs a light with a null position and retyped fields", () => {
    const c = ensureStudioConfig(
      hostile({ waves: [{}], lights: [{ position: null, color: 5, intensity: "x" }] }),
    );
    assertBindableLeaves(c.lights);
  });

  it("drops entries in lights / noiseBands that aren't objects", () => {
    const c = ensureStudioConfig(
      hostile({ waves: [{ noiseBands: [{}, null, 7] }], lights: ["nope", null, {}] }),
    );
    expect(c.lights).toHaveLength(1);
    expect(c.waves[0].noiseBands).toHaveLength(1);
    assertBindableLeaves(c);
  });

  it("replaces NaN and Infinity, which pass a typeof check but poison the shader", () => {
    const c = ensureStudioConfig(
      hostile({ waves: [{ displaceAmount: NaN }], grain: NaN, quality: Infinity }),
    );
    expect(c.grain).toBe(1.1);
    expect(c.quality).toBe(1);
    expect(c.waves[0].displaceAmount).toBe(6.051);
  });

  it("replaces retyped scalars", () => {
    const c = ensureStudioConfig(
      hostile({ waves: [{}], timeOffset: "12", transparentBackground: "yes", background: null }),
    );
    expect(c.timeOffset).toBe(0);
    expect(c.transparentBackground).toBe(true);
    expect(c.background).toBe("#ffffff");
  });

  it("upgrades a legacy string palette to stops", () => {
    const c = ensureStudioConfig(hostile({ waves: [{ palette: ["#ffffff", "#000000"] }] }));
    expect(c.waves[0].palette).toEqual([
      { color: "#ffffff", pos: 0 },
      { color: "#000000", pos: 1 },
    ]);
  });

  it("leaves an out-of-range timeOffset alone", () => {
    // Deliberately NOT clamped to the studio slider's 0..60: a driver stepping a paused scene
    // frame by frame passes any finite phase, and clamping would freeze it.
    expect(ensureStudioConfig(hostile({ waves: [{}], timeOffset: 137.5 })).timeOffset).toBe(137.5);
  });

  it("leaves every leaf of a fully hostile config bindable", () => {
    assertBindableLeaves(
      ensureStudioConfig(
        hostile({
          waves: [{ noiseBands: [{}], meshGradientPoints: null, position: null }],
          lights: [{}],
          cameraPosition: null,
          cameraFit: "sideways",
        }),
      ),
    );
  });

  it("is idempotent", () => {
    const once = ensureStudioConfig(hostile({ waves: [{}], lights: [{}] }));
    const twice = ensureStudioConfig(structuredClone(once));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe("normalizing never rewrites a value the config already declares", () => {
  it.for(Object.keys(PRESETS))("%s", (name) => {
    expectAuthoredValuesPreserved(PRESETS[name](), ensureStudioConfig(PRESETS[name]()), name);
  });

  it("createDefaultConfig", () => {
    expectAuthoredValuesPreserved(createDefaultConfig(), ensureStudioConfig(createDefaultConfig()));
  });
});
