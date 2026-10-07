import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTrackData } from "../../data";
import { TRACK_IDS, type TrackData, type TrackId } from "../../data/types";
import { CAR_IDS } from "../cars";
import { detailedModels } from "../detailed";
import { driveTrack } from "../track";
import { lpGround } from "./ground";
import { lpDriveBuild, type DriveWorld } from "./drive";

const data = Object.fromEntries(await Promise.all(TRACK_IDS.map(async (id) => [id, await loadTrackData(id)]))) as Record<TrackId, TrackData>;

// lpBanner draws its name on a canvas; nothing is drawn here, only the mesh is built.
beforeAll(() => {
  const ctx2d = { fillRect() {}, fillText() {}, measureText: () => ({ width: 0 }), font: "", fillStyle: "", textAlign: "", textBaseline: "" };
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) } });
});

const run = <R,>(gen: Generator<[string, number], R>): { steps: [string, number][]; value: R } => {
  const steps: [string, number][] = [];
  let r = gen.next();
  while (!r.done) { steps.push(r.value); r = gen.next(); }
  return { steps, value: r.value };
};

/** Every object in a world, in traversal order: what it is, where it sits, and what its buffers hold. */
function fingerprint(root: THREE.Object3D): string[] {
  const out: string[] = [];
  const sum = (a: ArrayLike<number>) => { let s = 0, w = 0; for (let i = 0; i < a.length; i++) { s += a[i]; w += a[i] * ((i % 97) + 1); } return `${a.length}:${s}:${w}`; };
  root.traverse((o) => {
    const m = o as THREE.Mesh & THREE.InstancedMesh;
    const parts = [o.type, o.name, o.position.toArray().join(), o.rotation.toArray().slice(0, 3).join(), o.scale.toArray().join(), String(o.visible), String(o.castShadow), String(o.receiveShadow), String(o.renderOrder)];
    if (m.geometry) for (const [k, a] of Object.entries(m.geometry.attributes)) parts.push(`${k}=${sum((a as THREE.BufferAttribute).array)}`);
    if (m.geometry?.index) parts.push(`index=${sum(m.geometry.index.array)}`);
    if (m.isInstancedMesh) parts.push(`count=${m.count}`, `inst=${sum(m.instanceMatrix.array)}`);
    const mat = m.material as THREE.MeshLambertMaterial | undefined;
    if (mat && !Array.isArray(mat)) parts.push(`mat=${mat.type}:${mat.side}:${mat.transparent}:${mat.opacity}:${mat.depthWrite}:${mat.polygonOffset}:${mat.flatShading}`);
    if (o.userData.count !== undefined) parts.push(`userCount=${o.userData.count}`);
    out.push(parts.join("|"));
  });
  return out;
}

// The scenery only asks for models when a swap is fetched; building a world never does.
const never = (): Promise<THREE.BufferGeometry> => Promise.reject(new Error("no model fetched while building"));
const noModels = { tree: never, furniture: never, mountain: never, gantry: never };

const build = (id: TrackId, mobile: boolean, detailed: boolean) => {
  const track = structuredClone(data[id].track), sight = track.mood.fog.far * 12.5;
  return run<DriveWorld>(lpDriveBuild(track, driveTrack(structuredClone(track)), lpGround(structuredClone(data[id].ground), id), mobile, sight, detailed ? { trackId: id, src: noModels } : null));
};
const total = (w: DriveWorld) => Object.values(w.counts).reduce((a, b) => a + b, 0);

const cases: [TrackId, boolean][] = [...TRACK_IDS.map((id): [TrackId, boolean] => [id, false]), ["spa", true]];

describe("the Low poly drive world", () => {
  it.each(cases)("%s (mobile %s): builds in labelled steps into a world of road, scenery, gantry and banner", (id, mobile) => {
    const { steps, value: w } = build(id, mobile, false);
    expect(steps.length).toBeGreaterThan(5);
    for (const [label, f] of steps) {
      expect(label.length).toBeGreaterThan(0);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    expect(w.look).toBe("lowpoly");
    expect(w.counts.gantry).toBe(1);
    expect(w.counts.building).toBeGreaterThan(0);
    expect(w.counts.roadRibbon).toBeGreaterThan(0);
    expect(w.counts.mountainFuji).toBe(id === "fuji" ? 1 : undefined);
    expect(typeof w.banner.userData.text).toBe("string");
    expect(w.group.children.length).toBeGreaterThan(0);
    expect(w.horizon.children.length).toBeGreaterThan(0);
    expect(Number.isFinite(w.lo)).toBe(true);
    // Nothing waits on a model in Low poly.
    expect(w.swaps).toEqual([]);
    expect(w.detailOnly).toEqual([]);
  }, 60_000);

  it.each(TRACK_IDS)("%s: building it twice gives the identical world", (id) => {
    const a = build(id, false, false), b = build(id, false, false);
    expect(b.steps.map(([l]) => l)).toEqual(a.steps.map(([l]) => l));
    expect(b.value.counts).toEqual(a.value.counts);
    expect(fingerprint(b.value.group)).toEqual(fingerprint(a.value.group));
    expect(fingerprint(b.value.horizon)).toEqual(fingerprint(a.value.horizon));
  }, 60_000);

  it("draws no more for a phone than for a desktop", () => {
    expect(total(build("spa", true, false).value)).toBeLessThanOrEqual(total(build("spa", false, false).value));
  }, 60_000);
});

describe("the Detailed drive world, before any model arrives", () => {
  it.each(TRACK_IDS)("%s: stands Low poly pieces in, lists the models waiting to swap in, and adds building detail", (id) => {
    const { value: w } = build(id, false, true);
    expect(w.look).toBe("detailed");
    expect(w.counts.gantry).toBe(1);
    expect(w.swaps.length).toBeGreaterThan(0);
    // Every model it waits on is one the circuit is known to need, and the start gantry is among them.
    const wanted = new Set(CAR_IDS.flatMap((c) => detailedModels(id, c)));
    for (const s of w.swaps) expect(wanted, s.model).toContain(s.model);
    expect(w.swaps.map((s) => s.model)).toContain("gantry");
    expect(w.detailOnly.length).toBeGreaterThan(0);
    for (const m of w.detailOnly) expect(m.name).toBe("buildingDetail");
  }, 60_000);

  it.each(TRACK_IDS)("%s: has the same land and road as Low poly, and builds the identical world twice", (id) => {
    const low = build(id, false, false).value, a = build(id, false, true).value, b = build(id, false, true).value;
    expect(a.counts.roadRibbon).toBe(low.counts.roadRibbon);
    expect(a.counts.building).toBe(low.counts.building);
    expect(fingerprint(b.group)).toEqual(fingerprint(a.group));
    expect(fingerprint(b.horizon)).toEqual(fingerprint(a.horizon));
  }, 60_000);
});
