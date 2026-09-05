/**
 * The tilt source is three fixes on top of a raw `deviceorientation` reading — a neutral baseline,
 * a screen-orientation rotation, and a permission gate — and each one is invisible until it is
 * wrong on a real phone, in a real grip, in a real orientation. Nothing here needs a GPU or a DOM:
 * we drive a fake `window` and a fake sensor, and check the arithmetic and the gate.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TiltConfig } from "../config/model";
import { TiltSource } from "./tilt";

type Listener = (e: unknown) => void;

interface FakeWindow {
  listeners: Map<string, Set<Listener>>;
  angle: number;
  requestPermission?: () => Promise<string>;
}

/** Install a minimal `window` carrying a DeviceOrientationEvent, and return the handle to drive it. */
function installWindow(
  options: { angle?: number; requestPermission?: () => Promise<string> } = {},
) {
  const listeners = new Map<string, Set<Listener>>();
  // The source only probes this for a `requestPermission` and never constructs it, so a plain bag
  // stands in for the constructor — and a FRESH one each install, so the gate can't leak across tests.
  const ctor: Record<string, unknown> = {};
  if (options.requestPermission) ctor.requestPermission = options.requestPermission;
  const fake: FakeWindow = {
    listeners,
    angle: options.angle ?? 0,
    requestPermission: options.requestPermission,
  };
  vi.stubGlobal("window", {
    DeviceOrientationEvent: ctor,
    screen: {
      get orientation() {
        return { angle: fake.angle };
      },
    },
    addEventListener(type: string, fn: Listener) {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
  });
  return fake;
}

/** Deliver one orientation reading to whatever the source attached. */
function emit(fake: FakeWindow, beta: number | null, gamma: number | null): void {
  for (const fn of fake.listeners.get("deviceorientation") ?? []) fn({ beta, gamma });
}

const attached = (fake: FakeWindow): number => fake.listeners.get("deviceorientation")?.size ?? 0;

afterEach(() => vi.unstubAllGlobals());

describe("neutral pose", () => {
  it("centres both axes on the FIRST reading, whatever pose that is", () => {
    // The whole point: a phone held at the usual ~50° must not start pegged at one end.
    const fake = installWindow();
    const t = new TiltSource(() => undefined);
    emit(fake, 50, -13);
    expect(t.x).toBeCloseTo(0.5, 6);
    expect(t.y).toBeCloseTo(0.5, 6);
    expect(t.live).toBe(true);
    expect(t.status).toBe("live");
  });

  it("recenter() re-takes the neutral pose from the next reading", () => {
    const fake = installWindow();
    const t = new TiltSource(() => undefined);
    emit(fake, 50, 0);
    emit(fake, 50, 25); // a full range to the right, with range defaulting to 25°
    expect(t.x).toBeCloseTo(1, 6);
    t.recenter();
    emit(fake, 50, 25); // same pose, now declared to be centre
    expect(t.x).toBeCloseTo(0.5, 6);
  });
});

describe("range mapping", () => {
  it("reads the way a ball rolls: right edge down → x toward 1, bottom edge down → y toward 1", () => {
    const fake = installWindow();
    const t = new TiltSource(() => undefined);
    emit(fake, 40, 0);
    emit(fake, 40, 12.5); // half of the default 25° range
    expect(t.x).toBeCloseTo(0.75, 6);
    emit(fake, 52.5, 0); // beta up 12.5° = the bottom edge dropping
    expect(t.y).toBeCloseTo(0.75, 6);
  });

  it("clamps past the range instead of running away", () => {
    const fake = installWindow();
    const t = new TiltSource(() => undefined);
    emit(fake, 0, 0);
    emit(fake, 0, 400);
    expect(t.x).toBe(1);
    emit(fake, 0, -400);
    expect(t.x).toBe(0);
  });

  it("honours a custom range and the invert flags", () => {
    const fake = installWindow();
    const cfg: TiltConfig = { range: 10, invertX: true, invertY: true };
    const t = new TiltSource(() => cfg);
    emit(fake, 0, 0);
    emit(fake, 5, 10);
    expect(t.x).toBeCloseTo(0, 6); // +full range, inverted
    expect(t.y).toBeCloseTo(0.25, 6); // +half range, inverted
  });

  it("takes the shortest way round the ±180 beta wrap", () => {
    // Without the wrap this reads as a 355° lurch and pegs the axis for a 5° movement.
    const fake = installWindow();
    const t = new TiltSource(() => undefined);
    emit(fake, 178, 0);
    emit(fake, -177, 0); // 5° further over the top, not 355° back
    expect(t.y).toBeCloseTo(0.6, 6);
  });
});

describe("screen orientation", () => {
  it("rotates device axes into screen axes, so tiltX still means 'toward the right edge'", () => {
    const fake = installWindow({ angle: 90 });
    const t = new TiltSource(() => undefined);
    emit(fake, 0, 0);
    // Landscape: the device's beta axis is what now runs across the page.
    emit(fake, 25, 0);
    expect(t.x).toBeCloseTo(1, 6);
    expect(t.y).toBeCloseTo(0.5, 6);
    emit(fake, 0, 25);
    expect(t.y).toBeCloseTo(0, 6);
  });

  it("mirrors both axes upside-down (angle 180)", () => {
    const fake = installWindow({ angle: 180 });
    const t = new TiltSource(() => undefined);
    emit(fake, 0, 0);
    emit(fake, 12.5, 12.5);
    expect(t.x).toBeCloseTo(0.25, 6);
    expect(t.y).toBeCloseTo(0.25, 6);
  });
});

describe("readings that carry no orientation", () => {
  it("ignores null angles rather than latching them as the neutral pose", () => {
    const fake = installWindow();
    const t = new TiltSource(() => undefined);
    emit(fake, null, null);
    expect(t.live).toBe(false);
    expect(t.status).toBe("listening");
    expect(t.x).toBe(0.5);
    emit(fake, 30, 0);
    emit(fake, 30, 25);
    expect(t.x).toBeCloseTo(1, 6); // the real reading, not one measured from a null
  });
});

describe("the permission gate", () => {
  it("attaches immediately where no permission is required", () => {
    const fake = installWindow();
    const t = new TiltSource(() => undefined);
    expect(attached(fake)).toBe(1);
    expect(t.status).toBe("listening");
  });

  it("stays dormant until enable() where one is (iOS)", async () => {
    const fake = installWindow({ requestPermission: () => Promise.resolve("granted") });
    const t = new TiltSource(() => undefined);
    expect(attached(fake)).toBe(0);
    expect(t.status).toBe("prompt");
    await expect(t.enable()).resolves.toBe(true);
    expect(attached(fake)).toBe(1);
  });

  it("latches an explicit refusal", async () => {
    const fake = installWindow({ requestPermission: () => Promise.resolve("denied") });
    const t = new TiltSource(() => undefined);
    await expect(t.enable()).resolves.toBe(false);
    expect(t.status).toBe("denied");
    await expect(t.enable()).resolves.toBe(false);
    expect(attached(fake)).toBe(0);
  });

  it("keeps a THROWN request retryable — iOS throws when the call missed the gesture", async () => {
    let fail = true;
    const fake = installWindow({
      requestPermission: () =>
        fail ? Promise.reject(new Error("not from a gesture")) : Promise.resolve("granted"),
    });
    const t = new TiltSource(() => undefined);
    await expect(t.enable()).resolves.toBe(false);
    expect(t.status).toBe("prompt"); // NOT "denied" — the next tap must still be able to ask
    fail = false;
    await expect(t.enable()).resolves.toBe(true);
    expect(attached(fake)).toBe(1);
  });
});

describe("without a sensor", () => {
  it("reports unsupported and touches nothing", async () => {
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    const t = new TiltSource(() => undefined);
    expect(TiltSource.supported()).toBe(false);
    expect(t.status).toBe("unsupported");
    await expect(t.enable()).resolves.toBe(false);
  });
});

describe("dispose", () => {
  it("removes the listener and returns both axes to rest", () => {
    const fake = installWindow();
    const t = new TiltSource(() => undefined);
    emit(fake, 0, 0);
    emit(fake, 0, 25);
    expect(t.x).toBeCloseTo(1, 6);
    t.dispose();
    expect(attached(fake)).toBe(0);
    expect(t.x).toBe(0.5);
    expect(t.live).toBe(false);
  });
});
