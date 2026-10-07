import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { TRACK_IDS } from "../data/types";
import { CAR_IDS } from "./cars";
import { D_FALLBACK, HERO_MODEL_DIR, createModels, dFitCar, dRevert, detailedModels } from "./detailed";
import { LP_CAR_SIZE, lpCar } from "./scenery/car";

// The committed models, read from the directory the game serves them from.
const MODELS = path.join(process.cwd(), "public", ...HERO_MODEL_DIR.split("/").filter(Boolean));
const files = () => fs.readdirSync(MODELS).filter((f) => f.endsWith(".glb")).map((f) => f.replace(/\.glb$/, "")).sort();
const readModel = (name: string) => { const b = fs.readFileSync(path.join(MODELS, `${name}.glb`)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

/** A built geometry is a triangle soup with a normal and a colour for every vertex. */
const expectSoup = (g: THREE.BufferGeometry, what: string) => {
  const pos = g.attributes.position, normal = g.attributes.normal, color = g.attributes.color;
  expect(pos.count, what).toBeGreaterThan(0);
  expect(pos.count % 3, what).toBe(0);
  expect(normal.count, what).toBe(pos.count);
  expect(color.count, what).toBe(pos.count);
  expect(Array.from(pos.array).every(Number.isFinite), what).toBe(true);
};

describe("the Detailed look's models", () => {
  it("the models live under HERO_MODEL_DIR, one constant", () => {
    expect(HERO_MODEL_DIR).toMatch(/^\/[a-z/]+\/$/);
    expect(files()).toHaveLength(16);
  });

  it("serves them from public/hero/models/", () => {
    expect(HERO_MODEL_DIR).toBe("/hero/models/");
    expect(MODELS).toBe(path.join(process.cwd(), "public", "hero", "models"));
  });

  it.each(TRACK_IDS.flatMap((t) => CAR_IDS.map((c) => [t, c] as const)))("%s/%s requests only models that exist, each once, and its own car", (t, c) => {
    const list = detailedModels(t, c);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toContain(c);
    expect(list).toContain("gantry");
    for (const name of list) expect(files(), name).toContain(name);
    expect(list.includes("mountain-fuji")).toBe(t === "fuji");
    // The other car's model is never fetched.
    for (const other of CAR_IDS.filter((x) => x !== c)) expect(list).not.toContain(other);
  });

  it("every committed model is used by some circuit and car", () => {
    const used = new Set(TRACK_IDS.flatMap((t) => CAR_IDS.flatMap((c) => detailedModels(t, c))));
    expect([...used].sort()).toEqual(files());
  });

  it("loads each model once however often it is asked for, and records the order", async () => {
    const asked: string[] = [];
    const m = createModels((name) => { asked.push(name); return Promise.resolve(readModel(name)); });
    await Promise.all([m.load("gt3"), m.load("gt3"), m.tree("tree-fir"), m.furniture("armco"), m.carParts("gt3")]);
    expect(asked).toEqual(["gt3", "tree-fir", "armco"]);
    expect(m.state.requested).toEqual(["gt3", "tree-fir", "armco"]);
  });

  it("builds a triangle soup with normals and vertex colours from every model", async () => {
    const mine = createModels((n) => Promise.resolve(readModel(n)));
    for (const id of CAR_IDS) {
      const parts = await mine.carParts(id);
      expectSoup(parts.body, `${id} body`);
      expectSoup(parts.glass, `${id} glass`);
      expect(Object.keys(parts.wheels).sort()).toEqual(["wheel-fl", "wheel-fr", "wheel-rl", "wheel-rr"]);
      for (const [w, wheel] of Object.entries(parts.wheels)) {
        expect(wheel.r, `${id} ${w} radius`).toBeGreaterThan(0.1);
        expectSoup(wheel.geo, `${id} ${w}`);
      }
    }
    for (const t of ["tree-spruce", "tree-palm", "tree-cedar"]) expectSoup(await mine.tree(t), t);
    for (const f of ["armco", "brake-board", "marshal-post"]) expectSoup(await mine.furniture(f), f);
    expectSoup(await mine.mountain(), "mountain-fuji");
    expectSoup(await mine.gantry(1.37), "gantry");
  });

  it("a fitted car has at least 3x the stand-in's triangles, and a revert puts the stand-in back whole", async () => {
    const mine = createModels((n) => Promise.resolve(readModel(n)));
    const tris = (root: THREE.Object3D) => { let n = 0; root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.visible) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return n; };
    for (const id of CAR_IDS) {
      const mat = new THREE.MeshLambertMaterial(), car = lpCar(id, mat, LP_CAR_SIZE[id]), low = tris(car.root);
      const before = Object.fromEntries(Object.entries(car.wheels).map(([n, w]) => [n, [w.pivot.position.toArray(), w.y, w.r, w.spin.geometry]]));
      dFitCar(car, await mine.carParts(id));
      expect(car.root.userData.look).toBe("detailed");
      expect(tris(car.root)).toBeGreaterThanOrEqual(3 * low);
      dRevert(car.root);
      expect(car.root.userData.look).toBe("lowpoly");
      expect(tris(car.root)).toBe(low);
      expect(Object.fromEntries(Object.entries(car.wheels).map(([n, w]) => [n, [w.pivot.position.toArray(), w.y, w.r, w.spin.geometry]]))).toEqual(before);
    }
  });

  it("a model that fails to load rejects, and says the fallback line", async () => {
    const m = createModels(() => Promise.reject(new Error("aborted")));
    await expect(m.carParts("gt3")).rejects.toThrow();
    expect(D_FALLBACK).toBe("Detailed models did not load: showing Low poly");
  });
});
