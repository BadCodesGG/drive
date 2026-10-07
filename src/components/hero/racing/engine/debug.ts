/**
 * The end-to-end checks' window into the engine (scripts/smoke.mjs reads it). Loaded as its own chunk,
 * and only when localStorage["hero-debug"] is "1", so ordinary visitors never download it or see any
 * internals.
 */
import * as THREE from "three";
import type { RacingEngine } from "./engine";
import { bumpAt, heightAt } from "./track";

declare global {
  interface Window {
    __heroDebug?: Record<string, unknown>;
  }
}

const WHEELS = ["wheel-fl", "wheel-fr", "wheel-rl", "wheel-rr"];
const trisOf = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Installs this mount's hooks; the returned function removes them again (on unmount). */
export function installHeroDebug(engine: RacingEngine): () => void {
  const x = engine.inspect();
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  const drive = () => engine.getState().world === "drive";
  const need = <T,>(v: T | null, what: string): T => { if (v === null) throw new Error(`__heroDebug: no ${what} yet (press Drive first)`); return v; };
  const road = () => need(x.world, "drive world").group.getObjectByName("road") as THREE.Object3D;
  const hooks = {
    get renderer() { return x.renderer; },
    // three's colour management is a module switch, not a renderer field.
    colorManagement: () => THREE.ColorManagement.enabled,
    get mood() { return x.mood; },
    get trackId() { return engine.getState().shown?.trackId ?? null; },
    get carId() { return engine.getState().shown?.carId ?? null; },
    get look() { return engine.getState().lookInForce; },
    get world() { return engine.getState().world; },
    get phase() { return engine.getState().phase; },
    get progress() { return (engine.getState().progress?.value ?? (engine.getState().phase === "idle" ? 0 : 100)) / 100; },
    get camera() { return x.camera; },
    get scene() { return x.scene; },
    get G() { return x.G; },
    get store() { return x.store; },
    get readyPrograms() { return x.readyPrograms; },
    get lastSplit() { return x.lastSplit; },
    // How long the last exit (Esc/Exit to idle) took by the page's own clock, in ms.
    get lastExitMs() { return x.lastExitMs; },
    driveBuilt: () => !!x.D,
    dtrk: () => x.dtrk,
    heightAt: (i: number) => heightAt(need(x.dtrk, "drive track"), i),
    bumpAt: (i: number) => bumpAt(need(x.dtrk, "drive track"), i),
    carTris: () => { let n = 0; x.D?.model.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.visible) n += trisOf(m.geometry); }); return n; },
    landmarkCounts: () => ({ ...((drive() ? x.world?.counts : x.mini?.counts) ?? {}) }),
    gantryText: () => { const b = drive() ? x.world?.banner : x.mini?.banner; return b ? (b.userData.text as string) : null; },
    // The drive world's size: meshes, draw objects, and triangles (instances counted).
    worldStats: () => {
      let tris = 0, meshes = 0; const w = x.world;
      w?.group.traverse((o) => { const m = o as THREE.InstancedMesh; if (!m.isMesh) return; meshes++; tris += trisOf(m.geometry) * (m.isInstancedMesh ? m.count : 1); });
      return { meshes, tris: Math.round(tris), names: w ? w.group.children.map((o) => o.name).filter(Boolean) : [] };
    },
    cacheStats: () => x.cacheStats(),
    // Put the car at a lap fraction at a speed (for sampling particular corners).
    place: (f: number, v: number) => x.place(f, v),
    // The same at a named place (the track's marks: its start, or its end), shift metres on from it.
    placeAt: (name: string, shift = 0, v = 0, end = false) => { const t = need(x.dtrk, "drive track"); x.place((((t.mark(name, end) + shift / t.seg) / t.N) % 1 + 1) % 1, v); },
    markIdx: (name: string, end = false) => need(x.dtrk, "drive track").mark(name, end),
    // The elevation model's height (the track's height array) at centreline index i, before any meshing.
    profileAt: (i: number) => { const H = need(x.track, "track").height, N = need(x.dtrk, "drive track").N, k0 = ((((i / N) * H.length) % H.length) + H.length) % H.length, k = Math.floor(k0), u = k0 - k; return (H[k] * (1 - u) + H[(k + 1) % H.length] * u) / 10; },
    // What lies on the centreline: the first thing a ray straight down meets at n points round the
    // lap (away from the start line and grid), and the colour of the surface it hit there.
    centreSamples: (n: number) => {
      const t = need(x.dtrk, "drive track"), w = need(x.world, "drive world").group, out: { i: number; name: string | null; rgb: number[] | null }[] = [];
      for (let k = 0; k < n; k++) {
        const i = Math.round(((k + 0.5) / n) * t.N) % t.N; if (Math.min(i, t.N - i) * t.seg < 180) continue;
        ray.set(new THREE.Vector3(t.P[i].x, t.E[i] + 20, t.P[i].z), down); const hit = ray.intersectObject(w, true)[0];
        const c = hit && ((hit.object as THREE.Mesh).geometry.attributes.color as THREE.BufferAttribute | undefined), a = hit?.face?.a ?? 0;
        out.push({ i, name: hit ? hit.object.name : null, rgb: c ? [c.getX(a), c.getY(a), c.getZ(a)] : null });
      }
      return out;
    },
    // Each rendered wheel's lowest point, and the rendered road right under it (a raycast).
    wheelContacts: () => WHEELS.map((n) => {
      const w = need(x.D, "car").model.wheels[n]; w.pivot.updateWorldMatrix(true, false); const c = new THREE.Vector3().setFromMatrixPosition(w.pivot.matrixWorld);
      ray.set(new THREE.Vector3(c.x, c.y + 30, c.z), down); const hit = ray.intersectObject(road())[0];
      return { wheel: c.y - w.r, road: hit ? hit.point.y : null };
    }),
    // The rendered road's height under (x, z), by raycast, or null off the road.
    roadAt: (px: number, pz: number) => { ray.set(new THREE.Vector3(px, 5000, pz), down); const hit = ray.intersectObject(road())[0]; return hit ? hit.point.y : null; },
    // The rendered land's height under (x, z), by raycast; this circuit's raw ground entry.
    landAt: (px: number, pz: number) => { const land = need(x.world, "drive world").group.children.filter((o) => o.name === "land"); ray.set(new THREE.Vector3(px, 5000, pz), down); const hit = ray.intersectObjects(land)[0]; return hit ? hit.point.y : null; },
    groundData: () => x.ground,
    // The drawn Fuji's apex from its rendered bounding box, and the camera it is seen from.
    mountain: () => {
      const m = x.world?.horizon.getObjectByName("mountainFuji");
      if (!m || !x.D) return null;
      m.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m);
      return { apex: [(box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2], cam: x.D.camera.position.toArray() };
    },
    carModel: () => ({ visible: x.D ? x.D.model.root.visible : false, miniVisible: !!x.mini?.miniCar.root.visible }),
    wheelNodes: (id: string) => (id !== engine.getState().shown?.carId || !x.D ? null : Object.fromEntries(Object.entries(x.D.model.wheels).map(([n, w]) => [n, { steer: w.pivot.rotation.y, spin: w.spin.rotation.z }]))),
    effects: () => ({ smoke: x.D ? x.D.smoke.live() : 0, puffs: x.D ? x.D.smoke.total() : 0, skids: x.D ? x.D.skids.count() : 0, slip: x.G.slip || 0 }),
    // The body's drawn roll and pitch (rad), and the chase camera's heading.
    body: () => (x.D ? { roll: x.D.model.body.rotation.x, pitch: x.D.model.body.rotation.z } : null),
    chaseH: () => x.chaseH,
    // Where the ghost car is, in metres along the lap ahead of the player (negative: behind).
    ghost: () => { const D = x.D, t = x.dtrk; if (!D || !t) return null; const d = ((x.G.gi - x.G.idx + t.N * 1.5) % t.N) - t.N / 2; return { visible: D.ghostCar.root.visible, ahead: d * t.seg, opacity: D.ghostMat.opacity, unlit: D.ghostMat.isMeshBasicMaterial }; },
    // Anything drawn as glowing points in the drive world (there should be none).
    glowPoints: () => { let n = 0; x.D?.scene.traverse((o) => { const p = o as THREE.Points<THREE.BufferGeometry, THREE.Material>; if (p.isPoints && p.material.blending === THREE.AdditiveBlending) n++; }); return n; },
    shadow: () => {
      const lights: string[] = [], scenery: string[] = [], sc = x.D ? x.D.sun.shadow.camera : null;
      const s = drive() && x.D ? x.D.scene : x.mini?.scene;
      s?.traverse((o) => { const l = o as THREE.Light; if (l.isLight && l.castShadow) lights.push(l.type); });
      const g = drive() ? x.world?.group : x.mini?.group;
      g?.traverse((o) => { if (((o as THREE.InstancedMesh).isInstancedMesh || o.parent?.name === "gantry") && (o.castShadow || o.receiveShadow)) scenery.push(o.name || "gantry"); });
      return { lights, mapSize: x.D ? x.D.sun.shadow.mapSize.x : 0, frame: sc ? [sc.right - sc.left, sc.top - sc.bottom] : null, scenery };
    },
    // The Detailed look: the car's own look (lowpoly until its model is fitted), the
    // models asked for and still on their way, and the frame as drawn now (the miniature held in its
    // fixed pose, its comets hidden), w wide, as base64 RGBA for comparing looks.
    carLook: () => (x.D ? x.D.model.root.userData.look : x.mini?.miniCar.root.userData.look) as string,
    models: () => ({ requested: [...(x.models?.state.requested ?? [])], pending: x.pending, failed: !!x.models?.state.failed }),
    snapshot: (w = 480, h0?: number) => {
      const { h, rgba } = x.snapshot(w, h0);
      let b = ""; for (let i = 0; i < rgba.length; i += 8192) b += String.fromCharCode(...rgba.subarray(i, i + 8192));
      return { w, h, rgba: btoa(b) };
    },
    // Chase and cockpit: the view in force, the car's own eye offset (for an
    // independent check of where the cockpit camera sits), and whether the Low poly shell shows.
    cameraView: () => engine.getState().view,
    carEye: () => ({ x: x.spec.eyeX, y: x.spec.eyeY, z: x.spec.eyeZ }),
    cockpitShellVisible: () => (x.D?.model.cockpit ? x.D.model.cockpit.visible : null),
    // The cockpit steering wheel: shown, its turn against the car's steering input, its rim's top.
    steerWheel: () => {
      const s = x.D?.model.steer; if (!s) return null;
      const w = s.userData.wheel as THREE.Object3D; w.updateWorldMatrix(true, false);
      return { visible: s.visible, rot: w.rotation.x, st: x.G.st || 0, top: w.localToWorld(new THREE.Vector3(0, 0.07, 0)).toArray() };
    },
    // The F1 halo's pillar: a scene-graph point a Detailed fit never moves.
    haloPillar: () => { const h = x.D?.model.haloRef; if (!h) return null; h.updateWorldMatrix(true, false); return h.getWorldPosition(new THREE.Vector3()).toArray(); },
    // The cockpit camera's own roll, with heading and the road's camber removed: its up vector
    // relative to the car's root, sideways component.
    cockpitRoll: () => {
      if (!x.D || engine.getState().view !== "cockpit") return null;
      x.D.model.root.updateWorldMatrix(true, false);
      const rootQ = x.D.model.root.getWorldQuaternion(new THREE.Quaternion()), relQ = rootQ.clone().invert().multiply(x.D.camera.quaternion);
      return new THREE.Vector3(0, 1, 0).applyQuaternion(relQ).z;
    },
    // The nearest visible car part anywhere in the cockpit's view, cast from the eye over a 7x7 grid
    // out to the frame's edges (nothing of the car clips the camera).
    cockpitClearance: () => {
      if (!x.D || engine.getState().view !== "cockpit") return null;
      const cam = x.D.camera, eye = cam.position, m = x.D.model, parts: THREE.Object3D[] = [m.body, m.glass, ...(m.cockpit && m.cockpit.visible ? [m.cockpit] : []), ...Object.values(m.wheels).map((w) => w.spin)];
      let min = Infinity;
      for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
        const dir = new THREE.Vector3(-0.98 + (1.96 * i) / 6, -0.98 + (1.96 * j) / 6, 0.5).unproject(cam).sub(eye).normalize();
        ray.set(eye, dir);
        for (const p of parts) { const hits = ray.intersectObject(p, true); if (hits[0]) min = Math.min(min, hits[0].distance); }
      }
      return Number.isFinite(min) ? min : null;
    },
    // A rigid-body invariant that never reuses the cockpit's own formula: where the eye sits in the
    // body's local space now, and later how far the camera is from where the body says it should be.
    rigidBodyPose: () => {
      if (!x.D || engine.getState().view !== "cockpit") return null;
      x.D.model.body.updateWorldMatrix(true, false);
      const cam = x.D.camera, local = x.D.model.body.worldToLocal(cam.position.clone()), bodyQ = x.D.model.body.getWorldQuaternion(new THREE.Quaternion());
      return { local: local.toArray(), relQ: bodyQ.clone().invert().multiply(cam.quaternion).toArray() };
    },
    rigidBodyCheck: (local: [number, number, number], relQ: [number, number, number, number]) => {
      if (!x.D) return null;
      x.D.model.body.updateWorldMatrix(true, false);
      const cam = x.D.camera, wantPos = x.D.model.body.localToWorld(new THREE.Vector3(...local)), wantQ = x.D.model.body.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion(...relQ));
      return { posErr: wantPos.distanceTo(cam.position), angErr: (wantQ.angleTo(cam.quaternion) * 180) / Math.PI };
    },
    // Which worlds the frame being drawn holds, the car's share of the frame, the
    // last physics dt, how often the HUD component has rendered, and the camera shake.
    renderedWorlds: () => { const s = x.scene, has = (o: THREE.Object3D | undefined) => { let p: THREE.Object3D | null = o ?? null; while (p) { if (p === s) return true; p = p.parent; } return false; }; return { mini: has(x.mini?.group), drive: has(x.world?.group) }; },
    // The share of the frame the player's car covers, from a one-frame render of the
    // drive camera's view with the car isolated (everything else hidden, cleared transparent).
    carCover: (w = 240) => {
      const D = need(x.D, "car"), R = need(x.renderer, "renderer"), sz = R.getSize(new THREE.Vector2()), h = Math.max(1, Math.round((w * sz.y) / sz.x));
      const rt = new THREE.WebGLRenderTarget(w, h), px = new Uint8Array(w * h * 4), hidden = D.scene.children.filter((o) => o !== D.model.root && o.visible);
      const bg = D.scene.background, cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha();
      hidden.forEach((o) => { o.visible = false; }); D.scene.background = null; R.setClearColor(0x000000, 0);
      R.setRenderTarget(rt); R.clear(); R.render(D.scene, D.camera); R.readRenderTargetPixels(rt, 0, 0, w, h, px); R.setRenderTarget(null);
      hidden.forEach((o) => { o.visible = true; }); D.scene.background = bg; R.setClearColor(cc, ca); rt.dispose();
      let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
      return n / (w * h);
    },
    get lastDt() { return x.lastDt; },
    get hudRenders() { return x.hudRenders; },
    get shakeAmp() { return x.shakeAmp; },
  };
  const dbg = window.__heroDebug || (window.__heroDebug = {});
  Object.defineProperties(dbg, Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(hooks)).map(([k, d]) => [k, { ...d, configurable: true, enumerable: true }])));
  return () => {
    for (const k of Object.keys(hooks)) delete dbg[k];
    if (window.__heroDebug === dbg && Object.keys(dbg).length === 0) delete window.__heroDebug;
  };
}
