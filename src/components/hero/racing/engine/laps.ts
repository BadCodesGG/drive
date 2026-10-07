/**
 * Lap timing, sector splits and stored best laps. Best laps are stored under a versioned key
 * (hero-best-lap-v3:<track>:<car>) that must not be renamed or reformatted: laps already saved in
 * visitors' browsers depend on it.
 */
import type { CarId } from "./cars";
import type { TrackId } from "../data/types";

/** Seconds as the HUD writes a lap: m:ss.sss. */
export const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;

export const bestKey = (trackId: TrackId, carId: CarId) => `hero-best-lap-v3:${trackId}:${carId}`;

/**
 * A stored best is only trusted if it is a real lap: a positive time and finite splits. Anything else
 * (hand-edited, truncated) falls back to the ghost, or no lap could ever beat it again.
 */
export function parseBest(raw: string | null): { lap: number; times: number[] } | null {
  try {
    const s: unknown = JSON.parse(raw || "null");
    if (!s || typeof s !== "object") return null;
    const { lap, times } = s as { lap?: unknown; times?: unknown };
    if (typeof lap === "number" && Number.isFinite(lap) && lap > 0 && Array.isArray(times) && times.every(Number.isFinite)) return { lap, times: times as number[] };
  } catch {
    // Not JSON: no best.
  }
  return null;
}

/** The lap the ghost drives: the reference lap, or the visitor's own best (mine). */
export interface Best {
  lap: number;
  times: Float32Array;
  mine: boolean;
}

/** The timing half of the car's state: a lap under way, its split times so far, the ghost's index. */
export interface LapState {
  timing: boolean;
  lapT: number;
  cp1: boolean;
  cp2: boolean;
  cur: Float32Array;
  gi: number;
  last: number | null;
}

export interface Split {
  k: number;
  hud: string;
  tone: "good" | "bad";
  status: string;
}

export interface LapEvents {
  /** A HUD message for secs seconds (tone colours it), spoken as voice (the text itself if none). */
  say: (text: string, secs: number, tone?: "" | "good" | "bad", voice?: string) => void;
  split: (s: Split) => void;
  newBest: (lap: number, times: Float32Array) => void;
}

export const newLapState = (N: number): LapState => ({ timing: false, lapT: 0, cp1: false, cp2: false, cur: new Float32Array(N), gi: 0, last: null });

export function resetLap(G: LapState): void {
  G.lapT = 0; G.gi = 0; G.cur.fill(-1); G.cp1 = G.cp2 = false;
}

/** A split at a sector line: the time so far and the gap to the ghost there, coloured. */
function split(G: LapState, k: number, bi: number, best: Best, ev: LapEvents) {
  const t = G.lapT, d = t - best.times[bi], good = d <= 0, gap = Math.abs(d).toFixed(2);
  const hud = `S${k} ${fmt(t)} ${good ? "-" : "+"}${gap}`, tone = good ? "good" : "bad";
  const status = `Sector ${k}: ${fmt(t)}, ${gap} seconds ${good ? "faster" : "slower"} than the ghost`;
  ev.say(hud, 2, tone, status);
  ev.split({ k, hud, tone, status });
}

/**
 * Lap timing, run after every physics tick (prev: the centreline index before it, bi: after): an out
 * lap, then timing starts at the line, and both sector lines (trk.cp) must be crossed for a lap to
 * count. A lap faster than best is handed to newBest with its split times; the caller stores it.
 */
export function lapTick(G: LapState, prev: number, bi: number, trk: { N: number; cp: number[] }, best: Best, ev: LapEvents): void {
  const N2 = trk.N, crossed = prev > N2 * 0.9 && bi < N2 * 0.1;
  if (crossed && !G.timing) { G.timing = true; resetLap(G); ev.say("Timing", 1.2); }
  else if (crossed && G.cp1 && G.cp2) {
    const lap = G.lapT, d = lap - best.lap; G.last = lap;
    if (lap < best.lap) {
      let lastT = 0; const times = new Float32Array(N2);
      for (let i = 0; i < N2; i++) { if (G.cur[i] > lastT) lastT = G.cur[i]; times[i] = lastT; }
      ev.newBest(lap, times);
      ev.say(`New best ${fmt(lap)} (${d.toFixed(3)}): the ghost is you now`, 3, "good");
    } else ev.say(`Lap ${fmt(lap)} (+${d.toFixed(3)})`, 3, "bad");
    resetLap(G);
  } else if (crossed) { resetLap(G); ev.say("Lap not counted: a sector was missed", 2.5); }
  if (G.timing) {
    G.lapT += 1 / 120;
    // Sector lines at the named places the track data gives (trk.cp), each a band 15% of a lap deep.
    const [c1, c2] = trk.cp, past = (c: number) => (bi - c + N2) % N2 < N2 * 0.15;
    if (!G.cp1 && past(c1)) { G.cp1 = true; split(G, 1, bi, best, ev); }
    if (G.cp1 && !G.cp2 && past(c2)) { G.cp2 = true; split(G, 2, bi, best, ev); }
    if (G.cur[bi] < 0) G.cur[bi] = G.lapT;
    while (G.gi < N2 - 1 && best.times[G.gi + 1] <= G.lapT) G.gi++;
  }
}
