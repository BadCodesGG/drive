/**
 * The real ground around each circuit, decoded from the committed data. Sources, credited on the page (ui/credit.tsx): terrain
 * heights from SPW Wallonia (LiDAR DTM, Spa), GSI Japan (Fuji) and USGS 3DEP (Sebring); the distant
 * skyline from the open Terrain Tiles; woods, land use, buildings and single trees from OpenStreetMap
 * contributors, ODbL.
 */
import type { Ground, OsmLine, OsmPoly, Track, TrackId } from "../../data/types";
import { lpRand } from "./lowpoly";

/** The ground data's encoding: Int16 little-endian deltas in base64; the running sum over unit. */
export function lpDecode(b64: string, unit: number, n: number): Float32Array {
  const s = atob(b64), out = new Float32Array(n); let acc = 0;
  for (let i = 0; i < n; i++) { const d = s.charCodeAt(2 * i) | (s.charCodeAt(2 * i + 1) << 8); acc += d > 32767 ? d - 65536 : d; out[i] = acc / unit; }
  return out;
}

export interface LpGround {
  id: TrackId;
  x0: number; z0: number; cell: number; nx: number; nz: number; x1: number; z1: number;
  H: Float32Array;
  h: (x: number, z: number) => number;
  far: Ground["far"] & { H: Float32Array };
  mount: Ground["mount"] | null;
  osm: Ground["osm"];
}

/**
 * A circuit's real ground, decoded: H the survey grid (row by row from origin, x fastest), h(x, z) its
 * bilinear height (held at the edge), far the skyline ring's heights, osm the scenery layer. The
 * engine keeps one per mount.
 */
export function lpGround(G: Ground, id: TrackId): LpGround {
  const { origin: [x0, z0], cell, nx, nz } = G.grid, H = lpDecode(G.grid.h, 10, nx * nz);
  const h = (x: number, z: number) => {
    const u = Math.min(nx - 1.000001, Math.max(0, (x - x0) / cell)), v = Math.min(nz - 1.000001, Math.max(0, (z - z0) / cell)), i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * nx + i;
    return (H[k] * (1 - fu) + H[k + 1] * fu) * (1 - fv) + (H[k + nx] * (1 - fu) + H[k + nx + 1] * fu) * fv;
  };
  return { id, x0, z0, cell, nx, nz, x1: x0 + (nx - 1) * cell, z1: z0 + (nz - 1) * cell, H, h, far: { ...G.far, H: lpDecode(G.far.h, 1, G.far.n) }, mount: G.mount || null, osm: G.osm };
}

/** Distance from (x, z) to the segment a b ([x, z] each). */
export function lpSegDist(x: number, z: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}

export interface IndexedPoly {
  src: OsmPoly;
  q: [number, number][];
  x0: number; x1: number; z0: number; z1: number;
}
/**
 * Closed polygons bucketed on a 100 m grid. at(x, z) is the one (x, z) lies in, near(x, z, r) one it
 * lies in or within r of, else null. inside(p, x, z) and edge(p, x, z) test one.
 */
export function lpPolyIndex(list: OsmPoly[]) {
  const B = 100, cells = new Map<number, number[]>(), key = (i: number, j: number) => (i + 5000) * 10000 + j + 5000, polys: IndexedPoly[] = [];
  for (const src of list) {
    const q = src.pts; if (!q || q.length < 4) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of q) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const k = polys.push({ src, q, x0, x1, z0, z1 }) - 1;
    for (let i = Math.floor(x0 / B); i <= Math.floor(x1 / B); i++) for (let j = Math.floor(z0 / B); j <= Math.floor(z1 / B); j++) { const c = key(i, j); if (!cells.has(c)) cells.set(c, []); (cells.get(c) as number[]).push(k); }
  }
  const inside = (p: IndexedPoly, x: number, z: number) => { let c = false; const q = p.q; for (let i = 0, j = q.length - 1; i < q.length; j = i++) if ((q[i][1] > z) !== (q[j][1] > z) && x < ((q[j][0] - q[i][0]) * (z - q[i][1])) / (q[j][1] - q[i][1]) + q[i][0]) c = !c; return c; };
  const edge = (p: IndexedPoly, x: number, z: number) => { let m = Infinity; for (let i = 0; i < p.q.length - 1; i++) m = Math.min(m, lpSegDist(x, z, p.q[i], p.q[i + 1])); return m; };
  const find = (x: number, z: number, r: number, test: (p: IndexedPoly) => boolean) => {
    const seen = new Set<number>();
    for (let i = Math.floor((x - r) / B); i <= Math.floor((x + r) / B); i++) for (let j = Math.floor((z - r) / B); j <= Math.floor((z + r) / B); j++) for (const k of cells.get(key(i, j)) || []) {
      if (seen.has(k)) continue; seen.add(k); const p = polys[k];
      if (x >= p.x0 - r && x <= p.x1 + r && z >= p.z0 - r && z <= p.z1 + r && test(p)) return p;
    }
    return null;
  };
  return { polys, inside, edge, at: (x: number, z: number) => find(x, z, 0, (p) => inside(p, x, z)), near: (x: number, z: number, r: number) => find(x, z, r, (p) => inside(p, x, z) || edge(p, x, z) < r) };
}

/** Polylines ({ pts, w }) as segments bucketed on a 50 m grid: near(x, z, r) is true within w / 2 + r of one. */
export function lpLineIndex(list: OsmLine[]) {
  const B = 50, cells = new Map<number, number[]>(), key = (i: number, j: number) => (i + 5000) * 10000 + j + 5000, segs: [[number, number], [number, number], number][] = [];
  for (const l of list) for (let n = 0; n < l.pts.length - 1; n++) {
    const a = l.pts[n], b = l.pts[n + 1], k = segs.push([a, b, (l.w || 0) / 2]) - 1;
    for (let i = Math.floor(Math.min(a[0], b[0]) / B); i <= Math.floor(Math.max(a[0], b[0]) / B); i++) for (let j = Math.floor(Math.min(a[1], b[1]) / B); j <= Math.floor(Math.max(a[1], b[1]) / B); j++) { const c = key(i, j); if (!cells.has(c)) cells.set(c, []); (cells.get(c) as number[]).push(k); }
  }
  const near = (x: number, z: number, r: number) => {
    const e = r + 5;
    for (let i = Math.floor((x - e) / B); i <= Math.floor((x + e) / B); i++) for (let j = Math.floor((z - e) / B); j <= Math.floor((z + e) / B); j++) for (const k of cells.get(key(i, j)) || []) { const [a, b, h] = segs[k]; if (lpSegDist(x, z, a, b) < h + r) return true; }
    return false;
  };
  return { segs, near };
}

/**
 * The miniature's groups of trees, moved to where the map has trees: for each landmark with a
 * count and an osm id, up to count spots in metres, inside the wood or scrub that id names or, where
 * the id is a single mapped tree, on that tree and the unused mapped trees nearest it. clear(x, z)
 * keeps them off the miniature's road and on its land. Returns { landmark index: [[x, z], ...] }.
 */
export function lpHeroWoods(track: Track, ground: LpGround, clear: (x: number, z: number) => boolean): Record<number, [number, number][]> {
  const e = track.line, line: [number, number][] = [], osm = ground.osm, polys = lpPolyIndex([...osm.woods, ...osm.scrub]), used = new Set<number>(), out: Record<number, [number, number][]> = {};
  for (let i = 0, x = 0, z = 0; i < e.length; i += 2) { x += e[i] / 10; z += e[i + 1] / 10; line.push([x, z]); }
  (track.landmarks || []).forEach((lm, k) => {
    if (!((lm.count ?? 0) > 1) || !lm.osm) return;
    const count = lm.count as number, r = lpRand(k * 7919 + 17), spots: [number, number][] = [], tree = osm.trees.find((t) => String(t[2]) === lm.osm);
    if (tree) {
      const d = (t: [number, number, number]) => Math.hypot(t[0] - tree[0], t[1] - tree[1]);
      for (const t of osm.trees.filter((t) => !used.has(t[2]) && clear(t[0], t[1])).sort((a, b) => d(a) - d(b)).slice(0, count)) { used.add(t[2]); spots.push([t[0], t[1]]); }
    } else {
      const p = polys.polys.find((q) => String(q.src.id) === lm.osm); if (!p) return;
      const a = line[Math.round((lm.at as number) * line.length) % line.length], dA = (v: [number, number]) => Math.hypot(v[0] - a[0], v[1] - a[1]);
      const c = polys.inside(p, a[0], a[1]) ? a : p.q.reduce((m, v) => (dA(v) < dA(m) ? v : m));
      for (let t = 0; t < count * 80 && spots.length < count; t++) { const ang = r() * Math.PI * 2, d = Math.sqrt(r()) * 220, x = c[0] + Math.cos(ang) * d, z = c[1] + Math.sin(ang) * d; if (polys.inside(p, x, z) && clear(x, z)) spots.push([x, z]); }
    }
    out[k] = spots;
  });
  return out;
}
