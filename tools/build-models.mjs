// Generates every 3D model the Detailed look uses (public/hero/models/*.glb) in code: the two cars,
// the trees, the start gantry, trackside furniture and Mount Fuji. Each is built from primitives and
// lofted profiles here and exported with three's GLTFExporter. There are no textures and no
// third-party assets, and nothing carries a manufacturer's, team's or sponsor's name or mark:
// liveries are flat colour and a race number.
//   npm run models                      writes to public/hero/models
//   node tools/build-models.mjs [outdir]
// Headless Node, no browser or DOM. Deterministic for a given three version: no unseeded randomness
// and no clock. The committed files were exported with an earlier three release, so regenerating
// with the installed one can change their bytes without changing what they look like.
//
// Units follow the Low poly builders in src/components/hero/racing/engine/scenery/lowpoly.ts, so the
// game scales both looks the same way:
//   cars: x forward, y up, z to the right, about 2.3 units long, wheels where the Low poly cars
//   have them;
//   trees: the Low poly tree of the same kind's size (the scenery takes them to metres);
//   gantry: posts at x = +-1 and the beam at the Low poly gantry's height (the game moves the posts
//   and stretches the beam to the road's width); Mount Fuji: the Low poly cone's size, apex at 4.4;
//   trackside furniture: metres, x along the barrier, +z toward the track.
// Geometry is stored indexed with positions only: the game merges each model into one vertex-coloured
// mesh and rebuilds the normals with a crease angle (engine/detailed.ts), which keeps each file small.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// GLTFExporter's binary path reads its Blob back through FileReader, which Node lacks.
globalThis.FileReader ??= class { readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend(); }); } };

const here = path.dirname(fileURLToPath(import.meta.url)), out = path.resolve(process.argv[2] || path.join(here, "..", "public", "hero", "models"));
const PI = Math.PI;
/** A seeded generator (the same one the Low poly scenery uses), so every jitter is reproducible. */
const rand = (s) => () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
/** A smooth curve through keys [[x, v], ...] (monotone cubic, so it never overshoots a key). */
function ip(keys) {
  const n = keys.length, d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((keys[i + 1][1] - keys[i][1]) / (keys[i + 1][0] - keys[i][0]));
  for (let i = 0; i < n; i++) m.push(i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  return (x) => {
    if (x <= keys[0][0]) return keys[0][1];
    if (x >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0; while (keys[i + 1][0] < x) i++;
    const h = keys[i + 1][0] - keys[i][0], t = (x - keys[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * keys[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * keys[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

// ---------- Building blocks ----------
/** A model's materials: one per colour name, created once, named for what they are. */
function palette(colours) { const m = {}; for (const [k, v] of Object.entries(colours)) m[k] = new THREE.MeshStandardMaterial({ name: k, color: v, roughness: 0.8 }); return m; }
/** The pieces of one node, by material; mesh(name) merges them into one indexed mesh. */
class Parts {
  constructor() { this.list = []; }
  /** geo placed by position, Euler rotation and scale. */
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return this.addM(geo, mat, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  }
  addM(geo, mat, m4) {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", geo.attributes.position.clone()); if (geo.index) g.setIndex(geo.index.clone());
    g.applyMatrix4(m4); if (m4.determinant() < 0) flip(g); this.list.push([g, mat]); return this;
  }
  mesh(name) {
    const byMat = new Map();
    for (const [g, m] of this.list) { if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(g.index ? g : mergeVertices(g, 1e-5)); }
    const mats = [...byMat.keys()], geos = mats.map((m) => solid(mergeVertices(mergeGeometries(byMat.get(m)), 1e-5)));
    const geo = mats.length === 1 ? geos[0] : mergeGeometries(geos, true), mesh = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
    mesh.name = name; return mesh;
  }
}
/** Reverses every triangle's winding (after a mirror, or to face an open surface inward). */
function flip(g) {
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
  g.index.needsUpdate = true; return g;
}
/** Drops the triangles that welding collapsed (a cone's apex, a lathe's closed end). */
function solid(g) {
  const a = g.index.array, keep = [];
  for (let i = 0; i < a.length; i += 3) if (a[i] !== a[i + 1] && a[i + 1] !== a[i + 2] && a[i] !== a[i + 2]) keep.push(a[i], a[i + 1], a[i + 2]);
  g.setIndex(keep); return g;
}
/** Positions and triangles into an indexed geometry. */
function geom(pos, idx) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g; }
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, n, open = false) => new THREE.CylinderGeometry(r0, r1, h, n, 1, open);
/** A cylinder of radius r from point a to point b ([x, y, z] each), n sides. */
function rod(parts, a, b, r, mat, n = 4) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  return parts.addM(cyl(r, r, d.length(), n, true), mat, new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}
/** Placement at pos turning the axis from onto dir. */
const aim = (from, dir, pos) => new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...from).normalize(), new THREE.Vector3(...dir).normalize()), new THREE.Vector3(1, 1, 1));
/** A tube of radius r along points, n sides. */
const tube = (pts, r, seg, n = 5) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, "centripetal"), seg, r, n, false);
/** A closed 2D outline [[u, v], ...] in the x-y plane, extruded depth along z and centred on z = 0. */
function slab(pts, depth) { const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v))), { depth, bevelEnabled: false, curveSegments: 1 }); g.translate(0, 0, -depth / 2); return g; }
/** A thin wing section from its leading edge (x0, y0) to its trailing edge (x1, y1), t thick. */
const foil = (x0, y0, x1, y1, t) => [[x0, y0], [mix(x0, x1, 0.25), mix(y0, y1, 0.25) + t], [mix(x0, x1, 0.7), mix(y0, y1, 0.7) + t * 0.6], [x1, y1 + t * 0.2], [x1, y1], [mix(x0, x1, 0.4), mix(y0, y1, 0.4) - t * 0.2]];
/** Seven-segment digits as boxes on a plane (u across, v up, facing +w), h tall, t proud. */
function digits(parts, text, mat, h, m4, t = 0.004) {
  const DIG = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
  const w = h * 0.55, s = h * 0.13, seg = { a: [0, h / 2 - s / 2, w, s], g: [0, 0, w, s], d: [0, -h / 2 + s / 2, w, s], f: [-w / 2 + s / 2, h / 4, s, h / 2], b: [w / 2 - s / 2, h / 4, s, h / 2], e: [-w / 2 + s / 2, -h / 4, s, h / 2], c: [w / 2 - s / 2, -h / 4, s, h / 2] };
  [...text].forEach((ch, n) => { const u0 = (n - (text.length - 1) / 2) * w * 1.3; for (const k of DIG[ch]) { const [u, v, bw, bh] = seg[k]; parts.addM(box(bw, bh, t), mat, m4.clone().multiply(new THREE.Matrix4().makeTranslation(u0 + u, v, t / 2))); } });
}
/**
 * A loft along x: one ring per station, from a half profile p ([z, y] with z >= 0) that starts on
 * the underside's centreline and ends on the top's, mirrored to the other side. mat(i, j) names the
 * material of the face between stations i and i + 1 and half-profile points j and j + 1; the end
 * caps take capMats [rear, front]. Adds each material's faces to parts.
 */
function loft(parts, st, mat, capMats) {
  const k = st[0].p.length, R = 2 * (k - 1), pos = [], faces = new Map(), put = (m, ...v) => { if (!faces.has(m)) faces.set(m, []); faces.get(m).push(...v); };
  for (const s of st) { for (let j = 0; j < k; j++) pos.push(s.x, s.p[j][1], s.p[j][0]); for (let j = k - 2; j >= 1; j--) pos.push(s.x, s.p[j][1], -s.p[j][0]); }
  const half = (r) => (r < k ? r : R - r);
  for (let i = 0; i < st.length - 1; i++) for (let r = 0; r < R; r++) {
    const r1 = (r + 1) % R, a = i * R + r, b = i * R + r1, c = (i + 1) * R + r1, d = (i + 1) * R + r;
    put(mat(i, Math.min(half(r), half(r1))), a, d, c, a, c, b);
  }
  [[0, capMats[0], false], [st.length - 1, capMats[1], true]].forEach(([i, m, front]) => {
    let cy = 0; for (const [, y] of st[i].p) { cy += y / k; } const c = pos.length / 3; pos.push(st[i].x, cy, 0); // the loft is mirrored, so the cap's centre is on z = 0
    for (let r = 0; r < R; r++) { const a = i * R + r, b = i * R + ((r + 1) % R); if (front) put(m, c, b, a); else put(m, c, a, b); }
  });
  for (const [m, idx] of faces) parts.add(geom(pos, idx), m);
}

// ---------- Wheels: axle along z, the outer face toward +z, centred on the hub ----------
/** A race wheel: a rounded tyre, a rim barrel, spokes (or a flat cover) and a centre-lock nut. */
function wheel(M, r, w, { spokes = 10, rim = 0.66, cover = false, band = null } = {}) {
  const p = new Parts(), ri = r * rim, h = w / 2;
  const prof = [[ri, -h + 0.012], [r - 0.036, -h], [r - 0.012, -h + 0.018], [r, -h + 0.05], [r, h - 0.05], [r - 0.012, h - 0.018], [r - 0.036, h], [ri, h - 0.012]];
  const tyre = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 18); tyre.rotateX(PI / 2); p.add(tyre, M.tyre);
  p.add(flip(cyl(ri, ri, w - 0.03, 18, true)), M.barrel, 0, 0, 0, PI / 2);
  p.add(cyl(ri * 0.78, ri * 0.78, 0.018, 16), M.disc, 0, 0, -0.015, PI / 2);
  if (cover) p.add(cyl(ri * 0.97, ri * 0.97, 0.012, 18), M.cover, 0, 0, h - 0.02, PI / 2);
  else {
    p.add(new THREE.RingGeometry(ri * 0.84, ri, 18), M.rim, 0, 0, h - 0.012);
    for (let s = 0; s < spokes; s++) { const a = (s / spokes) * PI * 2 + (s % 2 ? 0.16 : 0), l = ri * 0.84 - 0.04; p.add(box(l, 0.02, 0.018), M.rim, Math.cos(a) * (0.04 + l / 2), Math.sin(a) * (0.04 + l / 2), h - 0.022, 0, 0, a); }
  }
  p.add(cyl(0.045, 0.05, 0.03, 12), M.rim, 0, 0, h - 0.012, PI / 2);
  p.add(cyl(0.022, 0.022, 0.03, 6), M.nut, 0, 0, h, PI / 2);
  if (band) p.add(new THREE.RingGeometry(r * 0.78, r * 0.82, 18), M[band], 0, 0, h + 0.002);
  return p;
}
/** The car's root: body (with its glass as a child node) and the four named wheel nodes. */
function carScene(name, body, glass, wheels, M) {
  const root = new THREE.Group(); root.name = name;
  const b = body.mesh("body"); b.add(glass.mesh("glass")); root.add(b);
  const shared = {};
  for (const [id, x, z, r, w, opts] of wheels) {
    const key = `${r}:${w}`, node = new THREE.Group(); node.name = id; node.position.set(x, r, z);
    const m = shared[key] || (shared[key] = wheel(M, r, w, opts).mesh(`tyre-${id.slice(-2, -1)}`));
    const tyre = new THREE.Mesh(m.geometry, m.material); tyre.name = `tyre-${id.slice(6)}`;
    if (z < 0) tyre.rotation.y = PI; // the outer face out on the left side too
    node.add(tyre); root.add(node);
  }
  return root;
}

// ---------- GT3: an unbadged rear-engined coupe ----------
// A lofted body with front fenders standing proud of the bonnet, round headlights set into them, a
// fastback over the engine, wide rear hips, wheel arches cut into the sides, separate glass, a
// swan-neck wing, and a flat livery: yellow, a dark centre stripe, roundels with the number 21.
function gt3() {
  const M = palette({ paint: "#f2b632", stripe: "#1f242d", carbon: "#24282f", well: "#15181c", glass: "#1c2837", lamp: "#fff4c8", tail: "#e0413a", chrome: "#c4c9d1", roundel: "#f4f5f7", numeral: "#15171a", tyre: "#1e2126", barrel: "#2a2e34", disc: "#6d7278", rim: "#3a3f47", nut: "#d9453a" });
  const body = new Parts(), glass = new Parts();
  const W = ip([[-1.17, 0.53], [-1.1, 0.585], [-0.95, 0.605], [-0.68, 0.61], [-0.4, 0.57], [-0.1, 0.525], [0.2, 0.52], [0.45, 0.53], [0.68, 0.545], [0.92, 0.53], [1.08, 0.49], [1.16, 0.43], [1.19, 0.36]]);
  const YB = ip([[-1.17, 0.2], [-1.05, 0.15], [-0.9, 0.13], [0.9, 0.13], [1.1, 0.14], [1.19, 0.17]]);
  const YS = ip([[-1.17, 0.44], [-1.1, 0.54], [-0.95, 0.62], [-0.68, 0.645], [-0.42, 0.6], [-0.15, 0.565], [0.2, 0.56], [0.45, 0.57], [0.68, 0.615], [0.9, 0.585], [1.05, 0.5], [1.14, 0.43], [1.19, 0.34]]);
  const YT = ip([[-1.17, 0.48], [-1.12, 0.585], [-1.0, 0.62], [-0.8, 0.66], [-0.62, 0.74], [-0.42, 0.83], [-0.15, 0.875], [0.12, 0.855], [0.3, 0.66], [0.48, 0.49], [0.7, 0.475], [0.95, 0.44], [1.1, 0.38], [1.19, 0.3]]);
  const cab = (x) => smooth(0.5, 0.3, x) * smooth(-0.92, -0.62, x), WHEELS = [[0.68, 0.27], [-0.68, 0.28]], T = 0.335;
  const xs = new Set(); for (let x = -1.17; x < 1.19; x += 0.05) xs.add(+x.toFixed(4)); xs.add(1.19);
  for (const [wx, r] of WHEELS) { const R = r + 0.035; for (const d of [-R - 0.006, -R, -R * 0.8, -R * 0.55, -R * 0.3, 0, R * 0.3, R * 0.55, R * 0.8, R, R + 0.006]) xs.add(+(wx + d).toFixed(4)); for (const x of [...xs]) if (Math.abs(x - wx) < R && Math.abs(x - wx) > 0.001 && ![0.3, 0.55, 0.8].some((f) => Math.abs(Math.abs(x - wx) - R * f) < 1e-3)) xs.delete(x); }
  const st = [...xs].sort((a, b) => a - b).map((x) => {
    const w = W(x), yb = YB(x), ys = YS(x), yt = YT(x), c = cab(x);
    let arch = null; for (const [wx, r] of WHEELS) { const R = r + 0.035, d = x - wx; if (Math.abs(d) <= R + 1e-6) arch = r + Math.sqrt(Math.max(0, R * R - d * d)); }
    const p4 = arch ? [w + 0.014, arch + 0.012] : [w, 0.37], p5 = [w - 0.004, Math.max(ys - 0.09, p4[1] + 0.02)], p6 = [w - 0.04, Math.max(ys, p5[1] + 0.02)];
    const p7 = [mix(0.64 * w, 0.86 * w, c), Math.max(mix(ys + 0.022, ys + 0.012, c), p6[1] + 0.008)];
    return { x, c, p: [[0, yb], arch ? [T - 0.03, yb] : [w - 0.07, yb], arch ? [T, yb + 0.05] : [w - 0.012, yb + 0.05], arch ? [T, arch - 0.012] : [w, 0.27], p4, p5, p6, p7,
      [mix(0.3, 0.355, c), mix(yt + 0.012, yt - 0.042, c)], [mix(0.27, 0.33, c), mix(yt + 0.01, yt - 0.017, c)], [0.075, yt - 0.002 * c], [0, yt]], arch: !!arch };
  });
  // Faces by band: j 0-1 underside and sill (carbon), 2-3 the wheel well inside an arch, 7 side
  // windows, 9-10 windscreen and rear window, 10 the centre stripe elsewhere.
  loft({ add: (g, m) => (m === M.glass ? glass : body).add(g, m) }, st, (i, j) => {
    const x = (st[i].x + st[i + 1].x) / 2, arch = st[i].arch && st[i + 1].arch, c = Math.min(st[i].c, st[i + 1].c);
    if (j <= 1) return M.carbon;
    if (j <= 3 && arch) return M.well;
    if (j === 2) return M.carbon;
    if (j === 3 && x > 1.12) return M.carbon; // the front intakes
    if (j === 7 && c > 0.55 && x > -0.52 && !(x > -0.15 && x < -0.08)) return M.glass;
    if (j >= 9 && ((x > 0.14 && x < 0.47) || (x > -0.62 && x < -0.34))) return M.glass;
    if (j === 10) return M.stripe;
    return M.paint;
  }, [M.paint, M.paint]);
  // Round headlights set into the fronts of the fenders, tilted up with the fender's line.
  for (const s of [-1, 1]) {
    const lamp = [1.075, 0.462, s * 0.33], face = [Math.cos(0.6), Math.sin(0.6), 0];
    body.addM(new THREE.TorusGeometry(0.082, 0.013, 5, 16), M.chrome, aim([0, 0, 1], face, lamp));
    body.addM(new THREE.SphereGeometry(0.078, 14, 4, 0, PI * 2, 0, PI / 2).scale(1, 0.4, 1), M.lamp, aim([0, 1, 0], face, lamp));
    // Mirror on a stalk, louvres on the front fender, a roundel with the number on each door.
    body.add(box(0.03, 0.02, 0.08), M.carbon, 0.33, 0.6, s * 0.49).add(box(0.07, 0.05, 0.11), M.paint, 0.32, 0.615, s * 0.555);
    for (let k = 0; k < 4; k++) body.add(box(0.03, 0.008, 0.1), M.carbon, 0.6 + k * 0.05, YS(0.6 + k * 0.05) + 0.012, s * 0.44);
    const door = new THREE.Matrix4().compose(new THREE.Vector3(-0.02, 0.36, s * (W(-0.02) + 0.004)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s > 0 ? 0 : PI, 0)), new THREE.Vector3(1, 1, 1));
    body.addM(cyl(0.095, 0.095, 0.006, 22), M.roundel, door.clone().multiply(new THREE.Matrix4().makeRotationX(PI / 2)));
    digits(body, "21", M.numeral, 0.11, door.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.003)));
    body.add(cyl(0.034, 0.034, 0.08, 10), M.chrome, -1.16, 0.2, s * 0.1, 0, 0, PI / 2);
    // The swan necks: plates rising from the engine lid and hooking over onto the wing's top.
    body.add(tube([[-0.99, 0.62, s * 0.17], [-1.0, 0.8, s * 0.17], [-1.06, 0.975, s * 0.17], [-1.14, 0.99, s * 0.17], [-1.18, 0.95, s * 0.17]], 0.013, 10, 4), M.carbon);
    body.add(box(0.3, 0.2, 0.012), M.carbon, -1.2, 0.9, s * 0.556);
  }
  // The bonnet's roundel and number, reading from the cockpit.
  { const m4 = new THREE.Matrix4().compose(new THREE.Vector3(0.84, YT(0.84) + 0.006, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(-PI / 2, 0, -PI / 2)), new THREE.Vector3(1, 1, 1));
    body.addM(cyl(0.1, 0.1, 0.006, 22), M.roundel, m4.clone().multiply(new THREE.Matrix4().makeRotationX(PI / 2))); digits(body, "21", M.numeral, 0.12, m4.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.003))); }
  // The wing: a cambered main plane with a gurney lip, endplates, on the swan necks.
  body.add(slab([[-1.06, 0.915], [-1.12, 0.94], [-1.22, 0.945], [-1.32, 0.955], [-1.32, 0.943], [-1.2, 0.922], [-1.1, 0.905]], 1.1), M.carbon);
  body.add(box(0.012, 0.025, 1.1), M.carbon, -1.315, 0.965, 0);
  // Splitter, full-width tail light bar, diffuser fins, a roof scoop and engine-lid louvres.
  body.add(box(0.3, 0.015, 1.0), M.carbon, 1.08, 0.125, 0);
  body.add(box(0.03, 0.035, 0.86), M.tail, -1.155, 0.52, 0);
  for (const z of [-0.3, -0.1, 0.1, 0.3]) body.add(box(0.2, 0.06, 0.012), M.carbon, -1.1, 0.16, z);
  body.add(box(0.2, 0.025, 0.16), M.carbon, 0.02, YT(0.02) + 0.008, 0);
  for (let k = 0; k < 5; k++) body.add(box(0.025, 0.01, 0.34), M.carbon, -0.84 - k * 0.04, YT(-0.84 - k * 0.04) + 0.006, 0);
  // The cockpit's own interior: the loft above is a single exterior skin with no
  // hollow cabin behind it, so without these the Detailed look showed nothing but the outside of the
  // hood from inside. A dash top, raked A-pillars tracing the windshield's own diagonal and a roof
  // edge, at the same points the Low poly cockpit shell uses, so both looks frame the
  // cockpit camera the same way.
  body.add(box(0.16, 0.045, 0.6), M.carbon, 0.4, 0.5, 0);
  for (const s of [-1, 1]) body.add(box(0.02, 0.42, 0.025), M.carbon, 0.4, 0.72, s * 0.32, 0, 0, -s * 0.91);
  body.add(box(0.42, 0.02, 0.64), M.carbon, 0.2, 0.86, 0);
  return carScene("gt3", body, glass, [["wheel-fl", 0.68, -0.47, 0.27, 0.24], ["wheel-fr", 0.68, 0.47, 0.27, 0.24], ["wheel-rl", -0.68, -0.48, 0.28, 0.26], ["wheel-rr", -0.68, 0.48, 0.28, 0.26]], M);
}

// ---------- F1: an unbadged open-wheeler ----------
// A lofted tub from the nose to the gearbox with the cockpit let into it, an airbox over the driver,
// sidepods with dark inlets and an undercut, a floor, a three-element front wing, a rear wing with a
// beam wing, the halo, wishbones out to the wheels, and number 8 on the nose and the engine fin.
function f1() {
  const M = palette({ paint: "#2a8fe0", white: "#eef1f5", carbon: "#22262d", cockpit: "#121418", glass: "#10151c", inlet: "#0d0f12", helmet: "#f2c230", tail: "#e0413a", tyre: "#1d2025", barrel: "#2a2e34", disc: "#5d6268", rim: "#2f343b", cover: "#1a1d22", nut: "#e8b84c", band: "#f2c230" });
  const body = new Parts(), glass = new Parts();
  const K = (keys) => ip(keys);
  const Wd = K([[-1.0, 0.05], [-0.92, 0.07], [-0.75, 0.1], [-0.55, 0.14], [-0.35, 0.17], [-0.2, 0.19], [0.1, 0.2], [0.36, 0.2], [0.45, 0.19], [0.7, 0.15], [0.95, 0.1], [1.15, 0.075], [1.3, 0.05], [1.37, 0.03]]);
  const YB = K([[-1.0, 0.14], [-0.92, 0.12], [-0.75, 0.11], [-0.35, 0.1], [0.45, 0.09], [0.7, 0.1], [0.95, 0.12], [1.3, 0.13], [1.37, 0.14]]);
  const YT = K([[-1.0, 0.3], [-0.92, 0.33], [-0.75, 0.38], [-0.55, 0.44], [-0.35, 0.5], [-0.2, 0.52], [-0.12, 0.5], [0.0, 0.47], [0.36, 0.46], [0.45, 0.44], [0.7, 0.39], [0.95, 0.33], [1.15, 0.28], [1.3, 0.23], [1.37, 0.19]]);
  const YC = K([[-1.0, 0.3], [-0.9, 0.34], [-0.7, 0.42], [-0.5, 0.52], [-0.3, 0.64], [-0.16, 0.72], [-0.1, 0.62], [0.0, 0.5], [0.04, 0.36], [0.33, 0.36], [0.37, 0.475], [0.45, 0.455], [0.7, 0.41], [0.95, 0.345], [1.15, 0.29], [1.3, 0.24], [1.37, 0.19]]);
  const st = []; for (let x = -1.0; x <= 1.3701; x += 0.045) {
    const w = Wd(x), yb = YB(x), yt = YT(x), yc = YC(x), air = yc > yt + 0.02;
    st.push({ x, p: [[0, yb], [0.8 * w, yb], [w, yb + 0.035], [w, mix(yb, yt, 0.55)], [0.92 * w, yt - 0.025], [0.62 * w, yt], [air ? 0.26 * w : 0.28 * w, yc], [0, yc]] });
  }
  loft(body, st, (i, j) => {
    const x = (st[i].x + st[i + 1].x) / 2;
    if (j <= 2) return M.carbon;
    if (j >= 5 && x > 0.03 && x < 0.35) return M.cockpit;
    if (x > 1.26) return M.white;
    if (j === 6 && x < -0.2) return M.white;
    return M.paint;
  }, [M.carbon, M.white]);
  // Sidepods, one loft across both sides, buried in the tub along the middle: dark inlets in front.
  { const Wp = K([[-0.78, 0.12], [-0.6, 0.19], [-0.4, 0.27], [-0.15, 0.34], [0.1, 0.37], [0.3, 0.375], [0.34, 0.37]]), Yp = K([[-0.78, 0.18], [-0.6, 0.24], [-0.4, 0.3], [-0.15, 0.35], [0.1, 0.37], [0.34, 0.36]]);
    const sp = []; for (let x = -0.78; x <= 0.341; x += 0.05) { const w = Wp(x), y = Yp(x); sp.push({ x, p: [[0, 0.1], [0.72 * w, 0.1], [w, 0.19], [w, y - 0.05], [0.86 * w, y], [0.18, y + 0.02], [0, y + 0.02]] }); }
    loft(body, sp, (i, j) => (j <= 1 ? M.carbon : M.paint), [M.carbon, M.inlet]); }
  // The floor: a carbon plate, widest under the pods, cut in ahead of the rear wheels.
  { const half = [[0.6, 0.2], [0.34, 0.42], [-0.5, 0.42], [-0.58, 0.3], [-1.0, 0.27]], outline = [...half.map(([x, z]) => [x, -z]), ...half.slice().reverse().map(([x, z]) => [x, z])];
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: 0.02, bevelEnabled: false }); g.rotateX(-PI / 2); body.add(g, M.carbon, 0, 0.06, 0); }
  // Front wing: main plane across, two flaps outboard, endplates, pylons to the nose.
  body.add(slab(foil(1.43, 0.055, 1.2, 0.075, 0.018), 1.32), M.carbon);
  for (const s of [-1, 1]) {
    body.add(slab(foil(1.27, 0.09, 1.12, 0.14, 0.012), 0.46), M.paint, 0, 0, s * 0.43).add(slab(foil(1.19, 0.15, 1.08, 0.2, 0.01), 0.41), M.white, 0, 0, s * 0.455);
    body.add(box(0.38, 0.17, 0.012), M.paint, 1.25, 0.12, s * 0.665).add(box(0.05, 0.07, 0.012), M.carbon, 1.3, 0.1, s * 0.06);
    // Rear wing endplates, mirrors on stalks, the halo's mounts, the suspension.
    body.add(box(0.32, 0.46, 0.012), M.paint, -1.12, 0.55, s * 0.46);
    body.add(box(0.02, 0.08, 0.02), M.carbon, 0.36, 0.47, s * 0.25).add(box(0.06, 0.035, 0.09), M.paint, 0.36, 0.515, s * 0.285);
    for (const [a, b] of [[[0.85, 0.34, 0.09], [0.94, 0.33, 0.47]], [[1.05, 0.33, 0.08], [0.94, 0.33, 0.47]], [[0.82, 0.16, 0.09], [0.94, 0.17, 0.47]], [[1.07, 0.15, 0.08], [0.94, 0.17, 0.47]], [[0.94, 0.18, 0.46], [0.86, 0.38, 0.1]], [[1.02, 0.25, 0.08], [0.98, 0.25, 0.47]],
      [[-0.62, 0.36, 0.08], [-0.74, 0.36, 0.41]], [[-0.9, 0.34, 0.06], [-0.74, 0.36, 0.41]], [[-0.6, 0.16, 0.1], [-0.74, 0.16, 0.41]], [[-0.9, 0.16, 0.06], [-0.74, 0.16, 0.41]]]) rod(body, [a[0], a[1], s * a[2]], [b[0], b[1], s * b[2]], 0.011, M.carbon);
  }
  // Rear wing main plane and flap, beam wing, its pylon, the rain light.
  body.add(slab(foil(-1.03, 0.66, -1.24, 0.7, 0.02), 0.9), M.carbon).add(slab(foil(-1.13, 0.73, -1.26, 0.79, 0.012), 0.9), M.paint);
  body.add(slab(foil(-1.02, 0.37, -1.2, 0.39, 0.015), 0.6), M.carbon).add(box(0.16, 0.3, 0.015), M.carbon, -1.08, 0.5, 0).add(box(0.03, 0.03, 0.06), M.tail, -1.01, 0.3, 0);
  // The halo: a hoop round the cockpit on a central pillar; the driver's helmet and visor under it.
  body.add(tube([[-0.06, 0.47, 0.19], [-0.04, 0.585, 0.2], [0.1, 0.615, 0.195], [0.26, 0.62, 0.12], [0.33, 0.62, 0], [0.26, 0.62, -0.12], [0.1, 0.615, -0.195], [-0.04, 0.585, -0.2], [-0.06, 0.47, -0.19]], 0.02, 22, 6), M.carbon);
  body.add(tube([[0.33, 0.62, 0], [0.39, 0.56, 0], [0.44, 0.46, 0]], 0.018, 6, 6), M.carbon);
  body.add(new THREE.SphereGeometry(0.07, 12, 8), M.helmet, 0.13, 0.45, 0);
  glass.add(new THREE.SphereGeometry(0.071, 10, 4, -0.9, 1.8, 1.25, 0.5), M.glass, 0.13, 0.45, 0);
  // The airbox's mouth over the helmet, a camera pod on top, the engine fin with the number.
  body.add(new THREE.CircleGeometry(0.05, 10), M.inlet, -0.085, 0.63, 0, 0, PI / 2, 0, 1, 0.9, 1).add(box(0.06, 0.02, 0.05), M.helmet, -0.17, 0.73, 0);
  body.add(slab([[-0.2, 0.7], [-0.92, 0.42], [-0.92, 0.33], [-0.55, 0.49], [-0.26, 0.62]], 0.01), M.white);
  for (const s of [-1, 1]) digits(body, "8", M.carbon, 0.1, new THREE.Matrix4().compose(new THREE.Vector3(-0.56, 0.52, s * 0.005), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s > 0 ? 0 : PI, 0)), new THREE.Vector3(1, 1, 1)), 0.003);
  digits(body, "8", M.white, 0.1, new THREE.Matrix4().compose(new THREE.Vector3(1.02, YC(1.02) + 0.008, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(-PI / 2 + 0.2, 0, -PI / 2)), new THREE.Vector3(1, 1, 1)), 0.003);
  return carScene("f1", body, glass, [["wheel-fl", 0.94, -0.58, 0.25, 0.2, { cover: true, rim: 0.6, band: "band" }], ["wheel-fr", 0.94, 0.58, 0.25, 0.2, { cover: true, rim: 0.6, band: "band" }], ["wheel-rl", -0.74, -0.57, 0.28, 0.3, { cover: true, rim: 0.6, band: "band" }], ["wheel-rr", -0.74, 0.57, 0.28, 0.3, { cover: true, rim: 0.6, band: "band" }]], M);
}

// ---------- Trees (LOWPOLY units; ground at y 0) ----------
/** Stacked cone tiers over a trunk, the lower rim of each dipping at every other branch tip. */
function conifer(name, seed, { trunk, tiers, n, droop, cols }) {
  const M = palette({ bark: "#5a4030", ...Object.fromEntries(cols.map((c, i) => [`needles-${i + 1}`, c])) }), p = new Parts(), r = rand(seed);
  p.add(cyl(trunk[0], trunk[1], trunk[2], 5, true), M.bark, 0, trunk[2] / 2, 0);
  tiers.forEach(([y, rad, h], i) => {
    const g = new THREE.ConeGeometry(rad, h, n, 1, false), a = g.attributes.position;
    for (let v = 0; v < a.count; v++) if (a.getY(v) < 0 && Math.hypot(a.getX(v), a.getZ(v)) > rad * 0.5) { const k = Math.round(((Math.atan2(a.getZ(v), a.getX(v)) + PI) / (2 * PI)) * n) % 2; a.setY(v, a.getY(v) - (k ? droop * h : 0)); }
    p.add(g, M[`needles-${Math.min(cols.length, i + 1)}`], (r() - 0.5) * rad * 0.08, y + h / 2, (r() - 0.5) * rad * 0.08, 0, r() * PI);
  });
  const root = new THREE.Group(); root.name = name; root.add(p.mesh("tree")); return root;
}
/** Lumpy crowns: icosahedra with every vertex nudged by a seeded amount (the same at shared points). */
function lump(radius, detail, jitter, r, sy = 1) {
  const ico = new THREE.IcosahedronGeometry(radius, detail); ico.deleteAttribute("normal"); ico.deleteAttribute("uv");
  const g = mergeVertices(ico), a = g.attributes.position;
  for (let v = 0; v < a.count; v++) { const k = 1 + (r() - 0.5) * jitter; a.setXYZ(v, a.getX(v) * k, a.getY(v) * k * sy, a.getZ(v) * k); }
  return g;
}
function broadleafLike(name, seed, { bark, cols, h, crown, spread, branches }) {
  const M = palette({ bark, ...Object.fromEntries(cols.map((c, i) => [`leaves-${i + 1}`, c])) }), p = new Parts(), r = rand(seed);
  p.add(cyl(0.011, 0.02, h, 6, true), M.bark, 0, h / 2, 0);
  for (let b = 0; b < branches; b++) { const a = (b / branches) * PI * 2 + r(); rod(p, [0, h * 0.8, 0], [Math.cos(a) * spread * 0.55, h * 1.15, Math.sin(a) * spread * 0.55], 0.007, M.bark); }
  crown.forEach(([x, y, z, rad, sy], i) => p.add(lump(rad, 0, 0.2, r, sy), M[`leaves-${(i % cols.length) + 1}`], x, y, z, r(), r(), 0));
  const root = new THREE.Group(); root.name = name; root.add(p.mesh("tree")); return root;
}
const TREES = {
  // Spa: Norway spruce (narrow, dark, drooping tiers) and silver fir (fuller, bluish, rounder top).
  "tree-spruce": () => conifer("spruce", 11, { trunk: [0.008, 0.016, 0.14], n: 7, droop: 0.22, cols: ["#1d4631", "#22503a", "#285b40", "#2f6848"], tiers: [[0.045, 0.098, 0.13], [0.105, 0.08, 0.12], [0.165, 0.062, 0.11], [0.225, 0.044, 0.1], [0.28, 0.026, 0.09]] }),
  "tree-fir": () => conifer("fir", 12, { trunk: [0.009, 0.017, 0.12], n: 8, droop: 0.12, cols: ["#2a5647", "#2f604f", "#356a57"], tiers: [[0.04, 0.105, 0.12], [0.1, 0.09, 0.11], [0.16, 0.07, 0.1], [0.22, 0.045, 0.1]] }),
  // Spa and Fuji: a broadleaf (beech, oak, maple): a trunk forking into a rounded, lumpy crown.
  "tree-broadleaf": () => broadleafLike("broadleaf", 13, { bark: "#5e4630", cols: ["#4a7a38", "#3f6d31", "#548540"], h: 0.13, spread: 0.16, branches: 2, crown: [[0, 0.2, 0, 0.09, 0.9], [0.06, 0.16, 0.03, 0.07, 0.85], [-0.05, 0.165, -0.04, 0.07, 0.85]] }),
  // Fuji: Japanese cedar (sugi): tall, narrow, in tiers up a straight trunk.
  "tree-cedar": () => conifer("cedar", 14, { trunk: [0.008, 0.015, 0.13], n: 6, droop: 0.1, cols: ["#244c33", "#2a563a", "#306142", "#376b48"], tiers: [[0.07, 0.06, 0.12], [0.13, 0.055, 0.12], [0.19, 0.046, 0.11], [0.25, 0.035, 0.1], [0.3, 0.022, 0.08]] }),
  // Fuji: a cherry: a low, wide crown of pink blossom on a dark, forking trunk.
  "tree-cherry": () => broadleafLike("cherry", 15, { bark: "#4f3a30", cols: ["#f0a6c2", "#e58db0", "#f6bfd3"], h: 0.1, spread: 0.2, branches: 4, crown: [[0, 0.17, 0, 0.075, 0.8], [0.07, 0.14, 0.03, 0.06, 0.8], [-0.065, 0.15, -0.035, 0.058, 0.8], [0.02, 0.145, -0.075, 0.055, 0.8], [-0.03, 0.14, 0.07, 0.055, 0.8], [0.01, 0.22, 0.01, 0.05, 0.8]] }),
  // Sebring: a cabbage palm: a ringed trunk that leans and curves, a crown of drooping fronds (each a
  // folded blade in two bent lengths) and a skirt of dead ones.
  "tree-palm": () => {
    const M = palette({ bark: "#7a6446", "bark-ring": "#6a563c", heart: "#556b30", "frond-1": "#4f7a34", "frond-2": "#5d8a3b", "frond-3": "#46702f", dead: "#8a7446" }), p = new Parts(), n = 8, h = 0.034;
    let x = 0, y = 0;
    for (let i = 0; i < n; i++) { const lean = 0.04 + i * 0.026, r0 = 0.012 - i * 0.0006; p.add(cyl(r0, r0 + 0.0014, h * 1.03, 6, true), i % 2 ? M["bark-ring"] : M.bark, x + (Math.sin(lean) * h) / 2, y + (Math.cos(lean) * h) / 2, 0, 0, 0, -lean); x += Math.sin(lean) * h; y += Math.cos(lean) * h; }
    p.add(lump(0.02, 0, 0.3, rand(21)), M.heart, x, y + 0.004, 0);
    // A frond: a folded blade (a V in section) from the crown out and down, in two lengths.
    const frond = (len, up, droop, w) => { const pos = [], idx = [], rows = [[0, 0, 0.004], [len * 0.55, up, w], [len, up - droop, w * 0.35]];
      for (const [u, v, ww] of rows) pos.push(u, v, -ww, u, v + ww * 0.45, 0, u, v, ww, u, v - 0.002, 0);
      for (let k = 0; k < 2; k++) { const a = k * 4, b = a + 4; for (const [s, t] of [[0, 1], [1, 2], [2, 3], [3, 0]]) idx.push(a + s, b + s, b + t, a + s, b + t, a + t); }
      return geom(pos, idx); };
    for (let k = 0; k < 14; k++) { const tier = k % 3, up = [0.03, 0.012, -0.01][tier]; p.add(frond(0.11 - tier * 0.01, up, 0.035 + tier * 0.012, 0.022), M[`frond-${tier + 1}`], x, y, 0, 0, (k / 14) * PI * 2 + (k % 2) * 0.2, 0); }
    for (let k = 0; k < 5; k++) p.add(frond(0.055, -0.02, 0.03, 0.012), M.dead, x, y - 0.012, 0, 0, (k / 5) * PI * 2 + 0.3, -0.6);
    const root = new THREE.Group(); root.name = "palm"; root.add(p.mesh("tree")); return root;
  },
  // Sebring: a Southern live oak: a short trunk splitting into spreading limbs under a broad, low
  // dome, with Spanish moss hanging from it.
  "tree-live-oak": () => {
    const M = palette({ bark: "#56473a", "leaves-1": "#3f5c2e", "leaves-2": "#48683a", "leaves-3": "#37532b", moss: "#8b9a7c" }), p = new Parts(), r = rand(16);
    p.add(cyl(0.017, 0.026, 0.06, 6, true), M.bark, 0, 0.03, 0);
    for (let b = 0; b < 4; b++) { const a = (b / 4) * PI * 2 + 0.4; rod(p, [0, 0.05, 0], [Math.cos(a) * 0.1, 0.1, Math.sin(a) * 0.1], 0.009, M.bark, 5); }
    const crown = [[0, 0.15, 0, 0.1, 0.62], [0.1, 0.12, 0.03, 0.075, 0.7], [-0.1, 0.12, -0.03, 0.072, 0.7], [0.03, 0.12, 0.1, 0.07, 0.7], [-0.02, 0.12, -0.1, 0.07, 0.7], [0.07, 0.14, -0.07, 0.06, 0.7], [-0.07, 0.14, 0.07, 0.06, 0.7]];
    crown.forEach(([x, y, z, rad, sy], i) => p.add(lump(rad, 1, 0.22, r, sy), M[`leaves-${(i % 3) + 1}`], x, y, z, 0, r() * PI, 0));
    for (let k = 0; k < 7; k++) { const a = (k / 7) * PI * 2 + 0.2, d = 0.08 + (k % 3) * 0.025; p.add(new THREE.ConeGeometry(0.008, 0.045, 4), M.moss, Math.cos(a) * d, 0.085, Math.sin(a) * d, PI); }
    const root = new THREE.Group(); root.name = "liveOak"; root.add(p.mesh("tree")); return root;
  },
  // Sebring: a slash pine: a tall bare trunk with a few stubs, a small, ragged crown high up.
  "tree-slash-pine": () => {
    const M = palette({ bark: "#6b5038", "needles-1": "#4d6b35", "needles-2": "#56753b", "needles-3": "#45612f" }), p = new Parts(), r = rand(17);
    p.add(cyl(0.008, 0.014, 0.32, 6, true), M.bark, 0, 0.16, 0);
    for (const [y, a, l] of [[0.2, 0.3, 0.035], [0.25, 2.4, 0.045], [0.28, 4.3, 0.05]]) rod(p, [0, y, 0], [Math.cos(a) * l, y + 0.03, Math.sin(a) * l], 0.004, M.bark);
    for (const [x, y, z, rad] of [[0, 0.33, 0, 0.05], [0.04, 0.3, 0.02, 0.035], [-0.035, 0.31, -0.02, 0.035], [0.02, 0.36, -0.03, 0.03]]) p.add(lump(rad, 0, 0.45, r, 0.65), M[`needles-${1 + Math.floor(r() * 3)}`], x, y, z, 0, r() * PI, 0);
    const root = new THREE.Group(); root.name = "slashPine"; root.add(p.mesh("tree")); return root;
  },
};

// ---------- Trackside furniture ----------
/** The start gantry: two lattice towers (posts at x = -1 and +1) and a truss beam at the Low poly
 *  gantry's height (the game moves the posts to the road's width and stretches the beam), plus the
 *  start lights, which keep their size. */
function gantry() {
  const M = palette({ steel: "#2a2f37", red: "#d9453a", white: "#eef0f3", panel: "#15181d", light: "#e0413a", base: "#8d949c" }), root = new THREE.Group(); root.name = "gantry";
  for (const [name, x] of [["post-l", -1], ["post-r", 1]]) {
    const p = new Parts();
    p.add(box(0.1, 0.03, 0.1), M.base, 0, 0.015, 0);
    for (let i = 0; i < 5; i++) p.add(box(0.056, 0.072, 0.056), i % 2 ? M.white : M.red, 0, 0.03 + 0.036 + i * 0.072, 0);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) p.add(box(0.008, 0.4, 0.008), M.steel, dx * 0.032, 0.2, dz * 0.032);
    const n = p.mesh(name); n.position.x = x; root.add(n);
  }
  const b = new Parts();
  for (const y of [0.365, 0.415]) for (const z of [-0.028, 0.028]) b.add(box(2.08, 0.01, 0.01), M.steel, 0, y, z);
  for (let i = 0; i <= 16; i++) { const x = -1 + i * 0.125; b.add(box(0.008, 0.05, 0.008), M.steel, x, 0.39, 0.028).add(box(0.008, 0.05, 0.008), M.steel, x, 0.39, -0.028); if (i < 16) b.add(box(0.14, 0.006, 0.006), M.steel, x + 0.0625, 0.39, 0.028, 0, 0, i % 2 ? 0.37 : -0.37); }
  const beam = b.mesh("beam"); root.add(beam);
  const l = new Parts(); l.add(box(0.3, 0.05, 0.02), M.panel, 0, 0.44, 0.03);
  for (let i = 0; i < 5; i++) l.add(cyl(0.014, 0.014, 0.012, 10), M.light, (i - 2) * 0.055, 0.44, 0.042, PI / 2);
  root.add(l.mesh("lights"));
  return root;
}
/** A quad from its corners, counter-clockwise as seen from the side it faces. */
const quad = (a, b, c, d) => geom([...a, ...b, ...c, ...d], [0, 1, 2, 0, 2, 3]);
// The barrier pieces are instanced thousands of times round a lap, so they carry only the faces the
// track side can see, to keep the triangle count down: nothing behind the wall line or underneath.
/** Armco, 5 m of it (x 0 to 5) on the wall line (z 0), facing +z: a W-section rail on two posts. */
function armco() {
  const M = palette({ rail: "#c9cfd6", post: "#8f98a2" }), p = new Parts(), prof = [[0, 0.46], [0.05, 0.52], [0.018, 0.615], [0.05, 0.71], [0, 0.78]], pos = [], idx = [];
  for (const [z, y] of prof) pos.push(0, y, z, 5, y, z);
  for (let k = 0; k < prof.length - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  p.add(geom(pos, idx), M.rail);
  for (const x of [1.25, 3.75]) {
    const [a, b, y0, y1, z0, z1] = [x - 0.045, x + 0.045, 0.12, 0.8, -0.14, -0.02];
    p.add(quad([a, y0, z1], [b, y0, z1], [b, y1, z1], [a, y1, z1]), M.post).add(quad([a, y0, z0], [a, y0, z1], [a, y1, z1], [a, y1, z0]), M.post).add(quad([b, y0, z1], [b, y0, z0], [b, y1, z0], [b, y1, z1]), M.post);
  }
  const root = new THREE.Group(); root.name = "armco"; root.add(p.mesh("armco")); return root;
}
/** A tyre wall, 2.5 m of it on the wall line, facing +z: four stacks of tyres (their fronts and a
 *  rubber top) strapped with a red and white belt. */
function tyreWall() {
  const M = palette({ tyre: "#1f2226", "tyre-top": "#2c3035", "belt-red": "#c8342c", "belt-white": "#e9ebee" }), p = new Parts();
  for (let k = 0; k < 4; k++) p.add(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 3, 1, true, -PI / 2, PI), M.tyre, 0.3125 + k * 0.625, 0.45, -0.3);
  p.add(quad([0, 0.9, 0], [2.5, 0.9, 0], [2.5, 0.9, -0.6], [0, 0.9, -0.6]), M["tyre-top"]);
  p.add(quad([0, 0.5, 0.01], [1.25, 0.5, 0.01], [1.25, 0.74, 0.01], [0, 0.74, 0.01]), M["belt-red"]).add(quad([1.25, 0.5, 0.01], [2.5, 0.5, 0.01], [2.5, 0.74, 0.01], [1.25, 0.74, 0.01]), M["belt-white"]);
  const root = new THREE.Group(); root.name = "tyreWall"; root.add(p.mesh("tyreWall")); return root;
}
/** A marshal post, metres: a plinth, a white cabin with a window band, an orange roof, a flag. */
function marshalPost() {
  const M = palette({ plinth: "#9aa0a8", cabin: "#e9ebee", window: "#2b3440", roof: "#e2711d", pole: "#b9bec4", flag: "#f2c230", step: "#6f757d" }), p = new Parts();
  p.add(box(1.8, 0.5, 1.6), M.plinth, 0, 0.25, 0).add(box(1.6, 1.3, 1.4), M.cabin, 0, 1.15, 0).add(box(1.64, 0.55, 1.44), M.window, 0, 1.95, 0).add(box(1.6, 0.12, 1.4), M.cabin, 0, 2.28, 0);
  p.add(box(2.0, 0.1, 1.8), M.roof, 0, 2.4, 0).add(box(1.7, 0.18, 1.5), M.roof, 0, 2.52, 0, 0, 0, 0);
  for (let k = 0; k < 3; k++) p.add(box(0.5, 0.1, 0.25), M.step, -1.05, 0.08 + k * 0.16, -0.5 + k * 0.25);
  p.add(cyl(0.03, 0.03, 3.4, 5), M.pole, 0.92, 2.0, 0.6).add(box(0.7, 0.48, 0.02), M.flag, 1.28, 3.42, 0.6);
  const root = new THREE.Group(); root.name = "marshalPost"; root.add(p.mesh("marshalPost")); return root;
}
/** A brake board's frame, metres, facing +z: two legs, a white panel in a dark border (the page
 *  adds its 300, 200 or 100). */
function brakeBoard() {
  const M = palette({ leg: "#8d949c", frame: "#2a2f37", face: "#f4f5f7" }), p = new Parts();
  for (const x of [-0.6, 0.6]) p.add(box(0.1, 3.4, 0.1), M.leg, x, 1.7, -0.08);
  p.add(box(1.62, 1.22, 0.06), M.frame, 0, 2.85, -0.02).add(box(1.5, 1.1, 0.04), M.face, 0, 2.85, 0.01).add(box(1.7, 0.06, 0.14), M.frame, 0, 3.49, -0.02);
  const root = new THREE.Group(); root.name = "brakeBoard"; root.add(p.mesh("brakeBoard")); return root;
}
/** Mount Fuji in the LOWPOLY cone's units (base radius 7.2, summit at y 4.4): concave slopes that
 *  steepen toward the top, shallow ridges and gullies, a crater rim, and snow down the gullies. */
function mountainFuji() {
  const M = palette({ rock: "#47566b", "rock-dark": "#3d4a5d", snow: "#eef2f7" }), p = new Parts(), n = 40, rings = 9, R = 7.2, H = 4.4, r = rand(18);
  const ridge = Array.from({ length: n }, () => r()), pos = [], snow = [], rock = [], dark = [];
  const rad = (t) => R * Math.pow(1 - t, 1.7) + 0.16; // t 0 at the foot, 1 at the rim
  for (let j = 0; j <= rings; j++) { const t = j / rings, y = H * (1 - Math.pow(1 - t, 1.35)); for (let i = 0; i < n; i++) { const a = (i / n) * PI * 2, k = 1 + (ridge[i] - 0.5) * 0.08 * Math.sin(PI * t); pos.push(Math.cos(a) * rad(t) * k, j === rings ? H : y, Math.sin(a) * rad(t) * k); } }
  const top = pos.length / 3; pos.push(0, H - 0.12, 0);
  for (let j = 0; j < rings; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + ((i + 1) % n), c = (j + 1) * n + ((i + 1) % n), d = (j + 1) * n + i;
    const line = 0.62 - 0.14 * ridge[i] - (i % 3 === 0 ? 0.1 : 0);
    (j / rings >= line ? snow : (i + j) % 5 === 0 ? dark : rock).push(a, c, b, a, d, c);
  }
  for (let i = 0; i < n; i++) snow.push(rings * n + i, rings * n + ((i + 1) % n), top);
  p.add(geom(pos, rock), M.rock).add(geom(pos, dark), M["rock-dark"]).add(geom(pos, snow), M.snow);
  const root = new THREE.Group(); root.name = "mountainFuji"; root.add(p.mesh("mountainFuji")); return root;
}

const MODELS = { gt3, f1, ...TREES, gantry, "tyre-wall": tyreWall, armco, "marshal-post": marshalPost, "brake-board": brakeBoard, "mountain-fuji": mountainFuji };
fs.mkdirSync(out, { recursive: true });
const exporter = new GLTFExporter();
let total = 0;
for (const [name, make] of Object.entries(MODELS)) {
  const scene = make();
  const buf = Buffer.from(await exporter.parseAsync(scene, { binary: true, onlyVisible: true }));
  fs.writeFileSync(path.join(out, `${name}.glb`), buf); total += buf.length;
  let tris = 0; scene.traverse((o) => { if (o.isMesh) tris += o.geometry.index.count / 3; });
  console.log(`${name.padEnd(16)} ${(buf.length / 1024).toFixed(1).padStart(6)} KB ${String(tris).padStart(6)} triangles`);
}
console.log(`total            ${(total / 1024).toFixed(1).padStart(6)} KB -> ${out}`);
