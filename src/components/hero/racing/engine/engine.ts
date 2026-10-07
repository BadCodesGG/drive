/**
 * The racing game's engine: one per mount, imperative, and never touched by React renders. React
 * reads its low-frequency state through subscribe/getState and hands it the HUD's elements
 * (bindHud), which it writes per frame; R3F hands it the renderer and calls frame() from its single
 * priority-1 useFrame, then draws engine.scene with engine.camera. Sections, in order: the
 * miniature, the drive (built only on Drive), phases, lap timing, cameras (chase and cockpit), one
 * frame of driving, and the Detailed look's fetch, fit and fallback.
 */
import * as THREE from "three";
import type { Ground, Track, TrackData, TrackId } from "../data/types";
import { CARS, isCarId, type Car, type CarId } from "./cars";
import { cockpitFov, cockpitPose } from "./cockpit";
import { createModels, D_FALLBACK, detailedModels, dFitCar, dRevert, type CarParts, type Detail, type Models } from "./detailed";
import type { KeyRead } from "./input";
import type { PadKeys } from "./pad";
import { bestKey, fmt, lapTick, newLapState, parseBest, type Best, type LapState, type Split } from "./laps";
import { buildMini, type Mini, type MiniPose, type Pointer } from "./mini";
import { bodyPose, chaseEase, stepFixed, type CarState, type Keys } from "./physics";
import { readPrefs, writePref, type Look, type Prefs, type Steer, type View } from "./prefs";
import { LP_CAR_SIZE, lpCar, type LpCarModel } from "./scenery/car";
import { lpDriveBuild, lpSkids, lpSmoke, type DriveWorld, type LpSkids, type LpSmoke } from "./scenery/drive";
import { lpGround, type LpGround } from "./scenery/ground";
import { lpSky } from "./scenery/sky";
import { bumpAt, carPose, driveTrack, heightAt, referenceLap, speedProfile, surfaceAt, type DriveTrack } from "./track";
import { isTrackId } from "../data/types";

export type Phase = "idle" | "loading" | "in" | "drive" | "out";

export interface EngineState {
  trackId: TrackId;
  carId: CarId;
  /** The look the visitor chose (hero-look); lookInForce is the one drawn, Low poly once the models failed. */
  look: Look;
  lookInForce: Look;
  /** The Detailed models failed this mount: the look shows Low poly for the rest of it. */
  lookFailed: boolean;
  view: View;
  steer: Steer;
  phase: Phase;
  world: "mini" | "drive";
  /** The circuit and car whose miniature is on screen (null until the first one is built). */
  shown: { trackId: TrackId; carId: CarId } | null;
  /** The shown circuit's fog colour: the veil the dive crosses through. */
  fog: string | null;
  /** The loader's current step while the drive builds, else null. */
  progress: { label: string; value: number } | null;
  /** The last thing said (say()), for the live region; n counts, so a repeat is still announced. */
  status: { text: string; n: number };
  /** True once a frame of the miniature has been drawn. */
  ready: boolean;
  /** The circuit's data could not be loaded: the hero falls back to its still gradient. */
  failed: boolean;
}

export interface EngineOptions {
  mobile: boolean;
  /** prefers-reduced-motion: the dive cuts instead of easing, and the camera never shakes. */
  reduced?: boolean;
  /** Fetches one circuit's data chunk (data/index.ts's loadTrackData in the page). */
  loadTrack: (id: TrackId) => Promise<TrackData>;
  prefs?: Prefs;
}

/** The HUD elements the engine writes each frame while driving; any may be absent. */
export interface HudRefs {
  msg?: HTMLElement | null;
  spd?: HTMLElement | null;
  lap?: HTMLElement | null;
  last?: HTMLElement | null;
  bestLabel?: HTMLElement | null;
  best?: HTMLElement | null;
  delta?: HTMLElement | null;
  /** The arc speedometer: its root (data-speed), the arc's fill path and the number. */
  speedo?: HTMLElement | null;
  speedoFill?: SVGElement | null;
  speedoNum?: HTMLElement | null;
  /** The fog-coloured veil the dive crosses. */
  veil?: HTMLElement | null;
}

/** The car's state: physics, pose, lap timing and the HUD's message. */
export type DriveState = CarState & LapState & { pos: THREE.Vector3; on: boolean; y: number; msg: string; msgTone: "" | "good" | "bad"; msgUntil: number };

/** One scene instance's drive: the drive scene around a cached world. */
export interface DriveScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  sky: THREE.Mesh;
  model: LpCarModel;
  ghostCar: LpCarModel;
  smoke: LpSmoke;
  skids: LpSkids;
  ghostMat: THREE.MeshBasicMaterial;
  marks: (number[] | null)[];
  speedFrac: number;
}

/**
 * Per circuit, per mount: the drive track, each car's reference lap, and the built world,
 * at most one look's at a time (the other is freed when a new one is built).
 */
interface TrackCache {
  trk: DriveTrack | null;
  ref: Partial<Record<CarId, { lap: number; times: Float32Array }>>;
  worlds: Partial<Record<Look, DriveWorld>>;
}

/** What the lazily loaded debug hooks read; nothing else uses it. */
export interface EngineInternals {
  renderer: THREE.WebGLRenderer | null;
  mini: Mini | null;
  mood: TrackData["track"]["mood"] | null;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cacheStats(): { driveWorlds: number; tracks: number; grounds: number };
  G: DriveState;
  D: DriveScene | null;
  dtrk: DriveTrack | null;
  track: Track | null;
  ground: Ground | null;
  /** The shown circuit's cached drive world in the look in force, built or not. */
  world: DriveWorld | null;
  /** This mount's Detailed models (null until the look is first chosen). */
  models: Models | null;
  /** Detailed model fits this scene is still waiting for. */
  pending: number;
  /** This frame's road pose under the car (carPose): the cockpit eye rides on it. */
  carP: { roll: number; pitch: number } | null;
  spec: Car;
  best: Best | null;
  store: string | null;
  chaseH: number;
  readyPrograms: number;
  lastSplit: (Split & { at: number }) | null;
  lastExitMs: number | null;
  /** The dt the last frame stepped the car by (0 while paused). */
  lastDt: number;
  /** How many times the HUD component has rendered (committed) this mount. */
  hudRenders: number;
  /** The camera shake's amplitude now (never set under reduced motion). */
  shakeAmp: number;
  /** Puts the car at lap fraction f at speed v, the chase camera snapped behind it. */
  place(f: number, v: number): void;
  /** Draws the frame as it is now (the miniature held still) into pixels w wide (the snapshot hook);
   * h, when given, draws it as a w x h canvas shows it: that aspect, the miniature's vantage for it, and
   * the canvas's own tone mapping and output colour space (display values, not linear). */
  snapshot(w: number, h?: number): { w: number; h: number; rgba: Uint8Array };
}

export interface RacingEngine {
  subscribe(fn: () => void): () => void;
  getState(): EngineState;
  attach(gl: THREE.WebGLRenderer): void;
  resize(w: number, h: number, dpr: number): void;
  frame(dt: number, pointer: Pointer): void;
  /** Called after each draw: the first one marks the hero ready. */
  afterRender(): void;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  setTrack(id: TrackId): void;
  setCar(id: CarId): void;
  /** The look (hero-look): Low poly or Detailed, rebuilt in place while idle. */
  setLook(look: Look): void;
  /** Chase and cockpit, while driving (the C key, and the phone pad's View button). */
  toggleView(): void;
  /** The phone pad's steering mode: touch halves or tilt, saved to hero-steer unless save is false (a
   * mode the pad fell back to on its own, which must not overwrite the visitor's choice). */
  setSteer(m: Steer, save?: boolean): void;
  /** The phone pad's keys, from pad.ts's padKeys (steer null: steer with A and D). */
  pad(k: PadKeys): void;
  /** A message in the HUD for secs seconds, also spoken via the live region. */
  say(text: string, secs: number): void;
  /** Drive: build the drive world (once per circuit) and dive in. */
  enter(): void;
  /** Leave the drive (or cancel its loading). */
  exit(): void;
  respawn(): void;
  /** A key event already read by input.ts's readKey. */
  key(read: KeyRead): void;
  clearKeys(): void;
  /** The game is on screen and the tab visible; while false the car does not move. */
  setActive(on: boolean): void;
  bindHud(refs: HudRefs): () => void;
  /** The HUD component committed a render (the debug hooks count them). */
  hudCommitted(): void;
  inspect(): EngineInternals;
  dispose(): void;
}

/**
 * Run every frame: shadows on, as PCFShadowMap. R3F re-applies its own
 * shadows=false config (disabled, and PCFSoftShadowMap, which 0.186 deprecates) whenever the Canvas
 * re-renders, so setting this once at creation would not hold.
 */
function shadowsOn(gl: THREE.WebGLRenderer) {
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFShadowMap;
}

const DRIVE_FOG = 12.5; // the drive world's fog reaches this many times the miniature's distances
const KMH = 3.6;
// The first pick of each car says how it handles.
const HINTS: Record<CarId, string> = { gt3: "GT3: heavier, slides more, forgiving on the walls", f1: "F1: faster, brakes later, twitchy at low speed" };
const smooth = (u: number) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const now = () => performance.now();

/** Frees a world's own geometry (and, on unmount, its materials): it is being evicted, not hidden. */
function disposeTree(root: THREE.Object3D, materials: boolean) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    if (!materials || !m.material) return;
    for (const mm of Array.isArray(m.material) ? m.material : [m.material]) {
      const sm = mm as THREE.MeshBasicMaterial;
      sm.map?.dispose(); mm.dispose();
    }
  });
}

/**
 * Frees a cached drive world that is being evicted, not hidden. A mesh showing a Detailed model has
 * its live geometry on loan from the models' shared cache, so only its own Low poly stand-in is freed;
 * anything else owns its geometry outright.
 */
function disposeWorld(w: DriveWorld) {
  for (const root of [w.group, w.horizon]) root.traverse((o) => {
    if (o.userData.look === "detailed") (o.userData.standIn as THREE.BufferGeometry | undefined)?.dispose();
    else (o as THREE.Mesh).geometry?.dispose();
  });
}

export function createRacingEngine(opts: EngineOptions): RacingEngine {
  const prefs = opts.prefs ?? readPrefs(), reduced = !!opts.reduced;
  let state: EngineState = {
    trackId: prefs.trackId, carId: prefs.carId, look: prefs.look, lookInForce: "lowpoly", lookFailed: false, view: prefs.view, steer: prefs.steer,
    phase: "idle", world: "mini", shown: null, fog: null, progress: null, status: { text: "", n: 0 }, ready: false, failed: false,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<EngineState>) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };

  // Per mount, never per module: a later mount starts empty, and dispose() frees all of it.
  const data = new Map<TrackId, TrackData>(), grounds = new Map<TrackId, LpGround>(), drives = new Map<TrackId, TrackCache>();
  const blank = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera() };
  let renderer: THREE.WebGLRenderer | null = null, mini: Mini | null = null, disposed = false, active = true;
  let size: [number, number, number] | null = null, t = 4, fresh = true, token = 0, lastDt = 0, hudRenders = 0;
  let hud: HudRefs = {};
  const hinted = new Set<CarId>();
  // The Detailed look's models, fetched at most once each per mount.
  let models: Models | null = null;
  const modelsOf = () => (models ??= createModels());
  const lookFailed = () => !!models?.state.failed;

  // ---------- The scene instance: this circuit and car ----------
  // Everything below is reset whenever the miniature is rebuilt for a new circuit or car.
  // lookId: this instance's look; alive until the next instance replaces it; fellBack once its models
  // failed; pending: model fits still waiting; carParts: the Detailed car, once loaded.
  interface Instance { trackId: TrackId; carId: CarId; track: Track; spec: Car; sunDir: THREE.Vector3; store: string; stored: { lap: number; times: number[] } | null; lookId: Look; alive: boolean; fellBack: boolean; pending: number; carParts: CarParts | null }
  let inst: Instance | null = null;
  let carP: { roll: number; pitch: number } | null = null; // this frame's carPose (the cockpit eye rides on it)
  let D: DriveScene | null = null, dtrk: DriveTrack | null = null, best: Best | null = null;
  const G: DriveState = { on: false, pos: new THREE.Vector3(), h: 0, v: 0, vl: 0, r: 0, y: 0, idx: 0, ...newLapState(0), msg: "", msgTone: "", msgUntil: 0, wall: false, wrong: false, hit: 0 };
  const keys: Keys = {};
  let lastSplit: (Split & { at: number }) | null = null, lastExitMs: number | null = null, outStartedAt = 0, readyPrograms = 0;

  /** A message in the HUD for a while (tone colours it), also spoken via the live region. */
  function say(text: string, secs: number, tone: "" | "good" | "bad" = "", spoken = text) {
    G.msg = text; G.msgTone = tone; G.msgUntil = now() + secs * 1000;
    set({ status: { text: spoken, n: state.status.n + 1 } });
  }

  function disposeDrive() {
    if (!D || !inst) return;
    // The cached world is only detached: it is kept, GPU buffers and all, for this mount's life,
    // so the next Drive on this circuit only rolls out a car and is ready at once. This
    // instance's own objects (car, ghost, smoke, skids, sky) free their buffers; their materials are
    // left to the garbage collector: disposing the last user of a shader
    // program deletes it, and relinking it on the next Drive stalls for hundreds of milliseconds.
    const w = drives.get(inst.trackId)?.worlds[inst.lookId];
    if (w) D.scene.remove(w.group, w.horizon);
    // A mesh showing a Detailed model keeps its Low poly stand-in parked in userData (dFit): a real
    // buffer of its own, freed with it.
    D.scene.traverse((c) => { (c as THREE.Mesh).geometry?.dispose(); (c.userData.standIn as THREE.BufferGeometry | undefined)?.dispose(); });
    D.sun.dispose();
    D = null;
  }

  // Builds the miniature for the chosen circuit and car in place: the old one draws until the new
  // one is ready, then is freed.
  async function build() {
    const my = ++token, { trackId, carId } = state;
    try {
      let d = data.get(trackId);
      if (!d) { d = await opts.loadTrack(trackId); data.set(trackId, d); }
      if (my !== token || disposed) return;
      let g = grounds.get(trackId);
      if (!g) { g = lpGround(d.ground, trackId); grounds.set(trackId, g); }
      // The look: Detailed unless its models already failed this mount.
      const lookId: Look = state.look === "detailed" && !lookFailed() ? "detailed" : "lowpoly";
      const detail: Detail | null = lookId === "detailed" ? { trackId, src: modelsOf() } : null;
      const next = buildMini(d.track, g, carId, opts.mobile, detail);
      if (size) next.resize(...size);
      disposeDrive();
      const old = mini; mini = next; old?.dispose();
      dtrk = null; best = null;
      const mood = d.track.mood, store = bestKey(trackId, carId);
      let raw: string | null = null;
      try { raw = localStorage.getItem(store); } catch { /* no storage: no stored best */ }
      if (inst) inst.alive = false;
      const I: Instance = (inst = { trackId, carId, track: d.track, spec: CARS[carId], store, stored: parseBest(raw), sunDir: new THREE.Vector3().setFromSphericalCoords(1, ((90 - mood.sun.elevation) * Math.PI) / 180, (mood.sun.azimuth * Math.PI) / 180), lookId, alive: true, fellBack: false, pending: 0, carParts: null });
      t = 4; fresh = true;
      set({ shown: { trackId, carId }, fog: mood.fog.color, lookInForce: lookId, lookFailed: lookFailed() });
      // What this circuit and car need is fetched as soon as the scene is made, each file once
      // per mount; each model is fitted in as it arrives while its Low poly piece stands in.
      if (detail) {
        const m = detail.src as Models;
        for (const name of detailedModels(trackId, carId)) fitWhenLoaded(I, m.load(name), () => {});
        fitWhenLoaded(I, m.carParts(carId), (p) => { I.carParts = p; fitCars(I); });
        for (const sw of next.swaps) fitWhenLoaded(I, sw.get(), sw.fit);
      }
      // Detailed picked again after its models failed this mount: say so again.
      if (state.look === "detailed" && lookId === "lowpoly") say(D_FALLBACK, 5);
    } catch (e) {
      if (my !== token || disposed) return;
      console.warn("Racing hero: the circuit could not be loaded", e);
      set({ failed: true });
    }
  }
  void build();

  // ---------- The Detailed look: fetch, fit, or fall back ----------
  // Any failure puts everything back to Low poly for the rest of this mount and says so:
  // hero-look itself stays detailed, only this mount falls back.
  // (Not named use*, as React's lint reads any use* call as a hook.) world: a fit into
  // the cached drive world, which still applies once this scene is gone.
  function fitWhenLoaded<T>(I: Instance, promise: Promise<T>, fit: (v: T) => void, world = false) {
    I.pending++;
    promise.then(
      (v) => { I.pending--; if (!disposed && (world || I.alive) && !lookFailed()) fit(v); },
      () => { I.pending--; if (disposed) return; if (I.alive) fallback(I); else if (models) { models.state.failed = true; disposeAllDetailed(null); } },
    );
  }
  /** Fits the Detailed car into every car of this instance that does not wear it yet. */
  function fitCars(I: Instance) {
    if (lookFailed() || !I.carParts || I !== inst) return;
    for (const c of [mini?.miniCar, D?.model, D?.ghostCar]) if (c && c.root.userData.look !== "detailed") dFitCar(c, I.carParts);
  }
  /** Frees every other circuit's cached Detailed world: nothing can show one again this mount. */
  function disposeAllDetailed(exceptId: TrackId | null) {
    for (const [id, c] of drives) if (id !== exceptId && c.worlds.detailed) { disposeWorld(c.worlds.detailed); delete c.worlds.detailed; }
  }
  function fallback(I: Instance) {
    if (I.fellBack || !models) return;
    I.fellBack = models.state.failed = true;
    const w = drives.get(I.trackId)?.worlds.detailed;
    for (const o of [mini?.group, mini?.miniCar.root, D?.model.root, D?.ghostCar.root, w?.group, w?.horizon]) if (o) dRevert(o);
    w?.detailOnly.forEach((m) => { m.visible = false; });
    // This circuit's own world was reverted in place and may be on screen; the rest are freed.
    disposeAllDetailed(I.trackId);
    say(D_FALLBACK, 5);
    set({ lookInForce: "lowpoly", lookFailed: true });
    // Idle, the miniature is rebuilt as plain Low poly at once; driving, once back at rest.
    if (state.phase === "idle") setTimeout(() => { if (inst === I && state.phase === "idle") void build(); }, 0);
  }
  /** Back at rest: a scene whose models failed while it was out is rebuilt as Low poly. */
  function atRest() {
    if (inst && inst.fellBack && inst.lookId === "detailed") void build();
  }

  // ---------- The drive: a true-scale world in metres, built only when someone presses Drive ----------
  const cacheOf = (id: TrackId) => { let c = drives.get(id); if (!c) { c = { trk: null, ref: {}, worlds: {} }; drives.set(id, c); } return c; };
  // Building the world, one step at a time; every yield is [what is happening, how far along].
  function* buildDrive(): Generator<[string, number], void, void> {
    const I = inst as Instance, cache = cacheOf(I.trackId), ground = grounds.get(I.trackId) as LpGround, lookId = I.lookId, detailed = lookId === "detailed";
    yield ["Measuring the circuit", 0.01];
    const trk = (dtrk = cache.trk || (cache.trk = driveTrack(I.track)));
    yield ["Timing the ghost", 0.03];
    const prof = speedProfile(trk, I.spec);
    const ref = cache.ref[I.carId] || (cache.ref[I.carId] = referenceLap(trk, prof, I.spec));
    best = I.stored && I.stored.times.length === trk.N ? { lap: I.stored.lap, times: Float32Array.from(I.stored.times), mine: true } : { lap: ref.lap, times: ref.times, mine: false };
    G.cur = new Float32Array(trk.N);
    let world = cache.worlds[lookId];
    if (!world) {
      const gen = lpDriveBuild(I.track, trk, ground, opts.mobile, I.track.mood.fog.far * DRIVE_FOG, detailed ? { trackId: I.trackId, src: modelsOf() } : null);
      let r = gen.next();
      while (!r.done) { yield [r.value[0], 0.05 + r.value[1] * 0.75]; r = gen.next(); }
      world = r.value;
      // At most one look's world per circuit: the other look's was built by a scene already gone.
      const other: Look = detailed ? "lowpoly" : "detailed", was = cache.worlds[other];
      if (was) { disposeWorld(was); delete cache.worlds[other]; }
      cache.worlds[lookId] = world;
      // The models may have failed while this world was mid-build: it shows as Low poly then.
      if (lookFailed()) { dRevert(world.group); dRevert(world.horizon); world.detailOnly.forEach((m) => { m.visible = false; }); }
      // Its models fit in as they arrive, into the cached world itself, so it is ready next time too.
      else for (const sw of world.swaps) fitWhenLoaded(I, sw.get(), sw.fit, true);
    }
    // Detailed: a moment for models still on their way (then their Low poly pieces stand in).
    for (const t1 = now(); detailed && I.pending > 0 && !I.fellBack && now() - t1 < 1000;) yield ["Fetching the detailed models", 0.82];
    yield ["Rolling out the car", 0.84];
    D = makeDrive(world); fitCars(I);
    yield ["Warming up the shaders", 0.9];
    warmUp(world);
    yield ["Ready", 1];
  }
  function makeDrive(w: DriveWorld): DriveScene {
    const I = inst as Instance, mood = I.track.mood, m = mini as Mini;
    const s = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, m.camera.aspect, 0.3, 2000);
    s.add(w.group, w.horizon);
    s.fog = new THREE.Fog(mood.fog.color, mood.fog.near * DRIVE_FOG, mood.fog.far * DRIVE_FOG);
    const dsky = lpSky(mood, I.sunDir); dsky.scale.setScalar(31); s.add(dsky);
    // Brighter than the miniature: the idle scene's lighting is tuned to sit behind the page's title, this is not.
    s.add(new THREE.HemisphereLight(mood.hemi.sky, mood.hemi.ground, mood.hemi.intensity * 1.6));
    // One shadow-casting light, framed tightly on the car, only while driving.
    const sun = new THREE.DirectionalLight(mood.sun.color, mood.sun.intensity * 1.35), SH = opts.mobile ? 512 : 1024;
    sun.shadow.mapSize.set(SH, SH); Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 200 }); sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; s.add(sun, sun.target);
    // Detailed: glossy paint and glass (the Low poly stand-in car wears them too, so the model fitting
    // in later compiles nothing new).
    const carSize = LP_CAR_SIZE[I.carId], detailed = I.lookId === "detailed";
    const mat = detailed ? new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: "#3a3a3a" }) : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const glass = detailed ? new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 120, specular: "#8a96a8" }) : mat;
    const model = lpCar(I.carId, mat, carSize, glass); s.add(model.root);
    const ghostMat = new THREE.MeshBasicMaterial({ color: "#dfe8f5", transparent: true, opacity: 0.28, depthWrite: false });
    const ghostCar = lpCar(I.carId, ghostMat, carSize, ghostMat); ghostCar.root.visible = false; s.add(ghostCar.root);
    const smoke = lpSmoke(), skids = lpSkids();
    s.add(smoke.pts, skids.mesh);
    smoke.mat.uniforms.uPx.value = size ? size[2] : 1;
    return { scene: s, camera: cam, sun, sky: dsky, model, ghostCar, smoke, skids, ghostMat, marks: [], speedFrac: 0 };
  }
  // Compile every program and upload every buffer now, so the drive never hitches on first sight
  // (a shader compiled on first sight is a visible stall). The cached world's buffers stay on the GPU once uploaded, so after its first warm-up only
  // this instance's own objects are drawn; programs are still compiled for all.
  function warmUp(w: DriveWorld) {
    const R = renderer; if (!R || !D) return;
    D.sun.castShadow = true; D.ghostCar.root.visible = true;
    const culled: THREE.Object3D[] = []; D.scene.traverse((o) => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
    const rt = new THREE.WebGLRenderTarget(64, 64), prev = R.getRenderTarget(), shadows = R.shadowMap.enabled;
    // As every frame does (shadowsOn): a Canvas re-render during loading has put R3F's own shadow type
    // back, which three 0.186 no longer has.
    shadowsOn(R); R.compile(D.scene, D.camera);
    if (w.renderer === R) w.group.visible = w.horizon.visible = false;
    R.setRenderTarget(rt); R.render(D.scene, D.camera); R.setRenderTarget(prev);
    // And once on the canvas itself, scissored to one pixel. The target above draws other variants
    // (linear output, no multisampling), so without this the dive's first frame of the drive world
    // still waited on the canvas's own pipelines: 0.2 to 0.5 s against 0.05 to 0.08 s with it, on a
    // software renderer, on the very frame the dive crosses into the drive world. The shown
    // miniature is then drawn whole again, so the canvas is back before the browser shows it.
    const m = mini;
    if (!prev && m) {
      const scissor = R.getScissor(new THREE.Vector4()), test = R.getScissorTest();
      R.setScissor(0, 0, 1, 1); R.setScissorTest(true);
      R.render(D.scene, D.camera);
      R.setScissor(scissor); R.setScissorTest(test);
      R.render(m.scene, m.camera);
    }
    R.shadowMap.enabled = shadows; rt.dispose(); culled.forEach((o) => { o.frustumCulled = true; });
    w.group.visible = w.horizon.visible = true; w.renderer = R;
    D.ghostCar.root.visible = false; readyPrograms = R.info.programs?.length ?? 0;
  }

  // ---------- Phases: idle > loading > in (the dive) > drive > out (back to idle) ----------
  let t0 = 0, loadToken: object | null = null;
  const DUR = reduced ? 0 : 1.2;
  const from: MiniPose = { cam: new THREE.Vector3(), look: new THREE.Vector3(), rx: 0, ry: 0, x: 0 };
  const out = { cam: new THREE.Vector3(), look: new THREE.Vector3() };
  const showWorld = (w: "mini" | "drive") => { if (state.world !== w) set({ world: w }); };
  const setVeil = (o: number) => { if (hud.veil) hud.veil.style.opacity = String(o); };
  function enter() {
    if (state.phase !== "idle" || !mini || !inst) return;
    G.on = true; delete keys.steer;
    if (D) return dive();
    // Build step by step, yielding to the browser between chunks so the loader keeps moving.
    set({ phase: "loading", progress: { label: "Measuring the circuit", value: 0 } });
    const my = (loadToken = {}), gen = buildDrive();
    const pump = () => {
      if (loadToken !== my || disposed) return;
      const start = now(); let r = gen.next(), last: [string, number] | null = null;
      while (!r.done) { last = r.value; if (now() - start >= 24) break; r = gen.next(); }
      if (last) set({ progress: { label: last[0], value: Math.round(last[1] * 100) } });
      if (r.done) { loadToken = null; set({ progress: null }); dive(); } else setTimeout(pump, 0);
    };
    setTimeout(pump, 30);
  }
  // Everything is ready: reset the car on the grid and play the dive in.
  function dive() {
    const trk = dtrk as DriveTrack, m = mini as Mini, i0 = trk.i0, spec = (inst as NonNullable<typeof inst>).spec;
    G.idx = i0; G.pos.set(trk.P[i0].x, 0, trk.P[i0].z); G.h = Math.atan2(trk.T[i0].z, trk.T[i0].x);
    G.v = G.vl = G.r = G.st = 0; G.acc = 0; G.timing = false; G.lapT = 0; G.gi = 0; G.cp1 = G.cp2 = false; G.y = carPose(G, trk, spec).y;
    m.poseInto(from);
    m.placeMini(i0 / trk.N, G.h); m.miniCar.root.visible = true;
    chase.h = G.h; chaseTarget(0, true);
    t0 = now(); set({ phase: "in" });
    say("Out lap: cross the chequered line to start timing", 3);
  }
  function exit() {
    if (state.phase === "idle" || state.phase === "out") return;
    G.on = false; clearKeys();
    // Cancelled mid-build, a scene already rolled out may not be warmed up yet: it is freed, so the next
    // Drive builds it again and warms it before the dive (enter() dives straight into any D it finds).
    if (state.phase === "loading") { loadToken = null; disposeDrive(); set({ phase: "idle", progress: null }); atRest(); return; }
    const trk = dtrk as DriveTrack, m = mini as Mini, d = D as DriveScene;
    // The sun keeps its shadow until the miniature is back (below): the out transition's first half
    // still draws the drive world, and without the shadow every lit material there needs a program
    // the warm-up never compiled, a stall on the first frame after Esc.
    if (state.world === "mini") { chaseTarget(0, true); driveCamera(1); }
    m.placeMini(G.idx / trk.N, G.h); m.miniCar.root.visible = true;
    out.cam.copy(d.camera.position); out.look.copy(dlook);
    t0 = now(); outStartedAt = t0; set({ phase: "out" });
  }
  function clearKeys() { keys.w = keys.a = keys.s = keys.d = false; delete keys.steer; }

  // Put the car back on the track, pointing the right way. The lap in progress is voided.
  function respawn(why: string) {
    const trk = dtrk as DriveTrack, i = G.idx;
    G.pos.set(trk.P[i].x, 0, trk.P[i].z); G.h = Math.atan2(trk.T[i].z, trk.T[i].x); G.v = G.vl = G.r = G.st = 0;
    if (G.timing) { G.lapT = 0; G.gi = 0; G.cur.fill(-1); G.cp1 = G.cp2 = false; }
    G.timing = false; say(`${why}: timing restarts at the line`, 2.5);
  }
  const lapEvents = {
    say,
    split: (s: Split) => { lastSplit = { ...s, at: now() }; },
    newBest: (lap: number, times: Float32Array) => {
      best = { lap, times, mine: true };
      try { localStorage.setItem((inst as NonNullable<typeof inst>).store, JSON.stringify({ lap, times: Array.from(times) })); } catch { /* not stored this visit */ }
    },
  };
  const onTick = (prev: number) => lapTick(G, prev, G.idx, dtrk as DriveTrack, best as Best, lapEvents);

  // ---------- Cameras ----------
  // Driving: a chase camera 6 to 9 m behind and 2 to 3.5 m above the car, following its heading and
  // height with a lag that shortens with speed (chaseEase), so the car stays centred and never floats.
  const chase = { pos: new THREE.Vector3(), look: new THREE.Vector3(), h: 0 };
  const dlook = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const shake = { t: 9, amp: 0 };
  const chaseTarget = (dt: number, snap: boolean) => {
    const trk = dtrk as DriveTrack, spec = (inst as NonNullable<typeof inst>).spec;
    const k = snap ? 1 : chaseEase(G.v, dt), frac = Math.min(1, Math.abs(G.v) / spec.vMax);
    chase.h += Math.atan2(Math.sin(G.h - chase.h), Math.cos(G.h - chase.h)) * k;
    const back = 7.2 + 1.6 * frac, ch = Math.cos(chase.h), sh = Math.sin(chase.h);
    chase.pos.x = G.pos.x - ch * back; chase.pos.z = G.pos.z - sh * back;
    // Never under the road behind the car: on a crest or in a compression the camera lifts.
    const under = surfaceAt(trk, chase.pos.x, chase.pos.z, (G.idx - Math.round(back / trk.seg) + trk.N) % trk.N);
    const want = Math.max(G.y + 2.6 + 0.4 * frac, under + 1.2);
    chase.pos.y = snap ? want : chase.pos.y + (want - chase.pos.y) * k;
    chase.pos.y = Math.min(Math.max(chase.pos.y, G.y + 1.85, under + 0.8), G.y + 3.45);
    chase.look.set(G.pos.x + ch * 12, G.y + 1.1, G.pos.z + sh * 12);
  };
  // The drive camera for this frame: the chase pose, eased in from above on arrival, plus shake.
  function driveCamera(w: number) {
    const d = D as DriveScene, cam = d.camera, raise = 1 - w, world = shownWorld() as DriveWorld;
    cam.position.copy(chase.pos); dlook.copy(chase.look);
    if (raise > 0) {
      const c = Math.cos(chase.h), s = Math.sin(chase.h);
      cam.position.x -= c * 22 * raise; cam.position.z -= s * 22 * raise; cam.position.y += 16 * raise; dlook.y -= 2 * raise;
    }
    if (shake.t < 0.35) { shake.t += 1 / 60; const a = shake.amp * Math.exp(-shake.t / 0.1); cam.position.x += Math.sin(shake.t * 71) * a; cam.position.y += Math.sin(shake.t * 53 + 1) * a * 0.6; }
    cam.position.y += bumpAt(dtrk as DriveTrack, G.idx);
    cam.lookAt(dlook);
    // Portrait screens are narrow, so they get a wider vertical view to keep the road around the car.
    const fov = (cam.aspect < 1 ? 74 : 58) + 10 * (d.speedFrac || 0);
    if (Math.abs(cam.fov - fov) > 0.05 || cam.near !== 0.3) { cam.fov = fov; cam.near = 0.3; cam.updateProjectionMatrix(); }
    d.sky.position.copy(cam.position); world.follow(cam.position);
  }
  /** The cockpit camera: rigid on the body, no ease, no shake; see cockpit.ts. */
  function cockpitCamera() {
    const d = D as DriveScene, trk = dtrk as DriveTrack, cam = d.camera, spec = (inst as Instance).spec;
    cockpitPose(cam, G, carP ?? { roll: 0, pitch: 0 }, pose, { x: spec.eyeX, y: spec.eyeY, z: spec.eyeZ }, reduced ? 1 / 3 : 1, bumpAt(trk, G.idx), (x, z) => surfaceAt(trk, x, z, G.idx));
    const fov = cockpitFov(cam.aspect);
    if (Math.abs(cam.fov - fov) > 0.05 || cam.near !== 0.05) { cam.fov = fov; cam.near = 0.05; cam.updateProjectionMatrix(); }
    d.sky.position.copy(cam.position); (shownWorld() as DriveWorld).follow(cam.position);
  }
  /** The shown circuit's cached drive world in this instance's look. */
  const shownWorld = () => (inst ? (drives.get(inst.trackId)?.worlds[inst.lookId] ?? null) : null);

  // ---------- Chase and cockpit ----------
  // The choice persists (hero-camera, validated on read), applies to every car and circuit, and never
  // touches the idle miniature. Both cameras are recomputed from the car's live state every frame, so
  // switching is instant: there is nothing to ease between them.
  function toggleView() {
    if (!G.on || !D) return;
    const next: View = state.view === "cockpit" ? "chase" : "cockpit";
    writePref("view", next); set({ view: next });
  }

  // ---------- One frame of driving ----------
  const pose = { roll: 0, pitch: 0 };
  const text = (el: HTMLElement | null | undefined, s: string) => { if (el && el.textContent !== s) el.textContent = s; };
  function drive(dt: number) {
    const I = inst as Instance, trk = dtrk as DriveTrack, d = D as DriveScene, spec = I.spec, b = best as Best;
    stepFixed(G, keys, dt, trk, spec, onTick);
    const p = carPose(G, trk, spec); G.y = p.y; carP = p;
    const m = d.model, bump = bumpAt(trk, G.idx), frac = Math.min(1, Math.abs(G.v) / spec.vMax), SY = LP_CAR_SIZE[I.carId][1];
    // The body pitches under throttle and brakes and rolls in corners by the loads the tyres carry
    // (bodyPose), on top of the road's own slope and camber, which the wheels follow exactly.
    bodyPose(pose, G, spec, dt);
    m.root.position.set(G.pos.x, p.y, G.pos.z); m.root.rotation.set(-p.roll, -G.h, p.pitch);
    m.body.position.y = bump / SY; m.body.rotation.set(pose.roll, 0, pose.pitch);
    // The Low poly cockpit shell only shows from inside the car, and only while this car is still Low
    // poly (its stand-in included): a fitted model's own dash and pillars frame the view.
    const inCockpit = state.view === "cockpit";
    if (m.cockpit) m.cockpit.visible = inCockpit && m.root.userData.look !== "detailed";
    // The cockpit wheel turns with the front wheels, at a visual 4:1 over their 0.42 rad lock.
    if (m.steer) { m.steer.visible = inCockpit; (m.steer.userData.wheel as THREE.Object3D).rotation.x = (G.st || 0) * 0.42 * 4; }
    const planeAt = (w: { x: number; z: number }) => p.y + Math.tan(p.pitch) * ((w.x - G.pos.x) * Math.cos(G.h) + (w.z - G.pos.z) * Math.sin(G.h)) + Math.tan(p.roll) * (-(w.x - G.pos.x) * Math.sin(G.h) + (w.z - G.pos.z) * Math.cos(G.h));
    ["wheel-fl", "wheel-fr", "wheel-rl", "wheel-rr"].forEach((name, k) => {
      const w = m.wheels[name], c = p.wheels[k];
      w.pivot.position.y = w.y + (c.y - planeAt(c)) / SY;
      if (k < 2) w.pivot.rotation.y = -(G.st || 0) * 0.42;
      w.spin.rotation.z -= (G.v * dt) / w.r;
    });
    // Tyre smoke and skid marks when the rear tyres slide past this car's threshold.
    d.smoke.tick(dt);
    const sliding = (G.slip || 0) > spec.slip && Math.abs(G.v) > 8;
    [2, 3].forEach((k) => {
      const c = p.wheels[k], here = [c.x, c.y + 0.02, c.z], was = d.marks[k];
      if (sliding) { if (was) d.skids.mark(was, here, 0.32); d.smoke.puff(c.x, c.y + 0.3, c.z); d.marks[k] = here; } else d.marks[k] = null;
    });
    // The ghost of the best lap, once a timed lap is under way: a see-through copy of this car,
    // placed between the two points its recorded times straddle, pitched with the road.
    d.ghostCar.root.visible = G.timing;
    if (G.timing) {
      const gi = G.gi, g1 = (gi + 1) % trk.N, span = b.times[g1] - b.times[gi], u = span > 0 ? Math.min(1, Math.max(0, (G.lapT - b.times[gi]) / span)) : 0;
      const a = trk.P[gi], c = trk.P[g1], gh = Math.atan2(trk.T[gi].z, trk.T[gi].x), rise = (heightAt(trk, gi + 2) - heightAt(trk, gi - 2)) / (4 * trk.seg);
      d.ghostCar.root.position.set(a.x + (c.x - a.x) * u, heightAt(trk, gi + u), a.z + (c.z - a.z) * u); d.ghostCar.root.rotation.set(0, -gh, Math.atan(rise));
    }
    // A wall hit: a short HUD note and a camera shake scaled by the impact (never under reduced motion).
    if ((G.hit || 0) > 3) { say("Wall", 1.2); if (!reduced) { shake.t = 0; shake.amp = Math.min(0.45, (G.hit as number) * 0.02); } }
    G.hit = 0;
    chaseTarget(dt, false);
    d.sun.castShadow = true; d.sun.target.position.copy(m.root.position); d.sun.position.copy(m.root.position).addScaledVector(I.sunDir, 80);
    const f = (d.speedFrac = frac), kmh = String(Math.round(Math.abs(G.v) * KMH));
    if (hud.speedo) hud.speedo.dataset.speed = f.toFixed(3);
    hud.speedoFill?.setAttribute("stroke-dasharray", `${f.toFixed(3)} 1`);
    text(hud.speedoNum, kmh);
    const delta = G.timing ? G.lapT - b.times[G.idx] : null, msgOn = now() < G.msgUntil;
    text(hud.msg, msgOn ? G.msg : G.wrong ? "Wrong way" : "");
    if (hud.msg) hud.msg.dataset.tone = msgOn ? G.msgTone : "";
    text(hud.spd, `${kmh} km/h`);
    text(hud.lap, G.timing ? fmt(G.lapT) : "out lap");
    text(hud.last, G.last ? fmt(G.last) : "-:--.---");
    text(hud.bestLabel, b.mine ? "BEST" : "REF");
    text(hud.best, `${fmt(b.lap)}${b.mine ? " (you)" : ""}`);
    text(hud.delta, delta === null ? "--" : (delta >= 0 ? "+" : "") + delta.toFixed(2));
  }

  function key(read: KeyRead) {
    if ("action" in read) {
      if (read.action === "exit") exit();
      else if (read.action === "view") toggleView();
      else if (G.on && D && dtrk) respawn("Reset");
      return;
    }
    keys[read.key] = read.down;
    if (read.start) enter();
  }

  function place(f: number, v: number) {
    const trk = dtrk as DriveTrack, i = Math.round(f * trk.N) % trk.N;
    G.idx = i; G.pos.set(trk.P[i].x, 0, trk.P[i].z); G.h = Math.atan2(trk.T[i].z, trk.T[i].x); G.v = v; G.vl = G.r = 0;
    G.y = carPose(G, trk, (inst as Instance).spec).y; chase.h = G.h; chaseTarget(0, true);
  }

  function snapshot(w: number, h0?: number) {
    const R = renderer, m = mini; if (!R || !m) throw new Error("no renderer yet");
    const sz = R.getSize(new THREE.Vector2()), h = h0 || Math.round((w * sz.y) / sz.x), px = new Uint8Array(w * h * 4), d = driveScene();
    const sc = d ? d.scene : m.scene, cam = d ? d.camera : m.camera;
    // With h: drawn on the page's own canvas (so through its tone mapping and output colour space) and
    // read back before the browser shows it. Without: into a render target, linear.
    const draw = h0
      ? () => { const vp = R.getViewport(new THREE.Vector4()), pr = R.getPixelRatio(), gl = R.getContext(); R.setRenderTarget(null); R.setViewport(0, 0, w / pr, h / pr); R.render(sc, cam); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); R.setViewport(vp); }
      : () => { const rt = new THREE.WebGLRenderTarget(w, h); R.setRenderTarget(rt); R.render(sc, cam); R.readRenderTargetPixels(rt, 0, 0, w, h, px); R.setRenderTarget(null); rt.dispose(); };
    if (d) {
      const a = d.camera.aspect;
      if (h0) { d.camera.aspect = w / h; d.camera.updateProjectionMatrix(); }
      try { draw(); } finally { if (h0) { d.camera.aspect = a; d.camera.updateProjectionMatrix(); } }
    } else m.still(draw, h0 ? w / h : undefined);
    if (h0) R.render(sc, cam); // the canvas's own frame back before the browser shows it
    return { w, h, rgba: px };
  }

  const driveScene = () => (state.world === "drive" && D ? D : null);
  return {
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getState: () => state,
    attach(gl) { renderer = gl; shadowsOn(gl); },
    resize(w, h, dpr) {
      size = [w, h, dpr];
      mini?.resize(w, h, dpr, state.phase === "idle" || state.phase === "loading");
      if (D) { D.camera.aspect = w / h; D.camera.updateProjectionMatrix(); D.smoke.mat.uniforms.uPx.value = dpr; }
    },
    frame(dt, pointer) {
      if (!mini) return;
      // rAF steps are capped at 0.1 s, and nothing moves while the hero is off screen or the tab is
      // hidden; the first frame after a build draws the start pose at 1/60.
      if (fresh) { dt = 1 / 60; fresh = false; } else { dt = active ? Math.max(0, Math.min(0.1, dt)) : 0; t += dt; }
      lastDt = dt;
      if (renderer) shadowsOn(renderer);
      const m = mini, phase = state.phase, u = DUR ? (now() - t0) / (DUR * 1000) : 1;
      if ((phase === "in" || phase === "drive") && D) {
        drive(dt);
        if (phase === "in" && u < 1) {
          // The first half dives into the miniature; the second settles into the chase view.
          showWorld(u < 0.5 ? "mini" : "drive");
          setVeil(u < 0.5 ? smooth((u - 0.15) / 0.35) : 1 - smooth((u - 0.5) / 0.35));
          if (state.world === "mini") m.miniCamera(smooth(u / 0.5), from.rx, from.ry, from.x, from.cam, from.look);
          else { m.miniCar.root.visible = false; driveCamera(smooth((u - 0.5) / 0.5)); }
        } else {
          if (phase !== "drive") set({ phase: "drive" });
          showWorld("drive"); setVeil(0); m.miniCar.root.visible = false;
          // The dive always settles into the chase pose; once driving, the chosen view takes over.
          if (state.view === "cockpit") cockpitCamera(); else driveCamera(1);
        }
      } else {
        m.update(t, dt, pointer);
        if (phase === "out" && u < 1) {
          showWorld(u < 0.5 ? "drive" : "mini");
          setVeil(u < 0.5 ? smooth((u - 0.15) / 0.35) : 1 - smooth((u - 0.5) / 0.35));
          if (state.world === "drive" && D) { const w = smooth(u / 0.5); D.camera.position.lerpVectors(out.cam, v1.copy(out.cam).add(v2.set(0, 16, 0)), w); D.camera.lookAt(out.look); }
          else { const ry = m.rig.rotation.y, rx = m.rig.rotation.x; m.miniCamera(1 - smooth((u - 0.5) / 0.5), rx, ry, m.idle.x, m.idle.cam, m.idle.look); }
        } else if (phase === "out") {
          lastExitMs = now() - outStartedAt;
          if (D) D.sun.castShadow = false;
          showWorld("mini"); setVeil(0); m.restoreIdle();
          set({ phase: "idle" });
          atRest();
        }
      }
      m.followSky();
    },
    afterRender() { if (mini && !state.ready) set({ ready: true }); },
    get scene() { const d = driveScene(); return d ? d.scene : mini ? mini.scene : blank.scene; },
    get camera() { const d = driveScene(); return d ? d.camera : mini ? mini.camera : blank.camera; },
    setTrack(id) {
      if (!isTrackId(id) || id === state.trackId || state.phase !== "idle") return;
      writePref("trackId", id); set({ trackId: id }); void build();
    },
    setCar(id) {
      if (!isCarId(id) || state.phase !== "idle") return;
      if (!hinted.has(id)) { hinted.add(id); say(HINTS[id], 4); }
      if (id === state.carId) return;
      writePref("carId", id); set({ carId: id }); void build();
    },
    setLook(look) {
      if ((look !== "lowpoly" && look !== "detailed") || state.phase !== "idle") return;
      // The same look again rebuilds nothing; Detailed again after a failure says so again.
      if (look === state.look) { if (look === "detailed" && lookFailed()) say(D_FALLBACK, 5); return; }
      writePref("look", look); set({ look }); void build();
    },
    toggleView,
    setSteer(m, save = true) {
      if ((m !== "touch" && m !== "tilt") || disposed) return;
      if (save) writePref("steer", m);
      if (m !== state.steer) set({ steer: m });
    },
    pad(k) {
      keys.w = k.w; keys.a = k.a; keys.s = k.s; keys.d = k.d;
      if (k.steer === null) delete keys.steer; else keys.steer = k.steer;
    },
    say(text, secs) { if (!disposed) say(text, secs); },
    enter,
    exit,
    respawn() { if (G.on && D && dtrk) respawn("Reset"); },
    key,
    clearKeys,
    setActive(on) { active = on; },
    // Each overlay component binds its own elements; unbinding drops only those it bound.
    bindHud(refs) {
      hud = { ...hud, ...refs };
      return () => { const next: HudRefs = { ...hud }; for (const k of Object.keys(refs) as (keyof HudRefs)[]) if (next[k] === refs[k]) delete next[k]; hud = next; };
    },
    hudCommitted() { hudRenders++; },
    inspect() {
      return {
        get renderer() { return renderer; },
        get mini() { return mini; },
        get mood() { return state.shown ? (data.get(state.shown.trackId)?.track.mood ?? null) : null; },
        get scene() { const d = driveScene(); return d ? d.scene : mini ? mini.scene : blank.scene; },
        get camera() { const d = driveScene(); return d ? d.camera : mini ? mini.camera : blank.camera; },
        cacheStats: () => ({ driveWorlds: [...drives.values()].reduce((n, c) => n + Object.keys(c.worlds).length, 0), tracks: data.size, grounds: grounds.size }),
        G,
        get D() { return D; },
        get dtrk() { return dtrk; },
        get track() { return inst?.track ?? null; },
        get ground() { return inst ? (data.get(inst.trackId)?.ground ?? null) : null; },
        get world() { return shownWorld(); },
        get models() { return models; },
        get pending() { return inst?.pending ?? 0; },
        get carP() { return carP; },
        get spec() { return inst?.spec ?? CARS.gt3; },
        get best() { return best; },
        get store() { return inst?.store ?? null; },
        get chaseH() { return chase.h; },
        get readyPrograms() { return readyPrograms; },
        get lastSplit() { return lastSplit; },
        get lastExitMs() { return lastExitMs; },
        get lastDt() { return lastDt; },
        get hudRenders() { return hudRenders; },
        get shakeAmp() { return shake.t < 0.35 ? shake.amp : 0; },
        place,
        snapshot,
      };
    },
    dispose() {
      disposed = true; token++; loadToken = null; G.on = false;
      disposeDrive();
      // Unmounting (say, on a hot reload or a remount) frees everything this mount built, the cached drive
      // worlds included: their buffers and materials go with the renderer.
      for (const c of drives.values()) for (const w of Object.values(c.worlds)) { disposeTree(w.group, true); disposeTree(w.horizon, true); }
      if (inst) inst.alive = false;
      mini?.dispose(); mini = null; inst = null; models?.dispose(); models = null; data.clear(); grounds.clear(); drives.clear(); listeners.clear(); renderer = null; hud = {};
    },
  };
}
