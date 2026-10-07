import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTrackData } from "../../data";
import { TRACK_IDS, type Track, type TrackData, type TrackId } from "../../data/types";
import { CAR_IDS } from "../cars";
import { detailedModels } from "../detailed";
import { elevSamples } from "../track";
import { lpGround } from "./ground";
import { lpWorld } from "./world";

const data = Object.fromEntries(await Promise.all(TRACK_IDS.map(async (id) => [id, await loadTrackData(id)]))) as Record<TrackId, TrackData>;

beforeAll(() => {
  const ctx2d = { fillRect() {}, fillText() {}, measureText: () => ({ width: 0 }), font: "", fillStyle: "", textAlign: "", textBaseline: "" };
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) } });
});

/** The miniature's centreline and curvature profile, as the idle scene derives them. */
function miniTrack(track: Track) {
  const curve = new THREE.CatmullRomCurve3(track.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, "centripetal", 0.5);
  const N = 1200, Pts = curve.getSpacedPoints(N), T: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) T.push(curve.getTangentAt(i / N));
  const miniV = (1.3 * curve.getLength()) / (Number(track.km) * 1000), E = Float32Array.from(elevSamples(curve, track.elev, N), (e) => e * miniV);
  const curv = new Float32Array(N), load = new Float32Array(N);
  for (let i = 0; i < N; i++) curv[i] = T[i].angleTo(T[(i + 6) % N]);
  for (let i = 0; i < N; i++) { let s = 0; for (let j = -40; j <= 40; j++) s = Math.max(s, curv[(i + j + N) % N] * (1 - Math.abs(j) / 60)); load[i] = s; }
  return { trk: { P: Pts, T, N, HW: 0.13, E }, load, peak: Math.max(...load) };
}

function fingerprint(root: THREE.Object3D): string[] {
  const out: string[] = [];
  const sum = (a: ArrayLike<number>) => { let s = 0, w = 0; for (let i = 0; i < a.length; i++) { s += a[i]; w += a[i] * ((i % 97) + 1); } return `${a.length}:${s}:${w}`; };
  root.traverse((o) => {
    const m = o as THREE.Mesh & THREE.InstancedMesh, parts = [o.type, o.name, o.position.toArray().join(), o.rotation.toArray().slice(0, 3).join(), o.scale.toArray().join()];
    if (m.geometry) for (const [k, a] of Object.entries(m.geometry.attributes)) parts.push(`${k}=${sum((a as THREE.BufferAttribute).array)}`);
    if (m.isInstancedMesh) parts.push(`count=${m.count}`, `inst=${sum(m.instanceMatrix.array)}`, `col=${m.instanceColor ? sum(m.instanceColor.array) : "-"}`);
    const mat = m.material as THREE.MeshLambertMaterial | undefined;
    if (mat && !Array.isArray(mat)) parts.push(`mat=${mat.type}:${mat.flatShading}`);
    out.push(parts.join("|"));
  });
  return out;
}

// The scenery only asks for models when a swap is fetched; building a world never does.
const never = (): Promise<THREE.BufferGeometry> => Promise.reject(new Error("no model fetched while building"));
const noModels = { tree: never, furniture: never, mountain: never, gantry: never };

const build = (id: TrackId, look: "lowpoly" | "detailed") => {
  const track = structuredClone(data[id].track), { trk, load, peak } = miniTrack(track);
  return lpWorld(track, lpGround(structuredClone(data[id].ground), id), trk, load, peak, false, look === "detailed" ? { trackId: id, src: noModels } : null);
};

describe("the miniature's world", () => {
  it.each(TRACK_IDS)("%s: Low poly has the gantry and its banner, ground to stand on, and no models waiting", (id) => {
    const w = build(id, "lowpoly");
    expect(w.counts.gantry).toBe(1);
    expect(w.group.children.length).toBeGreaterThan(0);
    expect(typeof w.banner.userData.text).toBe("string");
    expect(Number.isFinite(w.groundAt(0, 0))).toBe(true);
    expect(w.swaps).toEqual([]);
  }, 60_000);

  it.each(TRACK_IDS)("%s: Detailed lists the models waiting to swap in, all ones this circuit needs", (id) => {
    const w = build(id, "detailed");
    expect(w.counts.gantry).toBe(1);
    expect(w.swaps.length).toBeGreaterThan(0);
    const wanted = new Set(CAR_IDS.flatMap((c) => detailedModels(id, c)));
    for (const s of w.swaps) expect(wanted, s.model).toContain(s.model);
    expect(w.swaps.map((s) => s.model)).toContain("gantry");
  }, 60_000);

  it.each(TRACK_IDS.flatMap((id) => [[id, "lowpoly"], [id, "detailed"]] as [TrackId, "lowpoly" | "detailed"][]))("%s %s: building it twice gives the identical world", (id, look) => {
    const a = build(id, look), b = build(id, look);
    expect(b.counts).toEqual(a.counts);
    expect(fingerprint(b.group)).toEqual(fingerprint(a.group));
    expect(b.swaps.map((s) => s.model)).toEqual(a.swaps.map((s) => s.model));
  }, 60_000);
});
