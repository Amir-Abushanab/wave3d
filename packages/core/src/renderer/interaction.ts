// The optional interactivity runtime for the wave renderer: a per-wave pointer field (localized
// cursor effects) + per-wave and scene input→param bindings, driven by ONE shared cursor/scroll.
// It lives in renderer/ so it stays below the shell/studio/index layers (depcruise); it may import
// only `three`, ../config/model, and ../util/math.
//
// Split of responsibility with WaveRenderer: this controller owns ALL input + smoothing (the one
// cursor's position / presence / press / velocity, scroll progress + velocity, the `appear` latch,
// custom inputs, click ripples, and every binding's smoothed 0..1 source value — keyed by binding
// identity so scene + per-wave binding lists all get their own smoothing). The renderer reads
// sample() / bindingValue() once per frame and writes uniforms — the pointer field per wave, and
// bindings via the WAVE_APPLIERS / SCENE_APPLIERS tables. Bindings NEVER mutate `config`.
import * as THREE from "three";
import { clamp01 } from "../util/math";
import type {
  InteractionSource,
  SceneInteractionBinding,
  SceneInteractionTarget,
  StudioConfig,
  WaveConfig,
  WaveInteractionBinding,
  WaveInteractionTarget,
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

type AnyBinding = WaveInteractionBinding | SceneInteractionBinding;

/** Frame-rate-independent exponential smoothing factor for time constant `tau` (seconds). */
function alpha(tau: number, dt: number): number {
  return tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
}

// ---- Binding applier tables -----------------------------------------------------------------

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
interface WaveApplier {
  base(w: WaveConfig): number;
  apply(value: number, a: WaveApplyArgs): void;
}
interface SceneApplier {
  base(c: StudioConfig): number;
  apply(value: number, a: SceneApplyArgs): void;
}

const waveApplier = (
  base: (w: WaveConfig) => number,
  apply: (value: number, a: WaveApplyArgs) => void,
): WaveApplier => ({ base, apply });
const sceneApplier = (
  base: (c: StudioConfig) => number,
  apply: (value: number, a: SceneApplyArgs) => void,
): SceneApplier => ({ base, apply });

/**
 * Per-wave binding targets → (how to read the authored base value, how to write the modulated one).
 * Each base() mirrors the exact fallback refresh() uses, so a binding at rest (from omitted, source
 * 0) writes the same value the renderer already had — no visible jump. This object is the runtime
 * source of truth for {@link WaveInteractionTarget} (enforced by `satisfies`).
 */
export const WAVE_APPLIERS = {
  displaceAmount: waveApplier(
    (w) => w.displaceAmount,
    (v, a) => {
      a.u.uDispAmount.value = v;
    },
  ),
  detailAmount: waveApplier(
    (w) => w.detailAmount ?? 0,
    (v, a) => {
      a.u.uDetailAmount.value = v;
    },
  ),
  twistPowerX: waveApplier(
    (w) => w.twistPower.x,
    (v, a) => {
      a.u.uTwPowX.value = v;
    },
  ),
  twistPowerY: waveApplier(
    (w) => w.twistPower.y,
    (v, a) => {
      a.u.uTwPowY.value = v;
    },
  ),
  twistPowerZ: waveApplier(
    (w) => w.twistPower.z,
    (v, a) => {
      a.u.uTwPowZ.value = v;
    },
  ),
  twistFrequencyX: waveApplier(
    (w) => w.twistFrequency.x,
    (v, a) => {
      a.u.uTwFreqX.value = v;
    },
  ),
  twistFrequencyY: waveApplier(
    (w) => w.twistFrequency.y,
    (v, a) => {
      a.u.uTwFreqY.value = v;
    },
  ),
  twistFrequencyZ: waveApplier(
    (w) => w.twistFrequency.z,
    (v, a) => {
      a.u.uTwFreqZ.value = v;
    },
  ),
  hueShift: waveApplier(
    (w) => w.hueShift,
    (v, a) => {
      a.u.uHueShift.value = v;
    },
  ),
  gradientShift: waveApplier(
    (w) => w.gradientShift ?? 0,
    (v, a) => {
      a.u.uGradShift.value = v;
    },
  ),
  colorSaturation: waveApplier(
    (w) => w.colorSaturation,
    (v, a) => {
      a.u.uSaturation.value = v;
    },
  ),
  opacity: waveApplier(
    (w) => w.opacity,
    (v, a) => {
      a.u.uOpacity.value = v;
    },
  ),
  lineThickness: waveApplier(
    (w) => w.lineThickness ?? 1,
    (v, a) => {
      a.u.uLineThickness.value = v;
    },
  ),
  lineAmount: waveApplier(
    (w) => w.lineAmount ?? 425,
    (v, a) => {
      a.u.uLineAmount.value = v;
    },
  ),
  fiberStrength: waveApplier(
    (w) => w.fiberStrength,
    (v, a) => {
      a.u.uFiberStrength.value = v;
    },
  ),
  sheen: waveApplier(
    (w) => w.sheen ?? 1,
    (v, a) => {
      a.u.uSheen.value = v;
    },
  ),
  iridescence: waveApplier(
    (w) => w.iridescence ?? 0,
    (v, a) => {
      a.u.uIridescence.value = v;
    },
  ),
  positionX: waveApplier(
    (w) => w.position.x,
    (v, a) => {
      a.mesh.position.x = v;
    },
  ),
  positionY: waveApplier(
    (w) => w.position.y,
    (v, a) => {
      a.mesh.position.y = v;
    },
  ),
} satisfies Record<WaveInteractionTarget, WaveApplier>;

/** Scene-level binding targets. base() mirrors updateTime() / applyZoom() / applyPost() fallbacks. */
export const SCENE_APPLIERS = {
  timeOffset: sceneApplier(
    (c) => c.timeOffset ?? 0,
    (v, a) => {
      a.out.timeOffset = v;
    },
  ),
  cameraZoom: sceneApplier(
    (c) => c.cameraZoom ?? 1,
    (v, a) => {
      a.out.zoom = v;
    },
  ),
  blur: sceneApplier(
    (c) => c.blur,
    (v, a) => {
      a.post.uBlurAmount.value = v;
    },
  ),
  grain: sceneApplier(
    (c) => c.grain,
    (v, a) => {
      a.post.uGrainAmount.value = v;
    },
  ),
} satisfies Record<SceneInteractionTarget, SceneApplier>;

// ---- Active-state predicates (keyed off config only, so input never triggers a recompile) ----

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

/** Whether the interaction layer should run at all (any wave interaction, or any scene binding). */
export function interactionActive(cfg: StudioConfig): boolean {
  if (!notDisabled(cfg)) return false;
  if ((cfg.interaction?.bindings?.length ?? 0) > 0) return true;
  return cfg.waves.some((w) => {
    const it = w.interaction;
    return !!it && (!!it.hover || (it.press?.ripple ?? 0) > 0 || (it.bindings?.length ?? 0) > 0);
  });
}

// ---- Sample shape + the controller ----------------------------------------------------------

interface RippleSlot {
  origin: THREE.Vector2; // NDC
  age: number; // seconds since spawn
  amp: number; // 0..1 decay envelope (0 = free slot)
}
interface RippleState extends RippleSlot {
  active: boolean;
}

/** A per-frame snapshot of the pointer-field state. Fields are LIVE references into the controller's
 *  state — read them synchronously each frame; don't retain them. */
export interface InteractionSample {
  /** Smoothed pointer position, NDC (-1..1). */
  ndc: THREE.Vector2;
  /** Smoothed pointer presence 0..1 (→ uPointerActive). */
  presence: number;
  /** Click-ripple ring buffer (amp = shared 0..1 envelope; 0 = free slot). */
  ripples: readonly RippleSlot[];
}

/** A wave's own smoothed pointer-field state — trails the shared cursor at the wave's own rate. */
export interface PointerField {
  /** Smoothed pointer position for this wave, NDC (-1..1). */
  ndc: THREE.Vector2;
  /** Smoothed pointer presence 0..1 for this wave. */
  presence: number;
}

/**
 * Owns the one cursor's input + scroll + press/appear/custom and all smoothing. Constructed by the
 * renderer when {@link interactionActive} first turns true, disposed when it turns false. All
 * listeners are passive and container-scoped (the poster overlay passes events through).
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
  // Per-wave pointer-field state (index-parallel to config.waves); each trails the cursor at its own
  // hover smoothing. Grown/shrunk in update().
  private readonly fields: PointerField[] = [];
  // Per-binding smoothing state, keyed by binding-object identity (covers scene + every wave list).
  private readonly bindingState = new Map<
    AnyBinding,
    { value: number; source: InteractionSource }
  >();
  private readonly out: InteractionSample;

  constructor(
    private readonly container: HTMLElement,
    private readonly cfg: () => StudioConfig | undefined,
  ) {
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
      this.ripples.push({ origin: new THREE.Vector2(), age: 0, amp: 0, active: false });
    }
    this.out = { ndc: this.ndc, presence: 0, ripples: this.ripples };
    const opts = { passive: true } as const;
    container.addEventListener("pointerenter", this.onPointerEnter, opts);
    container.addEventListener("pointermove", this.onPointerMove, opts);
    container.addEventListener("pointerleave", this.onPointerLeave, opts);
    container.addEventListener("pointercancel", this.onPointerCancel, opts);
    container.addEventListener("pointerdown", this.onPointerDown, opts);
    container.addEventListener("pointerup", this.onPointerUp, opts);
  }

  /** Ignore coarse (touch) pointers unless the scene opts in with interaction.touch. */
  private ignore(e: PointerEvent): boolean {
    return e.pointerType === "touch" && this.cfg()?.interaction?.touch !== true;
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
    // Spawn a ripple only if some wave actually wants ripples (else it is wasted state).
    const cfg = this.cfg();
    if (cfg && cfg.waves.some((w) => (w.interaction?.press?.ripple ?? 0) > 0)) this.spawnRipple();
  };
  private onPointerUp = (e: PointerEvent): void => {
    if (this.ignore(e)) return;
    this.pressTarget = 0;
    if (e.pointerType === "touch") {
      this.presenceTarget = 0; // touch has no hover — presence ends with the touch
      this.ndcTarget.set(0, 0);
    }
  };

  /** Spawn a normalized ripple (envelope 0..1) at the click NDC; per-wave amplitude scales it in the
   *  shader. Reuses a free slot or evicts the oldest. */
  private spawnRipple(): void {
    let slot = this.ripples.find((r) => !r.active);
    if (!slot) {
      slot = this.ripples[0];
      for (const r of this.ripples) if (r.age > slot.age) slot = r;
    }
    slot.origin.copy(this.ndcTarget);
    slot.age = 0;
    slot.amp = 1;
    slot.active = true;
  }

  /** Advance all smoothed state by `dt` seconds. Called from the render loop with the same delta. */
  update(dt: number): void {
    const cfg = this.cfg();
    if (!cfg) return;
    const d = Math.max(dt, 0);
    // The SHARED pointer state feeds binding sources (hover / pointerX-Y / pointerSpeed / press) at a
    // fixed baseline; each wave's FIELD trails at its own hover smoothing further below.
    const kPointer = alpha(DEFAULT_POINTER_TAU, d);

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

    // Per-wave pointer FIELD: each wave lags toward the same raw cursor target at its OWN smoothing,
    // so a stack trails the cursor at different rates (a parallax drag).
    const waves = cfg.waves;
    if (this.fields.length > waves.length) this.fields.length = waves.length;
    for (let i = 0; i < waves.length; i++) {
      let f = this.fields[i];
      if (!f) {
        f = { ndc: this.ndcTarget.clone(), presence: this.presenceTarget };
        this.fields[i] = f;
      }
      const k = alpha(waves[i].interaction?.hover?.smoothing ?? DEFAULT_POINTER_TAU, d);
      f.ndc.lerp(this.ndcTarget, k);
      f.presence += (this.presenceTarget - f.presence) * k;
    }

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
      if (!r.active) continue;
      r.age += d;
      const env = Math.max(0, 1 - r.age / RIPPLE_LIFETIME);
      r.amp = env * env;
      if (r.amp <= 0) r.active = false;
    }

    this.updateBindings(cfg, d);
  }

  private updateBindings(cfg: StudioConfig, dt: number): void {
    const seen = new Set<AnyBinding>();
    const visit = (b: AnyBinding): void => {
      seen.add(b);
      const raw = this.rawSource(b.source);
      let st = this.bindingState.get(b);
      // (Re)initialise on first sight or when the slot's source changed (studio edit): `appear`
      // ramps from 0 (entrance), every other source snaps to its current value.
      if (!st || st.source !== b.source) {
        st = { value: b.source === "appear" ? 0 : raw, source: b.source };
        this.bindingState.set(b, st);
      }
      st.value += (raw - st.value) * alpha(b.smoothing ?? DEFAULT_BINDING_TAU, dt);
    };
    for (const b of cfg.interaction?.bindings ?? []) visit(b);
    for (const w of cfg.waves) for (const b of w.interaction?.bindings ?? []) visit(b);
    // Prune state for bindings that no longer exist (edited/removed slots).
    for (const key of this.bindingState.keys()) if (!seen.has(key)) this.bindingState.delete(key);
  }

  /** The current smoothed 0..1 value of a binding's source (0 if the binding is unknown). */
  bindingValue(b: AnyBinding): number {
    return this.bindingState.get(b)?.value ?? 0;
  }

  /** The current raw (un-per-binding-smoothed) 0..1 value of a source signal. */
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

  /** The shared pointer-field state + ripples for the renderer (live references — read synchronously). */
  sample(): InteractionSample {
    this.out.presence = this.presence;
    return this.out;
  }

  /** This wave's smoothed pointer-field state (it trails the cursor at its own hover smoothing), or
   *  null if the wave hasn't been advanced by update() yet (treat as rest). */
  fieldFor(waveIdx: number): PointerField | null {
    return this.fields[waveIdx] ?? null;
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
    for (const f of this.fields) {
      f.ndc.set(0, 0);
      f.presence = 0;
    }
    for (const r of this.ripples) {
      r.age = 0;
      r.amp = 0;
      r.active = false;
    }
    const rawScroll = this.scrollOverride ?? this.computeScroll();
    this.scroll = this.scrollPrev = rawScroll;
    this.scrollVel = 0;
    this.appearLatched = true;
    const cfg = this.cfg();
    if (cfg) {
      this.bindingState.clear();
      const snap = (b: AnyBinding): void => {
        this.bindingState.set(b, { value: this.rawSource(b.source), source: b.source });
      };
      for (const b of cfg.interaction?.bindings ?? []) snap(b);
      for (const w of cfg.waves) for (const b of w.interaction?.bindings ?? []) snap(b);
    }
  }

  /**
   * Snap scroll progress + the scroll-sourced bindings to the current override at once, leaving
   * every other input (pointer / press / appear / velocity / custom) advancing live. Used by the
   * studio scroll preview: the studio page never really scrolls, so dragging the preview slider is a
   * manual scrub that must reflect the instant you move it — not on the next animation frame, which
   * the browser fully suspends whenever the tab isn't foreground. Unlike settle() (which collapses
   * ALL input to rest for a paused still frame), this touches only the scroll signal.
   */
  snapScroll(): void {
    const raw = this.scrollOverride ?? this.computeScroll();
    this.scroll = this.scrollPrev = raw;
    this.scrollVel = 0; // a static scrub has no velocity
    const cfg = this.cfg();
    if (!cfg) return;
    const snap = (b: AnyBinding): void => {
      if (b.source === "scroll" || b.source === "scrollVelocity") {
        this.bindingState.set(b, { value: this.rawSource(b.source), source: b.source });
      }
    };
    for (const b of cfg.interaction?.bindings ?? []) snap(b);
    for (const w of cfg.waves) for (const b of w.interaction?.bindings ?? []) snap(b);
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
    this.bindingState.clear();
  }
}
