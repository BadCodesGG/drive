/**
 * The visitor's saved choices, under localStorage keys and formats that must not change (settings
 * already saved in visitors' browsers depend on them), each validated on read: anything unexpected
 * falls back to the default.
 */
import { isCarId, type CarId } from "./cars";
import { isTrackId, type TrackId } from "../data/types";

export type Look = "lowpoly" | "detailed";
export type View = "chase" | "cockpit";
export type Steer = "touch" | "tilt";

export interface Prefs {
  trackId: TrackId;
  carId: CarId;
  look: Look;
  view: View;
  steer: Steer;
}

export const PREF_KEYS = { trackId: "hero-track", carId: "hero-car", look: "hero-look", view: "hero-camera", steer: "hero-steer" } as const;

/** localStorage can throw (privacy modes, a sandboxed frame); a failed read is simply no value. */
function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readPrefs(): Prefs {
  const t = get(PREF_KEYS.trackId), c = get(PREF_KEYS.carId), l = get(PREF_KEYS.look), v = get(PREF_KEYS.view);
  return {
    trackId: isTrackId(t) ? t : "spa",
    carId: isCarId(c) ? c : "gt3",
    look: l === "lowpoly" || l === "detailed" ? l : "lowpoly",
    view: v === "chase" || v === "cockpit" ? v : "chase",
    steer: get(PREF_KEYS.steer) === "tilt" ? "tilt" : "touch",
  };
}

export function writePref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  try {
    localStorage.setItem(PREF_KEYS[key], value);
  } catch {
    // Not persisted this visit; the choice still applies.
  }
}
