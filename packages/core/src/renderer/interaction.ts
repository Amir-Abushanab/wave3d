// The optional interactivity runtime for the wave renderer: a pointer field (localized cursor
// effects) + input→param bindings. It lives in renderer/ so it stays below the shell/studio/index
// layers (depcruise); it may import only `three`, ../config/model, and ../util/math.
//
// Split of responsibility with WaveRenderer: this controller owns ALL input + smoothing (pointer
// position / presence / press / velocity, scroll progress + velocity, the `appear` latch, custom
// inputs, click ripples, and each binding's smoothed 0..1 source value). The renderer reads
// sample() once per frame and writes uniforms — the pointer field directly, and bindings via the
// BINDING_TARGETS applier table below. Bindings NEVER mutate `config` (guardrail): each base value
// is read live from config, so any refresh() restores the authored look and removing a binding
// needs no undo step.
import * as THREE from "three";
import { clamp01 } from "../util/math";
import type {
  InteractionConfig,
  InteractionSource,
  InteractionTarget,
  StudioConfig,
  WaveConfig,
} from "../config/model";

/** Click-ripple ring-buffer size. MUST match the `[4]` array sizes in shaders.ts (POINTER_RIPPLES). */
export const RIPPLE_SLOTS = 4;
const RIPPLE_LIFETIME = 2.5; // seconds a ripple lives before its slot frees
const VELOCITY_TAU = 0.08; // pointer-velocity smoothing time constant (seconds)
const POINTER_SPEED_REF = 4.0; // NDC/s that normalizes pointerSpeed to 1.0
const SCROLL_VELOCITY_REF = 2.0; // progress/s that normalizes scrollVelocity to 1.0
const SCROLL_VELOCITY_TAU = 0.15; // scroll-velocity smoothing (seconds)
const DEFAULT_POINTER_TAU = 0.12; // pointer-follow smoothing default (seconds)
const DEFAULT_BINDING_TAU = 0.25; // per-binding source smoothing default (seconds)

/** Frame-rate-independent exponential smoothing factor for time constant `tau` (seconds). */
function alpha(tau: number, dt: number): number {
  return tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
}

// ---- Binding applier table ------------------------------------------------------------------

/** What a wave-scoped applier writes into: one wave's uniforms + its mesh transform. */
export interface WaveApplyArgs {
  u: Record<string, THREE.IUniform>;
  mesh: THREE.Object3D;
}
/** What a scene-scoped applier writes into: the post-pass uniforms + a small out-param the renderer
 *  seeds (0 / 1) each frame and reads back (the interaction time-offset + zoom multiplier). */
export interface SceneApplyArgs {
  post: Record<string, THREE.IUniform>;
  out: { timeOffset: number; zoom: number };
}
type WaveApplier = {
  scope: "wave";
  base(w: WaveConfig): number;
  apply(value: number, a: WaveApplyArgs): void;
};
type SceneApplier = {
  scope: "scene";
  base(c: StudioConfig): number;
  apply(value: number, a: SceneApplyArgs): void;
};
export type BindingApplier = WaveApplier | SceneApplier;

const waveTarget = (
  base: (w: WaveConfig) => number,
  apply: (value: number, a: WaveApplyArgs) => void,
): WaveApplier => ({ scope: "wave", base, apply });
const sceneTarget = (
  base: (c: StudioConfig) => number,
  apply: (value: number, a: SceneApplyArgs) => void,
): SceneApplier => ({ scope: "scene", base, apply });

/**
 * The curated map from a binding target to (its scope, how to read the authored base value, how to
 * write the modulated value). Each base() mirrors the exact fallback refresh() / applyPost() /
 * applyZoom() / updateTime() use, so a binding at rest (from omitted, source 0) writes the same
 * value the renderer already had — no visible jump. This object is the runtime source of truth for
 * the {@link InteractionTarget} union (enforced by `satisfies` below): add a target here and the
 * const list in model.ts must match, or this stops compiling.
 */
export const BINDING_TARGETS = {
  displaceAmount: waveTarget(
    (w) => w.displaceAmount,
    (v, a) => {
      a.u.uDispAmount.value = v;
    },
  ),
  detailAmount: waveTarget(
    (w) => w.detailAmount ?? 0,
    (v, a) => {
      a.u.uDetailAmount.value = v;
    },
  ),
  twistPowerX: waveTarget(
    (w) => w.twistPower.x,
    (v, a) => {
      a.u.uTwPowX.value = v;
    },
  ),
  twistPowerY: waveTarget(
    (w) => w.twistPower.y,
    (v, a) => {
      a.u.uTwPowY.value = v;
    },
  ),
  twistPowerZ: waveTarget(
    (w) => w.twistPower.z,
    (v, a) => {
      a.u.uTwPowZ.value = v;
    },
  ),
  twistFrequencyX: waveTarget(
    (w) => w.twistFrequency.x,
    (v, a) => {
      a.u.uTwFreqX.value = v;
    },
  ),
  twistFrequencyY: waveTarget(
    (w) => w.twistFrequency.y,
    (v, a) => {
      a.u.uTwFreqY.value = v;
    },
  ),
  twistFrequencyZ: waveTarget(
    (w) => w.twistFrequency.z,
    (v, a) => {
      a.u.uTwFreqZ.value = v;
    },
  ),
  hueShift: waveTarget(
    (w) => w.hueShift,
    (v, a) => {
      a.u.uHueShift.value = v;
    },
  ),
  gradientShift: waveTarget(
    (w) => w.gradientShift ?? 0,
    (v, a) => {
      a.u.uGradShift.value = v;
    },
  ),
  colorSaturation: waveTarget(
    (w) => w.colorSaturation,
    (v, a) => {
      a.u.uSaturation.value = v;
    },
  ),
  opacity: waveTarget(
    (w) => w.opacity,
    (v, a) => {
      a.u.uOpacity.value = v;
    },
  ),
  lineThickness: waveTarget(
    (w) => w.lineThickness ?? 1,
    (v, a) => {
      a.u.uLineThickness.value = v;
    },
  ),
  lineAmount: waveTarget(
    (w) => w.lineAmount ?? 425,
    (v, a) => {
      a.u.uLineAmount.value = v;
    },
  ),
  fiberStrength: waveTarget(
    (w) => w.fiberStrength,
    (v, a) => {
      a.u.uFiberStrength.value = v;
    },
  ),
  sheen: waveTarget(
    (w) => w.sheen ?? 1,
    (v, a) => {
      a.u.uSheen.value = v;
    },
  ),
  iridescence: waveTarget(
    (w) => w.iridescence ?? 0,
    (v, a) => {
      a.u.uIridescence.value = v;
    },
  ),
  positionX: waveTarget(
    (w) => w.position.x,
    (v, a) => {
      a.mesh.position.x = v;
    },
  ),
  positionY: waveTarget(
    (w) => w.position.y,
    (v, a) => {
      a.mesh.position.y = v;
    },
  ),
  timeOffset: sceneTarget(
    (c) => c.timeOffset ?? 0,
    (v, a) => {
      a.out.timeOffset = v;
    },
  ),
  cameraZoom: sceneTarget(
    (c) => c.cameraZoom ?? 1,
    (v, a) => {
      a.out.zoom = v;
    },
  ),
  blur: sceneTarget(
    (c) => c.blur,
    (v, a) => {
      a.post.uBlurAmount.value = v;
    },
  ),
  grain: sceneTarget(
    (c) => c.grain,
    (v, a) => {
      a.post.uGrainAmount.value = v;
    },
  ),
} satisfies Record<InteractionTarget, BindingApplier>;

// ---- Active-state predicates (keyed off config only, so input never triggers a recompile) ----

/** True when the interaction layer should run at all (pointer field on, OR any bindings present). */
export function interactionActive(cfg: StudioConfig): boolean {
  const it = cfg.interaction;
  if (!it || it.enabled === false) return false;
  const pointerOn = !!it.pointer && it.pointer.enabled !== false;
  const hasBindings = Array.isArray(it.bindings) && it.bindings.length > 0;
  return pointerOn || hasBindings;
}

/** True when the pointer FIELD is active → the POINTER_FX shader path compiles (bindings alone don't
 *  need it: they drive existing uniforms directly). */
export function pointerFxActive(cfg: StudioConfig): boolean {
  const it = cfg.interaction;
  if (!it || it.enabled === false) return false;
  return !!it.pointer && it.pointer.enabled !== false;
}

/** True when click ripples are active → the nested POINTER_RIPPLES loop compiles. */
export function ripplesActive(cfg: StudioConfig): boolean {
  return pointerFxActive(cfg) && (cfg.interaction?.pointer?.ripple ?? 0) > 0;
}

// ---- Sample shape + the controller ----------------------------------------------------------

interface RippleSlot {
  origin: THREE.Vector2; // NDC
  age: number; // seconds since spawn
  amp: number; // envelope × strength (0 = free slot)
}
interface RippleState extends RippleSlot {
  strength: number; // amplitude at spawn (envelope multiplies this)
}

/** A per-frame snapshot the renderer reads to drive uniforms. Fields are LIVE references into the
 *  controller's state — read them synchronously each frame; don't retain them. */
export interface InteractionSample {
  /** Smoothed pointer position, NDC (-1..1). */
  ndc: THREE.Vector2;
  /** Smoothed pointer velocity, NDC units/s (the renderer maps this to world space for swoosh). */
  velNdc: THREE.Vector2;
  /** Smoothed pointer presence 0..1 (× per-wave influence → uPointerActive). */
  presence: number;
  /** Click-ripple ring buffer (amp 0 = free slot). */
  ripples: readonly RippleSlot[];
  /** Smoothed 0..1 source value per active binding, index-parallel to config.interaction.bindings. */
  bindingValues: readonly number[];
}

/**
 * Owns pointer/scroll/press/appear/custom input and all smoothing. Constructed by the renderer when
 * {@link interactionActive} first turns true, disposed when it turns false. All listeners are passive
 * and container-scoped (the poster overlay passes events through).
 */
export class InteractionController {
  /** Studio-only scroll preview: when non-null, overrides the computed scroll progress. */
  scrollOverride: number | null = null;

  private readonly ndc = new THREE.Vector2();
  private readonly ndcTarget = new THREE.Vector2();
  private readonly ndcPrev = new THREE.Vector2();
  private readonly velNdc = new THREE.Vector2();
  private presence = 0;
  private presenceTarget = 0;
  private press = 0;
  private pressTarget = 0;
  private pointerSpeed = 0;
  private scroll = 0;
  private scrollPrev = 0;
  private scrollVel = 0;
  private appearLatched = false;
  private readonly customInputs = new Map<string, number>();
  private readonly ripples: RippleState[] = [];
  // Per-binding smoothing state, index-parallel to config.interaction.bindings.
  private readonly bindingValues: number[] = [];
  private readonly bindingInit: boolean[] = [];
  private readonly bindingSource: (InteractionSource | undefined)[] = [];
  private readonly out: InteractionSample;

  constructor(
    private readonly container: HTMLElement,
    private readonly cfg: () => InteractionConfig | undefined,
  ) {
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
      this.ripples.push({ origin: new THREE.Vector2(), age: 0, amp: 0, strength: 0 });
    }
    this.out = {
      ndc: this.ndc,
      velNdc: this.velNdc,
      presence: 0,
      ripples: this.ripples,
      bindingValues: this.bindingValues,
    };
    const opts = { passive: true } as const;
    container.addEventListener("pointerenter", this.onPointerEnter, opts);
    container.addEventListener("pointermove", this.onPointerMove, opts);
    container.addEventListener("pointerleave", this.onPointerLeave, opts);
    container.addEventListener("pointercancel", this.onPointerCancel, opts);
    container.addEventListener("pointerdown", this.onPointerDown, opts);
    container.addEventListener("pointerup", this.onPointerUp, opts);
  }

  /** Ignore coarse (touch) pointers unless the config opts in with pointer.touch. */
  private ignore(e: PointerEvent): boolean {
    return e.pointerType === "touch" && this.cfg()?.pointer?.touch !== true;
  }

  private setNdcTarget(e: PointerEvent): void {
    const rect = this.container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.ndcTarget.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    );
  }

  private onPointerEnter = (e: PointerEvent): void => {
    if (this.ignore(e)) return;
    this.presenceTarget = 1;
    this.setNdcTarget(e);
  };
  private onPointerMove = (e: PointerEvent): void => {
    if (this.ignore(e)) return;
    if (e.pointerType === "touch" && this.pressTarget < 0.5) return; // touch: only track while down
    this.presenceTarget = 1;
    this.setNdcTarget(e);
  };
  private onPointerLeave = (e: PointerEvent): void => {
    if (this.ignore(e)) return;
    this.presenceTarget = 0;
    this.ndcTarget.set(0, 0); // relax toward centre → pointerX/Y rest at 0.5
  };
  private onPointerCancel = (e: PointerEvent): void => {
    if (this.ignore(e)) return;
    this.pressTarget = 0;
    this.presenceTarget = 0;
    this.ndcTarget.set(0, 0);
  };
  private onPointerDown = (e: PointerEvent): void => {
    if (this.ignore(e)) return;
    this.pressTarget = 1;
    this.presenceTarget = 1;
    this.setNdcTarget(e);
    const ripple = this.cfg()?.pointer?.ripple ?? 0;
    if (ripple > 0) this.spawnRipple(ripple);
  };
  private onPointerUp = (e: PointerEvent): void => {
    if (this.ignore(e)) return;
    this.pressTarget = 0;
    if (e.pointerType === "touch") {
      this.presenceTarget = 0; // touch has no hover — presence ends with the touch
      this.ndcTarget.set(0, 0);
    }
  };

  /** Spawn a ripple at the click NDC, reusing a free slot or evicting the oldest. */
  private spawnRipple(strength: number): void {
    let slot = this.ripples.find((r) => r.amp <= 0);
    if (!slot) {
      slot = this.ripples[0];
      for (const r of this.ripples) if (r.age > slot.age) slot = r;
    }
    slot.origin.copy(this.ndcTarget);
    slot.age = 0;
    slot.strength = strength;
    slot.amp = strength; // envelope at age 0 = 1
  }

  /** Advance all smoothed state by `dt` seconds. Called from the render loop with the same delta. */
  update(dt: number): void {
    const cfg = this.cfg();
    if (!cfg) return;
    const d = Math.max(dt, 0);
    const kPointer = alpha(cfg.pointer?.smoothing ?? DEFAULT_POINTER_TAU, d);

    // Pointer position + presence + press.
    this.ndcPrev.copy(this.ndc);
    this.ndc.lerp(this.ndcTarget, kPointer);
    this.presence += (this.presenceTarget - this.presence) * kPointer;
    this.press += (this.pressTarget - this.press) * kPointer;

    // Velocity (own tau) from the smoothed-position delta.
    if (d > 1e-5) {
      const kv = alpha(VELOCITY_TAU, d);
      this.velNdc.x += ((this.ndc.x - this.ndcPrev.x) / d - this.velNdc.x) * kv;
      this.velNdc.y += ((this.ndc.y - this.ndcPrev.y) / d - this.velNdc.y) * kv;
    }
    this.pointerSpeed = this.presence * clamp01(this.velNdc.length() / POINTER_SPEED_REF);

    // Scroll progress + velocity.
    const rawScroll = this.scrollOverride ?? this.computeScroll();
    if (d > 1e-5) {
      const sv = Math.abs(rawScroll - this.scrollPrev) / d;
      this.scrollVel += (sv - this.scrollVel) * alpha(SCROLL_VELOCITY_TAU, d);
    }
    this.scrollPrev = rawScroll;
    this.scroll = rawScroll;

    // Appear latch: the render loop is visibility-gated, so the first update() IS first-visible.
    this.appearLatched = true;

    // Ripples: age + quadratic-decay envelope.
    for (const r of this.ripples) {
      if (r.amp <= 0 && r.strength <= 0) continue;
      r.age += d;
      const env = Math.max(0, 1 - r.age / RIPPLE_LIFETIME);
      r.amp = r.strength * env * env;
      if (r.amp <= 0) r.strength = 0;
    }

    this.updateBindings(cfg, d);
  }

  private updateBindings(cfg: InteractionConfig, dt: number): void {
    const bindings = cfg.bindings ?? [];
    if (this.bindingValues.length > bindings.length) {
      this.bindingValues.length = bindings.length;
      this.bindingInit.length = bindings.length;
      this.bindingSource.length = bindings.length;
    }
    for (let i = 0; i < bindings.length; i++) {
      const b = bindings[i];
      const raw = this.rawSource(b.source);
      // (Re)initialise on first sight or when the slot's source changes (studio dropdown edit):
      // `appear` ramps from 0 (entrance), every other source snaps to its current value.
      if (!this.bindingInit[i] || this.bindingSource[i] !== b.source) {
        this.bindingValues[i] = b.source === "appear" ? 0 : raw;
        this.bindingInit[i] = true;
        this.bindingSource[i] = b.source;
      }
      this.bindingValues[i] +=
        (raw - this.bindingValues[i]) * alpha(b.smoothing ?? DEFAULT_BINDING_TAU, dt);
    }
  }

  /** The current raw (unsmoothed by the per-binding tau) 0..1 value of a source signal. */
  private rawSource(source: InteractionSource): number {
    switch (source) {
      case "scroll":
        return this.scroll;
      case "hover":
        return this.presence;
      case "pointerX":
        return (this.ndc.x + 1) * 0.5;
      case "pointerY":
        return (this.ndc.y + 1) * 0.5;
      case "pointerSpeed":
        return this.pointerSpeed;
      case "press":
        return this.press;
      case "scrollVelocity":
        return clamp01(this.scrollVel / SCROLL_VELOCITY_REF);
      case "appear":
        return this.appearLatched ? 1 : 0;
      default:
        // custom:<name> — fed by setInput(name, value).
        return this.customInputs.get(source.slice("custom:".length)) ?? 0;
    }
  }

  /** Container progress through the viewport: 0 as it enters from below, 1 once scrolled past. */
  private computeScroll(): number {
    const rect = this.container.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;
    return clamp01((vh - rect.top) / (vh + rect.height));
  }

  /** A frame's worth of state for the renderer (live references — read synchronously). */
  sample(): InteractionSample {
    this.out.presence = this.presence;
    return this.out;
  }

  /** Feed a `custom:<name>` input (developer API; staged/forwarded by the shell). */
  setInput(name: string, value: number): void {
    if (typeof name !== "string" || !Number.isFinite(value)) return;
    this.customInputs.set(name, value);
  }

  /**
   * Collapse to the settled resting state for the single frame drawn when the loop stops (paused /
   * reduced-motion / offscreen): presence / velocity / press / pointerSpeed → 0, ripples cleared,
   * scroll → its current raw value, pointer → centre, and `appear` → 1 (reduced-motion users must
   * see the FINAL entered state). Custom inputs KEEP their last explicit values. Each binding snaps
   * to its settled source so the one settled frame shows the final look.
   */
  settle(): void {
    this.presence = this.presenceTarget = 0;
    this.press = this.pressTarget = 0;
    this.pointerSpeed = 0;
    this.velNdc.set(0, 0);
    this.ndc.set(0, 0);
    this.ndcTarget.set(0, 0);
    this.ndcPrev.set(0, 0);
    for (const r of this.ripples) {
      r.age = 0;
      r.amp = 0;
      r.strength = 0;
    }
    const rawScroll = this.scrollOverride ?? this.computeScroll();
    this.scroll = this.scrollPrev = rawScroll;
    this.scrollVel = 0;
    this.appearLatched = true;
    const cfg = this.cfg();
    const bindings = cfg?.bindings ?? [];
    this.bindingValues.length = bindings.length;
    this.bindingInit.length = bindings.length;
    this.bindingSource.length = bindings.length;
    for (let i = 0; i < bindings.length; i++) {
      this.bindingValues[i] = this.rawSource(bindings[i].source);
      this.bindingInit[i] = true;
      this.bindingSource[i] = bindings[i].source;
    }
  }

  dispose(): void {
    const c = this.container;
    c.removeEventListener("pointerenter", this.onPointerEnter);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerleave", this.onPointerLeave);
    c.removeEventListener("pointercancel", this.onPointerCancel);
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointerup", this.onPointerUp);
    this.customInputs.clear();
  }
}
