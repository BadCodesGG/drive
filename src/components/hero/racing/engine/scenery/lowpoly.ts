/**
 * The low-poly model kit: built in code at
 * runtime, no model files. Every model is one merged, vertex-coloured, flat-shaded geometry, so a
 * landmark type costs one draw call however often it is placed. Units are the miniature's own (the
 * road is 0.26 wide) unless a comment says metres.
 */
import * as THREE from "three";

/** A seeded generator (mulberry32), so every placement is the same on every load. */
export const lpRand = (s: number) => () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const lpSmooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface LpPart {
  geo: THREE.BufferGeometry;
  color: THREE.Color;
  m: THREE.Matrix4;
}

/** One coloured piece of a model: a geometry, its colour, and where it sits. */
export function lpPart(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): LpPart {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  return { geo: geo.index ? geo.toNonIndexed() : geo, color: new THREE.Color(color), m };
}
/** Parts into one non-indexed geometry with a colour attribute (flat normals per face). */
export function lpMerge(parts: LpPart[]): THREE.BufferGeometry {
  let n = 0; for (const p of parts) n += p.geo.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  for (const p of parts) {
    p.geo.applyMatrix4(p.m); const a = p.geo.attributes.position as THREE.BufferAttribute;
    pos.set((a.array as Float32Array).subarray(0, a.count * 3), o * 3);
    for (let i = 0; i < a.count; i++) col.set([p.color.r, p.color.g, p.color.b], (o + i) * 3);
    o += a.count; p.geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals(); return g;
}
/** A block tapered along x: the x0 end spans y yb0..yt0 and z +-w0, the x1 end yb1..yt1 and +-w1. */
export function lpBlock(x0: number, x1: number, yb0: number, yt0: number, yb1: number, yt1: number, w0: number, w1: number): THREE.BufferGeometry {
  const c = [[x0, yb0, -w0], [x1, yb1, -w1], [x1, yb1, w1], [x0, yb0, w0], [x0, yt0, -w0], [x1, yt1, -w1], [x1, yt1, w1], [x0, yt0, w0]];
  const pos: number[] = [];
  for (const [a, b, d, e] of [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]) for (const k of [a, b, d, a, d, e]) pos.push(...c[k]);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); return g;
}
/** A side profile [[x, y], ...] extruded across z, centred, with chamfered edges. */
export function lpSide(pts: [number, number][], depth: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -depth / 2); return g;
}
export const lpBox = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const lpCyl = (r0: number, r1: number, h: number, n: number) => new THREE.CylinderGeometry(r0, r1, h, n);

// ---------- Landmarks: ground at y 0, the side facing the track is +z ----------
export const LOWPOLY: Record<string, (hw?: number) => THREE.BufferGeometry> = {
  pineForest: () => lpMerge([
    lpPart(lpCyl(0.014, 0.02, 0.07, 5), "#6b4a2f", 0, 0.035, 0),
    lpPart(new THREE.ConeGeometry(0.1, 0.15, 6), "#2f7d52", 0, 0.13, 0),
    lpPart(new THREE.ConeGeometry(0.078, 0.13, 6), "#358a5a", 0, 0.21, 0, 0, 0.5),
    lpPart(new THREE.ConeGeometry(0.052, 0.11, 6), "#3c9562", 0, 0.28, 0, 0, 1),
  ]),
  // A Florida cabbage palm: a gently curving, ringed trunk and a round crown of drooping fan
  // leaves, with a skirt of old brown fronds hanging under it.
  palm: () => {
    const parts: LpPart[] = [], n = 7, h = 0.037;
    let x = 0, y = 0;
    for (let i = 0; i < n; i++) {
      const lean = 0.03 + i * 0.028, r = 0.0125 - i * 0.0007;
      parts.push(lpPart(lpCyl(r, r + 0.0012, h * 1.02, 6), i % 2 ? "#6f5a40" : "#85704f", x + (Math.sin(lean) * h) / 2, y + (Math.cos(lean) * h) / 2, 0, 0, 0, -lean));
      x += Math.sin(lean) * h; y += Math.cos(lean) * h;
    }
    parts.push(lpPart(new THREE.IcosahedronGeometry(0.02, 0), "#556b30", x, y + 0.004, 0));
    const greens = ["#4f7a34", "#5d8a3b", "#46702f"];
    for (let k = 0; k < 18; k++) {
      const up = k % 3 === 0 ? 0.75 : k % 3 === 1 ? 0.35 : 0.02;
      parts.push(lpPart(lpBlock(0, 0.105, -0.003, 0.003, -0.05, -0.043, 0.004, 0.028), greens[k % 3], x, y, 0, 0, (k / 18) * Math.PI * 2 + (k % 2) * 0.17, up));
    }
    for (let k = 0; k < 6; k++) parts.push(lpPart(lpBlock(0, 0.06, -0.003, 0.003, -0.05, -0.045, 0.004, 0.016), "#8a7446", x, y - 0.01, 0, 0, (k / 6) * Math.PI * 2 + 0.3, -0.9));
    return lpMerge(parts);
  },
  // A Southern live oak: a short thick trunk under a broad, rounded dome of foliage.
  liveOak: () => lpMerge([
    lpPart(lpCyl(0.018, 0.026, 0.07, 6), "#5a4632", 0, 0.035, 0),
    lpPart(new THREE.IcosahedronGeometry(0.1, 1), "#3f5c2e", 0, 0.14, 0, 0, 0, 0, 1.15, 0.85, 1.1),
    lpPart(new THREE.IcosahedronGeometry(0.075, 0), "#48683a", 0.09, 0.1, 0.03, 0, 0.5, 0, 1, 0.85, 1),
    lpPart(new THREE.IcosahedronGeometry(0.07, 0), "#37532b", -0.09, 0.1, -0.03, 0, 1, 0, 1, 0.85, 1),
    lpPart(new THREE.IcosahedronGeometry(0.065, 0), "#48683a", 0.02, 0.1, 0.09, 0, 1.5, 0, 1, 0.85, 1),
    lpPart(new THREE.IcosahedronGeometry(0.065, 0), "#3f5c2e", -0.01, 0.1, -0.09, 0, 2, 0, 1, 0.85, 1),
  ]),
  cherryTree: () => lpMerge([
    lpPart(lpCyl(0.012, 0.018, 0.1, 5), "#5b4034", 0, 0.05, 0),
    lpPart(new THREE.IcosahedronGeometry(0.085, 0), "#f0a6c2", 0, 0.16, 0),
    lpPart(new THREE.IcosahedronGeometry(0.065, 0), "#e58db0", 0.06, 0.13, 0.03),
    lpPart(new THREE.IcosahedronGeometry(0.06, 0), "#f6bfd3", -0.05, 0.14, -0.035),
    lpPart(new THREE.IcosahedronGeometry(0.05, 0), "#e994b6", 0.01, 0.22, -0.01),
  ]),
  pitBuilding: () => {
    const parts = [
      lpPart(lpBox(1.1, 0.13, 0.24), "#d6dae0", 0, 0.065, 0),
      lpPart(lpBox(1.1, 0.07, 0.2), "#34445a", 0, 0.165, -0.01),
      lpPart(lpBox(1.18, 0.025, 0.32), "#eef0f3", 0, 0.212, 0.01),
      lpPart(lpBox(0.2, 0.08, 0.16), "#d6dae0", 0.4, 0.265, -0.03),
      lpPart(lpBox(0.21, 0.03, 0.17), "#34445a", 0.4, 0.28, -0.03),
    ];
    for (let i = 0; i < 9; i++) parts.push(lpPart(lpBox(0.085, 0.085, 0.01), "#2a3039", -0.48 + i * 0.12, 0.05, 0.12));
    return lpMerge(parts);
  },
  hangar: () => {
    const shell = new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8, 1, false, Math.PI / 2, Math.PI); shell.rotateX(Math.PI / 2);
    return lpMerge([lpPart(shell, "#9aa4ab"), lpPart(lpBox(0.26, 0.14, 0.01), "#3a4048", 0, 0.07, 0.252), lpPart(lpBox(0.44, 0.012, 0.56), "#6d747c", 0, 0.006, 0)]);
  },
  mountainFuji: () => {
    // A snow cap with a ragged lower edge, hugging the cone's own slope.
    const R = 7.2, H = 4.4, cap = new THREE.ConeGeometry(2.6, 1.55, 12, 1, true), yc = H - 0.775 + 0.03, p = cap.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) >= 0) continue;
      if (i % 2) p.setY(i, p.getY(i) - 0.4);
      const r = R * (1 - (yc + p.getY(i)) / H) + 0.04, k = r / Math.hypot(p.getX(i), p.getZ(i));
      p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
    }
    return lpMerge([lpPart(new THREE.ConeGeometry(R, H, 12), "#47566b", 0, H / 2, 0), lpPart(cap, "#eef2f7", 0, yc, 0)]);
  },
  grandstand: () => {
    const parts: LpPart[] = [];
    for (let k = 0; k < 5; k++) parts.push(lpPart(lpBox(0.9, 0.04 + k * 0.045, 0.06), k % 2 ? "#e8e9ec" : "#3d6fc2", 0, (0.04 + k * 0.045) / 2, 0.12 - k * 0.06));
    parts.push(lpPart(lpBox(0.92, 0.28, 0.03), "#c3c8cf", 0, 0.14, -0.16));
    for (const x of [-0.44, 0, 0.44]) parts.push(lpPart(lpBox(0.02, 0.1, 0.02), "#c3c8cf", x, 0.33, -0.15));
    parts.push(lpPart(lpBox(0.96, 0.02, 0.36), "#eef0f3", 0, 0.38, -0.01, 0.12));
    return lpMerge(parts);
  },
  // The start/finish gantry spanning the road (hw: half the road width); its name banner is lpBanner.
  gantry: (hw = 0.13) => {
    const x = hw + 0.1, parts = [lpPart(lpBox(2 * x + 0.08, 0.06, 0.06), "#2a2f37", 0, 0.39, 0)];
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) parts.push(lpPart(lpBox(0.05, 0.09, 0.05), i % 2 ? "#eef0f3" : "#d9453a", s * x, 0.045 + i * 0.09, 0));
    for (let i = 0; i < 5; i++) parts.push(lpPart(lpBox(0.035, 0.035, 0.02), "#e0413a", (i - 2) * 0.05, 0.39, 0.035));
    return lpMerge(parts);
  },
  // A marshal post, in metres: a white cabin on a plinth with an orange roof, and a yellow flag.
  marshalPost: () => lpMerge([
    lpPart(lpBox(1.7, 0.5, 1.5), "#9aa0a8", 0, 0.25, 0), lpPart(lpBox(1.6, 2.0, 1.4), "#e9ebee", 0, 1.5, 0), lpPart(lpBox(1.62, 0.5, 1.42), "#2b3440", 0, 1.95, 0),
    lpPart(lpBox(1.8, 0.12, 1.6), "#e2711d", 0, 2.56, 0), lpPart(lpBox(0.05, 3.4, 0.05), "#b9bec4", 0.92, 2.0, 0.6), lpPart(lpBox(0.7, 0.5, 0.02), "#f2c230", 1.28, 3.4, 0.6),
  ]),
  // Round 3's trees: a broadleaf (a rounded crown of two lumps), a Japanese cedar (tall, narrow, in
  // tiers) and a slash pine (a tall bare trunk under a small high crown).
  broadleaf: () => lpMerge([
    lpPart(lpCyl(0.014, 0.02, 0.12, 5), "#5e4630", 0, 0.06, 0),
    lpPart(new THREE.IcosahedronGeometry(0.09, 0), "#4a7a38", 0, 0.19, 0, 0, 0, 0, 1, 0.9, 1),
    lpPart(new THREE.IcosahedronGeometry(0.068, 0), "#3f6d31", 0.055, 0.15, 0.02, 0, 0.6),
  ]),
  cedar: () => lpMerge([
    lpPart(lpCyl(0.012, 0.018, 0.1, 5), "#5b4131", 0, 0.05, 0),
    lpPart(new THREE.ConeGeometry(0.06, 0.16, 6), "#2d5a3a", 0, 0.14, 0),
    lpPart(new THREE.ConeGeometry(0.048, 0.14, 6), "#336442", 0, 0.23, 0, 0, 0.5),
    lpPart(new THREE.ConeGeometry(0.032, 0.11, 6), "#3a6e48", 0, 0.31, 0, 0, 1),
  ]),
  slashPine: () => lpMerge([
    lpPart(lpCyl(0.009, 0.014, 0.3, 5), "#6b5038", 0, 0.15, 0),
    lpPart(new THREE.IcosahedronGeometry(0.055, 0), "#4d6b35", 0, 0.32, 0, 0, 0, 0, 1.2, 0.7, 1.2),
    lpPart(new THREE.IcosahedronGeometry(0.04, 0), "#56753b", 0.04, 0.29, 0.02),
  ]),
  // Trackside furniture, in metres, x along the wall line from 0, +z toward the track: 5 m of Armco,
  // 2.5 m of tyre wall, and a brake board's legs and panel.
  armco: () => lpMerge([lpPart(lpBox(5, 0.33, 0.04), "#50555d", 2.5, 0.285, -0.02), lpPart(lpBox(5, 0.17, 0.04), "#c9cfd6", 2.5, 0.535, -0.02), lpPart(lpBox(5, 0.16, 0.04), "#9aa3ad", 2.5, 0.7, -0.02)]),
  tyreWall: () => lpMerge([lpPart(lpBox(1.25, 0.6, 0.04), "#1f2226", 0.625, 0.42, -0.02), lpPart(lpBox(1.25, 0.6, 0.04), "#2c3035", 1.875, 0.42, -0.02), lpPart(lpBox(2.5, 0.3, 0.04), "#c8342c", 1.25, 0.87, -0.02)]),
  brakeBoard: () => lpMerge([lpPart(lpBox(0.14, 3.4, 0.14), "#8d949c", 0, 1.7, -0.06), lpPart(lpBox(1.5, 1.1, 0.08), "#f4f5f7", 0, 2.85, 0)]),
};
