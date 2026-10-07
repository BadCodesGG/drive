import { describe, expect, it } from "vitest";
import { createPad, padKeys, tiltRaw, tiltSteer, type PadEnv, type PadKeys } from "./pad";
import type { Steer } from "./prefs";

/** A pad wired to a recording sink and a fake clock, orientation source and permission prompt. */
function rig(initial: Steer, env: Partial<PadEnv> = {}) {
  const keys: PadKeys[] = [], said: string[] = [], modes: Steer[] = [], saved: Steer[] = [];
  let clock = 0, listener: ((e: { beta: number | null; gamma: number | null }) => void) | null = null;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const fake: PadEnv = {
    hasTilt: true,
    angle: () => 0,
    now: () => clock,
    later: (fn, ms) => { const t = { at: clock + ms, fn, live: true }; timers.push(t); return () => { t.live = false; }; },
    onTilt: (fn) => { listener = fn; return () => { if (listener === fn) listener = null; }; },
    ...env,
  };
  const pad = createPad(initial, { keys: (k) => keys.push(k), say: (t) => said.push(t), mode: (m, save) => { modes.push(m); if (save) saved.push(m); } }, fake);
  return {
    pad, keys, said, modes, saved,
    last: () => keys.at(-1),
    listening: () => listener !== null,
    tilt: (gamma: number) => { clock += 10; listener?.({ beta: 20, gamma }); },
    advance: (ms: number) => { clock += ms; for (const t of timers) if (t.live && t.at <= clock) { t.live = false; t.fn(); } },
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the pad controller", () => {
  it("starting in touch mode throttles at once, and fingers steer and brake", () => {
    const r = rig("touch");
    r.pad.start();
    expect(r.last()).toMatchObject({ w: true, s: false });
    r.pad.down(1, "l");
    expect(r.last()).toMatchObject({ a: true, d: false, w: true });
    r.pad.down(2, "r");
    expect(r.last()).toMatchObject({ a: false, d: false, s: true, w: false });
    r.pad.up(1);
    expect(r.last()).toMatchObject({ d: true, s: false });
    r.pad.up(2);
    expect(r.last()).toMatchObject({ a: false, d: false, s: false, w: true });
  });

  it("a finger that lands on the Brake pedal stays a brake however it slides", () => {
    const r = rig("touch");
    r.pad.start();
    r.pad.down(1, "b");
    r.pad.move(1, "l");
    r.pad.move(1, "r");
    expect(r.last()).toMatchObject({ s: true, w: false, a: false, d: false });
  });

  it("a steering finger that slides across follows the half it is over, and never turns into a brake", () => {
    const r = rig("touch");
    r.pad.start();
    r.pad.down(1, "l");
    r.pad.move(1, "r");
    expect(r.last()).toMatchObject({ a: false, d: true, s: false });
    r.pad.move(7, "l"); // a finger the pad never saw go down is ignored
    expect(r.last()).toMatchObject({ a: false, d: true });
  });

  it("choosing tilt persists it, says how to hold the phone, and steers from the first reading", async () => {
    const r = rig("touch");
    r.pad.start();
    await r.pad.setMode("tilt");
    expect(r.pad.mode).toBe("tilt");
    expect(r.saved).toEqual(["tilt"]);
    expect(r.said.at(-1)).toBe("Hold the phone how you like: that is straight ahead");
    expect(r.last()).toMatchObject({ steer: 0, w: true });
    r.tilt(10); // held like this: straight ahead
    expect(r.last()).toMatchObject({ steer: 0 });
    r.tilt(10 + 3 + 19);
    expect(r.last()?.steer).toBe(1);
    r.tilt(10 - 12.5);
    expect(r.last()?.steer).toBeCloseTo(-0.5, 12);
    r.advance(1500); // readings arrived: no fallback
    expect(r.pad.mode).toBe("tilt");
    r.pad.down(1, "l"); // in tilt, any touch brakes
    expect(r.last()).toMatchObject({ s: true, w: false, a: false });
  });

  it("starting in tilt mode (hero-steer) where no permission is needed listens straight away", async () => {
    const r = rig("tilt");
    r.pad.start();
    await flush();
    expect(r.listening()).toBe(true);
    expect(r.pad.mode).toBe("tilt");
    expect(r.saved).toEqual([]);
  });

  it("a saved Tilt never asks iOS for motion access at start: it drives with touch and keeps hero-steer", async () => {
    let asked = 0;
    const r = rig("tilt", { requestPermission: () => { asked++; return Promise.resolve("granted"); } });
    r.pad.start();
    await flush();
    expect(asked).toBe(0);
    expect(r.pad.mode).toBe("touch");
    expect(r.modes.at(-1)).toBe("touch"); // shown as touch
    expect(r.saved).toEqual([]); // but hero-steer still says tilt
    expect(r.listening()).toBe(false);
    expect(r.last()).toMatchObject({ w: true, steer: null });
    await r.pad.setMode("tilt"); // the visitor's tap asks, and the answer is kept
    expect(asked).toBe(1);
    expect(r.pad.mode).toBe("tilt");
    expect(r.saved).toEqual(["tilt"]);
    expect(r.listening()).toBe(true);
  });

  it("a saved Tilt with no readings at start drives with touch, and leaves hero-steer as it was", async () => {
    const r = rig("tilt");
    r.pad.start();
    await flush();
    r.advance(1201);
    await flush();
    expect(r.said).toContain("No tilt readings here: using touch");
    expect(r.pad.mode).toBe("touch");
    expect(r.modes.at(-1)).toBe("touch");
    expect(r.saved).toEqual([]);
  });

  it("with no tilt readings within 1.2 s, it says so and falls back to touch, persisted", async () => {
    const r = rig("touch");
    r.pad.start();
    await r.pad.setMode("tilt");
    r.advance(1199);
    expect(r.pad.mode).toBe("tilt");
    r.advance(2);
    await flush();
    expect(r.said).toContain("No tilt readings here: using touch");
    expect(r.pad.mode).toBe("touch");
    expect(r.saved).toEqual(["tilt", "touch"]);
    expect(r.listening()).toBe(false);
    expect(r.last()?.steer).toBeNull();
  });

  it("when motion access is refused, it says so and stays on touch", async () => {
    const r = rig("touch", { requestPermission: () => Promise.resolve("denied") });
    r.pad.start();
    await r.pad.setMode("tilt");
    expect(r.said).toContain("Tilt needs motion access: using touch");
    expect(r.pad.mode).toBe("touch");
    expect(r.saved).toEqual(["touch"]);
    expect(r.listening()).toBe(false);
  });

  it("without a tilt sensor, a stored tilt choice drives as touch", async () => {
    const r = rig("tilt", { hasTilt: false });
    r.pad.start();
    await flush();
    expect(r.pad.mode).toBe("touch");
    expect(r.listening()).toBe(false);
    expect(r.last()?.steer).toBeNull();
  });

  it("stopping lets go of every finger, stops listening, and cancels a pending fallback", async () => {
    const r = rig("touch");
    r.pad.start();
    await r.pad.setMode("tilt");
    r.pad.down(1, "b");
    r.pad.stop();
    expect(r.last()).toEqual({ w: false, a: false, s: false, d: false, steer: null });
    expect(r.listening()).toBe(false);
    const said = r.said.length;
    r.advance(5000);
    await flush();
    expect(r.said.length).toBe(said);
  });
});

describe("tilt steering", () => {
  it("reads gamma in portrait, beta in landscape, signed so tilting right is positive", () => {
    expect(tiltRaw({ beta: 30, gamma: 12 }, 0)).toBe(12);
    expect(tiltRaw({ beta: 30, gamma: 12 }, 90)).toBe(30);
    expect(tiltRaw({ beta: 30, gamma: 12 }, 270)).toBe(-30);
    expect(tiltRaw({ beta: 30, gamma: 12 }, -90)).toBe(-30);
  });

  it("an event without readings is no reading", () => {
    expect(tiltRaw({ beta: null, gamma: 12 }, 0)).toBeNull();
    expect(tiltRaw({ beta: 30, gamma: null }, 0)).toBeNull();
  });

  it("steers from however the phone was first held: 3 degrees of dead zone, full lock at 22", () => {
    expect(tiltSteer(12, 10)).toBe(0);
    expect(tiltSteer(12.9, 10)).toBe(0);
    expect(tiltSteer(10 + 3 + 9.5, 10)).toBeCloseTo(0.5, 12);
    expect(tiltSteer(10 - 12.5, 10)).toBeCloseTo(-0.5, 12);
    expect(tiltSteer(10 + 22, 10)).toBe(1);
    expect(tiltSteer(10 + 60, 10)).toBe(1);
    expect(tiltSteer(10 - 60, 10)).toBe(-1);
  });
});

describe("the phone pad's keys", () => {
  it("touch mode, nothing held: throttle is automatic, no steer, no brake", () => {
    expect(padKeys("touch", [], null)).toEqual({ w: true, a: false, s: false, d: false, steer: null });
  });

  it("touch mode: the left half steers left, the right half steers right", () => {
    expect(padKeys("touch", ["l"], null)).toEqual({ w: true, a: true, s: false, d: false, steer: null });
    expect(padKeys("touch", ["r"], null)).toEqual({ w: true, a: false, s: false, d: true, steer: null });
  });

  it("touch mode: both halves brake, with no steer and no throttle", () => {
    expect(padKeys("touch", ["l", "r"], null)).toEqual({ w: false, a: false, s: true, d: false, steer: null });
  });

  it("touch mode: the Brake pedal brakes, and the other thumb still steers", () => {
    expect(padKeys("touch", ["b"], null)).toEqual({ w: false, a: false, s: true, d: false, steer: null });
    expect(padKeys("touch", ["b", "l"], null)).toEqual({ w: false, a: true, s: true, d: false, steer: null });
  });

  it("tilt mode: steering is the tilt (0 before any reading), any touch brakes", () => {
    expect(padKeys("tilt", [], null)).toEqual({ w: true, a: false, s: false, d: false, steer: 0 });
    expect(padKeys("tilt", [], 0.5)).toEqual({ w: true, a: false, s: false, d: false, steer: 0.5 });
    expect(padKeys("tilt", ["l"], -0.25)).toEqual({ w: false, a: false, s: true, d: false, steer: -0.25 });
    expect(padKeys("tilt", ["b"], 0)).toEqual({ w: false, a: false, s: true, d: false, steer: 0 });
  });
});
