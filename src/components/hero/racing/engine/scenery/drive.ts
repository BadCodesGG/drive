/**
 * The true-scale drive world (metres), built only when someone presses Drive: lpDrivePlan (where
 * everything goes), lpDriveBuild, lpBuildingDetail, lpHorizon, lpSmoke and lpSkids, in both looks.
 */
import * as THREE from "three";
import type { Track } from "../../data/types";
import { DETAILED, detailedTree, dFit, type Detail, type Swap } from "../detailed";
import type { Look } from "../prefs";
import type { Corner, DriveTrack } from "../track";
import { lpLineIndex, lpPolyIndex, type IndexedPoly, type LpGround } from "./ground";
import { LOWPOLY, lpBox, lpMerge, lpPart, lpRand, lpSmooth, type LpPart } from "./lowpoly";
import { lpBanner } from "./sky";

/** Real sizes for the landmark models: x along the track, y up, z toward it (metres per model unit). */
export const LP_REAL: Record<string, [number, number, number]> = { pineForest: [62, 62, 62], palm: [44, 44, 44], liveOak: [72, 60, 72], cherryTree: [30, 30, 30], marshalPost: [1, 1, 1], broadleaf: [70, 70, 70], cedar: [68, 68, 68], slashPine: [70, 70, 70] };

type Step = [label: string, fraction: number];
type XZ2 = [number, number];

export interface PlanTree { type: string; x: number; z: number; rot: number; s: number; src: string }
export interface PlanBuilding { id: string; kind: string | undefined; stand: boolean; q: XZ2[]; base: number; tops: number[]; h: number }
export interface PlanRibbon { id: string; w: number; pts: XZ2[] }

/** lpDrivePlan's result: see that function's comment for every field. */
export interface DrivePlan {
  near: (x: number, z: number) => [number, number];
  groundAt: (x: number, z: number) => number;
  landH: Float32Array;
  landK: Uint8Array;
  landY: (x: number, z: number) => number;
  mx: number; mz: number; C: number; x0: number; z0: number; x1: number; z1: number; lo: number;
  blocked: (x: number, z: number, r: number) => string | null;
  inPit: (j: number) => boolean;
  pitSide: number; pit0: number; pitLen: number;
  trees: PlanTree[];
  canopy: Uint8Array;
  canopyOf: Map<number, IndexedPoly>;
  cn: number; cz: number; cell: number;
  buildings: PlanBuilding[];
  ribbons: PlanRibbon[];
  water: ReturnType<typeof lpPolyIndex>;
  level: Map<IndexedPoly, number>;
  parking: ReturnType<typeof lpPolyIndex>;
  aero: ReturnType<typeof lpPolyIndex>;
}

/**
 * Where everything around the drive road goes, from the real ground, as plain data that
 * lpDriveBuild turns into meshes: a generator yielding [label, fraction 0..1] between chunks,
 * returning the plan. near(x, z) is [distance, index] of the nearest centreline sample within 120 m;
 * groundAt the survey grid eased within HW + 30 m of the road down to its edge; landH (mx by mz nodes,
 * C apart) the land mesh's heights and landY the height of its own triangles; landK each node's ground
 * cover (0 open, 1 water, 2 airport concrete, 3 parking, 4 forest floor, 5 scrub, 6 meadow, 7 grass,
 * 8 farmland); blocked(x, z, r) why nothing may stand within r of (x, z), or null; trees and canopy;
 * buildings; ribbons (public roads). sight: how far the drive world can be seen (its fog's far).
 */
export function* lpDrivePlan(track: Track, trk: DriveTrack, ground: LpGround, mobile: boolean, sight = Infinity): Generator<Step, DrivePlan, void> {
  const { P, T, N, E, HW, seg } = trk, osm = ground.osm, id = ground.id, mod = (i: number) => ((i % N) + N) % N;
  // The nearest centreline sample, from 40 m buckets: exact within 120 m.
  const NB = 40, nb = new Map<number, number[]>(), nkey = (i: number, j: number) => (i + 5000) * 10000 + j + 5000;
  for (let i = 0; i < N; i++) { const k = nkey(Math.floor(P[i].x / NB), Math.floor(P[i].z / NB)); if (!nb.has(k)) nb.set(k, []); (nb.get(k) as number[]).push(i); }
  const near = (x: number, z: number): [number, number] => {
    let bd = 14400, bi = -1; const ci = Math.floor(x / NB), cj = Math.floor(z / NB);
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) { const l = nb.get(nkey(ci + a, cj + b)); if (l) for (const i of l) { const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } } }
    return bi < 0 ? [Infinity, -1] : [Math.sqrt(bd), bi];
  };
  // Any distance, coarsely (every other sample): for what lies further out than near() looks.
  const nearAny = (x: number, z: number): [number, number] => { let bd = Infinity, bi = 0; for (let i = 0; i < N; i += 2) { const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } } return [Math.sqrt(bd), bi]; };
  // The pit lane: the stretch of the pit straight the OSM pit lane runs beside, on its side.
  const pitSide = track.pit.side, ps = track.marks["Pit straight"], pitLen = Math.round((Math.min(track.pit.to, ps[1]) - Math.max(track.pit.from, ps[0])) / seg);
  const pit0 = mod(Math.round(Math.max(track.pit.from, ps[0]) / seg)), inPit = (j: number) => mod(j - pit0) < pitLen;
  const pitward = (x: number, z: number, i: number) => ((x - P[i].x) * -T[i].z + (z - P[i].z) * T[i].x) * pitSide > 0;
  // The map, indexed. A tank mapped as a single point counts as a 12 m square around it.
  const tanks = osm.tanks.map((t) => (t.pts.length >= 4 ? t : { ...t, pts: [[-6, -6], [6, -6], [6, 6], [-6, 6], [-6, -6]].map(([a, b]): XZ2 => [t.pts[0][0] + a, t.pts[0][1] + b]) }));
  const woods = lpPolyIndex(osm.woods), scrub = lpPolyIndex(osm.scrub), grass = lpPolyIndex(osm.grass), water = lpPolyIndex(osm.water), parking = lpPolyIndex(osm.parking), aero = lpPolyIndex(osm.aeroway);
  const built = lpPolyIndex([...osm.buildings, ...osm.grandstands, ...tanks]), roads = lpLineIndex(osm.roads);
  // Water lies flat, 0.3 m under the lowest survey point on its shore.
  const level = new Map(water.polys.map((p): [IndexedPoly, number] => [p, Math.min(...p.q.map(([x, z]) => ground.h(x, z))) - 0.3]));
  const BAND = 30;
  const groundAt = (x: number, z: number) => {
    const w = water.at(x, z), g = w ? Math.min(ground.h(x, z), level.get(w) as number) : ground.h(x, z), [d, i] = near(x, z);
    if (d >= HW + BAND) return g;
    const r = E[i] - 1.2; return r + (g - r) * lpSmooth(HW + 2, HW + BAND, d);
  };
  yield ["Shaping the land", 0];
  const step = mobile ? 2 : 1, C = ground.cell * step, mx = Math.floor((ground.nx - 1) / step) + 1, mz = Math.floor((ground.nz - 1) / step) + 1;
  const x0 = ground.x0, z0 = ground.z0, x1 = x0 + (mx - 1) * C, z1 = z0 + (mz - 1) * C, landH = new Float32Array(mx * mz), landK = new Uint8Array(mx * mz);
  const KIND: Record<string, number> = { meadow: 6, grass: 7, farmland: 8 };
  const cover = (x: number, z: number) => (water.at(x, z) ? 1 : aero.at(x, z) ? 2 : parking.at(x, z) ? 3 : woods.at(x, z) ? 4 : scrub.at(x, z) ? 5 : KIND[String(grass.at(x, z)?.src.kind)] || 0);
  for (let j = 0; j < mz; j++) {
    for (let i = 0; i < mx; i++) { const x = x0 + i * C, z = z0 + j * C; landH[j * mx + i] = groundAt(x, z); landK[j * mx + i] = cover(x, z); }
    if (j % 16 === 15) yield ["Shaping the land", (0.3 * j) / mz];
  }
  // The land mesh's triangles, split as lpDriveBuild splits them: corners a (i, j), b (i, j + 1),
  // c (i + 1, j + 1), d (i + 1, j), triangles a b d and b c d.
  const tri = (x: number, z: number) => { const u = Math.min(mx - 1.000001, Math.max(0, (x - x0) / C)), v = Math.min(mz - 1.000001, Math.max(0, (z - z0) / C)), i = Math.floor(u), j = Math.floor(v), k = j * mx + i; return { fu: u - i, fv: v - j, a: k, b: k + mx, c: k + mx + 1, d: k + 1 }; };
  const landY = (x: number, z: number) => { const { fu, fv, a, b, c, d } = tri(x, z), H = landH; return fu + fv <= 1 ? H[a] + (H[d] - H[a]) * fu + (H[b] - H[a]) * fv : H[c] + (H[b] - H[c]) * (1 - fu) + (H[d] - H[c]) * (1 - fv); };
  // Nothing of the land may show through the road or its run-off: wherever a land triangle comes to
  // within 0.15 m of the surface inside the wall line, its corners are pressed down to the tarmac
  // edge's level (only ever lowered, so one pass settles it).
  for (let i = 0; i < N; i++) {
    const n = Math.ceil((2 * HW) / 1.5);
    for (let s = 0; s <= n; s++) {
      const o = trk.off(i, -HW + (2 * HW * s) / n), x = P[i].x - T[i].z * o, z = P[i].z + T[i].x * o;
      if (landY(x, z) > E[i] - 0.15) { const t = tri(x, z), lim = E[i] - 1.2; for (const k of t.fu + t.fv <= 1 ? [t.a, t.b, t.d] : [t.b, t.c, t.d]) landH[k] = Math.min(landH[k], lim); }
    }
    if (i % 500 === 499) yield ["Shaping the land", 0.3 + (0.1 * i) / N];
  }
  let lo = Math.min(...E); for (const h of landH) lo = Math.min(lo, h); lo -= 3;

  // Where nothing may stand, within r of (x, z): off the land; the circuit and its run-off (all
  // inside the wall line HW, kept 3 m clear); the pit lane and the paddock in front of the garages; a
  // building, grandstand or tank; a car park; water; the airport's paved areas; a public road.
  const blocked = (x: number, z: number, r: number) => {
    if (x < x0 + r || x > x1 - r || z < z0 + r || z > z1 - r) return "edge";
    const [d, i] = near(x, z);
    if (d < HW + 3 + r) return "circuit";
    if (i >= 0 && inPit(i) && d < HW + 60 + r && pitward(x, z, i)) return "pit";
    return built.near(x, z, r + 1) ? "building" : parking.near(x, z, r) ? "parking" : water.near(x, z, r) ? "water" : aero.near(x, z, r) ? "runway" : roads.near(x, z, r + 1) ? "road" : null;
  };
  yield ["Planting the woods", 0.42];
  // Each circuit's own trees: Spa spruce and fir, broadleaf where the map says broadleaved or
  // mixed (and in scrub); Fuji cedar and broadleaf, cherries only by the main straight and paddock;
  // Sebring palms, live oaks and slash pines, scattered and never dense.
  const sa = trk.mark("Pit straight"), sl = mod(trk.mark("Pit straight", true) - sa), straight: THREE.Vector3[] = [];
  for (let k = 0; k <= sl; k += 4) straight.push(P[mod(sa + k)]);
  const byStraight = (x: number, z: number) => straight.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 350 * 350);
  const species = (p: IndexedPoly | null, x: number, z: number, r: number, low?: boolean) => {
    if (id === "sebring") return r < 0.55 ? "palm" : r < 0.82 ? "liveOak" : "slashPine";
    if (id === "fuji") return byStraight(x, z) && r < 0.8 ? "cherryTree" : r < 0.5 ? "cedar" : "broadleaf";
    const leaf = p && p.src.leaf; return !p || low || leaf === "broadleaved" || (leaf === "mixed" && r < 0.5) ? "broadleaf" : "pineForest";
  };
  const rnd = lpRand(9001), trees: PlanTree[] = [], cc = ground.cell, cn = ground.nx - 1, cz = ground.nz - 1, canopy = new Uint8Array(cn * cz), canopyOf = new Map<number, IndexedPoly>();
  const dense = id !== "sebring", perCell = mobile ? 1 : 2;
  const plant = (type: string, x: number, z: number, s: number, src: string) => trees.push({ type, x, z, rot: rnd() * Math.PI * 2, s, src });
  // Edge trees in a survey cell of wood or scrub p: n tries, each inside p and clear of everything.
  // (Two tries a cell within 120 m of the road; past that one, in 60% of cells; none past 80% of
  // sight, where the fog has all but swallowed a single tree and the canopy mass reads as the wood.)
  const fringe = (i: number, j: number, p: IndexedPoly, low: boolean, n: number) => {
    const d = nearAny(ground.x0 + (i + 0.5) * cc, ground.z0 + (j + 0.5) * cc)[0]; if (d > 0.8 * sight) return;
    if (d > 120) n = rnd() < 0.6 ? Math.min(n, 1) : 0;
    for (let t = 0; t < n; t++) {
      const x = ground.x0 + (i + rnd()) * cc, z = ground.z0 + (j + rnd()) * cc, r = rnd();
      if ((low ? scrub : woods).inside(p, x, z) && !blocked(x, z, 3)) plant(species(p, x, z, r, low), x, z, (low ? 0.45 : 0.8) + rnd() * 0.45, low ? "scrub" : "woods");
    }
  };
  // A wood's interior (more than 12 m inside its outline, and its whole cell clear of everything) is
  // canopy; the rest of it, and scrub, gets individual trees.
  for (let j = 0; j < cz; j++) {
    for (let i = 0; i < cn; i++) {
      const x = ground.x0 + (i + 0.5) * cc, z = ground.z0 + (j + 0.5) * cc, wp = woods.at(x, z), p = wp || scrub.at(x, z);
      if (!p) continue;
      if (dense && wp && woods.edge(wp, x, z) > 12 && !blocked(x, z, cc * 0.71 + 2)) { canopy[j * cn + i] = 1; canopyOf.set(j * cn + i, wp); continue; }
      fringe(i, j, p, !wp, dense ? perCell : rnd() < 0.3 ? 1 : 0);
    }
    if (j % 12 === 11) yield ["Planting the woods", 0.42 + (0.3 * j) / cz];
  }
  // The canopy only rises at a survey node with canopy all round it; a canopy cell with no such
  // corner would lie flat on the ground, so it gets edge trees instead.
  const isC = (i: number, j: number) => i >= 0 && j >= 0 && i < cn && j < cz && canopy[j * cn + i] === 1, inner = (a: number, b: number) => isC(a - 1, b - 1) && isC(a, b - 1) && isC(a - 1, b) && isC(a, b);
  for (let pass = 0; pass < 2; pass++) {
    const flat: XZ2[] = [];
    for (let j = 0; j < cz; j++) for (let i = 0; i < cn; i++) if (isC(i, j) && !inner(i, j) && !inner(i + 1, j) && !inner(i, j + 1) && !inner(i + 1, j + 1)) flat.push([i, j]);
    for (const [i, j] of flat) { canopy[j * cn + i] = 0; fringe(i, j, canopyOf.get(j * cn + i) as IndexedPoly, false, perCell); canopyOf.delete(j * cn + i); }
  }
  // The one documented exception to "trees only inside woods or scrub": a tree the map places
  // itself, as a single natural=tree node or along a natural=tree_row, stands where it is mapped.
  for (const [x, z] of osm.trees) if (!blocked(x, z, 2)) plant(species(null, x, z, rnd()), x, z, 0.7 + rnd() * 0.4, "mapped");
  for (const row of osm.treeRows) for (let n = 0; n < row.pts.length - 1; n++) {
    const a = row.pts[n], b = row.pts[n + 1], k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 9));
    for (let s = 0; s < k; s++) { const x = a[0] + ((b[0] - a[0]) * s) / k, z = a[1] + ((b[1] - a[1]) * s) / k; if (!blocked(x, z, 2)) plant(species(null, x, z, rnd()), x, z, 0.7 + rnd() * 0.3, "row"); }
  }

  yield ["Raising the buildings", 0.75];
  // The real buildings within 600 m of the road: extruded to their tagged height, else levels x
  // 3.2 m, else by type (the data's default height), and 9 m in the pits and paddock. A footprint reaching over
  // the wall line (or the pit lane) has those corners pulled back behind it; one standing on the
  // circuit itself is left out. Each sits on the lowest ground under it, so it never floats; a
  // grandstand is raked, rising away from the nearest point of the road.
  const buildings: PlanBuilding[] = [];
  for (const b of [...osm.buildings.map((x) => ({ ...x, stand: false })), ...osm.grandstands.map((g) => ({ ...g, kind: "grandstand", stand: true }))]) {
    const q = b.pts.slice(0, -1).map(([x, z]): XZ2 => [x, z]); if (q.length < 3) continue;
    const cxz = q.reduce((s, [x, z]): XZ2 => [s[0] + x / q.length, s[1] + z / q.length], [0, 0]), [dc, ic] = nearAny(cxz[0], cxz[1]);
    if (q.some(([x, z]) => x < x0 || x > x1 || z < z0 || z > z1) || dc < HW + 4) continue;
    for (const v of q) {
      const [d, i] = near(v[0], v[1]), min = i >= 0 && inPit(i) && pitward(v[0], v[1], i) ? HW + 13.5 : HW + 2;
      if (d < min) { const k = min / Math.max(d, 1e-3); v[0] = P[i].x + (v[0] - P[i].x) * k; v[1] = P[i].z + (v[1] - P[i].z) * k; }
    }
    const ys = q.map(([x, z]) => landY(x, z)), mean = ys.reduce((s, y) => s + y, 0) / ys.length, base = Math.min(...ys) - 0.5;
    let h = b.height || 7; if (b.def && inPit(ic) && dc < 150 && pitward(cxz[0], cxz[1], ic)) h = 9;
    let tops: number[];
    if (b.stand) { const dist = q.map(([x, z]) => nearAny(x, z)[0]), d0 = Math.min(...dist); tops = dist.map((d) => mean + 3 + Math.min(16, 0.5 * (d - d0))); }
    else tops = q.map(() => Math.max(mean + h, Math.max(...ys) + 2.5));
    buildings.push({ id: String(b.id), kind: b.kind, stand: !!b.stand, q, base, tops, h });
  }
  yield ["Laying the lanes", 0.85];
  // Public roads: plain ribbons on the land, cut back wherever they would reach the circuit's
  // tarmac or run-off (the wall line, their own half width and a metre more) or the pit lane.
  const ribbons: PlanRibbon[] = [];
  for (const r of osm.roads) {
    const w = r.w as number;
    let run: XZ2[] = []; const flush = () => { if (run.length >= 2) ribbons.push({ id: String(r.id), w, pts: run }); run = []; };
    for (let n = 0; n < r.pts.length - 1; n++) {
      const a = r.pts[n], b = r.pts[n + 1], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 16));
      for (let s = n ? 1 : 0; s <= k; s++) {
        const x = a[0] + ((b[0] - a[0]) * s) / k, z = a[1] + ((b[1] - a[1]) * s) / k, [d, i] = near(x, z);
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && d > HW + w / 2 + 1 && !(i >= 0 && inPit(i) && d < HW + 14 + w / 2 && pitward(x, z, i))) run.push([x, z]); else flush();
      }
    }
    flush();
  }
  yield ["Laying the lanes", 1];
  return { near, groundAt, landH, landK, landY, mx, mz, C, x0, z0, x1, z1, lo, blocked, inPit, pitSide, pit0, pitLen, trees, canopy, canopyOf, cn, cz, cell: cc, buildings, ribbons, water, level, parking, aero };
}

type V3 = number[];
/** Four corners (a b on the near row, c d on the far one) and a colour per corner (c, d default to a, b). */
type Quad = [V3, V3, V3, V3, THREE.Color, THREE.Color, THREE.Color?, THREE.Color?];

/** A drive world, built once per circuit and kept for the mount's life. */
export interface DriveWorld {
  group: THREE.Group;
  counts: Record<string, number>;
  banner: THREE.Mesh;
  horizon: THREE.Group;
  /** Redraws the horizon along the camera's lines of sight (lpHorizon). */
  follow: (cam: THREE.Vector3) => void;
  mat: THREE.MeshLambertMaterial;
  lo: number;
  /** The renderer this world's buffers were uploaded on (warm-up skips drawing it again). */
  renderer?: THREE.WebGLRenderer;
  /** Detailed: the models still to fit in place of their Low poly stand-ins (empty in Low poly). */
  swaps: Swap[];
  /** Detailed: what only the models' look draws (the building detail), hidden again if they fail. */
  detailOnly: THREE.Mesh[];
  look: Look;
}

/**
 * The drive world, built in steps so the loader shows real progress and the page stays live: a
 * generator yielding [label, fraction] between chunks and returning the world. trk is driveTrack(),
 * with its corners and run-off (trackCorners), which place the kerbs, gravel, barriers, brake boards
 * and the rubbered-in line; none of it depends on the car. ground is the circuit's decoded real ground.
 * detail, when given, builds the Detailed look: trees, furniture and Mount Fuji as our models,
 * listed in swaps with their Low poly pieces standing in until they load, plus modelled detail
 * on the real buildings, in detailOnly (hidden again if the models fail).
 */
export function* lpDriveBuild(track: Track, trk: DriveTrack, ground: LpGround, mobile: boolean, sight: number, detail: Detail | null = null): Generator<Step, DriveWorld, void> {
  const { P, T, N, E, S, HW, hw, road, seg } = trk, mood = track.mood, group = new THREE.Group(), counts: Record<string, number> = {}, swaps: Swap[] = [], detailOnly: THREE.Mesh[] = [], detailed = !!detail;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: !detailed });
  const near = (x: number, z: number): [number, number] => {
    let bd = Infinity, bi = 0;
    for (let i = 0; i < N; i += 8) { const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    for (let j = -8; j <= 8; j++) { const i = (bi + j + N) % N, d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    return [Math.sqrt(bd), bi];
  };
  // Where the land, woods, buildings and lanes go, from the real ground (lpDrivePlan).
  const pg = lpDrivePlan(track, trk, ground, mobile, sight);
  let pr = pg.next(); while (!pr.done) { yield [pr.value[0], 0.02 + 0.4 * pr.value[1]]; pr = pg.next(); }
  const plan = pr.value, { lo, landY } = plan;
  const { corners, runoff } = trk, sides = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), paint = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const col = (h: THREE.ColorRepresentation) => new THREE.Color(h), mod = (i: number) => ((i % N) + N) % N, sideOf = (w: number) => (w > 0 ? 1 : 0);
  // Where a lateral offset w lands at point r (inside a hairpin the run-off stops short), dy up.
  const at = (r: number, w: number, dy = 0): V3 => { const o = trk.off(r, w); return [P[r].x - T[r].z * o, E[r] + dy, P[r].z + T[r].x * o]; };
  // One mesh from quads, wound so the face points up (or toward +normal for a wall, drawn double sided).
  const mesh = (quads: Quad[], material: THREE.Material, name: string) => {
    const pos = new Float32Array(quads.length * 18), cl = new Float32Array(quads.length * 18); let o = 0;
    for (const [a, b, c, d, ca, cb, cc, cd] of quads) for (const [v, k] of [[a, ca], [b, cb], [c, cc || ca], [b, cb], [d, cd || cb], [c, cc || ca]] as [V3, THREE.Color][]) { pos.set(v, o); cl.set([k.r, k.g, k.b], o); o += 3; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(cl, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, material); m.name = name; group.add(m); return m;
  };
  // The pit lane: the stretch of the pit straight the OSM pit lane runs beside, on its side.
  const { pitSide, pit0, pitLen, inPit } = plan;
  // The racing line's rubbered-in band: from the outside before each corner to the inside at its
  // apex and back out on the exit, eased between those keyframes (an apex beats an entry or exit
  // that crowds it, so a chicane runs straight through).
  const ideal = new Float32Array(N);
  {
    const keys: [number, number, number][] = [];
    for (const c of corners) keys.push([mod(c.a - Math.round(40 / seg)), -c.turn, 0], [c.apex, c.turn, 1], [mod(c.b + Math.round(50 / seg)), -c.turn, 0]);
    keys.sort((a, b) => a[0] - b[0]);
    const kept: [number, number, number][] = [];
    for (const k of keys) { const last = kept[kept.length - 1]; if (last && (k[0] - last[0]) * seg < 25) { if (k[2] > last[2]) kept[kept.length - 1] = k; } else kept.push(k); }
    if (kept.length > 1 && (kept[0][0] + N - kept[kept.length - 1][0]) * seg < 25) kept.splice(kept[0][2] >= kept[kept.length - 1][2] ? kept.length - 1 : 0, 1);
    if (!kept.length) kept.push([0, 0, 0]);
    for (let i = 0; i < N; i++) {
      let n = kept.findIndex((k) => k[0] > i); if (n < 0) n = 0;
      const b = kept[n], a = kept[(n + kept.length - 1) % kept.length], span = mod(b[0] - a[0]) || N, u = mod(i - a[0]) / span;
      ideal[i] = (a[1] + ((b[1] - a[1]) * (1 - Math.cos(Math.PI * u))) / 2) * (hw - 1.8);
    }
  }
  yield ["Laying the road", 0.44];
  // The surface: one mesh on exactly the triangles surfaceAt() reads, so wheels sit on it. Dark
  // asphalt with a little aggregate and patching, darker still where the racing line has rubbered
  // in; a strip of shoulder past the white line; then grass, gravel, or tarmac with a painted band.
  {
    const asphalt = col("#3a3d43"), shoulder = col("#45484e"), grass = col(mood.ground).multiplyScalar(1.05), gravel = col("#b8a47c"), runT = col("#44484f"), bandA = col("#2f63b0"), bandB = col("#e4e7ea");
    const grain = (r: number, q: number) => { const x = Math.sin(r * 12.9898 + q * 78.233) * 43758.5453; return x - Math.floor(x); };
    const tar = (r: number, q: number) => col("#000").copy(asphalt).multiplyScalar((0.93 + 0.1 * grain(r, q)) * (1 + 0.05 * Math.sin(r * 0.041 + q * 0.7)) * (1 - 0.38 * Math.exp(-(((S[q] - ideal[r]) / 1.5) ** 2))));
    const quads: Quad[] = [];
    for (let j = 0; j < N; j++) {
      const j1 = (j + 1) % N;
      for (let s = 0; s < S.length - 1; s++) {
        const mid = (S[s] + S[s + 1]) / 2, am = Math.abs(mid), a = at(j, S[s]), b = at(j, S[s + 1]), c = at(j1, S[s]), d = at(j1, S[s + 1]);
        if (am < hw) { quads.push([a, b, c, d, tar(j, s), tar(j, s + 1), tar(j1, s), tar(j1, s + 1)]); continue; }
        let k: THREE.Color;
        if (am < road) k = shoulder;
        else {
          const kind = runoff[j * 2 + sideOf(mid)], first = am < road + 2.6;
          k = kind === 1 ? col("#000").copy(gravel).multiplyScalar(0.9 + 0.12 * grain(j, s)) : kind === 2 ? (first ? ((j >> 1) % 2 ? bandA : bandB) : runT) : col("#000").copy(grass).multiplyScalar(0.95 + 0.06 * Math.sin(j * 0.7 + s));
        }
        quads.push([a, b, c, d, k, k, k, k]);
      }
    }
    const m = mesh(quads, mat, "road"); m.receiveShadow = true;
    // A skirt down from the surface's outer edge, so its end never floats over the land.
    const skirt: Quad[] = [], green = col(mood.ground).multiplyScalar(0.8);
    for (let j = 0; j < N; j++) for (const w of [-HW, HW]) { const j1 = (j + 1) % N; skirt.push([at(j, w, -1.6), at(j, w), at(j1, w, -1.6), at(j1, w), green, green]); }
    mesh(skirt, sides, "skirt");
  }
  yield ["Painting the lines", 0.48];
  // Painted on the road: one solid white line at each tarmac edge, the chequered start/finish line,
  // and the grid's boxes behind it.
  {
    const white = col("#eceef1"), black = col("#15171a"), lines: Quad[] = [];
    for (let j = 0; j < N; j++) { const j1 = (j + 1) % N; for (const [w0, w1] of [[-hw, -hw + 0.15], [hw - 0.15, hw]]) lines.push([at(j, w0, 0.005), at(j, w1, 0.005), at(j1, w0, 0.005), at(j1, w1, 0.005), white, white]); }
    mesh(lines, paint, "edgeLines");
    // A point w across and u metres along the lap from index r.
    const along = (r: number, u: number, w: number) => { const i = mod(r + Math.floor(u / seg)), f = u / seg - Math.floor(u / seg), a = at(i, w, 0.008), b = at(mod(i + 1), w, 0.008); return a.map((v, n) => v + (b[n] - v) * f); };
    const chq: Quad[] = [], cells = Math.round((2 * hw) / 0.7);
    for (let y = 0; y < 2; y++) for (let x = 0; x < cells; x++) { const w0 = -hw + (2 * hw * x) / cells, w1 = -hw + (2 * hw * (x + 1)) / cells, k = (x + y) % 2 ? white : black; chq.push([along(N - 1, 2.5 - 0.6 + y * 0.6, w0), along(N - 1, 2.5 - 0.6 + y * 0.6, w1), along(N - 1, 2.5 + y * 0.6, w0), along(N - 1, 2.5 + y * 0.6, w1), k, k]); }
    mesh(chq, paint, "startLine");
    // Twenty boxes, two by two and staggered, 8 m apart; pole on the inside of the first corner.
    const grid: Quad[] = [], pole = corners.length ? corners.reduce((m, c) => (c.a < m.a ? c : m)).turn : 1, slots = 20;
    for (let k = 0; k < slots; k++) {
      const back = 6 + 8 * k, side = (k % 2 ? -1 : 1) * pole, c = side * hw * 0.42, r = mod(-Math.round(back / seg)), u = back - Math.round(back / seg) * seg;
      const box = (u0: number, u1: number, w0: number, w1: number) => grid.push([along(r, -u1 - u, w0), along(r, -u1 - u, w1), along(r, -u0 - u, w0), along(r, -u0 - u, w1), white, white]);
      box(0, 0.2, c - 1.7, c + 1.7); box(0.2, 1.4, c - 1.7, c - 1.52); box(0.2, 1.4, c + 1.52, c + 1.7);
    }
    const g = mesh(grid, paint, "gridBoxes"); g.userData.count = slots; counts.gridBox = slots;
  }
  // Kerbs where real ones go: inside the corner around its apex, and outside on its exit. Red and
  // white blocks 1 m wide, each rising 3 cm along its length and dropping at its end: a sawtooth.
  {
    const on = new Uint8Array(N * 2), red = col("#d23a31"), white = col("#eef0f2"), quads: Quad[] = [];
    const mark = (from: number, to: number, side: number) => { for (let j = from, e = from + mod(to - from); j <= e; j++) on[mod(j) * 2 + sideOf(side)] = 1; };
    for (const c of corners) {
      const len = mod(c.b - c.a), pre = Math.round(Math.max(6, 0.35 * mod(c.apex - c.a) * seg) / seg), post = Math.round(Math.max(6, 0.35 * mod(c.b - c.apex) * seg) / seg);
      if (len * seg < 8) continue;
      mark(c.apex - pre, c.apex + post, c.turn); mark(c.apex, c.b + Math.round(25 / seg), -c.turn);
    }
    for (let j = 0; j < N; j++) for (const sd of [-1, 1]) {
      if (!on[j * 2 + sideOf(sd)]) continue;
      const j1 = (j + 1) % N, lerp = (u: number, w: number, dy: number) => { const a = at(j, sd * w, dy), b = at(j1, sd * w, dy); return a.map((v, n) => v + (b[n] - v) * u); };
      for (const h of [0, 1]) {
        const k = (j * 2 + h) % 2 ? red : white, u0 = h / 2, u1 = (h + 1) / 2, [w0, w1] = sd > 0 ? [hw, hw + 1] : [hw + 1, hw];
        quads.push([lerp(u0, w0, 0.004), lerp(u0, w1, 0.004), lerp(u1, w0, 0.034), lerp(u1, w1, 0.034), k, k]);
        quads.push([lerp(u1, w0, 0.004), lerp(u1, w1, 0.004), lerp(u1, w0, 0.034), lerp(u1, w1, 0.034), k, k]);
      }
    }
    const m = mesh(quads, sides, "kerbs"); m.receiveShadow = true;
  }
  yield ["Building the barriers", 0.52];
  // Barriers stand exactly on the wall line the physics stops the car's body at: stacked tyres with
  // a belt outside the corners, Armco along the straights and inside the corners, and a concrete
  // pit wall beside the pit lane. Catch fencing over the Armco on the straights and the pit wall.
  {
    const quads: Quad[] = [], fence: Quad[] = [], footing = col("#50555d"), steel = col("#c9cfd6"), steelD = col("#9aa3ad"), tyreA = col("#1f2226"), tyreB = col("#2c3035"), beltR = col("#c8342c"), beltW = col("#e9ebee"), concrete = col("#c3c6ca"), cap = col("#e6e7e9"), mesh0 = col("#8d969f");
    const wall = (j: number, s: number, y0: number, y1: number, k: THREE.Color) => { const j1 = (j + 1) % N; quads.push([at(j, s * HW, y0), at(j, s * HW, y1), at(j1, s * HW, y0), at(j1, s * HW, y1), k, k]); };
    const straightAt = (j: number) => { for (let q = -8; q <= 8; q++) if (Math.abs(trk.kappa[mod(j + q)]) > 1 / 400) return false; return true; };
    const kinds = detail ? new Uint8Array(N * 2) : null; // Detailed: 1 Armco, 2 tyres, at (sample, side)
    for (let j = 0; j < N; j++) for (const s of [1, -1]) {
      const probe = at(j, s * HW); if (near(probe[0], probe[2])[0] < HW - 0.5) continue;
      const pitWall = s === pitSide && inPit(j), tyres = !pitWall && runoff[j * 2 + sideOf(s)] > 0;
      wall(j, s, -1.3, 0.12, footing);
      if (pitWall) { wall(j, s, 0.12, 1.1, concrete); wall(j, s, 1.1, 1.25, cap); }
      else if (kinds) kinds[j * 2 + sideOf(s)] = tyres ? 2 : 1;
      else if (tyres) { const P0 = at(j, s * HW, 0), P1 = at((j + 1) % N, s * HW, 0), mid = P0.map((v, n) => (v + P1[n]) / 2); for (const [a, b, k] of [[P0, mid, j % 2 ? tyreA : tyreB], [mid, P1, j % 2 ? tyreB : tyreA]] as [V3, V3, THREE.Color][]) quads.push([[a[0], a[1] + 0.12, a[2]], [a[0], a[1] + 0.72, a[2]], [b[0], b[1] + 0.12, b[2]], [b[0], b[1] + 0.72, b[2]], k, k]); wall(j, s, 0.72, 1.02, (j >> 1) % 2 ? beltR : beltW); }
      else { wall(j, s, 0.12, 0.45, footing); wall(j, s, 0.45, 0.62, steel); wall(j, s, 0.62, 0.78, steelD); }
      // Catch fence: posts every 5 m and see-through mesh between them.
      if (pitWall || (!tyres && straightAt(j))) {
        const y0 = pitWall ? 1.25 : 0.78, j1 = (j + 1) % N, o = s * (HW + 0.15);
        fence.push([at(j, o, y0), at(j, o, 3.6), at(j1, o, y0), at(j1, o, 3.6), mesh0, mesh0]);
        if (j % 2 === 0) { const p = at(j, o, 0), t = T[j], x = [p[0] - t.x * 0.05, p[0] + t.x * 0.05], z = [p[2] - t.z * 0.05, p[2] + t.z * 0.05]; quads.push([[x[0], p[1] - 0.2, z[0]], [x[0], p[1] + 3.7, z[0]], [x[1], p[1] - 0.2, z[1]], [x[1], p[1] + 3.7, z[1]], steelD, steelD]); }
      }
    }
    mesh(quads, sides, "barrier");
    if (detail && kinds) {
      // Detailed: the Armco and the tyre walls as our models, laid segment by segment on the wall line
      // (Armco two samples at a time where the line runs straight through them) and instanced in
      // chunks along the lap like the trees; the Low poly pieces stand in until the models load.
      const segs: Record<string, { j: number; m: THREE.Matrix4 }[]> = { armco: [], tyreWall: [] }, X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
      const place = (list: { j: number; m: THREE.Matrix4 }[], a: V3, b: V3, j: number, len0: number) => {
        X.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const L = X.length(); X.divideScalar(L);
        Z.set(P[j].x - a[0], 0, P[j].z - a[2]); Z.addScaledVector(X, -Z.dot(X)).normalize(); Y.crossVectors(Z, X);
        let o = a; if (Y.y < 0) { X.negate(); Y.negate(); o = b; }
        list.push({ j, m: new THREE.Matrix4().makeBasis(X.clone().multiplyScalar(L / len0), Y, Z).setPosition(o[0], o[1], o[2]) });
      };
      const sag = (a: V3, b: V3, c: V3) => { const ux = c[0] - a[0], uz = c[2] - a[2]; return Math.abs(ux * (b[2] - a[2]) - uz * (b[0] - a[0])) / (Math.hypot(ux, uz) || 1); };
      for (const s of [1, -1]) for (let j = 0; j < N; j++) {
        const k = kinds[j * 2 + sideOf(s)]; if (!k) continue;
        const a = at(j, s * HW), j1 = (j + 1) % N, b = at(j1, s * HW);
        if (k === 2) { place(segs.tyreWall, a, b, j, 2.5); continue; }
        const c = at((j + 2) % N, s * HW);
        if (j + 1 < N && kinds[j1 * 2 + sideOf(s)] === 1 && sag(a, b, c) < 0.04) { place(segs.armco, a, c, j, 5); j++; } else place(segs.armco, a, b, j, 5);
      }
      for (const [type, list] of Object.entries(segs)) {
        const geo = LOWPOLY[type](), by: THREE.Matrix4[][] = [], model = DETAILED.furniture[type];
        for (const it of list) (by[Math.floor((it.j / N) * 12)] ||= []).push(it.m);
        for (const ms of by) {
          if (!ms) continue;
          const m = new THREE.InstancedMesh(geo, mat, ms.length); ms.forEach((x, i) => m.setMatrixAt(i, x)); m.computeBoundingSphere(); m.name = type; group.add(m);
          swaps.push({ model, get: () => detail.src.furniture(model), fit: (g) => dFit(m, g) });
        }
        counts[type] = list.length;
      }
    }
    mesh(fence, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.32, depthWrite: false }), "catchFence");
  }
  // The pit lane beside the pit wall (to look at, not to drive): 12 m of tarmac with its fast-lane
  // line, level with the track, over a skirt down to the land.
  {
    const lane = col("#34373c"), line = col("#e9ebee"), green = col(mood.ground).multiplyScalar(0.8), quads: Quad[] = [], o = (w: number) => pitSide * (HW + w);
    const ribbon = (r: number, w0: number, w1: number, dy: number, k: THREE.Color) => { const r1 = mod(r + 1), p = (i: number, w: number): V3 => { const q = at(i, 0, dy); return [q[0] - T[i].z * o(w), q[1], q[2] + T[i].x * o(w)]; }; const [a, b] = pitSide > 0 ? [w0, w1] : [w1, w0]; quads.push([p(r, a), p(r, b), p(r1, a), p(r1, b), k, k]); };
    for (let n = 0; n < pitLen; n++) {
      const r = mod(pit0 + n), far = at(r, 0); const fx = far[0] - T[r].z * o(12.6), fz = far[2] + T[r].x * o(12.6);
      if (near(fx, fz)[0] < HW + 11.5) continue;
      ribbon(r, 0.6, 12.6, 0.02, lane); ribbon(r, 6.5, 6.7, 0.03, line);
      const r1 = mod(r + 1), p = (i: number, dy: number): V3 => { const q = at(i, 0, dy); return [q[0] - T[i].z * o(12.6), q[1], q[2] + T[i].x * o(12.6)]; };
      quads.push([p(r, -1.6), p(r, 0.02), p(r1, -1.6), p(r1, 0.02), green, green]);
    }
    mesh(quads, sides, "pitLane");
  }
  yield ["Shaping the land", 0.56];
  // The land: the survey grid as one mesh (every other node on a phone), each node
  // coloured by what the map says covers it. Past the grid it runs 3 km on to the skyline ring's
  // heights, in the fog, over a plain.
  const drape = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  const flat = (pos: number[], cl: number[], material: THREE.Material, name: string) => {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(cl, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, material); m.name = name; group.add(m); return m;
  };
  // The big ground-hugging meshes are cut into 4 x 4 tiles over the survey grid (each triangle by its
  // centre), so the ones behind the camera are culled; a mesh the size of the grid never would be.
  const TL = 4, cut = (v: number, a: number, b: number) => Math.min(TL - 1, Math.max(0, Math.floor(((v - a) / (b - a)) * TL)));
  const tiled = (pos: number[], cl: number[], material: THREE.Material, name: string) => {
    const parts = Array.from({ length: TL * TL }, (): [number[], number[]] => [[], []]);
    for (let t = 0; t < pos.length; t += 9) {
      const k = cut((pos[t] + pos[t + 3] + pos[t + 6]) / 3, plan.x0, plan.x1) * TL + cut((pos[t + 2] + pos[t + 5] + pos[t + 8]) / 3, plan.z0, plan.z1);
      for (let v = 0; v < 9; v++) { parts[k][0].push(pos[t + v]); parts[k][1].push(cl[t + v]); }
    }
    return parts.filter(([q]) => q.length).map(([q, c]) => flat(q, c, material, name));
  };
  {
    const { mx, mz, C, x0, z0, landH, landK } = plan, base = new THREE.Color(mood.ground), tint = (hex: string, k: number) => base.clone().lerp(new THREE.Color(hex), k);
    // Open ground, water, airport concrete, parking, forest floor, scrub, meadow, grass, farmland.
    const COVER = [base, new THREE.Color("#3e6a88"), new THREE.Color("#a4a6a3"), new THREE.Color("#6c6f75"), tint("#1e3322", 0.5), tint("#55603a", 0.4), tint("#9aa55a", 0.2), base.clone().multiplyScalar(1.08), tint("#a8965e", 0.35)];
    const pos = new Float32Array(mx * mz * 3), cl = new Float32Array(mx * mz * 3), c = new THREE.Color();
    for (let j = 0; j < mz; j++) for (let i = 0; i < mx; i++) {
      const k = j * mx + i, x = x0 + i * C, z = z0 + j * C, K = landK[k];
      pos[k * 3] = x; pos[k * 3 + 1] = landH[k]; pos[k * 3 + 2] = z;
      c.copy(COVER[K]); if (K !== 1) c.multiplyScalar(0.9 + 0.12 * (0.5 + 0.5 * Math.sin(x / 37 + Math.sin(z / 53) * 1.7)));
      cl[k * 3] = c.r; cl[k * 3 + 1] = c.g; cl[k * 3 + 2] = c.b;
    }
    // Split as lpDrivePlan's landY reads them: triangles a b d and b c d of each cell.
    const tp: number[] = [], tc: number[] = [];
    for (let j = 0; j < mz - 1; j++) for (let i = 0; i < mx - 1; i++) { const a = j * mx + i, b = a + mx; for (const k of [a, b, a + 1, b, b + 1, a + 1]) { tp.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]); tc.push(cl[k * 3], cl[k * 3 + 1], cl[k * 3 + 2]); } }
    for (const land of tiled(tp, tc, mat, "land")) land.receiveShadow = true;
    yield ["Shaping the land", 0.6];
    const far = ground.far, edge: number[] = [], cx = (x0 + plan.x1) / 2, cz = (z0 + plan.z1) / 2, dark = base.clone().multiplyScalar(0.8);
    for (let i = 0; i < mx; i++) edge.push(i);
    for (let j = 1; j < mz; j++) edge.push(j * mx + mx - 1);
    for (let i = mx - 2; i >= 0; i--) edge.push((mz - 1) * mx + i);
    for (let j = mz - 2; j > 0; j--) edge.push(j * mx);
    const out = (k: number): V3 => { const x = pos[k * 3] - cx, z = pos[k * 3 + 2] - cz, s = 1 + 3000 / Math.hypot(x, z), n = Math.round(((((Math.atan2(x, -z) / (2 * Math.PI)) % 1) + 1) % 1) * far.n) % far.n; return [cx + x * s, far.H[n] * 0.7 + landH[k] * 0.3, cz + z * s]; };
    const quads: Quad[] = [];
    for (let q = 0; q < edge.length; q++) { const a = edge[q], b = edge[(q + 1) % edge.length]; quads.push([[pos[a * 3], landH[a], pos[a * 3 + 2]], [pos[b * 3], landH[b], pos[b * 3 + 2]], out(a), out(b), base, base, dark, dark]); }
    mesh(quads, sides, "apron");
    const plain = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshLambertMaterial({ color: base.clone().multiplyScalar(0.78) }));
    plain.rotation.x = -Math.PI / 2; plain.position.set(cx, lo - 1, cz); group.add(plain);
  }
  yield ["Planting the woods", 0.64];
  // Inside the woods: one merged low-poly canopy over every canopy cell, at the tree tops
  // where canopy lies all round a node and down at the ground at the edge of the mass, where the
  // edge trees stand in front of it.
  {
    const { cn, cz, cell, canopy, canopyOf } = plan, isC = (i: number, j: number) => i >= 0 && j >= 0 && i < cn && j < cz && canopy[j * cn + i] === 1;
    const hash = (a: number, b: number) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
    const needle = new THREE.Color("#2a5034"), broad = new THREE.Color("#3a6230"), H = new Map<number, [V3, THREE.Color]>(), pos: number[] = [], cl: number[] = [];
    const corner = (a: number, b: number): [V3, THREE.Color] => {
      const key = b * (cn + 1) + a, got = H.get(key); if (got) return got;
      const x = ground.x0 + a * cell, z = ground.z0 + b * cell, inner = isC(a - 1, b - 1) && isC(a, b - 1) && isC(a - 1, b) && isC(a, b);
      const p = canopyOf.get(b * cn + a) || canopyOf.get(b * cn + a - 1) || canopyOf.get((b - 1) * cn + a) || canopyOf.get((b - 1) * cn + a - 1);
      const needles = ground.id === "spa" && !(p && /broad|mixed/.test(p.src.leaf || "")), r = hash(a, b);
      const v: [V3, THREE.Color] = [[x, inner ? landY(x, z) + (needles ? 21 : 16) + (r - 0.5) * 6 : landY(x, z) - 0.5, z], (needles ? needle : broad).clone().multiplyScalar(0.8 + 0.3 * r)];
      H.set(key, v); return v;
    };
    for (let j = 0; j < cz; j++) for (let i = 0; i < cn; i++) {
      if (!isC(i, j)) continue;
      const a = corner(i, j), b = corner(i, j + 1), c = corner(i + 1, j + 1), d = corner(i + 1, j);
      for (const [p, k] of [a, b, d, b, c, d]) { pos.push(...p); cl.push(k.r, k.g, k.b); }
    }
    if (pos.length) tiled(pos, cl, mat, "canopy");
    counts.canopyCells = pos.length / 18;
  }
  // Trees and trackside furniture, instanced in chunks along the lap so the ones behind the camera
  // are culled.
  interface Placed { x: number; z: number; y: number; rot: number; s: number }
  const CH = 12, chunks: Record<string, Placed[][]> = {}, add = (type: string, x: number, z: number, rot: number, s: number) => {
    const [, i] = near(x, z), k = Math.floor((i / N) * CH), list = ((chunks[type] ||= [])[k] ||= []);
    list.push({ x, z, y: landY(x, z) - 0.3, rot, s });
  };
  // Clear of the road by gap past the wall, and never on the pit lane or in front of the garages.
  const clear = (x: number, z: number, gap: number) => { const [d, i] = near(x, z); return d > HW + gap && !(inPit(i) && d < HW + 60 && ((x - P[i].x) * -T[i].z + (z - P[i].z) * T[i].x) * pitSide > 0); };
  // The woods' own trees: only where the map has trees, as lpDrivePlan placed them.
  for (const t of plan.trees) add(t.type, t.x, t.z, t.rot, t.s);
  yield ["Planting the woods", 0.7];
  {
    // Marshal posts about every 400 m behind the barrier, on the outside of the nearest corner.
    for (let i = Math.round(200 / seg); i < N - Math.round(100 / seg); i += Math.round(400 / seg)) {
      const c: Corner | undefined = trk.corners.reduce((m, q) => (Math.abs(((q.apex - i + N * 1.5) % N) - N / 2) < Math.abs(((m.apex - i + N * 1.5) % N) - N / 2) ? q : m), trk.corners[0]);
      for (const side of c ? [-c.turn, c.turn] : [1, -1]) {
        const w = HW + 3.5, x = P[i].x - T[i].z * w * side, z = P[i].z + T[i].x * w * side;
        if (clear(x, z, 3) && !(side === track.pit.side && Math.abs((i - trk.mark("Pit straight") + N) % N) * seg < 600)) { add("marshalPost", x, z, Math.atan2(T[i].z * side, -T[i].x * side), 1); break; }
      }
    }
  }
  yield ["Placing the landmarks", 0.74];
  // The real buildings in one mesh: walls and a flat roof, coloured by type; a grandstand's
  // raked top is its seating, in the stands' blue. The pit building, grandstands and hangars the
  // landmarks name (by OSM id) are among them, and counted as those landmarks.
  {
    const WALL: Record<string, string> = { house: "#d9ccb5", residential: "#d9ccb5", detached: "#d9ccb5", garage: "#a09a90", shed: "#948e82", hut: "#948e82", farm_auxiliary: "#9b8f7a", hangar: "#9aa4ab", industrial: "#a9aca9", warehouse: "#a9aca9", commercial: "#cdd0d4", retail: "#cfc8b9", hotel: "#d6d2c8", grandstand: "#c3c8cf", roof: "#8c9299" };
    const ROOF: Record<string, string> = { house: "#8a5446", residential: "#8a5446", detached: "#8a5446", farm_auxiliary: "#6f5a48", grandstand: "#3d6fc2" };
    const pos: number[] = [], cl: number[] = [], put = (p: V3, k: THREE.Color) => { pos.push(...p); cl.push(k.r, k.g, k.b); };
    for (const b of plan.buildings) {
      const q = b.q, n = q.length, kind = String(b.kind), wall = new THREE.Color(WALL[kind] || "#c2c4c0"), dim = wall.clone().multiplyScalar(0.86), roof = new THREE.Color(ROOF[kind] || "#7d838a");
      for (let v = 0; v < n; v++) { const w = (v + 1) % n, k = v % 2 ? wall : dim; for (const p of [[q[v][0], b.base, q[v][1]], [q[w][0], b.base, q[w][1]], [q[v][0], b.tops[v], q[v][1]], [q[w][0], b.base, q[w][1]], [q[w][0], b.tops[w], q[w][1]], [q[v][0], b.tops[v], q[v][1]]]) put(p, k); }
      let tris: number[][] = []; try { tris = THREE.ShapeUtils.triangulateShape(q.map(([x, z]) => new THREE.Vector2(x, z)), []); } catch { /* an outline three cannot triangulate gets walls only */ }
      for (const t of tris) for (const v of t) put([q[v][0], b.tops[v], q[v][1]], roof);
      for (const lm of track.landmarks || []) if (lm.osm === b.id && !((lm.count ?? 0) > 1)) counts[lm.type] = (counts[lm.type] || 0) + 1;
    }
    if (pos.length) flat(pos, cl, sides, "buildings");
    counts.building = plan.buildings.length;
    if (detailed) { const d = lpBuildingDetail(plan, WALL, ROOF); if (d.pos.length) detailOnly.push(flat(d.pos, d.cl, sides, "buildingDetail")); }
  }
  // Public roads: plain asphalt ribbons laid on the land, no racing-surface treatment.
  {
    const pos: number[] = [], cl: number[] = [], ash = new THREE.Color("#4b4e53");
    for (const r of plan.ribbons) {
      const p = r.pts, n = p.length, rows: V3[][] = [];
      for (let k = 0; k < n; k++) {
        const a = p[Math.max(0, k - 1)], b = p[Math.min(n - 1, k + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ox = ((-(b[1] - a[1]) / l) * r.w) / 2, oz = (((b[0] - a[0]) / l) * r.w) / 2;
        rows.push([[p[k][0] + ox, p[k][1] + oz], [p[k][0] - ox, p[k][1] - oz]].map(([x, z]) => [x, landY(x, z) + 0.12, z]));
      }
      for (let k = 0; k < n - 1; k++) { const [a, b] = rows[k], [c, d] = rows[k + 1]; for (const v of [a, b, c, b, d, c]) { pos.push(...v); cl.push(ash.r, ash.g, ash.b); } }
    }
    if (pos.length) tiled(pos, cl, drape, "roads");
    counts.roadRibbon = plan.ribbons.length;
  }
  // Car parks and the airport's paved areas laid on the land in their real outlines, water
  // flat at its level: each outline triangulated, then split until no edge is over 14 m so it follows
  // the land, and kept off the circuit.
  {
    const pos: number[] = [], cl: number[] = [], tone = { parking: new THREE.Color("#6a6d73"), aero: new THREE.Color("#a7a9a6"), water: new THREE.Color("#3e6a88") };
    const lay = (q: XZ2[], y: (x: number, z: number) => number, k: THREE.Color) => {
      let tris: number[][]; try { tris = THREE.ShapeUtils.triangulateShape(q.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z)), []); } catch { return 0; }
      const pts = q.slice(0, -1);
      const split = (a: XZ2, b: XZ2, c: XZ2, depth: number) => {
        const e = [Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1])], m = Math.max(...e), i = e.indexOf(m);
        if (m > 14 && depth < 12) { const [u, v, w] = i === 0 ? [a, b, c] : i === 1 ? [b, c, a] : [c, a, b], mid: XZ2 = [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2]; split(u, mid, w, depth + 1); split(mid, v, w, depth + 1); return; }
        const x = (a[0] + b[0] + c[0]) / 3, z = (a[1] + b[1] + c[1]) / 3;
        if (plan.near(x, z)[0] < HW + 1 || x < plan.x0 || x > plan.x1 || z < plan.z0 || z > plan.z1) return;
        for (const v of [a, b, c]) { pos.push(v[0], y(v[0], v[1]), v[1]); cl.push(k.r, k.g, k.b); }
      };
      for (const [i, j, l] of tris) split(pts[i], pts[j], pts[l], 0);
      return 1;
    };
    for (const p of plan.parking.polys) lay(p.q, (x, z) => landY(x, z) + 0.12, tone.parking);
    let aero = 0; for (const p of plan.aero.polys) aero += lay(p.q, (x, z) => landY(x, z) + 0.12, tone.aero);
    for (const p of plan.water.polys) { const h = (plan.level.get(p) as number) + 0.25; lay(p.q, () => h, tone.water); }
    if (pos.length) tiled(pos, cl, drape, "paved");
    if (aero) counts.aeroway = aero;
  }
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  for (const [type, lists] of Object.entries(chunks)) {
    const geo = LOWPOLY[type](), base = LP_REAL[type] || [60, 60, 60];
    let n = 0;
    lists.forEach((list, k) => {
      if (!list || !list.length) return;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, j) => m.setMatrixAt(j, mtx.compose(v.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.rot), sc.set(base[0] * it.s, base[1] * it.s, base[2] * it.s))));
      m.computeBoundingSphere(); m.name = type; group.add(m); n += list.length;
      // Detailed: this stand's species (alternating by chunk where the circuit has two) or the post.
      const model = !detail ? null : type === "marshalPost" ? DETAILED.furniture.marshalPost : detailedTree(detail.trackId, type, k);
      if (detail && model) swaps.push({ model, get: () => (type === "marshalPost" ? detail.src.furniture(model) : detail.src.tree(model)), fit: (g) => dFit(m, g) });
    });
    counts[type] = n;
  }
  // Brake boards (300, 200, 100 m) before the three heaviest braking zones, behind the barrier on
  // the outside, facing the cars that are coming: one merged mesh.
  {
    const zones: (Corner & { end: number })[] = [], parts: LpPart[] = [], seven: Record<string, string> = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd" };
    // A corner that starts within 150 m of the last one's end belongs to its complex (a chicane):
    // the boards count down to the complex's first corner, by the speed lost over the whole of it.
    const complexes: (Corner & { end: number })[] = [];
    for (const c of [...trk.corners].sort((a, b) => a.a - b.a)) { const last = complexes[complexes.length - 1]; if (last && ((c.a - last.end + N) % N) * seg < 150) { last.drop = Math.max(last.drop, c.drop); last.end = c.b; } else complexes.push({ ...c, end: c.b }); }
    for (const c of complexes.sort((a, b) => b.drop - a.drop)) if (zones.length < 3 && zones.every((z) => Math.abs(((z.a - c.a + N * 1.5) % N) - N / 2) * seg > 400)) zones.push(c);
    const seg7: Record<string, [number, number, number, number]> = { a: [0, 0.31, 0.36, 0.08], g: [0, 0, 0.36, 0.08], d: [0, -0.31, 0.36, 0.08], f: [-0.14, 0.155, 0.08, 0.3], b: [0.14, 0.155, 0.08, 0.3], e: [-0.14, -0.155, 0.08, 0.3], c: [0.14, -0.155, 0.08, 0.3] };
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), frames: THREE.Matrix4[] = [];
    for (const z of zones) for (const d of [300, 200, 100]) {
      const i = (z.a - Math.round(d / seg) + N) % N;
      for (const side of [-z.turn, z.turn]) {
        const w = HW + 1.8, x = P[i].x - T[i].z * w * side, zz = P[i].z + T[i].x * w * side;
        if (!clear(x, zz, 1)) continue;
        M.compose(new THREE.Vector3(x, landY(x, zz) - 0.2, zz), Q.setFromAxisAngle(Y, Math.atan2(-T[i].x, -T[i].z)), one);
        // (Detailed: the legs and panel are our model, instanced below; only the digits merge here.)
        const board = detailed ? [] : [lpPart(lpBox(0.14, 3.4, 0.14), "#8d949c", 0, 1.7, -0.06), lpPart(lpBox(1.5, 1.1, 0.08), "#f4f5f7", 0, 2.85, 0)];
        if (detailed) frames.push(M.clone());
        String(d).split("").forEach((ch, n) => { for (const k of seven[ch]) { const [sx, sy, w7, h7] = seg7[k]; board.push(lpPart(lpBox(w7, h7, 0.02), "#15171a", (n - 1) * 0.44 + sx, 2.85 + sy, 0.05)); } });
        for (const p of board) { p.m.premultiply(M); parts.push(p); }
        break;
      }
    }
    const boards = new THREE.Mesh(lpMerge(parts), mat); boards.name = "brakeBoards"; boards.userData.count = parts.length ? zones.length * 3 : 0;
    boards.userData.zones = zones.map((z) => Math.round(z.a * seg)); group.add(boards); counts.brakeBoard = boards.userData.count;
    if (detail && frames.length) {
      const f = new THREE.InstancedMesh(LOWPOLY.brakeBoard(), mat, frames.length), model = DETAILED.furniture.brakeBoard; frames.forEach((x, i) => f.setMatrixAt(i, x)); f.computeBoundingSphere(); f.name = "brakeBoardFrames"; group.add(f);
      swaps.push({ model, get: () => detail.src.furniture(model), fit: (g) => dFit(f, g) });
    }
  }
  yield ["Raising the gantry", 0.9];
  // The start gantry, spanning the wall lines, with the circuit's name on its banner.
  const gs = 25, gantry = new THREE.Group(), span = HW + 2, banner = lpBanner(track.name, 2 * span * 0.78, 2 * span * 0.78 * 0.17), frame = new THREE.Mesh(LOWPOLY.gantry(span / gs - 0.1), mat);
  frame.scale.setScalar(gs); banner.position.y = 0.3 * gs; gantry.add(frame, banner);
  gantry.position.set(P[0].x, E[0] - 0.4, P[0].z); gantry.rotation.y = Math.atan2(-T[0].x, -T[0].z); gantry.name = "gantry";
  group.add(gantry); counts.gantry = 1;
  if (detail) swaps.push({ model: DETAILED.furniture.gantry, get: () => detail.src.gantry(span / gs), fit: (g) => dFit(frame, g) });
  // Beyond the land, the real skyline, and at Fuji the mountain.
  const { group: horizon, follow } = lpHorizon(track, ground, detail ? { src: detail.src, swaps } : null);
  if (ground.mount) counts.mountainFuji = 1;
  return { group, counts, banner, horizon, follow, mat, lo, swaps, detailOnly, look: detailed ? "detailed" : "lowpoly" };
}

/**
 * The drive world's horizon: the real skyline (ground.far, heights on a ring 9 km out) and at
 * Fuji the mountain itself, at its real bearing and size. Both are drawn nearer than they are, every
 * point pulled toward the camera along its own line of sight, so its bearing and elevation angle from
 * the camera are the real ones exactly: follow(camera position) redoes that each frame. They are
 * drawn first and write no depth, so everything in the world stands in front of them. detail, in the
 * Detailed look, gets our mountain model listed in its swaps.
 */
export function lpHorizon(track: Track, ground: LpGround, detail: { src: Detail["src"]; swaps: Swap[] } | null = null): { group: THREE.Group; follow: (cam: THREE.Vector3) => void } {
  const mood = track.mood, fog = new THREE.Color(mood.fog.color), dark = fog.clone().multiplyScalar(0.72), far = ground.far, n = far.n, R = 1500, group = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
  // The ring: for each bearing, its real top (9 km out) and a point about 4 degrees under the camera's
  // horizon (no lower: the land and the plain cover everything below, and this is painted undepthed).
  const real: V3[] = []; for (let k = 0; k < n; k++) { const b = (k / n) * Math.PI * 2; real.push([far.c[0] + far.r * Math.sin(b), far.H[k], far.c[1] - far.r * Math.cos(b)]); }
  const pos = new Float32Array(n * 18), col = new Float32Array(n * 18);
  for (let k = 0; k < n; k++) [fog, fog, dark, dark, fog, dark].forEach((c, v) => col.set([c.r, c.g, c.b], (k * 6 + v) * 3));
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const ring = new THREE.Mesh(g, m); ring.name = "skyline"; ring.renderOrder = -0.5; group.add(ring);
  let mtn: THREE.Mesh | null = null, S: V3 = [0, 0, 0], mpu = 0;
  if (ground.mount) {
    // The model's apex (4.4 units up) is the summit; its base sits 400 m under the zero, out of sight.
    const cone = LOWPOLY.mountainFuji(), c = cone.attributes.color as THREE.BufferAttribute, tmp = new THREE.Color();
    const body = new THREE.Color("#47566b").lerp(fog, 0.35), snow = new THREE.Color("#eef2f7").lerp(new THREE.Color(mood.sky.bottom), 0.2);
    for (let i = 0; i < c.count; i++) { tmp.copy(c.getX(i) > 0.5 ? snow : body); c.setXYZ(i, tmp.r, tmp.g, tmp.b); }
    mtn = new THREE.Mesh(cone, m); mtn.name = "mountainFuji"; mtn.renderOrder = -0.6; group.add(mtn);
    // Detailed: our mountain (same size and apex), its rock and snow toned into the haze alike.
    const drawn = mtn, sky = new THREE.Color(mood.sky.bottom);
    if (detail) detail.swaps.push({ model: DETAILED.mountainFuji, get: () => detail.src.mountain(), fit: (g) => {
      const t = g.clone(), c = t.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < c.count; i++) { tmp.fromBufferAttribute(c, i); const hi = tmp.r > 0.5; tmp.lerp(hi ? sky : fog, hi ? 0.2 : 0.35); c.setXYZ(i, tmp.r, tmp.g, tmp.b); }
      dFit(drawn, t);
    } });
    S = [ground.mount.xz[0], ground.mount.summitM, ground.mount.xz[1]]; mpu = (ground.mount.summitM + 400) / 4.4;
  }
  // Per bearing, its drawn top (x, y, z) and bottom height; filled each frame without allocating.
  // QUAD: each quad's six corners as (next bearing?, bottom?): bot k, bot k+1, top k, top k, bot k+1, top k+1.
  const top = new Float32Array(n * 3), bot = new Float32Array(n), QUAD = [0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0];
  const follow = (cam: THREE.Vector3) => {
    for (let k = 0; k < n; k++) {
      const r = real[k], dx = r[0] - cam.x, dy = r[1] - cam.y, dz = r[2] - cam.z, s = R / Math.hypot(dx, dy, dz);
      top[k * 3] = cam.x + dx * s; top[k * 3 + 1] = cam.y + dy * s; top[k * 3 + 2] = cam.z + dz * s; bot[k] = Math.min(cam.y - 0.07 * R, top[k * 3 + 1] - 1);
    }
    for (let k = 0; k < n; k++) for (let v = 0; v < 6; v++) {
      const q = QUAD[v * 2] ? (k + 1) % n : k, o = (k * 6 + v) * 3;
      pos[o] = top[q * 3]; pos[o + 1] = QUAD[v * 2 + 1] ? bot[q] : top[q * 3 + 1]; pos[o + 2] = top[q * 3 + 2];
    }
    g.attributes.position.needsUpdate = true;
    if (mtn) {
      const dx = S[0] - cam.x, dy = S[1] - cam.y, dz = S[2] - cam.z, s = 1200 / Math.hypot(dx, dy, dz);
      mtn.scale.setScalar(s * mpu); mtn.position.set(cam.x + dx * s, cam.y + dy * s - 4.4 * s * mpu, cam.z + dz * s);
    }
  };
  follow(new THREE.Vector3(far.c[0], 0, far.c[1]));
  group.children.forEach((o) => { o.frustumCulled = false; });
  return { group, follow };
}

/**
 * Detailed: modelled detail on the real buildings, on their own footprints and heights (plan
 * .buildings): a parapet round each flat roof and an eave on houses, window bands on every floor
 * of the walls (two windows a floor on a house, one big door on a hangar's longest wall, none on
 * sheds), and on a grandstand seat rows down its rake with a roof canopy over the back on columns.
 * WALL/ROOF: lpDriveBuild's colours by building type. Returns { pos, cl } triangles for one mesh.
 */
export function lpBuildingDetail(plan: Pick<DrivePlan, "buildings" | "landY">, WALL: Record<string, string>, ROOF: Record<string, string>): { pos: number[]; cl: number[] } {
  const pos: number[] = [], cl: number[] = [], C = (h: string) => new THREE.Color(h), glass = C("#26303b"), door = C("#3a4048"), seatA = C("#2f5aa6"), seatB = C("#e8e9ec"), under = C("#8d949c"), lid = C("#dfe2e5"), column = C("#9aa0a8");
  const tri = (a: V3, b: V3, c: V3, k: THREE.Color) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) cl.push(k.r, k.g, k.b); };
  const quad = (a: V3, b: V3, c: V3, d: V3, k: THREE.Color) => { tri(a, b, c, k); tri(a, c, d, k); };
  const inside = (q: XZ2[], x: number, z: number) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) if ((q[i][1] > z) !== (q[j][1] > z) && x < ((q[j][0] - q[i][0]) * (z - q[i][1])) / (q[j][1] - q[i][1]) + q[i][0]) c = !c; return c; };
  const HOMES = new Set(["house", "residential", "detached"]), PLAIN = new Set(["shed", "hut", "garage", "farm_auxiliary", "roof"]);
  // A grandstand: across it (u) and up its rake (v, from its lowest top to its highest), seat backs in
  // rows every 1.2 m or so (every fifth row white), and a canopy over the back two thirds.
  const stand = (b: PlanBuilding) => {
    const q = b.q, n = q.length; let lo = 0, hi = 0;
    for (let v = 1; v < n; v++) { if (b.tops[v] < b.tops[lo]) lo = v; if (b.tops[v] > b.tops[hi]) hi = v; }
    let vx = q[hi][0] - q[lo][0], vz = q[hi][1] - q[lo][1]; const l = Math.hypot(vx, vz); if (l < 3 || b.tops[hi] - b.tops[lo] < 1) return; vx /= l; vz /= l;
    const ux = -vz, uz = vx, o = q[lo]; let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of q) { const du = (x - o[0]) * ux + (z - o[1]) * uz, dv = (x - o[0]) * vx + (z - o[1]) * vz; u0 = Math.min(u0, du); u1 = Math.max(u1, du); v0 = Math.min(v0, dv); v1 = Math.max(v1, dv); }
    const W = (u: number, d: number, y: number): V3 => [o[0] + ux * u + vx * d, y, o[1] + uz * u + vz * d], h = (d: number) => b.tops[lo] + (b.tops[hi] - b.tops[lo]) * Math.min(1, Math.max(0, (d - v0) / (v1 - v0)));
    const rows = Math.max(3, Math.min(30, Math.round((v1 - v0) / 1.2)));
    for (let k = 0; k < rows; k++) { const d = v0 + ((k + 0.5) / rows) * (v1 - v0), y = h(d); quad(W(u0 + 0.8, d, y), W(u1 - 0.8, d, y), W(u1 - 0.8, d, y + 0.5), W(u0 + 0.8, d, y + 0.5), k % 5 === 4 ? seatB : seatA); }
    const y = b.tops[hi] + 4.5, dc = v0 + 0.35 * (v1 - v0), a = u0 - 0.4, c = u1 + 0.4, e = v1 + 0.6;
    quad(W(a, dc, y), W(c, dc, y), W(c, e, y), W(a, e, y), lid); quad(W(a, dc, y - 0.3), W(c, dc, y - 0.3), W(c, e, y - 0.3), W(a, e, y - 0.3), under);
    quad(W(a, dc, y - 0.3), W(c, dc, y - 0.3), W(c, dc, y), W(a, dc, y), under);
    for (const u of [u0, (u0 + u1) / 2, u1]) {
      const f = W(u, v1 + 0.3, 0), g = plan.landY(f[0], f[2]) - 0.3;
      for (const [p0, p1] of [[[-0.2, -0.2], [0.2, -0.2]], [[0.2, -0.2], [0.2, 0.2]], [[0.2, 0.2], [-0.2, 0.2]], [[-0.2, 0.2], [-0.2, -0.2]]]) quad(W(u + p0[0], v1 + 0.3 + p0[1], g), W(u + p1[0], v1 + 0.3 + p1[1], g), W(u + p1[0], v1 + 0.3 + p1[1], y - 0.3), W(u + p0[0], v1 + 0.3 + p0[1], y - 0.3), column);
    }
  };
  for (const b of plan.buildings) {
    if (b.stand) { stand(b); continue; }
    const q = b.q, n = q.length, kind = String(b.kind), edge = C(WALL[kind] || "#c2c4c0").multiplyScalar(0.72), roof = C(ROOF[kind] || "#7d838a"), home = HOMES.has(kind);
    let longest = 0; for (let v = 0, m = 0; v < n; v++) { const w = (v + 1) % n, L = Math.hypot(q[w][0] - q[v][0], q[w][1] - q[v][1]); if (L > m) { m = L; longest = v; } }
    for (let v = 0; v < n; v++) {
      const w = (v + 1) % n, [x0, z0] = q[v], [x1, z1] = q[w], L = Math.hypot(x1 - x0, z1 - z0); if (L < 1) continue;
      // The wall's outward side: the one a step off its middle is not inside the footprint.
      let nx = (z1 - z0) / L, nz = -(x1 - x0) / L; if (inside(q, (x0 + x1) / 2 + nx * 0.3, (z0 + z1) / 2 + nz * 0.3)) { nx = -nx; nz = -nz; }
      const t0 = b.tops[v], t1 = b.tops[w], P = (f: number, off: number, y: number): V3 => [x0 + (x1 - x0) * f + nx * off, y, z0 + (z1 - z0) * f + nz * off];
      if (home) quad(P(0, 0, t0), P(1, 0, t1), P(1, 0.55, t1 - 0.35), P(0, 0.55, t0 - 0.35), roof);
      else quad(P(0, 0.08, t0 - 0.45), P(1, 0.08, t1 - 0.45), P(1, 0.08, t1 + 0.4), P(0, 0.08, t0 + 0.4), edge);
      if (PLAIN.has(kind)) continue;
      const g0 = Math.max(plan.landY(x0, z0), plan.landY(x1, z1)), top = Math.min(t0, t1);
      if (kind === "hangar") { if (v === longest) quad(P(0.12, 0.06, g0), P(0.88, 0.06, g0), P(0.88, 0.06, g0 + (top - g0) * 0.72), P(0.12, 0.06, g0 + (top - g0) * 0.72), door); continue; }
      if (L < 3) continue;
      for (let y = g0 + 1.0; y + 1.3 < top - 0.7; y += 3.2) {
        if (home) for (const f of [0.3, 0.7]) { const a = f - 0.55 / L, c = f + 0.55 / L; quad(P(a, 0.05, y + 0.2), P(c, 0.05, y + 0.2), P(c, 0.05, y + 1.4), P(a, 0.05, y + 1.4), glass); }
        else { const a = 0.7 / L, c = 1 - 0.7 / L; if (c > a) quad(P(a, 0.05, y + 0.2), P(c, 0.05, y + 0.2), P(c, 0.05, y + 1.5), P(a, 0.05, y + 1.5), glass); }
      }
    }
  }
  return { pos, cl };
}

export interface LpSmoke {
  pts: THREE.Points;
  mat: THREE.ShaderMaterial;
  live: () => number;
  total: () => number;
  puff: (x: number, y: number, z: number) => void;
  tick: (dt: number) => void;
}

/** Tyre smoke: a small pool of soft grey puffs, one draw call. puff(x, y, z) adds one. */
export function lpSmoke(): LpSmoke {
  const n = 96, g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), age = new Float32Array(n).fill(9);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("age", new THREE.BufferAttribute(age, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 1 } }, transparent: true, depthWrite: false,
    vertexShader: `attribute float age; uniform float uPx; varying float vA; void main(){ vA=age; vec4 mv=modelViewMatrix*vec4(position+vec3(0.,age*1.6,0.),1.); gl_Position=projectionMatrix*mv; gl_PointSize=age>1.2?0.:uPx*(120.+260.*age)/-mv.z; }`,
    fragmentShader: `varying float vA; void main(){ vec2 c=gl_PointCoord-.5; float d=length(c); if(d>.5) discard; gl_FragColor=vec4(vec3(.82),(1.-vA/1.2)*.42*smoothstep(.5,.15,d)); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false;
  let k = 0, live = 0, total = 0;
  return {
    pts, mat: m, live: () => live, total: () => total,
    puff(x, y, z) { pos.set([x, y, z], k * 3); age[k] = 0; k = (k + 1) % n; total++; },
    tick(dt) { live = 0; for (let i = 0; i < n; i++) { age[i] += dt; if (age[i] < 1.2) live++; } g.attributes.position.needsUpdate = g.attributes.age.needsUpdate = true; },
  };
}

export interface LpSkids {
  mesh: THREE.Mesh;
  count: () => number;
  mark: (a: V3, b: V3, w: number) => void;
}

/** Skid marks: a ring buffer of dark quads laid on the road behind sliding tyres, one draw call. */
export function lpSkids(): LpSkids {
  const n = 600, pos = new Float32Array(n * 18), g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setDrawRange(0, 0);
  const m = new THREE.MeshBasicMaterial({ color: "#16181c", transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false;
  let k = 0, used = 0;
  return {
    mesh, count: () => used,
    // One quad from the previous contact a to this one b ([x, y, z] each), w metres wide.
    mark(a, b, w) {
      const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1, ox = ((-dz / l) * w) / 2, oz = ((dx / l) * w) / 2;
      const v = [[a[0] + ox, a[1], a[2] + oz], [a[0] - ox, a[1], a[2] - oz], [b[0] + ox, b[1], b[2] + oz], [b[0] - ox, b[1], b[2] - oz]];
      [v[0], v[2], v[1], v[1], v[2], v[3]].forEach((p, i) => pos.set(p, k * 18 + i * 3));
      k = (k + 1) % n; used = Math.min(n, used + 1); g.setDrawRange(0, used * 6); g.attributes.position.needsUpdate = true;
    },
  };
}
