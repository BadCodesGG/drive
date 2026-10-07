/**
 * The true-scale drive track and everything measured on it: driveTrack, driveLine, trackCorners,
 * heightAt, surfaceAt, carPose, bumpAt, speedProfile, botKeys, referenceLap, elevSamples.
 */
import * as THREE from "three";
import { CARS, type Car } from "./cars";
import { carStep, fullLock, tyreLoad, type CarState, type Keys, type PhysTrack, type XZ } from "./physics";
import type { Track } from "../data/types";

export interface Corner {
  a: number;
  apex: number;
  b: number;
  turn: number;
  vMin: number;
  drop: number;
}

/** driveTrack's output: see that function's comment for every field. */
export interface DriveTrack extends PhysTrack {
  P: THREE.Vector3[];
  T: THREE.Vector3[];
  E: Float32Array;
  seg: number;
  len: number;
  k: number;
  eased: Uint8Array;
  W: Float32Array;
  inSide: Int8Array;
  off: (i: number, w: number) => number;
  mark: (name: string, end?: boolean) => number;
  cp: number[];
  hw: number;
  S: number[];
  bumpy: boolean;
  i0: number;
  corners: Corner[];
  runoff: Uint8Array;
  kappa: Float32Array;
  L: XZ[];
}

/**
 * Resamples a track's elev (one value per pts index) onto the N arc-length samples of the curve,
 * so E[i] is the height under point i. Linear between control points.
 */
export function elevSamples(curve: THREE.Curve<THREE.Vector3>, elev: number[], N: number): Float32Array {
  const E = new Float32Array(N), M = elev.length;
  for (let i = 0; i < N; i++) {
    // (A distance of 0 is three's "none given": the mapping uses u, as a one-argument call would.)
    const x = curve.getUtoTmapping(i / N, 0) * M, k = Math.floor(x), f = x - k;
    E[i] = elev[k % M] * (1 - f) + elev[(k + 1) % M] * f;
  }
  return E;
}

/**
 * The true-scale drive track, from the circuit's traced line (OpenStreetMap metres in decimetre
 * steps) with no stretching. Heights in metres placed along the lap; HW the wall line, road the road
 * edge past which is grass, S the road's cross-section; mark(name, end) the index where a named place
 * starts or ends; cp the sector lines; L the racing line (driveLine).
 */
export function driveTrack(track: Track): DriveTrack {
  const e = track.line, pts: THREE.Vector3[] = [];
  for (let i = 0, x = 0, z = 0; i < e.length; i += 2) { x += e[i] / 10; z += e[i + 1] / 10; pts.push(new THREE.Vector3(x, 0, z)); }
  const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal", 0.5); curve.arcLengthDivisions = pts.length * 8;
  const HW = track.hw + track.runoff, road = track.hw + 1.2, L0 = curve.getLength(), M = Math.round(L0 / 2.5);
  // Each sample: x, z, its height (height: decimetres at every line point; elev, coarser, if a track
  // has none), and whether easing moved it.
  const el = track.height ? track.height.map((h) => h / 10) : track.elev, K = el.length;
  const hAt = (f: number) => { const x = (((f * K) % K) + K) % K, k = Math.floor(x), u = x - k; return el[k] * (1 - u) + el[(k + 1) % K] * u; };
  let Q: number[][] = curve.getSpacedPoints(M).slice(0, M).map((p, i) => [p.x, p.z, hAt(i / M), 0]);
  const radius = (a: number[], b: number[], c: number[]) => { const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]); return (ab * bc * ca) / (2 * Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) + 1e-9); };
  for (let it = 0; it < 600; it++) {
    const hot = new Uint8Array(M); let any = false;
    for (let i = 0; i < M; i++) if (radius(Q[(i + M - 4) % M], Q[i], Q[(i + 4) % M]) < road + 2) { any = true; for (let j = -8; j <= 8; j++) hot[(i + j + M) % M] = 1; }
    if (!any) break;
    Q = Q.map((q, i) => { if (!hot[i]) return q; const a = Q[(i + M - 1) % M], b = Q[(i + 1) % M]; return [q[0] + 0.5 * ((a[0] + b[0]) / 2 - q[0]), q[1] + 0.5 * ((a[1] + b[1]) / 2 - q[1]), q[2], 1]; });
  }
  // Resample evenly by distance, then tangents from neighbours.
  const cum = [0]; for (let i = 1; i <= M; i++) { const a = Q[i - 1], b = Q[i % M]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const len = cum[M], N = Math.round(len / 2.5), seg = len / N, P: THREE.Vector3[] = [], T: THREE.Vector3[] = [], E = new Float32Array(N), eased = new Uint8Array(N);
  for (let i = 0, j = 0; i < N; i++) {
    const d = i * seg; while (cum[j + 1] < d) j++;
    const f = (d - cum[j]) / (cum[j + 1] - cum[j]), a = Q[j], b = Q[(j + 1) % M];
    P.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * f, 0, a[1] + (b[1] - a[1]) * f)); E[i] = a[2] + (b[2] - a[2]) * f; eased[i] = a[3] | b[3];
  }
  for (let i = 0; i < N; i++) T.push(new THREE.Vector3().subVectors(P[(i + 1) % N], P[(i + N - 1) % N]).normalize());
  // In a hairpin tighter than the wall line the inside run-off stops short of the corner's centre: W is
  // how far it reaches on the inside (inSide) at each point, so the surface never folds over itself.
  const W = new Float32Array(N).fill(HW), inSide = new Int8Array(N), rad = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = T[(i + N - 4) % N], b = T[(i + 4) % N]; rad[i] = (8 * seg) / Math.max(a.angleTo(b), 1e-6); inSide[i] = Math.sign(a.x * b.z - a.z * b.x) || 1; }
  for (let i = 0; i < N; i++) { let m = Infinity, sd = inSide[i]; for (let j = -12; j <= 12; j++) { const r = rad[(i + j + N) % N]; if (r < m) { m = r; sd = inSide[(i + j + N) % N]; } } W[i] = Math.min(HW, Math.max(road + 0.6, m - 2)); inSide[i] = sd; }
  const off = (i: number, w: number) => (w * inSide[i] > 0 && Math.abs(w) > W[i] ? Math.sign(w) * W[i] : w);
  // Cross-section: wall, run-off, kerb edge, road edge on each side, split into strips at most 2.5 m
  // wide (1.2 m on the tarmac) to stay within a couple of centimetres of the elevation in curves.
  const S = [-HW], edges = [-HW, -road, -track.hw, track.hw, road, HW];
  for (let q0 = 1; q0 < edges.length; q0++) { const w = q0 === 3 ? 1.2 : 2.5, n = Math.ceil((edges[q0] - edges[q0 - 1]) / w); for (let q = 1; q <= n; q++) S.push(edges[q0 - 1] + ((edges[q0] - edges[q0 - 1]) * q) / n); }
  const mark = (name: string, end?: boolean) => { const m = track.marks[name]; return Math.round(((((m[end ? 1 : 0] / L0) % 1) + 1) % 1) * N) % N; };
  // k: the built centreline's length over the traced line's own length, so any stretch shows up in it.
  let traced = 0, sx = 0, sz = 0;
  for (let i = 2; i < e.length; i += 2) { traced += Math.hypot(e[i], e[i + 1]) / 10; sx += e[i] / 10; sz += e[i + 1] / 10; }
  traced += Math.hypot(sx, sz);
  const base = { P, T, N, E, seg, len, k: len / traced, eased, W, inSide, off, mark, cp: (track.sectors || []).map((n) => mark(n)), HW, road, hw: track.hw, S, bumpy: !!track.bumpy, i0: N - Math.round(100 / seg) };
  const withCorners = Object.assign(base, trackCorners(base));
  return Object.assign(withCorners, { L: driveLine(withCorners) });
}

/**
 * The racing line a driver takes, for the ghost and the test bot: at every centreline point, the
 * point across the tarmac (never nearer its edge than 1.6 m) that bends the line least, relaxed from
 * every 32nd point down to every point. Returns [{ x, z }].
 */
export function driveLine(trk: { P: XZ[]; T: XZ[]; N: number; hw: number }): XZ[] {
  const { P, T, N } = trk, w = trk.hw - 1.6, n = new Float32Array(N);
  const at = (i: number, o: number): [number, number] => [P[i].x - T[i].z * o, P[i].z + T[i].x * o];
  for (const step of [32, 16, 8, 4, 2, 1]) {
    const M = Math.floor(N / step), ix = Array.from({ length: M }, (_, k) => Math.round((k * N) / M) % N), pt = (k: number) => { const i = ix[(k + M) % M]; return at(i, n[i]); };
    for (let it = 0; it < 300; it++) {
      for (let k = 0; k < M; k++) {
        const i = ix[k], a = pt(k - 1), b = pt(k + 1), c = pt(k - 2), d = pt(k + 2);
        const x = (4 * (a[0] + b[0]) - c[0] - d[0]) / 6, z = (4 * (a[1] + b[1]) - c[1] - d[1]) / 6;
        n[i] = Math.max(-w, Math.min(w, (x - P[i].x) * -T[i].z + (z - P[i].z) * T[i].x));
      }
    }
    // The points between this level's, straight across, for the next level to start from.
    for (let k = 0; k < M; k++) { const i = ix[k], j = ix[(k + 1) % M], len = (j - i + N) % N; for (let q = 1; q < len; q++) n[(i + q) % N] = n[i] + ((n[j] - n[i]) * q) / len; }
  }
  return Array.from(n, (o, i) => { const [x, z] = at(i, o); return { x, z }; });
}

/**
 * The corners of a drive track and what lies beyond their edges, the same for every car: runoff[i * 2 +
 * (right ? 1 : 0)] is 0 grass, 1 gravel, 2 tarmac, from 30 m before a corner to 60 m after it.
 */
export function trackCorners(trk: { T: XZ[]; N: number; seg: number }): { corners: Corner[]; runoff: Uint8Array; kappa: Float32Array } {
  const { T, N, seg } = trk, k = new Float32Array(N), v = new Float32Array(N), corners: Corner[] = [], runoff = new Uint8Array(N * 2);
  for (let i = 0; i < N; i++) { let s = 0; for (let j = -4; j <= 4; j++) { const a = T[(i + j + N - 1) % N], b = T[(i + j + N + 1) % N]; s += Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z) / (2 * seg); } k[i] = s / 9; }
  for (let i = 0; i < N; i++) v[i] = Math.min(80, Math.sqrt(20 / Math.max(Math.abs(k[i]), 1e-5)));
  for (let n = 0; n < 2; n++) for (let i = N - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[(i + 1) % N] ** 2 + 2 * 14 * seg));
  // Start the scan on a straight so no corner is split across the index wrap.
  let i0 = 0; while (Math.abs(k[i0]) > 1 / 300 && i0 < N) i0++;
  for (let q = 0; q < N; q++) {
    const i = (i0 + q) % N; if (Math.abs(k[i]) <= 1 / 300) continue;
    const sg = Math.sign(k[i]); let e = q, turn = 0, apex = i;
    while (e < N && Math.abs(k[(i0 + e) % N]) > 1 / 300 && Math.sign(k[(i0 + e) % N]) === sg) { const j = (i0 + e) % N; turn += k[j] * seg; if (Math.abs(k[j]) > Math.abs(k[apex])) apex = j; e++; }
    if (Math.abs(turn) > 0.21) {
      let vMin = Infinity; for (let j = q; j < e; j++) vMin = Math.min(vMin, v[(i0 + j) % N]);
      corners.push({ a: i, apex, b: (i0 + e - 1) % N, turn: sg, vMin, drop: v[(i + N - Math.round(250 / seg)) % N] - vMin });
    }
    q = e;
  }
  for (const c of corners) {
    const kind = c.drop > 22 || c.vMin > 45 ? 1 : 2, out = c.turn > 0 ? 0 : 1;
    for (let j = c.a - Math.round(30 / seg); j <= c.b + Math.round(60 / seg) + (c.b < c.a ? N : 0); j++) { const x = ((j % N) + N) % N; runoff[x * 2 + out] = Math.max(runoff[x * 2 + out], kind); }
  }
  return { corners, runoff, kappa: k };
}

/** Track height at centreline index idx (fractional allowed, wraps). */
export function heightAt(trk: { E?: Float32Array; N: number }, idx: number): number {
  const { E, N } = trk;
  if (!E) return 0;
  const x = ((idx % N) + N) % N, k = Math.floor(x), f = x - k;
  return E[k] * (1 - f) + E[(k + 1) % N] * f;
}

/**
 * The drive surface's exact height at (x, z) near centreline index i: the same triangles the road
 * mesh is built from (rows at each point across trk.S, split on the same diagonal).
 */
export function surfaceAt(trk: DriveTrack, x: number, z: number, i: number): number {
  const { P, T, N, E, S } = trk;
  for (let k = -3; k <= 3; k++) {
    const j = (i + k + N) % N, j1 = (j + 1) % N;
    if ((x - P[j].x) * T[j].x + (z - P[j].z) * T[j].z < 0 || (x - P[j1].x) * T[j1].x + (z - P[j1].z) * T[j1].z >= 0) continue;
    const at = (r: number, s: number) => { const w = trk.off(r, S[s]); return [P[r].x - T[r].z * w, P[r].z + T[r].x * w, E[r]]; };
    for (let s = 0; s < S.length - 1; s++) {
      const a = at(j, s), b = at(j, s + 1), c = at(j1, s), d = at(j1, s + 1);
      for (const [p, q, r] of [[a, b, c], [b, d, c]]) {
        const den = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
        const u = ((q[1] - r[1]) * (x - r[0]) + (r[0] - q[0]) * (z - r[1])) / den, w = ((r[1] - p[1]) * (x - r[0]) + (p[0] - r[0]) * (z - r[1])) / den;
        if (u >= -1e-6 && w >= -1e-6 && u + w <= 1 + 1e-6) return u * p[2] + w * q[2] + (1 - u - w) * r[2];
      }
    }
  }
  return heightAt(trk, i);
}

export interface WheelContact {
  x: number;
  z: number;
  y: number;
}

/**
 * Where the car sits on the surface: the height under each wheel's contact point (fl, fr, rl, rr),
 * and the ride height, pitch and roll of the plane through them. Never smoothed or lagged.
 */
export function carPose(G: CarState, trk: DriveTrack, car: Car): { wheels: WheelContact[]; y: number; pitch: number; roll: number } {
  const c = Math.cos(G.h), s = Math.sin(G.h), hx = car.wb / 2, hz = car.tw / 2, wheels: WheelContact[] = [];
  for (const [fx, fz] of [[1, -1], [1, 1], [-1, -1], [-1, 1]]) {
    const x = G.pos.x + c * fx * hx - s * fz * hz, z = G.pos.z + s * fx * hx + c * fz * hz;
    wheels.push({ x, z, y: surfaceAt(trk, x, z, G.idx) });
  }
  const [fl, fr, rl, rr] = wheels.map((w) => w.y);
  return { wheels, y: (fl + fr + rl + rr) / 4, pitch: Math.atan((fl + fr - rl - rr) / 2 / car.wb), roll: Math.atan((fr + rr - fl - rl) / 2 / car.tw) };
}

/** A bumpy surface's small lift at index idx, in metres: a function of position, never of time. */
export function bumpAt(trk: { bumpy?: boolean }, idx: number): number {
  if (!trk.bumpy) return 0;
  return 0.02 + 0.012 * Math.sin(idx * 0.9) * Math.sin(idx * 0.23) + 0.008 * Math.sin(idx * 2.7);
}

/**
 * Target speed (m/s) at every centreline point for this car: the corner speed its grip allows on the
 * racing line, worked backwards along its own braking, each with a margin a keyboard driver can hold.
 */
export function speedProfile(trk: { N: number; L?: XZ[]; P: XZ[] }, car: Car): Float32Array {
  const { N } = trk, L = trk.L || trk.P, v = new Float32Array(N), g = car.grip * 9.81 * 0.88, ga = car.grip * car.aero * 0.88;
  // Along the racing line: its curvature over 6 steps, and the length of each step.
  const d = (i: number, j: number): [number, number] => [L[j % N].x - L[i % N].x, L[j % N].z - L[i % N].z], len = (i: number) => Math.hypot(...d(i, i + 1));
  for (let i = 0; i < N; i++) {
    const a = d(i + N - 3, i), b = d(i, i + 3), turn = Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
    const k = turn / (Math.hypot(...a) / 2 + Math.hypot(...b) / 2) - ga; v[i] = k > 0 ? Math.min(car.vMax, Math.sqrt(g / k)) : car.vMax;
  }
  for (let n = 0; n < 2; n++) for (let i = N - 1; i >= 0; i--) { const u = v[(i + 1) % N]; v[i] = Math.min(v[i], Math.sqrt(u * u + 2 * (Math.min(car.brakeMax, car.brake * tyreLoad(car, u)) + car.cd * u * u) * 0.82 * len(i))); }
  return v;
}

/**
 * The bot's keys for this moment, as a keyboard player would press them: pure pursuit onto the
 * racing line plus the car's understeer, tapping A or D until the wheel is there (or, with
 * keys.analog, holding it like tilt steering); W or S hold the speed profile.
 */
export function botKeys(G: CarState, trk: { N: number; seg: number; L?: XZ[]; P: XZ[] }, prof: Float32Array, keys: Keys, car: Car): void {
  const { N, seg } = trk, ld = 8 + 0.35 * Math.abs(G.v), tp = (trk.L || trk.P)[(G.idx + Math.round(ld / seg)) % N];
  const a = Math.atan2(tp.z - G.pos.z, tp.x - G.pos.x) - G.h, err = Math.atan2(Math.sin(a), Math.cos(a));
  const load = tyreLoad(car, G.v), lock = fullLock(car, G.v, load), us = ((0.55 / car.cf - 0.45 / car.cr) * 9.81) / load;
  const kap = (2 * Math.sin(err)) / ld, want = Math.max(-1, Math.min(1, (Math.atan(car.wb * kap) + us * kap * G.v * G.v + 0.25 * (kap * G.v - (G.r || 0))) / lock)), st = G.st || 0;
  if (keys.analog) keys.steer = want; else { keys.d = want > st + 0.04; keys.a = want < st - 0.04; }
  const vt = prof[(G.idx + Math.round(4 / seg)) % N]; keys.w = G.v < vt && (G.slip || 0) < car.slip; keys.s = G.v > vt + 1;
}

/**
 * The ghost's reference lap: the bot driving carStep itself, so it is a time a player can beat.
 * Returns { lap, times } with times[i] = seconds into the lap at centreline index i.
 */
export function referenceLap(trk: DriveTrack, prof: Float32Array, car: Car = CARS.gt3): { lap: number; times: Float32Array } {
  const { P, T, N } = trk, dt = 1 / 120, i0 = trk.i0;
  const G: CarState = { pos: { x: P[i0].x, z: P[i0].z }, h: Math.atan2(T[i0].z, T[i0].x), v: 0, vl: 0, r: 0, idx: i0 };
  const keys: Keys = {}, times = new Float32Array(N).fill(-1);
  let t = 0, timing = false;
  for (let f = 0; f < 120 * 600; f++) {
    botKeys(G, trk, prof, keys, car);
    const prev = carStep(G, keys, dt, trk, car);
    if (prev > N * 0.9 && G.idx < N * 0.1) { if (timing) break; timing = true; t = 0; }
    if (timing) { t += dt; if (times[G.idx] < 0) times[G.idx] = t; }
  }
  // Running max: in a chicane the nearest index can skip ahead a frame and come back.
  let last = 0; for (let i = 0; i < N; i++) { if (times[i] > last) last = times[i]; times[i] = last; }
  return { lap: t, times };
}
