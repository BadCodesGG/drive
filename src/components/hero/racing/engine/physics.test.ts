import { describe, expect, it } from "vitest";
import fuji from "../data/fuji.json";
import sebring from "../data/sebring.json";
import spa from "../data/spa.json";
import { TRACK_IDS, type Track, type TrackId } from "../data/types";
import { CARS, CAR_IDS } from "./cars";
import { carStep, stepFixed, type CarState, type Keys } from "./physics";
import { driveTrack, referenceLap, speedProfile, type DriveTrack } from "./track";

const tracks: Record<TrackId, Track> = { spa: spa.track as unknown as Track, sebring: sebring.track as unknown as Track, fuji: fuji.track as unknown as Track };

const built = new Map<TrackId, DriveTrack>();
const trackFor = (id: TrackId) => {
  if (!built.has(id)) built.set(id, driveTrack(structuredClone(tracks[id])));
  return built.get(id)!;
};
const fresh = (trk: DriveTrack, v = 0, dh = 0): CarState => {
  const i = trk.i0;
  return { pos: { x: trk.P[i].x, z: trk.P[i].z }, h: Math.atan2(trk.T[i].z, trk.T[i].x) + dh, v, vl: 0, r: 0, idx: i };
};
// Mixed keys, digital and analog, that run the car off the road and into the walls.
const script = (f: number): Keys => {
  const k: Keys = { w: f % 400 < 300, s: f % 400 >= 340, d: f % 170 < 60, a: f % 230 > 180 };
  if (f % 1500 > 1200) k.steer = Math.sin(f / 37);
  return k;
};
const FIELDS = ["h", "v", "vl", "r", "st", "idx", "acc", "slip", "beta", "ax", "ay"] as const;

describe("the drive track", () => {
  it.each(TRACK_IDS)("%s: is a closed, true-scale loop with a height and a run-off flag per sample", (id) => {
    const trk = trackFor(id);
    expect(trk.N).toBe(trk.P.length);
    expect(trk.len).toBeGreaterThan(4000);
    expect(trk.len).toBeLessThan(8000);
    expect(trk.i0).toBeGreaterThanOrEqual(0);
    expect(trk.i0).toBeLessThan(trk.N);
    expect(trk.E).toHaveLength(trk.N);
    expect(Array.from(trk.E).every(Number.isFinite)).toBe(true);
    // One flag per side per sample.
    expect(trk.runoff).toHaveLength(trk.N * 2);
    expect(trk.L).toHaveLength(trk.N);
    for (const t of trk.T.slice(0, 50)) expect(Math.hypot(t.x, t.z)).toBeCloseTo(1, 6);
    // The last sample sits one step from the first: the loop closes.
    expect(Math.hypot(trk.P[0].x - trk.P[trk.N - 1].x, trk.P[0].z - trk.P[trk.N - 1].z)).toBeLessThan(trk.seg * 2);
  });
});

describe("the car", () => {
  for (const id of TRACK_IDS)
    for (const carId of CAR_IDS)
      it(`${id} ${carId}: 60 s of scripted input stays finite, within the car's speed range, and reaches the walls`, () => {
        const trk = trackFor(id), car = CARS[carId];
        const run = () => {
          const G = fresh(trk, 20);
          let ticks = 0, walls = 0;
          for (let f = 0; f < 60 * 60; f++) {
            const dt = f % 3 ? 1 / 60 : 1 / 47;
            stepFixed(G, script(f), dt, trk, car, () => {
              ticks++;
              if (G.wall) walls++;
              expect(G.v).toBeLessThanOrEqual(car.vMax);
              expect(G.v).toBeGreaterThanOrEqual(car.vMin);
            });
          }
          return { G, ticks, walls };
        };
        const a = run();
        expect(a.ticks).toBeGreaterThanOrEqual(60 * 120 - 1);
        expect(a.walls).toBeGreaterThan(0); // the script really reaches the walls, so the clamp is exercised
        expect(Number.isFinite(a.G.pos.x) && Number.isFinite(a.G.pos.z)).toBe(true);
        for (const k of FIELDS) {
          const v = a.G[k];
          if (typeof v === "number") expect(Number.isFinite(v), k).toBe(true);
        }
        // Fixed-step physics is deterministic: the same input gives the same car, bit for bit.
        const b = run();
        expect(b.G).toEqual(a.G);
        expect(b.walls).toBe(a.walls);
      });

  it("accelerates from rest on the throttle, and brakes to a stop", () => {
    const trk = trackFor("spa");
    for (const carId of CAR_IDS) {
      const car = CARS[carId], G = fresh(trk, 0);
      for (let f = 0; f < 120 * 4; f++) carStep(G, { w: true }, 1 / 120, trk, car);
      expect(G.v).toBeGreaterThan(10);
      for (let f = 0; f < 120 * 30 && G.v > 0.01; f++) carStep(G, { s: true }, 1 / 120, trk, car);
      expect(G.v).toBeLessThan(0.5);
    }
  });

  for (const id of TRACK_IDS)
    describe(`${id}: referenceLap`, () => {
      const laps = {} as Record<(typeof CAR_IDS)[number], ReturnType<typeof referenceLap>>;
      for (const carId of CAR_IDS)
        it(`${carId}: finishes in a real lap time with times that never run backwards`, () => {
          const trk = trackFor(id), car = CARS[carId];
          const lap = (laps[carId] = referenceLap(trk, speedProfile(trk, car), car));
          // Never faster than holding top speed all the way round, and well inside the 10 minute cap.
          expect(lap.lap).toBeGreaterThan(trk.len / car.vMax);
          expect(lap.lap).toBeLessThan(400);
          expect(lap.times).toHaveLength(trk.N);
          for (let i = 1; i < trk.N; i++) expect(lap.times[i]).toBeGreaterThanOrEqual(lap.times[i - 1]);
          expect(lap.times[trk.N - 1]).toBeLessThanOrEqual(lap.lap);
        }, 30_000);

      it("the F1 car laps faster than the GT3 car", () => {
        const trk = trackFor(id);
        const gt3 = laps.gt3 ?? referenceLap(trk, speedProfile(trk, CARS.gt3), CARS.gt3);
        const f1 = laps.f1 ?? referenceLap(trk, speedProfile(trk, CARS.f1), CARS.f1);
        expect(f1.lap).toBeLessThan(gt3.lap);
      }, 60_000);
    });
});

describe("walls", () => {
  // How far the body's worst corner is past the wall line.
  const penetration = (G: CarState, trk: DriveTrack, car = CARS.gt3) => {
    const { P: Pt, T, N, HW } = trk, c = Math.cos(G.h), s = Math.sin(G.h);
    let worst = -Infinity;
    for (const [fx, fz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = G.pos.x + (c * fx * car.len) / 2 - (s * fz * car.wid) / 2, z = G.pos.z + (s * fx * car.len) / 2 + (c * fz * car.wid) / 2;
      let bd = Infinity, j = G.idx;
      for (let k = -20; k <= 20; k++) { const i = (G.idx + k + N) % N, d = (Pt[i].x - x) ** 2 + (Pt[i].z - z) ** 2; if (d < bd) { bd = d; j = i; } }
      worst = Math.max(worst, Math.abs((x - Pt[j].x) * -T[j].z + (z - Pt[j].z) * T[j].x) - HW);
    }
    return worst;
  };
  it.each(TRACK_IDS)("%s: a hands-off car launched at the wall is held for 60 s", (id) => {
    const trk = trackFor(id);
    for (const dh of [0.45, -0.45]) {
      const G = fresh(trk, 60, dh);
      let worst = -Infinity, hits = 0;
      for (let f = 0; f < 120 * 60; f++) {
        carStep(G, {}, 1 / 120, trk);
        if (G.wall) hits++;
        worst = Math.max(worst, penetration(G, trk));
      }
      expect(hits).toBeGreaterThan(0);
      expect(worst).toBeLessThanOrEqual(0.02);
    }
  });
});
