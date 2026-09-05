// Device tilt as an interaction input: the phone's own orientation, normalized into the same 0..1
// shape the pointer sources already speak, so `tiltX` / `tiltY` drop into a binding anywhere
// `pointerX` / `pointerY` would. Lives beside interaction.ts in renderer/ and imports only
// ../config/model + ../util/math (depcruise keeps this layer below shell/studio).
//
// Raw `deviceorientation` is unusable as a binding source for three reasons, and this module is
// those three fixes. Everything else — smoothing, per-binding response — belongs to the
// InteractionController, which already owns all input smoothing; this only produces the reading.
//
// 1. NOBODY HOLDS A PHONE FLAT. `beta` rests around 40-60° in a normal grip, not 0, so a raw angle
//    would peg every binding at one end before the user moved at all. The first accepted reading
//    becomes the neutral pose and every later one is a delta from it ("however you were already
//    holding it is centre"); recenter() re-arms that when the user settles into a new grip.
// 2. THE AXES TURN WITH THE SCREEN. `beta` / `gamma` are DEVICE axes, so in landscape they have
//    swapped roles relative to what the reader sees. Each reading is rotated by the screen angle,
//    which is what keeps `tiltX` meaning "toward the right edge of the page" in every orientation.
// 3. iOS DEGRADES SILENTLY. Safari 13+ gates the sensor behind a modal permission dialog that only
//    DeviceOrientationEvent.requestPermission(), called from a user gesture, can open. This source
//    never opens it on its own: on that platform it stays dormant at its rest value and the page
//    renders exactly as it would with no tilt at all. A decorative effect is not worth interrupting
//    a reader with a permission dialog, and a prompt nobody asked for is worse than an effect
//    nobody notices is missing. enable() is the explicit opt-in for a page that has decided the
//    trade is worth it. Everywhere else there is no gate and tilt simply attaches.
import type { TiltConfig } from "../config/model";
import { clamp01 } from "../util/math";

const DEFAULT_RANGE = 25; // degrees away from neutral that reach the 0 / 1 ends
const DEG2RAD = Math.PI / 180;

/** iOS 13+ adds a static `requestPermission` to the constructor; the DOM lib doesn't type it. */
interface PermissionGatedEvent {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
}

/**
 * Where the sensor stands. Nothing here obliges an app to act: tilt that never becomes `live` is a
 * scene that reads 0.5 on both axes, which is the same scene as one that never mentioned tilt.
 * - `unsupported` — no DeviceOrientationEvent at all (desktop browsers).
 * - `prompt` — the platform HAS a sensor but gates it behind a permission dialog (iOS), and this
 *   source will not open one. Tilt stays inert unless the page explicitly calls
 *   {@link TiltSource.enable} from a gesture. Reading this as "show a permission button" is a
 *   choice, not a requirement, and usually the wrong one.
 * - `denied` — the reader refused; asking again in the same page load does nothing.
 * - `listening` — attached, still waiting for the first reading.
 * - `live` — readings are arriving and the sources are moving.
 */
export type TiltStatus = "unsupported" | "prompt" | "denied" | "listening" | "live";

/** Shortest-way-round delta for an angle that wraps at ±180 (`beta`), so passing the wrap point
 *  reads as a small move instead of a 360° jump. `gamma` spans only ±90 and mirrors past vertical,
 *  which the range clamp already absorbs — it is deliberately left alone. */
function wrap180(deg: number): number {
  return deg - 360 * Math.round(deg / 360);
}

/** How far the page is rotated from the device's natural orientation, in degrees. */
function screenAngle(): number {
  const angle = window.screen?.orientation?.angle;
  return typeof angle === "number" ? angle : 0;
}

/**
 * The device-orientation reading behind the `tiltX` / `tiltY` sources: normalized 0..1 with 0.5 at
 * the neutral pose. Constructed by {@link InteractionController} only when the scene carries an
 * `interaction.tilt` block, so a scene without one attaches no listener and touches no sensor.
 */
export class TiltSource {
  /** Normalized 0..1, 0.5 = the neutral pose. Read every frame; the controller smooths them. */
  x = 0.5;
  y = 0.5;

  private baseBeta: number | null = null;
  private baseGamma: number | null = null;
  private attached = false;
  private denied = false;
  private reading = false;

  constructor(private readonly cfg: () => TiltConfig | undefined) {
    // Where no gesture is required (Android/Chrome), tilt behaves like every other input and is
    // simply live; only the gated platforms wait for enable().
    if (TiltSource.supported() && !TiltSource.needsPermission()) this.attach();
  }

  static supported(): boolean {
    return typeof window !== "undefined" && typeof window.DeviceOrientationEvent !== "undefined";
  }

  /** True where the sensor needs {@link enable} called from a user gesture (iOS 13+). */
  static needsPermission(): boolean {
    if (!TiltSource.supported()) return false;
    const ctor = window.DeviceOrientationEvent as unknown as PermissionGatedEvent;
    return typeof ctor.requestPermission === "function";
  }

  get status(): TiltStatus {
    if (!TiltSource.supported()) return "unsupported";
    if (this.denied) return "denied";
    if (!this.attached) return "prompt";
    return this.reading ? "live" : "listening";
  }

  /** True once a real reading has landed — the point from which the values mean anything. */
  get live(): boolean {
    return this.reading;
  }

  /**
   * Start listening, asking the platform's permission first where that is required. MUST be called
   * from inside a user gesture on iOS. Resolves true when the sensor is (or already was) attached.
   *
   * A rejected request is NOT treated as a refusal: iOS throws when the call didn't come from a
   * gesture, and latching that as `denied` would kill a button that is merely wired up wrong.
   * Only an explicit non-"granted" answer sticks.
   *
   * Calling this at all is a decision. On iOS it opens a modal permission dialog, so it belongs to
   * pages where tilt is the point — an interactive piece a reader came to play with — not to a
   * decorative background, which should simply not have tilt on that platform.
   */
  async enable(): Promise<boolean> {
    if (!TiltSource.supported() || this.denied) return false;
    if (this.attached) return true;
    const ctor = window.DeviceOrientationEvent as unknown as PermissionGatedEvent;
    if (typeof ctor.requestPermission === "function") {
      try {
        if ((await ctor.requestPermission()) !== "granted") {
          this.denied = true;
          return false;
        }
      } catch {
        return false; // not from a gesture (or no sensor) — retryable, so leave the status at "prompt"
      }
    }
    this.attach();
    return true;
  }

  /** Take the next reading as the new neutral pose. For when the reader has visibly changed grip —
   *  stood up, put the phone down flat — and the old centre no longer matches how they're holding it. */
  recenter(): void {
    this.baseBeta = null;
    this.baseGamma = null;
  }

  private attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener("deviceorientation", this.onOrientation, { passive: true });
  }

  private readonly onOrientation = (e: DeviceOrientationEvent): void => {
    const { beta, gamma } = e;
    // Some browsers fire the event with null angles before the sensor has a fix (and headless
    // environments fire nulls forever): those carry no orientation, so they are not a reading.
    if (beta === null || gamma === null || !Number.isFinite(beta) || !Number.isFinite(gamma))
      return;
    if (this.baseBeta === null || this.baseGamma === null) {
      this.baseBeta = beta;
      this.baseGamma = gamma;
    }
    const dGamma = gamma - this.baseGamma;
    const dBeta = wrap180(beta - this.baseBeta);

    // Device axes → screen axes. The page is rotated `screenAngle()` from the device, so rotating
    // the tilt vector by MINUS that angle lands it in what the reader is actually looking at.
    const a = -screenAngle() * DEG2RAD;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const sx = dGamma * cos - dBeta * sin;
    const sy = dGamma * sin + dBeta * cos;

    const cfg = this.cfg();
    const range = Math.max(cfg?.range ?? DEFAULT_RANGE, 1);
    const nx = clamp01(0.5 + sx / (2 * range));
    const ny = clamp01(0.5 + sy / (2 * range));
    this.x = cfg?.invertX ? 1 - nx : nx;
    this.y = cfg?.invertY ? 1 - ny : ny;
    this.reading = true;
  };

  dispose(): void {
    if (this.attached) window.removeEventListener("deviceorientation", this.onOrientation);
    this.attached = false;
    this.reading = false;
    this.x = 0.5;
    this.y = 0.5;
  }
}
