/**
 * The miniature: the idle scene, the whole lap in view, with its autopilot. It touches no DOM
 * (React owns that). The Detailed look passes its Detail through to lpWorld, whose swaps the engine fits.
 */
import * as THREE from "three";
import type { CarId } from "./cars";
import type { Track } from "../data/types";
import type { Detail, Swap } from "./detailed";
import { elevSamples } from "./track";
import { lpCar, type LpCarModel } from "./scenery/car";
import type { LpGround } from "./scenery/ground";
import { lpSky } from "./scenery/sky";
import { lpWorld } from "./scenery/world";
import { idleFar, idlePull } from "./fit";

/** The app's palette as the scene uses it (the same values as globals.css's tokens). */
export const C = {
  accent: new THREE.Color("#e8b84c"),
  strong: new THREE.Color("#90681a"),
  dim: new THREE.Color("#7c8699"),
};

export interface Pointer {
  x: number;
  y: number;
  inside: boolean;
}

/** Where a dive starts from: the camera, where it looks, and the rig's turn and offset. */
export interface MiniPose {
  cam: THREE.Vector3;
  look: THREE.Vector3;
  rx: number;
  ry: number;
  x: number;
}

export interface Mini {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: THREE.Group;
  /** The miniature's own world (lpWorld): what the shadow and landmark hooks read. */
  group: THREE.Group;
  counts: Record<string, number>;
  banner: THREE.Mesh;
  miniCar: LpCarModel;
  /** Detailed: the models to fit into the miniature once they load (empty in Low poly). */
  swaps: Swap[];
  /** Runs draw with the miniature held in the snapshot pose (for stills): the rig
   * square at its idle turn and offset, the moving comets hidden; they show again afterwards. Given an
   * aspect, draw sees the vantage resize() gives a canvas of that shape (the camera's aspect, position
   * and aim, and the rig's offset), and the camera and rig are put back afterwards. */
  still(draw: () => void, aspect?: number): void;
  /** The idle vantage resize() computes: camera, look target, rig offset. */
  idle: { cam: THREE.Vector3; look: THREE.Vector3; x: number };
  /** One idle frame: the autopilot's comets run and the rig follows the pointer. */
  update(t: number, dt: number, m: Pointer): void;
  /** Keeps the sky dome centred on the camera, after any camera move this frame. */
  followSky(): void;
  /** The pose a dive starts from, copied into pose. */
  poseInto(pose: MiniPose): void;
  /** Puts the little car at lap fraction f, heading h; returns its sample index. */
  placeMini(f: number, h: number): number;
  /** The camera on the way in (w 0 to 1) or out (1 to 0): the rig turns square, the camera dives to the car. */
  miniCamera(w: number, rx: number, ry: number, rxPos: number, camFrom: THREE.Vector3, lookFrom: THREE.Vector3): void;
  /** Back at rest: the rig and camera in the idle vantage, the little car hidden. */
  restoreIdle(): void;
  /** placeCamera: only while idle or loading does a resize move the camera. */
  resize(w: number, h: number, dpr: number, placeCamera?: boolean): void;
  dispose(): void;
}

interface Trail {
  g: THREE.BufferGeometry;
  m: THREE.ShaderMaterial;
  s: number;
  pts: THREE.Points;
}

export function buildMini(track: Track, ground: LpGround | null, carId: CarId, mobile: boolean, detail: Detail | null = null): Mini {
  const mood = track.mood, sunDir = new THREE.Vector3().setFromSphericalCoords(1, ((90 - mood.sun.elevation) * Math.PI) / 180, (mood.sun.azimuth * Math.PI) / 180);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
  const rig = new THREE.Group(); scene.add(rig);
  // A real circuit, traced from open map data. Index 0 sits on the start/finish line.
  const curve = new THREE.CatmullRomCurve3(track.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, "centripetal", 0.5);
  const N = 1200, P = curve.getSpacedPoints(N), T: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) T.push(curve.getTangentAt(i / N));
  const HW = 0.13; // half the track width
  // Heights at the miniature's own scale, a little exaggerated so the hills read.
  const miniV = (1.3 * curve.getLength()) / (Number(track.km) * 1000), E = elevSamples(curve, track.elev, N).map((e) => e * miniV);
  // Curvature decides speed: the car brakes for corners, as a real lap trace does.
  const curv = new Float32Array(N), speed = new Float32Array(N), load = new Float32Array(N);
  for (let i = 0; i < N; i++) curv[i] = T[i].angleTo(T[(i + 6) % N]);
  for (let i = 0; i < N; i++) { let s = 0; for (let j = -40; j <= 40; j++) s = Math.max(s, curv[(i + j + N) % N] * (1 - Math.abs(j) / 60)); load[i] = s; }
  const peak = Math.max(...load);
  for (let i = 0; i < N; i++) speed[i] = Math.pow(1 - load[i] / peak, 1.6);
  const trk = { P, T, N, HW, E };
  const side = (i: number, sign: number, w: number) => { const p = P[i % N], tg = T[i % N]; return new THREE.Vector3(p.x - tg.z * w * sign, E[i % N], p.z + tg.x * w * sign); };
  {
    const pos = new Float32Array((N + 1) * 6), idx: number[] = [];
    for (let i = 0; i <= N; i++) { const l = side(i, 1, HW), r = side(i, -1, HW); pos.set([l.x, l.y + 0.004, l.z, r.x, r.y + 0.004, r.z], i * 6); if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    rig.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: "#3a3f47" })));
  }
  // The racing line, darker gold where the car is flat out, brighter in the braking zones.
  const colors = new Float32Array((N + 1) * 3), lp: THREE.Vector3[] = [];
  for (let i = 0; i <= N; i++) { const p = P[i % N]; lp.push(new THREE.Vector3(p.x, E[i % N] + 0.008, p.z)); const c = C.accent.clone().lerp(C.strong, 0.35 + 0.65 * speed[i % N]); colors.set([c.r, c.g, c.b], i * 3); }
  const lineGeo = new THREE.BufferGeometry().setFromPoints(lp); lineGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  rig.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })));
  // Start/finish line in gold, sector lines in grey.
  [0, 0.34, 0.68].forEach((f, k) => {
    const i = Math.round(f * N) % N;
    const g = new THREE.BufferGeometry().setFromPoints([side(i, 1, HW * 2), side(i, -1, HW * 2)].map((v) => v.setY(v.y + 0.01)));
    rig.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: k === 0 ? C.accent : C.dim, transparent: true, opacity: k === 0 ? 0.9 : 0.6 })));
  });
  // The world around the road, then this circuit's mood: sky, sun, fog and hemisphere light.
  const mini = lpWorld(track, ground, trk, load, peak, mobile, detail); rig.add(mini.group);
  scene.fog = new THREE.Fog(mood.fog.color, mood.fog.near, mood.fog.far);
  const sky = lpSky(mood, sunDir); scene.add(sky);
  scene.add(new THREE.HemisphereLight(mood.hemi.sky, mood.hemi.ground, mood.hemi.intensity));
  { const sun = new THREE.DirectionalLight(mood.sun.color, mood.sun.intensity); sun.position.copy(sunDir).multiplyScalar(6); scene.add(sun); }
  // The autopilot's comet and its ghost: this lap in gold, the best lap in grey.
  const TR = 90;
  const mkTrail = (parent: THREE.Object3D, color: THREE.Color, sizeMul: number): Trail => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TR * 3), 3));
    const f = new Float32Array(TR); for (let i = 0; i < TR; i++) f[i] = 1 - i / TR; g.setAttribute("fade", new THREE.BufferAttribute(f, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color }, uPx: { value: 1 }, uSize: { value: sizeMul } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float fade; uniform float uPx; uniform float uSize; varying float vF; void main(){ vF=fade; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=min(uPx*uSize*(3.+ 20.*pow(fade,6.))*(6./-mv.z), 40.*uPx); }`,
      fragmentShader: `uniform vec3 uColor; varying float vF; void main(){ vec2 c=gl_PointCoord-.5; float d=length(c); if(d>.5) discard; float core=smoothstep(.5,.0,d); gl_FragColor=vec4(mix(uColor,vec3(1.),pow(vF,8.)*.6), core*pow(vF,1.6)); }`,
    });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; parent.add(pts); return { g, m, s: 0, pts };
  };
  const car = mkTrail(rig, C.accent, 1), ghost = mkTrail(rig, C.dim, 0.75);
  ghost.s = N * 0.035;
  const trailFromIndex = (c: Trail, s: number, stride = 3) => {
    const attr = c.g.attributes.position as THREE.BufferAttribute, arr = attr.array as Float32Array;
    for (let i = 0; i < TR; i++) { const k = (((Math.floor(s) - i * stride) % N) + N) % N, p = P[k]; arr[i * 3] = p.x; arr[i * 3 + 1] = E[k] + 0.012; arr[i * 3 + 2] = p.z; }
    attr.needsUpdate = true;
  };
  // The little car the camera dives toward when the drive loads in (and rises from on the way out).
  const miniCar = lpCar(carId, mini.mat); miniCar.root.visible = false; rig.add(miniCar.root);
  let miniI = 0;
  const placeMini = (f: number, h: number) => {
    const i = Math.round(f * N) % N; miniCar.root.position.set(P[i].x, E[i], P[i].z); miniCar.root.rotation.set(0, -h, 0);
    return (miniI = i);
  };
  // The miniature's pose behind its little car, in the rig's own frame.
  const miniChase = (pos: THREE.Vector3, lk: THREE.Vector3) => {
    const i = miniI, h = -miniCar.root.rotation.y, c = Math.cos(h), s = Math.sin(h);
    pos.set(P[i].x - c * 0.34, E[i] + 0.11, P[i].z - s * 0.34); lk.set(P[i].x + c * 0.3, E[i] + 0.02, P[i].z + s * 0.3);
  };
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

  // Idle: the high three-quarter view, set in resize().
  const idle = { cam: new THREE.Vector3(), look: new THREE.Vector3(), x: 0 };
  const look = new THREE.Vector3();
  // The circuit's reach from the rig's origin: turn-proof, so the fit holds as the rig sways.
  const reach = Math.max(...P.map((p) => Math.hypot(p.x, p.z)));
  // The fog moves out with any pull-back (fit.ts idlePull); `pull` is the one resize() last set.
  let pull = 0;
  const fogOut = (by: number) => { const f = scene.fog as THREE.Fog; f.near = mood.fog.near + by; f.far = mood.fog.far + by; };
  const step = (c: Trail, dt: number, pace: number) => { c.s = (c.s + dt * pace * (90 + 330 * speed[Math.floor(c.s) % N])) % N; };
  const tilt = { x: 0, y: 0 };

  return {
    scene, camera, rig, group: mini.group, counts: mini.counts, banner: mini.banner, miniCar, idle, swaps: mini.swaps,
    still(draw, aspect) {
      const keep = aspect === undefined ? null : { a: camera.aspect, p: camera.position.clone(), q: camera.quaternion.clone() };
      let rx = idle.x;
      if (aspect !== undefined) { const far = idleFar(aspect, reach); rx = Math.max(0, aspect - 1.3) * 1.35; camera.aspect = aspect; camera.updateProjectionMatrix(); camera.position.set(0, far * 0.62, far * 0.78); camera.lookAt(rx * 0.55, 0, 0); fogOut(idlePull(aspect, reach)); }
      rig.rotation.set(0, -0.35, 0); rig.position.x = rx; car.pts.visible = ghost.pts.visible = false;
      try { draw(); } finally {
        car.pts.visible = ghost.pts.visible = true; rig.position.x = idle.x;
        if (keep) { camera.aspect = keep.a; camera.updateProjectionMatrix(); camera.position.copy(keep.p); camera.quaternion.copy(keep.q); fogOut(pull); }
      }
    },
    update(t, dt, m) {
      step(car, dt, 1); step(ghost, dt, 0.992);
      trailFromIndex(car, car.s); trailFromIndex(ghost, ghost.s);
      tilt.x += (m.y * 0.12 - tilt.x) * Math.min(1, dt * 2); tilt.y += (m.x * 0.25 - tilt.y) * Math.min(1, dt * 2);
      rig.rotation.set(tilt.x, -0.35 + tilt.y + Math.sin(t * 0.08) * 0.12, 0);
    },
    followSky() { sky.position.copy(camera.position); },
    poseInto(pose) { pose.cam.copy(camera.position); pose.look.copy(look); pose.rx = rig.rotation.x; pose.ry = rig.rotation.y; pose.x = rig.position.x; },
    placeMini,
    miniCamera(w, rx, ry, rxPos, camFrom, lookFrom) {
      rig.position.set(rxPos * (1 - w), 0, 0); rig.rotation.set(rx * (1 - w), ry * (1 - w), 0); rig.updateMatrixWorld();
      miniChase(v1, v2); v1.applyMatrix4(rig.matrixWorld); v2.applyMatrix4(rig.matrixWorld);
      camera.position.lerpVectors(camFrom, v1, w); look.lerpVectors(lookFrom, v2, w); camera.lookAt(look);
      const fov = 35 + 20 * w; if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    },
    restoreIdle() {
      miniCar.root.visible = false;
      rig.position.x = idle.x; camera.fov = 35; camera.updateProjectionMatrix(); camera.position.copy(idle.cam); look.copy(idle.look); camera.lookAt(look);
    },
    resize(w, h, dpr, placeCamera = true) {
      camera.aspect = w / h; camera.updateProjectionMatrix();
      car.m.uniforms.uPx.value = ghost.m.uniforms.uPx.value = dpr;
      rig.position.x = idle.x = Math.max(0, w / h - 1.3) * 1.35;
      pull = idlePull(w / h, reach); fogOut(pull);
      const far = idleFar(w / h, reach); idle.cam.set(0, far * 0.62, far * 0.78); idle.look.set(rig.position.x * 0.55, 0, 0);
      if (placeCamera) { camera.position.copy(idle.cam); look.copy(idle.look); camera.lookAt(look); }
    },
    dispose() {
      // Everything this miniature built, freed as the scene is left.
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        // A mesh showing a Detailed model keeps its own Low poly stand-in parked here (dFit).
        (o.userData.standIn as THREE.BufferGeometry | undefined)?.dispose();
        const mat = mesh.material;
        if (mat) for (const mm of Array.isArray(mat) ? mat : [mat]) {
          const sm = mm as THREE.ShaderMaterial & { map?: THREE.Texture | null };
          Object.values(sm.uniforms || {}).forEach((u) => (u.value as THREE.Texture | undefined)?.isTexture && (u.value as THREE.Texture).dispose());
          sm.map?.dispose(); mm.dispose();
        }
      });
    },
  };
}
