/**
 * The two low-poly cars. Forward is +x,
 * built in car units (about 2.3 long) and scaled into the world by lpCar's size.
 */
import * as THREE from "three";
import type { CarId } from "../cars";
import { lpBlock, lpBox, lpCyl, lpMerge, lpPart, lpSide, type LpPart } from "./lowpoly";

export function lpWheel(r: number, w: number): THREE.BufferGeometry {
  return lpMerge([
    lpPart(lpCyl(r, r, w, 10), "#202328", 0, 0, 0, Math.PI / 2),
    lpPart(lpCyl(r * 0.6, r * 0.6, w + 0.02, 10), "#c4c9d1", 0, 0, 0, Math.PI / 2),
    lpPart(lpBox(r * 1.05, r * 0.22, w + 0.04), "#4c525b"),
  ]);
}

type WheelDef = [name: string, x: number, z: number, r: number, w: number];
interface CarDef {
  parts: LpPart[];
  cockpit?: LpPart[];
  steer?: LpPart[];
  steerAt?: [number, number, number];
  steerRake?: number;
  haloRef?: [number, number, number];
  wheels: WheelDef[];
}

export const LP_CARS: Record<CarId, () => CarDef> = {
  // An unbadged rear-engined coupe: sloping nose with round headlight nubs, fastback over the engine
  // hump, wide rear arches, a swan-neck wing, and a roundel with a number on each door.
  gt3: () => {
    const paint = "#f2b632", dark = "#24282f", glass = "#1c2837", parts = [
      lpPart(lpSide([[-1.08, 0.2], [1.08, 0.2], [1.12, 0.34], [1.0, 0.47], [0.42, 0.56], [-0.5, 0.58], [-0.92, 0.52], [-1.1, 0.4]], 0.9, 0.06), paint),
      lpPart(lpSide([[0.4, 0.55], [0.06, 0.86], [-0.32, 0.87], [-0.96, 0.56]], 0.62, 0.04), paint),
      lpPart(lpSide([[0.5, 0.55], [0.13, 0.84], [-0.36, 0.845], [-1.02, 0.55]], 0.72, 0.02), glass),
      lpPart(lpBlock(0.38, 0.98, 0.24, 0.52, 0.24, 0.47, 0.57, 0.55), paint),
      lpPart(lpBlock(-1.02, -0.36, 0.24, 0.52, 0.24, 0.6, 0.61, 0.61), paint),
      lpPart(lpBlock(0.42, 1.03, 0.605, 0.625, 0.52, 0.54, 0.1, 0.1), dark),
      lpPart(lpBlock(0.9, 1.18, 0.12, 0.2, 0.12, 0.18, 0.5, 0.46), dark),
      lpPart(lpBlock(-1.16, -0.9, 0.14, 0.3, 0.14, 0.24, 0.46, 0.5), dark),
      lpPart(lpBox(0.05, 0.07, 0.9), "#e0413a", -1.13, 0.43, 0),
      lpPart(lpBox(0.08, 0.28, 0.05), dark, -0.86, 0.72, 0.24), lpPart(lpBox(0.08, 0.28, 0.05), dark, -0.86, 0.72, -0.24),
      lpPart(lpBlock(-1.14, -0.8, 0.84, 0.9, 0.87, 0.9, 0.58, 0.58), dark),
      lpPart(lpBox(0.36, 0.17, 0.03), paint, -0.97, 0.85, 0.595), lpPart(lpBox(0.36, 0.17, 0.03), paint, -0.97, 0.85, -0.595),
    ];
    for (const s of [-1, 1]) {
      parts.push(lpPart(lpCyl(0.1, 0.1, 0.08, 8), "#fff1b8", 0.93, 0.53, s * 0.34, 0, 0, Math.PI / 2 - 0.35));
      parts.push(lpPart(lpCyl(0.17, 0.17, 0.02, 10), "#f4f5f7", -0.02, 0.37, s * 0.52, Math.PI / 2));
      parts.push(lpPart(lpBox(0.15, 0.035, 0.02), dark, -0.03, 0.45, s * 0.532), lpPart(lpBox(0.035, 0.16, 0.02), dark, 0.01, 0.37, s * 0.532, 0, 0, -0.35));
    }
    // Seen only from the cockpit camera: dash, thin raked A-pillars along the windshield's edges, and
    // a roof band joining them.
    const cockpit = [
      lpPart(lpBox(0.16, 0.045, 0.6), dark, 0.4, 0.5, 0),
      lpPart(lpBox(0.02, 0.42, 0.025), dark, 0.4, 0.72, 0.32, 0, 0, -0.91),
      lpPart(lpBox(0.02, 0.42, 0.025), dark, 0.4, 0.72, -0.32, 0, 0, 0.91),
      lpPart(lpBox(0.42, 0.02, 0.64), dark, 0.2, 0.86, 0),
    ];
    // A steering wheel ahead of the driver's seat, built around its own hub (lpCar places it at
    // steerAt and rakes it by steerRake). Shown in cockpit view only.
    const steer = [
      lpPart(new THREE.TorusGeometry(0.07, 0.011, 6, 18), dark, 0, 0, 0, 0, Math.PI / 2, 0),
      lpPart(lpBox(0.012, 0.012, 0.13), dark),
      lpPart(lpCyl(0.012, 0.012, 0.08, 6), dark, 0.045, 0, 0, 0, 0, Math.PI / 2),
    ];
    return { parts, cockpit, steer, steerAt: [0.3, 0.58, -0.155], steerRake: -0.35, wheels: [["wheel-fl", 0.68, -0.47, 0.27, 0.24], ["wheel-fr", 0.68, 0.47, 0.27, 0.24], ["wheel-rl", -0.68, -0.48, 0.28, 0.26], ["wheel-rr", -0.68, 0.48, 0.28, 0.26]] };
  },
  // An unbadged open-wheeler: long nose, halo over the cockpit, sidepods, front and rear wings, and
  // the wheels out in the air.
  f1: () => {
    const paint = "#2a8fe0", white = "#eef1f5", dark = "#22262d", halo = new THREE.TorusGeometry(0.06, 0.008, 4, 12, Math.PI);
    halo.scale(1.3, 1, 1);
    const parts = [
      lpPart(lpBlock(-1.0, 0.72, 0.07, 0.1, 0.07, 0.1, 0.36, 0.3), dark),
      lpPart(lpBlock(0.5, 1.3, 0.14, 0.42, 0.12, 0.22, 0.17, 0.08), paint),
      lpPart(lpBlock(-0.25, 0.52, 0.1, 0.46, 0.12, 0.43, 0.24, 0.19), paint),
      lpPart(lpBox(0.36, 0.03, 0.26), dark, 0.14, 0.45, 0),
      lpPart(new THREE.IcosahedronGeometry(0.1, 0), "#f2c230", 0.08, 0.53, 0),
      lpPart(lpBlock(-1.02, -0.2, 0.12, 0.3, 0.1, 0.66, 0.08, 0.2), paint),
      lpPart(lpBlock(-0.34, -0.14, 0.52, 0.66, 0.52, 0.66, 0.05, 0.07), white),
      lpPart(lpBlock(-0.62, 0.3, 0.1, 0.26, 0.1, 0.36, 0.34, 0.44), paint),
      lpPart(lpBlock(1.1, 1.42, 0.06, 0.09, 0.06, 0.09, 0.68, 0.68), white),
      lpPart(lpBlock(1.12, 1.26, 0.11, 0.14, 0.11, 0.14, 0.64, 0.64), paint),
      lpPart(lpBlock(-1.24, -0.94, 0.66, 0.72, 0.66, 0.72, 0.44, 0.44), white),
      lpPart(lpBlock(-1.22, -1.04, 0.77, 0.81, 0.77, 0.81, 0.44, 0.44), paint),
      lpPart(lpBlock(-1.16, -0.98, 0.34, 0.37, 0.34, 0.37, 0.4, 0.4), dark),
      lpPart(lpBox(0.06, 0.36, 0.04), dark, -1.0, 0.47, 0),
      lpPart(halo, dark, 0.189, 0.904, 0), lpPart(lpBox(0.0143, 0.075, 0.0207), dark, 0.267, 0.867, 0),
    ];
    for (const s of [-1, 1]) {
      parts.push(lpPart(lpBox(0.04, 0.18, 0.04), dark, 0.02, 0.54, s * 0.2));
      parts.push(lpPart(lpBox(0.03, 0.18, 0.18), dark, 0.31, 0.24, s * 0.33));
      parts.push(lpPart(lpBox(0.34, 0.17, 0.03), paint, 1.26, 0.13, s * 0.69), lpPart(lpBox(0.34, 0.5, 0.03), paint, -1.08, 0.6, s * 0.455));
      for (const [x, y] of [[0.9, 0.3], [0.9, 0.19], [-0.72, 0.32], [-0.72, 0.2]]) parts.push(lpPart(lpBox(0.05, 0.025, 0.34), dark, x, y, s * 0.3));
    }
    // haloRef: the halo pillar's own local point (car units), a scene-graph marker.
    return { parts, haloRef: [0.267, 0.9045, 0], wheels: [["wheel-fl", 0.94, -0.58, 0.25, 0.2], ["wheel-fr", 0.94, 0.58, 0.25, 0.2], ["wheel-rl", -0.74, -0.57, 0.28, 0.3], ["wheel-rr", -0.74, 0.57, 0.28, 0.3]] };
  },
};

/** Life-size car scales (x length, y height, z width) for the low-poly models above. */
export const LP_CAR_SIZE: Record<CarId, [number, number, number]> = { gt3: [1.92, 1.6, 1.6], f1: [2.1, 1.2, 1.45] };

export interface LpWheel {
  pivot: THREE.Group;
  spin: THREE.Mesh;
  r: number;
  y: number;
}
export interface LpCarModel {
  root: THREE.Group;
  body: THREE.Mesh;
  glass: THREE.Mesh;
  cockpit: THREE.Mesh | null;
  steer: THREE.Group | null;
  haloRef: THREE.Object3D | null;
  wheels: Record<string, LpWheel>;
  S: number;
}

/**
 * The drivable car: root (placed, yawed, pitched with the slope) > frame (scaled) > body (pitch and
 * lean) and four wheel pivots named wheel-fl/fr/rl/rr (front ones steer), each holding a spinning
 * wheel. The body also holds a hidden glass mesh (for a Detailed fit) and, in Low poly, a cockpit
 * mesh shown only from the cockpit camera. userData.look says which car it is.
 */
export function lpCar(id: CarId, mat: THREE.Material, size?: [number, number, number], glassMat?: THREE.Material): LpCarModel {
  const S = size || [0.085, 0.085, 0.085], def = (LP_CARS[id] || LP_CARS.gt3)(), root = new THREE.Group(), frame = new THREE.Group();
  // The wheelbase is centred on the root, so the root sits midway between the axles.
  const xs = def.wheels.map((w) => w[1]); frame.position.x = (-(Math.max(...xs) + Math.min(...xs)) / 2) * S[0];
  root.rotation.order = "YZX"; frame.scale.set(S[0], S[1], S[2]); root.add(frame); root.userData.look = "lowpoly";
  const body = new THREE.Mesh(lpMerge(def.parts), mat); body.castShadow = true; frame.add(body);
  const none = new THREE.BufferGeometry(); none.setAttribute("position", new THREE.Float32BufferAttribute(9, 3)); none.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3)); none.setAttribute("color", new THREE.Float32BufferAttribute(9, 3));
  const glass = new THREE.Mesh(none, glassMat || mat); glass.visible = false; glass.castShadow = true; body.add(glass);
  const cockpit = def.cockpit && def.cockpit.length ? new THREE.Mesh(lpMerge(def.cockpit), mat) : null;
  if (cockpit) { cockpit.visible = false; body.add(cockpit); }
  // steer: a pivot at the wheel's hub, raked, holding the wheel itself, which turns about the column.
  // It skips the depth test and draws after the body that would otherwise hide it.
  let steer: THREE.Group | null = null;
  if (def.steer && def.steer.length && def.steerAt) {
    const steerMat = mat.clone(); steerMat.depthTest = false; steerMat.depthWrite = false;
    const wheel = new THREE.Mesh(lpMerge(def.steer), steerMat); wheel.renderOrder = 10;
    steer = new THREE.Group(); steer.position.set(...def.steerAt); steer.rotation.z = def.steerRake ?? 0;
    steer.userData.wheel = wheel; steer.add(wheel); steer.visible = false; body.add(steer);
  }
  let haloRef: THREE.Object3D | null = null;
  if (def.haloRef) { haloRef = new THREE.Object3D(); haloRef.position.set(...def.haloRef); body.add(haloRef); }
  const wheels: Record<string, LpWheel> = {};
  for (const [name, x, z, r, w] of def.wheels) {
    const pivot = new THREE.Group(), spin = new THREE.Mesh(lpWheel(r, w), mat);
    pivot.name = name; pivot.position.set(x, r, z); spin.castShadow = true; pivot.add(spin); frame.add(pivot);
    wheels[name] = { pivot, spin, r: r * S[1], y: r };
    // A back-reference so a Detailed revert, which only sees the Object3D graph, can restore it.
    pivot.userData.wheelRef = wheels[name];
  }
  return { root, body, glass, cockpit, steer, haloRef, wheels, S: S[1] };
}
