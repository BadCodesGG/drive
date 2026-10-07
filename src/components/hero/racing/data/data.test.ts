import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAR_IDS, CARS } from "../engine/cars";
import { TRACK_IDS, type Ground, type Track } from "./types";

const DATA = __dirname;
const load = (id: string) => JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), "utf8")) as { track: Track; ground: Ground };
const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
// Both height fields are base64 of little-endian int16 values.
const int16Count = (b64: string) => Buffer.from(b64, "base64").length / 2;

describe("track data", () => {
  it("has one file per circuit id, and no other", () => {
    const files = fs.readdirSync(DATA).filter((f) => f.endsWith(".json")).sort();
    expect(files).toEqual(TRACK_IDS.map((id) => `${id}.json`).sort());
  });

  describe.each(TRACK_IDS)("%s.json", (id) => {
    const { track, ground } = load(id);

    it("has the circuit's identity and a length that agrees with its stated distance", () => {
      expect(track.name.length).toBeGreaterThan(0);
      expect(track.len).toBeGreaterThan(1000);
      // A traced OpenStreetMap centreline runs a few percent off the official length (Sebring is 2.7% short).
      expect(Math.abs(track.len - parseFloat(track.km) * 1000) / track.len).toBeLessThan(0.03);
      expect(track.sectors).toHaveLength(2);
      for (const s of track.sectors) expect(Object.keys(track.marks)).toContain(s);
    });

    it("has a finite traced centreline with an elevation per point", () => {
      expect(track.pts.length).toBeGreaterThanOrEqual(3);
      expect(track.pts.every(([x, z]) => finite(x) && finite(z))).toBe(true);
      expect(track.elev).toHaveLength(track.pts.length);
      expect(track.elev.every(finite)).toBe(true);
    });

    it("has a dense drive line with one height per point", () => {
      expect(track.line.length % 2).toBe(0);
      expect(track.line.every(finite)).toBe(true);
      expect(track.height).toHaveLength(track.line.length / 2);
      expect(track.height.every(finite)).toBe(true);
    });

    it("has a road, run-off and pit lane with sensible sizes", () => {
      expect(track.hw).toBeGreaterThan(3);
      expect(track.runoff).toBeGreaterThan(0);
      expect(track.pit.from).toBeLessThan(track.pit.to);
      expect([-1, 1]).toContain(track.pit.side);
    });

    it("has a mood the scene can light from", () => {
      expect(Object.keys(track.mood).sort()).toEqual(["fog", "ground", "hemi", "sky", "sun"]);
      expect(track.mood.fog.near).toBeLessThan(track.mood.fog.far);
    });

    it("places every landmark by type, on a lap fraction or a position", () => {
      expect(track.landmarks.length).toBeGreaterThan(0);
      for (const l of track.landmarks) {
        expect(l.type.length).toBeGreaterThan(0);
        expect(finite(l.at) || Array.isArray(l.pos)).toBe(true);
      }
    });

    it("has height grids whose byte length matches their declared size", () => {
      expect(int16Count(ground.grid.h)).toBe(ground.grid.nx * ground.grid.nz);
      expect(int16Count(ground.far.h)).toBe(ground.far.n);
      expect(ground.grid.cell).toBeGreaterThan(0);
    });

    it("has closed OpenStreetMap outlines with their first point repeated last", () => {
      const polys = [...ground.osm.woods, ...ground.osm.grass, ...ground.osm.water, ...ground.osm.buildings, ...ground.osm.parking];
      expect(polys.length).toBeGreaterThan(0);
      for (const p of polys) {
        expect(p.id.length).toBeGreaterThan(0);
        expect(p.pts.length).toBeGreaterThanOrEqual(3);
        expect(p.pts[0]).toEqual(p.pts[p.pts.length - 1]);
      }
    });

    it("keeps its mapped trees as [x, z, id] triples", () => {
      for (const t of ground.osm.trees) {
        expect(t).toHaveLength(3);
        expect(t.every(finite)).toBe(true);
      }
    });
  });

  it("only Fuji carries the mountain", () => {
    expect(TRACK_IDS.filter((id) => load(id).ground.mount)).toEqual(["fuji"]);
  });
});

describe("cars", () => {
  it("defines every car id with finite, positive dimensions and power", () => {
    expect(Object.keys(CARS).sort()).toEqual([...CAR_IDS].sort());
    for (const id of CAR_IDS) {
      const c = CARS[id];
      for (const k of ["len", "wid", "wb", "tw", "power", "vMax", "grip"] as const) {
        expect(c[k], `${id}.${k}`).toBeGreaterThan(0);
      }
      expect(c.vMin).toBeLessThan(0);
    }
  });

  it("makes the F1 car faster and more powerful than the GT3 car", () => {
    expect(CARS.f1.vMax).toBeGreaterThan(CARS.gt3.vMax);
    expect(CARS.f1.power).toBeGreaterThan(CARS.gt3.power);
  });
});
