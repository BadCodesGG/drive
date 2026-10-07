/**
 * The phone pad, without its DOM: which keys the
 * held touches mean, the tilt maths, and the controller that tracks fingers, tilt and the steering
 * mode. ui/pad.tsx owns the elements and feeds this their pointer events.
 *
 * Touch: throttle is automatic, hold the left or right half to steer, hold both to brake.
 * Tilt: steer by tilting the phone (zeroed to however it is held), touch anywhere to brake.
 * Both: a visible Brake pedal, held to brake (and steerable with the other thumb), because neither
 * gesture above is discoverable on its own.
 */
import type { Steer } from "./prefs";

/** Where a finger went down: the left or right half of the pad, or the Brake pedal. */
export type Side = "l" | "r" | "b";
/** The pad's keys; steer is analog steering in [-1, 1] (tilt), null to steer with a and d. */
export interface PadKeys {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  steer: number | null;
}

/** What the held touches mean in this steering mode. */
export function padKeys(mode: Steer, touches: Iterable<Side>, tilt: number | null): PadKeys {
  const s = [...touches];
  if (mode === "tilt") {
    const brake = s.length > 0;
    return { w: !brake, a: false, s: brake, d: false, steer: tilt === null ? 0 : tilt };
  }
  const L = s.includes("l"), R = s.includes("r"), brake = (L && R) || s.includes("b");
  return { w: !brake, a: L && !R, s: brake, d: R && !L, steer: null };
}

/** Screen-relative tilt in degrees: gamma in portrait, beta in landscape, signed so right is +. */
export function tiltRaw(e: { beta: number | null; gamma: number | null }, angle: number): number | null {
  if (e.beta === null || e.gamma === null) return null;
  return angle === 90 ? e.beta : angle === -90 || angle === 270 ? -e.beta : e.gamma;
}

/** Steering from a tilt reading against the first one (zero): 3 degrees dead, full lock at 22. */
export function tiltSteer(raw: number, zero: number): number {
  const d = raw - zero, dead = 3, full = 22;
  return Math.abs(d) < dead ? 0 : Math.max(-1, Math.min(1, (d - Math.sign(d) * dead) / (full - dead)));
}

/** What the pad drives: the car's keys, the HUD's message, and the steering mode. */
export interface PadSink {
  keys(k: PadKeys): void;
  say(text: string, secs: number): void;
  /** The mode now in force; save: persist it to hero-steer (only what follows the visitor's own tap). */
  mode(m: Steer, save: boolean): void;
}

/** The browser around the pad (a fake one in tests). */
export interface PadEnv {
  /** The page has a DeviceOrientationEvent at all (without one, Tilt is not offered). */
  hasTilt: boolean;
  /** Listens for deviceorientation; returns the function that stops listening. */
  onTilt(fn: (e: { beta: number | null; gamma: number | null }) => void): () => void;
  /** The screen's orientation angle (0 portrait, 90 or -90/270 landscape). */
  angle(): number;
  now(): number;
  /** Runs fn after ms; returns the function that cancels it. */
  later(fn: () => void, ms: number): () => void;
  /** iOS: motion access is asked for once, and only from a tap. */
  requestPermission?: () => Promise<string>;
}

export interface PadController {
  readonly mode: Steer;
  /** The pad appears (Drive pressed): no fingers down, and tilt picks up where hero-steer left it,
   * except where motion access needs a tap (iOS): there it drives with touch until Tilt is tapped. */
  start(): void;
  /** The pad goes (the drive ends): every finger and the tilt let go. */
  stop(): void;
  /** The visitor's tap on Touch or Tilt, persisted; Tilt falls back to touch without motion access or readings. */
  setMode(next: Steer): Promise<void>;
  down(id: number, side: Side): void;
  move(id: number, side: Exclude<Side, "b">): void;
  up(id: number): void;
}

const RELEASED: PadKeys = { w: false, a: false, s: false, d: false, steer: null };

export function createPad(initial: Steer, sink: PadSink, env: PadEnv): PadController {
  let mode: Steer = env.hasTilt ? initial : "touch";
  const touches = new Map<number, Side>();
  let tilt: number | null = null, zero: number | null = null, seen = -Infinity, live = false;
  let unlisten: (() => void) | null = null, cancelCheck: (() => void) | null = null;
  const sync = () => sink.keys(padKeys(mode, touches.values(), tilt));
  const onTilt = (e: { beta: number | null; gamma: number | null }) => {
    const raw = tiltRaw(e, env.angle());
    if (raw === null) return;
    seen = env.now();
    if (zero === null) zero = raw;
    tilt = tiltSteer(raw, zero);
    sync();
  };
  const stopTilt = () => {
    unlisten?.(); unlisten = null; cancelCheck?.(); cancelCheck = null;
    tilt = null; zero = null;
  };
  // save: this follows the visitor's tap, so the outcome is kept; a mode the pad applies on its own
  // (at start, or falling back from it) never overwrites hero-steer.
  async function apply(next: Steer, save: boolean) {
    if (next === "tilt") {
      try {
        if (!env.hasTilt) throw new Error("no tilt");
        if (save && env.requestPermission && (await env.requestPermission()) !== "granted") throw new Error("refused");
      } catch {
        if (env.hasTilt) sink.say("Tilt needs motion access: using touch", 3);
        next = "touch";
      }
      if (!live) return;
    }
    stopTilt(); mode = next; sync();
    sink.mode(mode, save);
    if (mode !== "tilt") return;
    unlisten = env.onTilt(onTilt);
    const asked = env.now();
    cancelCheck = env.later(() => {
      cancelCheck = null;
      if (live && mode === "tilt" && seen < asked) { sink.say("No tilt readings here: using touch", 3); void apply("touch", save); }
    }, 1200);
    sink.say("Hold the phone how you like: that is straight ahead", 2.5);
  }
  return {
    get mode() { return mode; },
    start() {
      live = true; touches.clear();
      // iOS grants motion access only from a tap, and asking from here would be refused: a saved Tilt
      // waits for the visitor to tap it, and hero-steer keeps it meanwhile.
      if (mode === "tilt" && env.requestPermission) { mode = "touch"; sink.mode(mode, false); }
      if (mode === "tilt") void apply("tilt", false); else sync();
    },
    stop() {
      live = false; touches.clear(); stopTilt();
      sink.keys({ ...RELEASED });
    },
    setMode: (next) => apply(next, true),
    down(id, side) { touches.set(id, side); sync(); },
    // A finger that went down on the pedal stays a brake however it slides.
    move(id, side) { const was = touches.get(id); if (was && was !== "b" && was !== side) { touches.set(id, side); sync(); } },
    up(id) { if (touches.delete(id)) sync(); },
  };
}
