/**
 * The drivable car's physics, in metres and seconds: a bicycle-model tyre step, walls that stop the
 * car's whole body, and a fixed 1/120 s tick. Comments that explain the model live with each function.
 */
import { CARS, type Car } from "./cars";

/** A point on the ground plane: THREE.Vector3 fits, and so does a plain { x, z }. */
export interface XZ {
  x: number;
  z: number;
}

/** The car's state, mutated in place by carStep. Optional fields start undefined. */
export interface CarState {
  pos: XZ;
  h: number;
  v: number;
  idx: number;
  vl?: number;
  r?: number;
  st?: number;
  acc?: number;
  slip?: number;
  beta?: number;
  ax?: number;
  ay?: number;
  wall?: boolean;
  grass?: boolean;
  wrong?: boolean;
  hit?: number;
}

/** Held keys; steer, when a number, is analog steering in [-1, 1] (tilt) and overrides A/D. */
export interface Keys {
  w?: boolean;
  a?: boolean;
  s?: boolean;
  d?: boolean;
  steer?: number;
  analog?: boolean;
}

/** What carStep needs of a track: centreline, unit tangents, count, wall line, road edge, run-off kinds. */
export interface PhysTrack {
  P: XZ[];
  T: XZ[];
  N: number;
  HW: number;
  road: number;
  runoff?: Uint8Array;
}

/** A wall overshoot: how far past (negative when clear) and the unit normal into that wall. */
export interface WallOut {
  out: number;
  nx: number;
  nz: number;
}

/**
 * One fixed 1/120 s physics tick (see stepFixed) for the drivable car, in metres: the tyres as a
 * bicycle model (tyreStep), then the walls, which stop the car's whole body (bodyOut). Mutates G.
 * Returns the centreline index the car was nearest before the tick.
 */
export function carStep(G: CarState, keys: Keys, dt: number, trk: PhysTrack, car: Car = CARS.gt3): number {
  const { P, T, N, HW } = trk;
  const steer = typeof keys.steer === "number" ? keys.steer : (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  // Throttle, brakes and tyre forces act in the car's own frame: forward v, sideways vl, yaw r.
  tyreStep(G, keys, steer, dt, car);
  const c = Math.cos(G.h), s = Math.sin(G.h);
  const vl = G.vl as number, r = G.r as number;
  // Move by the car's velocity in world space (its right-hand side is -sin, cos of the heading).
  G.pos.x += (c * G.v - s * vl) * dt; G.pos.z += (s * G.v + c * vl) * dt;
  G.h += r * dt;
  // Nearest centreline point, searched near the last one so a hairpin's other leg never wins.
  const prev = G.idx; let bd = Infinity, bi = prev;
  for (let j = -24; j <= 24; j++) {
    const i = (prev + j + N) % N, d = (P[i].x - G.pos.x) ** 2 + (P[i].z - G.pos.z) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  G.idx = bi;
  // Walls: no corner of the car's body passes the wall line. A hit scrubs speed by how square it
  // was and nudges the car back off the wall with a little yaw toward its line (wallHit).
  const nx = -T[bi].z, nz = T[bi].x, lim = HW - 0.03;
  const off = (G.pos.x - P[bi].x) * nx + (G.pos.z - P[bi].z) * nz;
  const along = Math.atan2(T[bi].z, T[bi].x), body = bodyOut(G, trk, car, lim);
  G.wall = body.out > 0;
  if (G.wall) {
    G.pos.x -= body.nx * body.out; G.pos.z -= body.nz * body.out;
    wallHit(G, body, car, dt);
  }
  // Past the road edge but inside the wall is grass or gravel: it drags and grips less (see
  // tyreStep). A corner's tarmac run-off (trk.runoff 2) grips like the road.
  G.grass = Math.abs(off) > trk.road && !(trk.runoff && trk.runoff[bi * 2 + (off > 0 ? 1 : 0)] === 2);
  G.wrong = G.v > 0.3 && Math.cos(G.h - along) < -0.2;
  return prev;
}

/** What the tyres are pressed down with, per unit mass (m/s^2): gravity plus downforce, aero * v^2. */
export function tyreLoad(car: Car, v: number): number {
  return 9.81 + car.aero * v * v;
}

/**
 * Full steering lock (rad) at speed v with the tyres under load: car.limit times the angle a steady
 * corner at the car's grip needs, never more than car.lock.
 */
export function fullLock(car: Car, v: number, load: number): number {
  const a = car.wb * 0.45, b = car.wb - a, mu = car.grip * load;
  return Math.min(car.lock, mu * car.limit * (car.wb / Math.max(v * v, 1) + ((b / car.cf - a / car.cr) * 9.81) / (car.wb * load)));
}

/**
 * The tyres, as a bicycle model per unit mass: front and rear axles each with a cornering stiffness
 * (car.cf, car.cr), saturating at the grip the load allows (tyreLoad).
 * Leaves G.ax and G.ay, the body's own longitudinal and lateral acceleration, for bodyPose.
 */
export function tyreStep(G: CarState, keys: Keys, steer: number, dt: number, car: Car): void {
  G.vl = G.vl || 0; G.r = G.r || 0; G.st = G.st || 0;
  const rate = car.steerRate * dt; G.st += Math.max(-rate, Math.min(rate, steer - G.st));
  const v = G.v, vl0 = G.vl, load = tyreLoad(car, v) * (G.grass ? car.grass : 1), mu = car.grip * load, thr = keys.w ? 1 : 0;
  const trac = car.trac * load, drive = thr * Math.min(trac, car.power / Math.max(Math.abs(v), 1));
  const brake = keys.s ? (v > 0.05 ? Math.min(car.brakeMax, car.brake * load) : car.brakeStopped) : 0;
  G.v += (drive - brake - car.cd * v * Math.abs(v) - (G.grass ? (1 - car.grass) * 0.6 * v : 0)) * dt;
  G.v = Math.min(Math.max(G.v, car.vMin), car.vMax);
  G.ax = (G.v - v) / dt;
  const d = G.st * fullLock(car, v, load);
  if (v < 5) {
    G.r += ((v * Math.tan(d)) / car.wb - G.r) * Math.min(1, dt * 12); G.vl -= G.vl * Math.min(1, dt * 8);
    G.slip = G.beta = 0; G.ay = v * G.r; return;
  }
  // Cornering stiffness (cf, cr at 1 g) grows with the load, downforce included.
  const a = car.wb * 0.45, b = car.wb - a, fMax = (mu * b) / car.wb, use = trac > 0 ? drive / trac : 0, cs = load / 9.81;
  const rMax = ((mu * a * car.rearGrip) / car.wb) * Math.sqrt(1 - 0.25 * use * use);
  const af = d - Math.atan2(G.vl + a * G.r, v), ar = -Math.atan2(G.vl - b * G.r, v);
  const ff = Math.max(-fMax, Math.min(fMax, car.cf * cs * af)), fr = Math.max(-rMax, Math.min(rMax, car.cr * cs * ar));
  G.vl += (ff * Math.cos(d) + fr - v * G.r) * dt;
  G.r += ((a * ff * Math.cos(d) - b * fr) / (a * b)) * dt;
  // A slide can be caught: yaw rate is held near what grip allows, and the car never goes fully
  // sideways, so a lapse on the keys is a moment of opposite lock, not a spin.
  const rCap = (mu * 1.25) / v; if (Math.abs(G.r) > rCap) G.r += (Math.sign(G.r) * rCap - G.r) * Math.min(1, car.assist * dt);
  G.vl = Math.max(-0.45 * v, Math.min(0.45 * v, G.vl));
  G.slip = Math.abs(ar); G.beta = Math.atan2(G.vl, v); G.ay = (G.vl - vl0) / dt + v * G.r;
}

/**
 * How far the car's body pokes past the wall line lim: the worst of its four corners, each
 * measured against its own nearest centreline point.
 */
export function bodyOut(G: CarState, trk: PhysTrack, car: Car, lim: number): WallOut {
  const { P, T, N } = trk, c = Math.cos(G.h), s = Math.sin(G.h), hl = car.len / 2, hw = car.wid / 2, w = { out: -Infinity, nx: 0, nz: 0 };
  for (const [fx, fz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = G.pos.x + c * fx * hl - s * fz * hw, z = G.pos.z + s * fx * hl + c * fz * hw;
    let bd = Infinity, j = G.idx;
    for (let k = -8; k <= 8; k++) { const i = (G.idx + k + N) % N, d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2; if (d < bd) { bd = d; j = i; } }
    const nx = -T[j].z, nz = T[j].x, off = (x - P[j].x) * nx + (z - P[j].z) * nz, e = Math.abs(off) - lim;
    if (e > w.out) { w.out = e; w.nx = nx * Math.sign(off); w.nz = nz * Math.sign(off); }
  }
  return w;
}

/**
 * A wall contact: the velocity into the wall goes (with a small bounce), the rest is scrubbed by
 * how square the hit was, and a little yaw turns the car back toward the wall's line; a square hit
 * stops it. G.hit keeps the hardest impact speed since it was last read (camera shake, HUD).
 */
export function wallHit(G: CarState, w: WallOut, car: Car, dt: number): void {
  const c = Math.cos(G.h), s = Math.sin(G.h), vl = G.vl as number;
  let vx = c * G.v - s * vl, vz = s * G.v + c * vl;
  const vn = vx * w.nx + vz * w.nz, sp = Math.hypot(vx, vz) || 1, hit = Math.max(0, vn) / sp;
  const keep = 1 - Math.min(1, ((0.5 + 6 * hit) * dt) / car.wallGrip) - (vn > 0 ? Math.min(0.85, (0.6 * hit) / car.wallGrip) : 0);
  if (vn > 0) { vx -= 1.08 * vn * w.nx; vz -= 1.08 * vn * w.nz; G.hit = Math.max(G.hit || 0, vn); }
  const tn = vx * w.nx + vz * w.nz; vx = (vx - tn * w.nx) * Math.max(0, keep) + tn * w.nx; vz = (vz - tn * w.nz) * Math.max(0, keep) + tn * w.nz;
  // The heading along the wall that is closer to the car's own.
  let tx = -w.nz, tz = w.nx; if (tx * c + tz * s < 0) { tx = -tx; tz = -tz; }
  const turn = Math.atan2(Math.sin(Math.atan2(tz, tx) - G.h), Math.cos(Math.atan2(tz, tx) - G.h));
  if (vn > 0) G.r = (G.r as number) * 0.3 + Math.max(-0.6, Math.min(0.6, turn)) * (1.5 + 3 * hit) * car.wallGrip;
  else G.r = (G.r as number) + turn * 1.5 * car.wallGrip * dt;
  G.v = vx * c + vz * s; G.vl = -vx * s + vz * c;
}

/** Advances the car by a render frame's dt in fixed 1/120 s ticks; onTick(prev) runs after each. */
export function stepFixed(G: CarState, keys: Keys, frameDt: number, trk: PhysTrack, car: Car, onTick?: (prev: number) => void): void {
  G.acc = (G.acc || 0) + Math.min(frameDt, 0.25);
  while (G.acc >= 1 / 120) { G.acc -= 1 / 120; const prev = carStep(G, keys, 1 / 120, trk, car); if (onTick) onTick(prev); }
}

/**
 * The body on its springs, from the loads the tyres carry (G.ay, G.ax, left by tyreStep): roll and
 * pitch in radians, each settling with the suspension's time constant car.susp. pose is mutated.
 */
export function bodyPose(pose: { roll?: number; pitch?: number }, G: CarState, car: Car, dt: number): void {
  const k = 1 - Math.exp(-dt / car.susp), rad = Math.PI / 180 / 9.81, cap = (x: number | undefined) => Math.max(-60, Math.min(60, x || 0));
  pose.roll = (pose.roll || 0) + (-car.roll * rad * cap(G.ay) - (pose.roll || 0)) * k;
  pose.pitch = (pose.pitch || 0) + (car.pitch * rad * cap(G.ax) - (pose.pitch || 0)) * k;
}

/** How far (0 to 1) the chase camera closes on the car over a frame of dt at speed v. */
export function chaseEase(v: number, dt: number): number {
  return 1 - Math.exp(-dt / (0.17 - 0.09 * Math.min(1, Math.abs(v) / 41.7)));
}
