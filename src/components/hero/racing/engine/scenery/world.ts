/**
 * Everything around the miniature's road, in both looks (Low poly and Detailed).
 */
import * as THREE from "three";
import type { Track } from "../../data/types";
import { DETAILED, detailedTree, dFit, type Detail, type Swap } from "../detailed";
import { lpHeroWoods, lpPolyIndex, type LpGround } from "./ground";
import { LOWPOLY, lpRand, lpSmooth } from "./lowpoly";
import { lpBanner } from "./sky";

/** The miniature's own centreline: points, unit tangents, count, half road width, heights. */
export interface MiniTrack {
  P: THREE.Vector3[];
  T: THREE.Vector3[];
  N: number;
  HW: number;
  E: Float32Array;
}

export interface LpWorld {
  group: THREE.Group;
  counts: Record<string, number>;
  banner: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
  groundAt: (x: number, z: number) => number;
  /** Detailed: the models to fit in place of their Low poly stand-ins (empty in Low poly). */
  swaps: Swap[];
}

interface Placed {
  x: number;
  z: number;
  y: number;
  rot: number;
  s: number;
  tint?: number;
}

/**
 * Terrain following the track's height, kerbs, barriers, the gantry and every landmark. trk is the
 * miniature's { P, T, N, HW, E }; load/peak its curvature profile. ground is the circuit's decoded
 * real ground (lpGround), or null. detail, when given, is the Detailed look: the land takes
 * the colour of what the map says covers it and shades smooth, and swaps lists the models to fit in
 * once they load (the Low poly pieces stand in until then).
 */
export function lpWorld(track: Track, ground: LpGround | null, trk: MiniTrack, load: Float32Array, peak: number, mobile: boolean, detail: Detail | null = null): LpWorld {
  const { P, T, N, HW, E } = trk, mood = track.mood, group = new THREE.Group(), counts: Record<string, number> = {}, swaps: Swap[] = [];
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: !detail });
  const eMin = Math.min(...E), eMax = Math.max(...E), lo = eMin - 0.05, amp = (eMax - eMin) * 0.8;
  const near = (x: number, z: number): [number, number] => {
    let bd = Infinity, bi = 0;
    for (let i = 0; i < N; i += 6) { const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    for (let j = -6; j <= 6; j++) { const i = (bi + j + N) % N, d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    return [Math.sqrt(bd), bi];
  };
  // Ground: level with the road beside it, easing off into rolling hills (taller where the circuit
  // itself climbs more), down to a flat plain out to the horizon.
  const groundAt = (x: number, z: number) => {
    const [d, i] = near(x, z), road = 1 - lpSmooth(HW + 0.06, HW + 1.2, d);
    const hills = amp * (0.55 + 0.45 * Math.sin(x * 1.1 + 0.7) * Math.sin(z * 1.35 - 0.4)) * lpSmooth(HW + 0.25, HW + 1.5, d);
    return lo + (E[i] - 0.014 - lo) * road + hills;
  };
  // The miniature's units per metre (kM: the hero's pts are the traced line, scaled), for its woods.
  let kM = 0, bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  if (ground) {
    let lx = 0, l0 = Infinity, l1 = -Infinity;
    for (let i = 0; i < track.line.length; i += 2) { lx += track.line[i] / 10; l0 = Math.min(l0, lx); l1 = Math.max(l1, lx); }
    for (const p of P) { bx0 = Math.min(bx0, p.x); bx1 = Math.max(bx1, p.x); bz0 = Math.min(bz0, p.z); bz1 = Math.max(bz1, p.z); }
    const px = track.pts.map((p) => p[0]); kM = (Math.max(...px) - Math.min(...px)) / (l1 - l0);
  }
  // Detailed: open ground, water, airport concrete, parking, forest floor, scrub, meadow, grass,
  // farmland, as the drive world colours them, looked up in metres.
  let cover: ((x: number, z: number) => number) | null = null, COVER: THREE.Color[] = [];
  if (detail && ground) {
    const o = ground.osm, idx = [o.water, o.aeroway, o.parking, o.woods, o.scrub].map((l) => lpPolyIndex(l)), grassI = lpPolyIndex(o.grass), base = new THREE.Color(mood.ground), tint = (hex: string, k: number) => base.clone().lerp(new THREE.Color(hex), k);
    COVER = [base, new THREE.Color("#3e6a88"), new THREE.Color("#a4a6a3"), new THREE.Color("#6c6f75"), tint("#1e3322", 0.55), tint("#55603a", 0.4), tint("#9aa55a", 0.25), base.clone().multiplyScalar(1.1), tint("#a8965e", 0.4)];
    const KIND: Record<string, number> = { meadow: 6, grass: 7, farmland: 8 };
    cover = (x, z) => { for (let k = 0; k < 5; k++) if (idx[k].at(x, z)) return k + 1; return KIND[grassI.at(x, z)?.src.kind ?? ""] || 0; };
  }
  {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const M = 2.4, cell = mobile ? 0.14 : 0.1; x0 -= M; x1 += M; z0 -= M; z1 += M;
    const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell), grass = new THREE.Color(mood.ground), c = new THREE.Color();
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), edge = lpSmooth(0, 1.4, Math.min(x - x0, x1 - x, z - z0, z1 - z));
      p.setY(i, lo + (groundAt(x, z) - lo) * edge);
      // (Detailed: the cover at five points round the node, averaged, so the woods' edges are soft.)
      let K = 0;
      if (cover) { c.setRGB(0, 0, 0); const d = cell * 0.35; for (const [a, b] of [[0, 0], [d, d], [-d, d], [d, -d], [-d, -d]]) { const k = cover((x + a) / kM, (z + b) / kM); c.r += COVER[k].r / 5; c.g += COVER[k].g / 5; c.b += COVER[k].b / 5; if (!a && !b) K = k; } }
      else c.copy(grass);
      c.multiplyScalar(K === 1 ? 1 : 0.86 + 0.2 * (0.5 + 0.5 * Math.sin(x * 4.1 + Math.sin(z * 3.3) * 1.7))); col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    const land = new THREE.Mesh(g, mat); land.receiveShadow = true; group.add(land);
    const plain = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: grass.clone().multiplyScalar(0.93) }));
    plain.rotation.x = -Math.PI / 2; plain.position.y = lo - 0.004; group.add(plain);
  }
  // Kerbs (red and white where the road bends), a white edge line, and low grey barriers.
  {
    const side = (i: number, s: number, w: number, dy: number) => { const p = P[i % N], t = T[i % N]; return [p.x - t.z * w * s, E[i % N] + dy, p.z + t.x * w * s]; };
    const kerb: number[] = [], kc: number[] = [], bar: number[] = [], bc: number[] = [], red = new THREE.Color("#d9453a"), white = new THREE.Color("#eef0f3"), grey = new THREE.Color("#cfd4da");
    const quad = (arr: number[], cols: number[], a: number[], b: number[], c: number[], d: number[], col: THREE.Color) => { arr.push(...a, ...c, ...b, ...b, ...c, ...d); for (let k = 0; k < 6; k++) cols.push(col.r, col.g, col.b); };
    for (let i = 0; i < N; i++) {
      const bend = load[i] / peak > 0.42;
      for (const s of [1, -1]) {
        const [a0, a1] = bend ? [HW - 0.024, HW + 0.012] : [HW - 0.012, HW - 0.002];
        const inA = side(i, s, a0, 0.007), outA = side(i, s, a1, 0.007), inB = side(i + 1, s, a0, 0.007), outB = side(i + 1, s, a1, 0.007);
        const kcol = bend && (i >> 2) % 2 ? red : white; // wound so the face points up on both sides
        if (s > 0) quad(kerb, kc, outA, inA, outB, inB, kcol); else quad(kerb, kc, inA, outA, inB, outB, kcol);
        const w = HW + 0.08, lowA = side(i, s, w, -0.02), hiA = side(i, s, w, 0.03), lowB = side(i + 1, s, w, -0.02), hiB = side(i + 1, s, w, 0.03);
        // No barrier where another leg of the circuit runs close by (a hairpin's other side).
        if (near(lowA[0], lowA[2])[0] > HW + 0.04) quad(bar, bc, lowA, hiA, lowB, hiB, ((i / 12) | 0) % 2 ? grey : grey.clone().multiplyScalar(0.86));
      }
    }
    const mk = (arr: number[], cols: number[], sideMode: boolean) => {
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, sideMode ? new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }) : mat); m.receiveShadow = !sideMode; return m;
    };
    group.add(mk(kerb, kc, false), mk(bar, bc, true));
  }
  // The gantry over the start/finish line, with the circuit's name on its banner.
  const gantry = new THREE.Group(), banner = lpBanner(track.name, 0.42, 0.075), frame = new THREE.Mesh(LOWPOLY.gantry(HW), mat);
  gantry.add(frame, banner); banner.position.y = 0.3;
  if (detail) swaps.push({ model: DETAILED.furniture.gantry, get: () => detail.src.gantry(HW + 0.1), fit: (g) => dFit(frame, g) });
  gantry.position.set(P[0].x, E[0] - 0.014, P[0].z); gantry.rotation.y = Math.atan2(-T[0].x, -T[0].z); gantry.name = "gantry";
  group.add(gantry); counts.gantry = 1;
  // Landmarks: single buildings face the track at their anchor. Groups of trees stand where the map
  // has them, brought to this scale, kept on this land and off this (wider than life) road.
  const items: Record<string, Placed[]> = {};
  let heroWoods: Record<number, [number, number][]> = {};
  if (ground) {
    heroWoods = lpHeroWoods(track, ground, (x, z) => x * kM > bx0 - 2.2 && x * kM < bx1 + 2.2 && z * kM > bz0 - 2.2 && z * kM < bz1 + 2.2 && near(x * kM, z * kM)[0] > HW + 0.16);
    for (const k in heroWoods) heroWoods[k] = heroWoods[k].map(([x, z]) => [x * kM, z * kM]);
  }
  (track.landmarks || []).forEach((lm, k) => {
    if (lm.type === "gantry" || !LOWPOLY[lm.type]) return;
    const list = items[lm.type] || (items[lm.type] = []), r = lpRand(k * 7919 + 17);
    if (lm.pos) { list.push({ x: lm.pos[0], z: lm.pos[1], y: lo - 0.02, rot: 0, s: 1 }); return; }
    if (heroWoods[k]) { for (const [x, z] of heroWoods[k]) list.push({ x, z, y: groundAt(x, z), rot: r() * Math.PI * 2, s: 0.8 + r() * 0.55, tint: 0.82 + r() * 0.3 }); return; }
    const side = lm.side as number, offset = lm.offset as number;
    const i = Math.round((lm.at as number) * N) % N, nx = -T[i].z * side, nz = T[i].x * side;
    const cx = P[i].x + nx * (HW + offset), cz = P[i].z + nz * (HW + offset), n = lm.count || 1, spread = lm.spread || 0;
    for (let c = 0; c < n; c++) {
      let x = cx, z = cz, ok = n === 1;
      for (let t = 0; t < 24 && !ok; t++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread; x = cx + Math.cos(a) * d; z = cz + Math.sin(a) * d; ok = near(x, z)[0] > HW + 0.16; }
      if (ok) list.push({ x, z, y: groundAt(x, z), rot: n > 1 ? r() * Math.PI * 2 : Math.atan2(-nx, -nz), s: n > 1 ? 0.8 + r() * 0.55 : 1, tint: n > 1 ? 0.82 + r() * 0.3 : 1 });
    }
  });
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  for (const [type, list] of Object.entries(items)) {
    if (!list.length) continue;
    const m = new THREE.InstancedMesh(LOWPOLY[type](), mat, list.length);
    list.forEach((it, j) => { m.setMatrixAt(j, mtx.compose(v.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.rot), sc.setScalar(it.s))); m.setColorAt(j, col.setScalar(it.tint || 1)); });
    m.name = type; group.add(m); counts[type] = list.length;
    // Detailed: the circuit's own species (the first of its stands), and Mount Fuji's model.
    const model = !detail ? null : type === "mountainFuji" ? DETAILED.mountainFuji : detailedTree(detail.trackId, type);
    // (A copy: this miniature's geometry is freed with it, and the cached drive world shares the model's.)
    if (detail && model) swaps.push({ model, get: () => (type === "mountainFuji" ? detail.src.mountain() : detail.src.tree(model)), fit: (g) => dFit(m, g.clone()) });
  }
  return { group, counts, banner, mat, groundAt, swaps };
}
