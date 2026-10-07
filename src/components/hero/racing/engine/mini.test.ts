import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import spa from "../data/spa.json";
import type { Track } from "../data/types";
import { buildMini } from "./mini";

const SPA = spa.track as unknown as Track;

beforeAll(() => {
  // The gantry banner draws its text on a 2D canvas; node has none, and no pixel of it is read here.
  const ctx2d = { fillRect() {}, fillText() {}, measureText: () => ({ width: 0 }), font: "", fillStyle: "", textAlign: "", textBaseline: "" };
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) } });
});

/** What draw() sees: the camera's aspect, position and aim, and the rig's offset. */
function seen(m: ReturnType<typeof buildMini>) {
  const c = m.camera, fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
  return { aspect: c.aspect, pos: c.position.toArray(), fwd: fwd.toArray(), rigX: m.rig.position.x, rigRot: [m.rig.rotation.x, m.rig.rotation.y, m.rig.rotation.z] };
}
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe("the snapshot pose", () => {
  const mini = () => {
    const m = buildMini(structuredClone(SPA), null, "gt3", false);
    m.resize(1440, 900, 1); // the canvas's own aspect, 1.6
    return m;
  };

  it("with no aspect, draws from the camera as it stands, the rig square at its idle offset", () => {
    const m = mini(), before = seen(m);
    let during: ReturnType<typeof seen> | null = null;
    m.still(() => { during = seen(m); });
    expect(during!.aspect).toBe(1.6);
    close(during!.pos, before.pos);
    close(during!.fwd, before.fwd);
    expect(during!.rigX).toBeCloseTo((1.6 - 1.3) * 1.35, 12);
    close(during!.rigRot, [0, -0.35, 0]);
  });

  it("with an aspect, draws the vantage resize() gives a canvas of that shape, then puts everything back", () => {
    const m = mini(), before = seen(m);
    let during: ReturnType<typeof seen> | null = null;
    m.still(() => { during = seen(m); }, 480 / 270);
    // resize()'s formula at 16:9, worked by hand: rig 0.645 across, camera at (0, 9.2 x 0.62, 9.2 x 0.78),
    // aimed at (0.645 x 0.55, 0, 0).
    expect(during!.aspect).toBeCloseTo(16 / 9, 12);
    expect(during!.rigX).toBeCloseTo(0.645, 12);
    close(during!.pos, [0, 5.704, 7.176]);
    close(during!.fwd, new THREE.Vector3(0.35475, -5.704, -7.176).normalize().toArray());
    const after = seen(m);
    expect(after.aspect).toBe(1.6);
    close(after.pos, before.pos);
    close(after.fwd, before.fwd);
    expect(after.rigX).toBe(before.rigX);
    expect(m.camera.projectionMatrix.elements[0]).toBeCloseTo(new THREE.PerspectiveCamera(35, 1.6, 0.05, 100).projectionMatrix.elements[0], 12);
  });
});
