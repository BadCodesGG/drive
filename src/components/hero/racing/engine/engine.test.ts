import type * as THREE from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadTrackData } from "../data";
import { createRacingEngine, type RacingEngine } from "./engine";

// The sky and the gantry banner draw on a 2D canvas; node has none, and no pixel of it is read here.
beforeAll(() => {
  const ctx2d = { fillRect() {}, fillText() {}, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop() {} }), font: "", fillStyle: "", textAlign: "", textBaseline: "" };
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A renderer that only records what warm-up asks of it: compiling the drive's programs, and each draw. */
function fakeRenderer() {
  let target: unknown = null, scissor = false;
  const r = {
    compiles: 0,
    draws: [] as { scene: unknown; target: unknown; scissor: boolean }[],
    shadowMap: { enabled: false, type: 0 },
    info: { programs: [] },
    compile() { r.compiles++; },
    render(scene: unknown) { r.draws.push({ scene, target, scissor }); },
    getRenderTarget: () => target,
    setRenderTarget(t: unknown) { target = t; },
    getScissor: (v: THREE.Vector4) => v,
    getScissorTest: () => scissor,
    setScissor() {},
    setScissorTest(on: boolean) { scissor = on; },
  };
  return r;
}
async function ready(): Promise<{ engine: RacingEngine; gl: ReturnType<typeof fakeRenderer> }> {
  const engine = createRacingEngine({ mobile: false, reduced: false, loadTrack: loadTrackData });
  const gl = fakeRenderer();
  engine.attach(gl as unknown as THREE.WebGLRenderer);
  await vi.waitFor(() => expect(engine.getState().shown).not.toBeNull());
  return { engine, gl };
}

describe("Drive's loading", () => {
  it("cancelled while the shaders warm up, the next Drive warms them up before the dive", async () => {
    const { engine, gl } = await ready();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Every clock read is 25 ms on, so each loader tick runs exactly one build step.
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 25));
    engine.enter();
    for (let i = 0; i < 1000 && engine.getState().progress?.label !== "Warming up the shaders"; i++) vi.advanceTimersToNextTimer();
    expect(engine.getState().progress?.label).toBe("Warming up the shaders");
    expect(gl.compiles).toBe(0);
    engine.exit(); // Cancel
    expect(engine.getState().phase).toBe("idle");
    engine.enter();
    for (let i = 0; i < 1000 && engine.getState().phase !== "in"; i++) vi.advanceTimersToNextTimer();
    expect(engine.getState().phase).toBe("in");
    expect(gl.compiles).toBe(1);
    engine.dispose();
  });
  it("warm-up draws the drive world once on the canvas itself, then the miniature whole again", async () => {
    const { engine, gl } = await ready();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 25));
    engine.enter();
    for (let i = 0; i < 1000 && engine.getState().phase !== "in"; i++) vi.advanceTimersToNextTimer();
    expect(engine.getState().phase).toBe("in");
    // A render target compiles other variants than the canvas, so the canvas needs its own draw.
    const onCanvas = gl.draws.filter((d) => d.target === null);
    const warm = onCanvas.findIndex((d) => d.scissor);
    expect(warm).toBeGreaterThanOrEqual(0);
    // Scissored to a pixel, then the shown miniature repaints the whole canvas before it is shown.
    expect(onCanvas[warm + 1]).toMatchObject({ scissor: false });
    expect(onCanvas[warm + 1].scene).not.toBe(onCanvas[warm].scene);
    engine.dispose();
  });
  it("the sun keeps its shadow through the out transition's drive half, and drops it back at rest", async () => {
    const { engine } = await ready();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let clock = 0, step = 25;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += step));
    engine.enter();
    for (let i = 0; i < 1000 && engine.getState().phase !== "in"; i++) vi.advanceTimersToNextTimer();
    // From here the clock moves only when told: each frame lands at a chosen point of the transitions.
    step = 0;
    const at = (ms: number) => { clock += ms; engine.frame(1 / 60, { x: 0, y: 0, inside: false }); };
    at(1300);
    expect(engine.getState().phase).toBe("drive");
    engine.exit();
    at(100);
    // Still drawing the drive world: shadowless, its lit materials would need programs never compiled.
    expect(engine.getState()).toMatchObject({ phase: "out", world: "drive" });
    expect(engine.inspect().D?.sun.castShadow).toBe(true);
    at(1300);
    expect(engine.getState()).toMatchObject({ phase: "idle", world: "mini" });
    expect(engine.inspect().D?.sun.castShadow).toBe(false);
    engine.dispose();
  });
});

describe("the phone pad's steering mode (hero-steer)", () => {
  it("a mode the pad fell back to on its own is shown, but never overwrites the saved choice", async () => {
    const store = new Map([["hero-steer", "tilt"]]);
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    const { engine } = await ready();
    expect(engine.getState().steer).toBe("tilt");
    engine.setSteer("touch", false);
    expect(engine.getState().steer).toBe("touch");
    expect(store.get("hero-steer")).toBe("tilt");
    engine.setSteer("tilt");
    expect(store.get("hero-steer")).toBe("tilt");
    engine.setSteer("touch");
    expect(store.get("hero-steer")).toBe("touch");
    engine.dispose();
  });
});
